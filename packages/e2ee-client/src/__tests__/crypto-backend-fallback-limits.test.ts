import {
  compareHashes,
  deriveKeyHkdf,
  deriveKeyPbkdf2,
  encrypt,
  forceTypeScriptBackend,
  generateFingerprint,
  generateHmac,
  generateSafetyNumbers,
  hash,
  hashWithSalt,
  hexDecode,
  hexEncode,
} from '../crypto-backend';

describe('raw crypto TypeScript fallback allocation boundary', () => {
  beforeEach(() => {
    forceTypeScriptBackend();
  });

  test('rejects hostile typed-array objects before fallback primitives run', async () => {
    const spoofed = Object.create(Uint8Array.prototype) as Uint8Array;

    await expect(
      deriveKeyHkdf(spoofed, null, new Uint8Array()),
    ).rejects.toThrow('valid Uint8Array');
    await expect(hash(spoofed)).rejects.toThrow('valid Uint8Array');
    await expect(hexEncode(spoofed)).rejects.toThrow('valid Uint8Array');
    await expect(
      encrypt(spoofed, new Uint8Array(32)),
    ).rejects.toThrow('valid Uint8Array');

    const shortKeyWithShadowedLength = new Uint8Array(16);
    Object.defineProperty(shortKeyWithShadowedLength, 'length', { value: 32 });
    await expect(
      encrypt(new Uint8Array(), shortKeyWithShadowedLength),
    ).rejects.toThrow('valid Uint8Array');

    const statefulLength = new Uint8Array([1]);
    let reads = 0;
    Object.defineProperty(statefulLength, 'length', {
      get: () => (++reads === 1 ? 1 : 0x7fffffff),
    });
    await expect(hash(statefulLength)).rejects.toThrow('valid Uint8Array');
    expect(reads).toBe(0);
  });

  test('enforces exact KDF, digest, and formatter parameters in fallback mode', async () => {
    await expect(
      deriveKeyPbkdf2(new Uint8Array([1]), new Uint8Array(16), 99_999),
    ).rejects.toThrow('PBKDF2 iterations');
    await expect(
      compareHashes(new Uint8Array(65), new Uint8Array(32)),
    ).rejects.toThrow('64');
    await expect(
      generateHmac(new Uint8Array(), new Uint8Array()),
    ).rejects.toThrow('HMAC key');
    await expect(
      generateFingerprint(new Uint8Array(), 33),
    ).rejects.toThrow('fingerprint length');
    await expect(
      generateSafetyNumbers(new Uint8Array(), 0),
    ).rejects.toThrow('safety-number group size');
    await expect(
      hash(new Uint8Array(), 'sha3' as 'sha256'),
    ).rejects.toThrow('unsupported');
  });

  test('validates long hexadecimal input iteratively without a regex stack blowup', async () => {
    const longInvalid = `${'00'.repeat(512 * 1024)}G0`;
    await expect(hexDecode(longInvalid)).rejects.toThrow(
      'canonical lowercase hexadecimal',
    );
    await expect(hexDecode('00ff')).resolves.toEqual(
      new Uint8Array([0, 255]),
    );
    await expect(hexEncode(new Uint8Array([0, 255]))).resolves.toBe('00ff');
  });

  test('keeps salted fallback transcripts bounded', async () => {
    const spoofed = Object.create(Uint8Array.prototype) as Uint8Array;
    await expect(
      hashWithSalt(new Uint8Array(), spoofed),
    ).rejects.toThrow('valid Uint8Array');
  });
});
