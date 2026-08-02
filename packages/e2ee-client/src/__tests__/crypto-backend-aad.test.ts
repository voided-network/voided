import {
  base64Decode,
  decryptWithAad,
  encryptWithAad,
  forceTypeScriptBackend,
  generateKey,
} from '../crypto-backend';

describe('Voided authenticated-data crypto backend', () => {
  beforeEach(() => {
    forceTypeScriptBackend();
  });

  test('roundtrips AES-GCM only with the exact authenticated context', async () => {
    const key = await generateKey();
    const plaintext = new TextEncoder().encode('owned media epoch');
    const aad = new TextEncoder().encode('session=owned-screen|epoch=7');
    const encrypted = await encryptWithAad(
      plaintext,
      key,
      aad,
      'aes-256-gcm',
    );

    await expect(decryptWithAad(encrypted, key, aad)).resolves.toEqual(
      plaintext,
    );
    await expect(
      decryptWithAad(
        encrypted,
        key,
        new TextEncoder().encode('session=other|epoch=7'),
      ),
    ).rejects.toBeDefined();
  });

  test('roundtrips empty AES-GCM plaintext as canonical empty base64', async () => {
    const key = await generateKey();
    const aad = new Uint8Array();
    const encrypted = await encryptWithAad(
      new Uint8Array(),
      key,
      aad,
      'aes-256-gcm',
    );

    expect(encrypted.ciphertext).toBe('');
    await expect(decryptWithAad(encrypted, key, aad)).resolves.toEqual(
      new Uint8Array(),
    );
  });

  test('never substitutes AES-GCM for requested XChaCha without Voided WASM', async () => {
    const key = await generateKey();
    await expect(
      encryptWithAad(
        new Uint8Array([1, 2, 3]),
        key,
        new Uint8Array([4, 5, 6]),
      ),
    ).rejects.toThrow('requires the WASM backend');
  });

  test('rejects hostile byte inputs before the crypto backend is reached', async () => {
    const encryptSpy = jest.spyOn(crypto.subtle, 'encrypt');
    const decryptSpy = jest.spyOn(crypto.subtle, 'decrypt');
    const key = new Uint8Array(32);
    const fakeOversizeBytes = {
      byteLength: 100 * 1024 * 1024 + 1,
      length: 100 * 1024 * 1024 + 1,
    } as unknown as Uint8Array;
    const oversizedAad = new Uint8Array(16 * 1024 * 1024 + 1);
    const validShell = {
      ciphertext: 'AQ==',
      nonce: 'AAAAAAAAAAAAAAAA',
      tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
      algorithm: 'aes-256-gcm' as const,
    };

    try {
      await expect(
        encryptWithAad(fakeOversizeBytes, key, new Uint8Array(), 'aes-256-gcm')
      ).rejects.toThrow('must be a Uint8Array');
      await expect(
        encryptWithAad(new Uint8Array([1]), key, oversizedAad, 'aes-256-gcm')
      ).rejects.toThrow('exceeds 16777216 bytes');
      await expect(
        decryptWithAad(validShell, key, oversizedAad)
      ).rejects.toThrow('exceeds 16777216 bytes');
      await expect(
        decryptWithAad(
          { ...validShell, ciphertext: { length: Number.MAX_SAFE_INTEGER } as any },
          key,
          new Uint8Array(),
        )
      ).rejects.toThrow('not canonical base64');

      expect(encryptSpy).not.toHaveBeenCalled();
      expect(decryptSpy).not.toHaveBeenCalled();
    } finally {
      encryptSpy.mockRestore();
      decryptSpy.mockRestore();
    }
  });

  test('rejects non-zero base64 pad bits before the backend is reached', async () => {
    const importKeySpy = jest.spyOn(crypto.subtle, 'importKey');
    const decryptSpy = jest.spyOn(crypto.subtle, 'decrypt');
    const key = new Uint8Array(32);
    const aad = new Uint8Array();
    const validShell = {
      ciphertext: 'AQ==',
      nonce: 'AAAAAAAAAAAAAAAA',
      tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
      algorithm: 'aes-256-gcm' as const,
    };

    try {
      await expect(
        decryptWithAad({ ...validShell, ciphertext: 'AR==' }, key, aad)
      ).rejects.toThrow('Authenticated ciphertext is not canonical base64');
      await expect(
        decryptWithAad(
          { ...validShell, nonce: 'AAAAAAAAAAAAAAB=' },
          key,
          aad,
        )
      ).rejects.toThrow('AEAD nonce is not canonical base64');
      await expect(
        decryptWithAad(
          { ...validShell, tag: 'AAAAAAAAAAAAAAAAAAAAAB==' },
          key,
          aad,
        )
      ).rejects.toThrow('AEAD tag is not canonical base64');
      await expect(base64Decode('AB==')).rejects.toThrow(
        'Base64 value is not canonical base64'
      );

      expect(importKeySpy).not.toHaveBeenCalled();
      expect(decryptSpy).not.toHaveBeenCalled();
    } finally {
      importKeySpy.mockRestore();
      decryptSpy.mockRestore();
    }
  });
});
