import {
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
});
