import {
  createTransportP256EnvelopeKey,
  deriveTransportAesGcmKey,
  deriveTransportHkdfBytes,
  deriveTransportHkdfBytesFromKey,
  deriveTransportX25519PublicKey,
  deriveTransportX25519SharedSecret,
  exportTransportAesGcmKey,
  exportTransportPrivateKeyPkcs8,
  generateTransportEd25519KeyPair,
  generateTransportX25519KeyPair,
  hashTransportSha256,
  importTransportAesGcmKey,
  importTransportHkdfKey,
  importTransportP256PublicKey,
  importTransportX25519PrivateKey,
  openTransportAesGcm,
  sealTransportAesGcm,
  signTransportEd25519,
  transportRandomBytes,
  transportRandomUuid,
  verifyTransportEd25519,
} from '../transport-crypto';

describe('Voided transport crypto boundary', () => {
  test('owns secure randomness and RFC 4122 v4 identifiers', () => {
    expect(transportRandomBytes(32)).toHaveLength(32);
    expect(transportRandomUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(() => transportRandomBytes(0)).toThrow(/transport random length/);
  });

  test('roundtrips X25519, HKDF, and AES-GCM with authenticated context', async () => {
    const alice = await generateTransportX25519KeyPair();
    const bob = await generateTransportX25519KeyPair();
    const aliceSecret = await deriveTransportX25519SharedSecret(alice.privateKey, bob.publicKey);
    const bobSecret = await deriveTransportX25519SharedSecret(bob.privateKey, alice.publicKey);
    expect(aliceSecret).toEqual(bobSecret);

    const salt = new TextEncoder().encode('tube-test-salt');
    const info = new TextEncoder().encode('tube-test-info');
    const aad = new TextEncoder().encode('tube-test-route');
    const [sealKey, openKey] = await Promise.all([
      deriveTransportAesGcmKey(aliceSecret, salt, info, ['encrypt']),
      deriveTransportAesGcmKey(bobSecret, salt, info, ['decrypt']),
    ]);
    const plaintext = new TextEncoder().encode('private transport payload');
    const sealed = await sealTransportAesGcm(plaintext, sealKey, aad);
    await expect(openTransportAesGcm(sealed.ciphertext, sealed.nonce, openKey, aad))
      .resolves.toEqual(plaintext);
    await expect(openTransportAesGcm(
      sealed.ciphertext,
      sealed.nonce,
      openKey,
      new TextEncoder().encode('wrong-route'),
    )).rejects.toBeDefined();

    aliceSecret.fill(0);
    bobSecret.fill(0);
  });

  test('preserves extractable X25519 identity persistence through Voided', async () => {
    const original = await generateTransportX25519KeyPair();
    const pkcs8 = await exportTransportPrivateKeyPkcs8(original.privateKey);
    const restored = await importTransportX25519PrivateKey(pkcs8, false);
    const peer = await generateTransportX25519KeyPair();
    const [before, after] = await Promise.all([
      deriveTransportX25519SharedSecret(original.privateKey, peer.publicKey),
      deriveTransportX25519SharedSecret(restored, peer.publicKey),
    ]);
    expect(after).toEqual(before);
    pkcs8.fill(0);
    before.fill(0);
    after.fill(0);
  });

  test('owns deterministic X25519 derivation and reusable HKDF/AES key custody', async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const firstPublic = await deriveTransportX25519PublicKey(seed);
    const secondPublic = await deriveTransportX25519PublicKey(seed);
    expect(firstPublic).toHaveLength(32);
    expect(secondPublic).toEqual(firstPublic);

    const salt = new TextEncoder().encode('managed-e2ee-salt');
    const info = new TextEncoder().encode('managed-e2ee-info');
    const hkdfKey = await importTransportHkdfKey(seed);
    const direct = await deriveTransportHkdfBytes(seed, salt, info);
    const reused = await deriveTransportHkdfBytesFromKey(hkdfKey, salt, info);
    expect(reused).toEqual(direct);

    const imported = await importTransportAesGcmKey(seed, true);
    const raw = await exportTransportAesGcmKey(imported);
    expect(raw).toEqual(seed);
    const restored = await importTransportAesGcmKey(raw, false);
    const sealed = await sealTransportAesGcm(new TextEncoder().encode('managed payload'), restored);
    await expect(openTransportAesGcm(sealed.ciphertext, sealed.nonce, restored))
      .resolves.toEqual(new TextEncoder().encode('managed payload'));
  });

  test('creates a P-256 envelope key compatible with the recipient agreement', async () => {
    const receiver = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    ) as CryptoKeyPair;
    const receiverSpki = new Uint8Array(await crypto.subtle.exportKey('spki', receiver.publicKey));
    const salt = transportRandomBytes(32);
    const info = new TextEncoder().encode('slipner:mcp:crypto-grant:v1');
    const envelope = await createTransportP256EnvelopeKey(receiverSpki, salt, info, ['encrypt']);
    const ephemeralPublic = await crypto.subtle.importKey(
      'spki',
      new Uint8Array(envelope.ephemeralPublicKeySpki).buffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const receiverSecret = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'ECDH', public: ephemeralPublic },
      receiver.privateKey,
      256,
    ));
    const receiverKey = await deriveTransportAesGcmKey(receiverSecret, salt, info, ['decrypt']);
    const sealed = await sealTransportAesGcm(
      new TextEncoder().encode('mcp app key'),
      envelope.key,
    );
    await expect(openTransportAesGcm(sealed.ciphertext, sealed.nonce, receiverKey))
      .resolves.toEqual(new TextEncoder().encode('mcp app key'));
    receiverSecret.fill(0);
  });

  test('keeps P-256 envelope private and wrapping keys non-exportable', async () => {
    const receiver = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    ) as CryptoKeyPair;
    const receiverSpki = new Uint8Array(await crypto.subtle.exportKey('spki', receiver.publicKey));
    const generated = jest.spyOn(crypto.subtle, 'generateKey');
    try {
      const envelope = await createTransportP256EnvelopeKey(
        receiverSpki,
        transportRandomBytes(32),
        new TextEncoder().encode('slipner:mcp:crypto-grant:v1'),
        ['encrypt'],
      );
      expect(generated).toHaveBeenCalledTimes(1);
      expect(generated).toHaveBeenCalledWith({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const ephemeral = await generated.mock.results[0].value as CryptoKeyPair;
      expect(ephemeral.privateKey.extractable).toBe(false);
      expect(ephemeral.publicKey.extractable).toBe(true);
      expect(envelope.key.extractable).toBe(false);
      expect(envelope.key.usages).toEqual(['encrypt']);
      await expect(crypto.subtle.exportKey('pkcs8', ephemeral.privateKey)).rejects.toBeDefined();
      await expect(crypto.subtle.exportKey('jwk', ephemeral.privateKey)).rejects.toBeDefined();
      await expect(crypto.subtle.exportKey('raw', envelope.key)).rejects.toBeDefined();
      const publicSpki = new Uint8Array(await crypto.subtle.exportKey('spki', ephemeral.publicKey));
      expect(envelope.ephemeralPublicKeySpki).toEqual(publicSpki);
    } finally {
      generated.mockRestore();
    }
  });

  test('preserves sliced byte views without copying or invoking caller accessors', async () => {
    const expected = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const backing = new Uint8Array(64).fill(0xee);
    backing.set(expected, 16);
    const view = backing.subarray(16, 48);
    for (const name of ['buffer', 'byteOffset', 'byteLength']) {
      Object.defineProperty(view, name, { get() { throw new Error('Caller accessor executed'); } });
    }
    const imported = jest.spyOn(crypto.subtle, 'importKey');
    try {
      const key = await importTransportAesGcmKey(view, true);
      const argument = imported.mock.calls[0][1];
      expect(argument).toBeInstanceOf(Uint8Array);
      if (!(argument instanceof Uint8Array)) throw new Error('Expected a checked byte view');
      expect(argument.buffer).toBe(backing.buffer);
      expect(argument.byteOffset).toBe(16);
      expect(argument.byteLength).toBe(32);
      expect(await exportTransportAesGcmKey(key)).toEqual(expected);
      expect(await hashTransportSha256(view)).toEqual(await hashTransportSha256(expected));
      expect(backing.subarray(0, 16).every(byte => byte === 0xee)).toBe(true);
      expect(backing.subarray(48).every(byte => byte === 0xee)).toBe(true);
    } finally {
      imported.mockRestore();
    }
  });

  test('rejects shared byte storage before native key import or hashing', async () => {
    const shared = new Uint8Array(new SharedArrayBuffer(32));
    const imported = jest.spyOn(crypto.subtle, 'importKey');
    const digest = jest.spyOn(crypto.subtle, 'digest');
    try {
      await expect(importTransportHkdfKey(shared)).rejects.toThrow('non-shared ArrayBuffer-backed bytes');
      await expect(hashTransportSha256(shared)).rejects.toThrow('non-shared ArrayBuffer-backed bytes');
      expect(imported).not.toHaveBeenCalled();
      expect(digest).not.toHaveBeenCalled();
    } finally {
      imported.mockRestore();
      digest.mockRestore();
    }
  });

  test('signs and verifies Ed25519 without exposing primitives to callers', async () => {
    const signer = await generateTransportEd25519KeyPair();
    const message = new TextEncoder().encode('tube handshake transcript');
    const signature = await signTransportEd25519(message, signer.privateKey);
    await expect(verifyTransportEd25519(message, signature, signer.publicKey)).resolves.toBe(true);
    const changed = message.slice();
    changed[0] ^= 1;
    await expect(verifyTransportEd25519(changed, signature, signer.publicKey)).resolves.toBe(false);
  });

  test.each(['verify', 'agreement'] as const)('imports a P-256 public key for %s without creating private keys', async purpose => {
    const spki = Uint8Array.from(('3059301306072a8648ce3d020106082a8648ce3d03010703420004'
      + '6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'
      + '4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5').match(/../g)!, byte => parseInt(byte, 16));
    const generated = jest.spyOn(crypto.subtle, 'generateKey');
    const exported = jest.spyOn(crypto.subtle, 'exportKey');
    try {
      const key = await importTransportP256PublicKey(spki, purpose);
      expect(key.type).toBe('public'); expect(key.extractable).toBe(false);
      expect(key.algorithm).toEqual({ name: purpose === 'verify' ? 'ECDSA' : 'ECDH', namedCurve: 'P-256' });
      expect(key.usages).toEqual(purpose === 'verify' ? ['verify'] : []);
      expect(generated).not.toHaveBeenCalled(); expect(exported).not.toHaveBeenCalled();
    } finally { generated.mockRestore(); exported.mockRestore(); }
  });

  test('rejects invalid P-256 import purpose and byte ownership before native import', async () => {
    const imported = jest.spyOn(crypto.subtle, 'importKey');
    try {
      await expect(importTransportP256PublicKey(new Uint8Array(91), 'sign' as 'verify')).rejects.toThrow(/purpose/);
      await expect(importTransportP256PublicKey(new Uint8Array(90), 'verify')).rejects.toThrow(/91/);
      await expect(importTransportP256PublicKey(new Uint8Array(new SharedArrayBuffer(91)), 'verify')).rejects.toThrow(/non-shared/);
      expect(imported).not.toHaveBeenCalled();
    } finally { imported.mockRestore(); }
  });

  test('rejects a malformed P-256 public point rather than accepting its 91-byte shape', async () => {
    const spki = Uint8Array.from(('3059301306072a8648ce3d020106082a8648ce3d03010703420004'
      + '00'.repeat(64)).match(/../g)!, byte => parseInt(byte, 16));
    await expect(importTransportP256PublicKey(spki, 'verify')).rejects.toBeDefined();
    await expect(importTransportP256PublicKey(spki, 'agreement')).rejects.toBeDefined();
  });

  test('returns canonical SHA-256 bytes and rejects malformed inputs', async () => {
    const digest = await hashTransportSha256(new TextEncoder().encode('abc'));
    expect(Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await expect(deriveTransportX25519SharedSecret(
      (await generateTransportX25519KeyPair()).privateKey,
      new Uint8Array(31),
    )).rejects.toThrow(/exactly 32 bytes/);
  });
});
