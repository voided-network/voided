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
      envelope.ephemeralPublicKeySpki,
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

  test('signs and verifies Ed25519 without exposing primitives to callers', async () => {
    const signer = await generateTransportEd25519KeyPair();
    const message = new TextEncoder().encode('tube handshake transcript');
    const signature = await signTransportEd25519(message, signer.privateKey);
    await expect(verifyTransportEd25519(message, signature, signer.publicKey)).resolves.toBe(true);
    const changed = message.slice();
    changed[0] ^= 1;
    await expect(verifyTransportEd25519(changed, signature, signer.publicKey)).resolves.toBe(false);
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
