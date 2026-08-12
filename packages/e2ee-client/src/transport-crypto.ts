/**
 * Audited browser primitives for transport and protocol SDKs.
 *
 * Product and transport packages must use this boundary instead of calling
 * WebCrypto directly. Voided owns runtime validation, key algorithms, key
 * extraction policy, randomness, and the exact browser primitive mapping.
 */

import { assertBytes, assertExactBytes, assertSafeInteger } from './wasm/boundary';

const X25519_KEY_BYTES = 32;
const X25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);
const X25519_BASEPOINT = Uint8Array.from([9, ...new Array<number>(31).fill(0)]);
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const AES_GCM_KEY_BITS = 256;
const AES_GCM_NONCE_BYTES = 12;
const MAX_RAW_BYTES = 16 * 1024 * 1024;

export interface VoidedTransportKeyPair {
  publicKey: Uint8Array;
  privateKey: CryptoKey;
  rawCryptoKeyPair: CryptoKeyPair;
}

function browserCrypto(): Crypto {
  const runtime = globalThis.crypto;
  if (!runtime?.subtle || typeof runtime.getRandomValues !== 'function') {
    throw new Error('Voided transport crypto requires a WebCrypto runtime');
  }
  return runtime;
}

function exactBytes(value: Uint8Array, label: string, expected: number): Uint8Array {
  assertExactBytes(value, label, expected);
  return value;
}

function boundedBytes(value: Uint8Array, label: string, minimum = 0): Uint8Array {
  assertBytes(value, label, MAX_RAW_BYTES, minimum);
  return value;
}

function aesUsages(usages: readonly KeyUsage[]): KeyUsage[] {
  if (usages.length === 0 || usages.some((usage) => usage !== 'encrypt' && usage !== 'decrypt')) {
    throw new Error('Voided transport AES-GCM usages must contain encrypt and/or decrypt');
  }
  return Array.from(new Set(usages));
}

function hkdfUsages(usages: readonly KeyUsage[]): KeyUsage[] {
  if (usages.length === 0 || usages.some((usage) => usage !== 'deriveBits' && usage !== 'deriveKey')) {
    throw new Error('Voided transport HKDF usages must contain deriveBits and/or deriveKey');
  }
  return Array.from(new Set(usages));
}

export function transportRandomBytes(length: number): Uint8Array {
  const checkedLength = assertSafeInteger(length, 'transport random length', 1, MAX_RAW_BYTES);
  const output = new Uint8Array(checkedLength);
  for (let offset = 0; offset < output.length; offset += 65_536) {
    browserCrypto().getRandomValues(output.subarray(offset, Math.min(offset + 65_536, output.length)));
  }
  return output;
}

export function transportRandomUuid(): string {
  const bytes = transportRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function generateTransportX25519KeyPair(): Promise<VoidedTransportKeyPair> {
  const pair = await browserCrypto().subtle.generateKey('X25519', true, ['deriveBits']) as CryptoKeyPair;
  const publicKey = new Uint8Array(await browserCrypto().subtle.exportKey('raw', pair.publicKey));
  exactBytes(publicKey, 'X25519 public key', X25519_KEY_BYTES);
  return { publicKey, privateKey: pair.privateKey, rawCryptoKeyPair: pair };
}

export async function deriveTransportX25519SharedSecret(
  privateKey: CryptoKey,
  peerPublicKey: Uint8Array,
): Promise<Uint8Array> {
  exactBytes(peerPublicKey, 'X25519 peer public key', X25519_KEY_BYTES);
  const imported = await browserCrypto().subtle.importKey('raw', peerPublicKey, 'X25519', false, []);
  const secret = new Uint8Array(await browserCrypto().subtle.deriveBits(
    { name: 'X25519', public: imported },
    privateKey,
    256,
  ));
  exactBytes(secret, 'X25519 shared secret', X25519_KEY_BYTES);
  if (secret.every((byte) => byte === 0)) {
    secret.fill(0);
    throw new Error('Voided rejected a non-contributory X25519 shared secret');
  }
  return secret;
}

export async function deriveTransportX25519PublicKey(privateSeed: Uint8Array): Promise<Uint8Array> {
  exactBytes(privateSeed, 'X25519 private seed', X25519_KEY_BYTES);
  const pkcs8 = new Uint8Array(X25519_PKCS8_PREFIX.length + privateSeed.length);
  pkcs8.set(X25519_PKCS8_PREFIX, 0);
  pkcs8.set(privateSeed, X25519_PKCS8_PREFIX.length);
  try {
    const privateKey = await browserCrypto().subtle.importKey('pkcs8', pkcs8, 'X25519', false, ['deriveBits']);
    const basepoint = await browserCrypto().subtle.importKey('raw', X25519_BASEPOINT, 'X25519', false, []);
    const publicKey = new Uint8Array(await browserCrypto().subtle.deriveBits(
      { name: 'X25519', public: basepoint },
      privateKey,
      256,
    ));
    return exactBytes(publicKey, 'X25519 public key', X25519_KEY_BYTES);
  } finally {
    pkcs8.fill(0);
  }
}

export async function generateTransportEd25519KeyPair(): Promise<VoidedTransportKeyPair> {
  const pair = await browserCrypto().subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const publicKey = new Uint8Array(await browserCrypto().subtle.exportKey('raw', pair.publicKey));
  exactBytes(publicKey, 'Ed25519 public key', ED25519_PUBLIC_KEY_BYTES);
  return { publicKey, privateKey: pair.privateKey, rawCryptoKeyPair: pair };
}

export async function signTransportEd25519(data: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array> {
  boundedBytes(data, 'Ed25519 message');
  const signature = new Uint8Array(await browserCrypto().subtle.sign('Ed25519', privateKey, data));
  return exactBytes(signature, 'Ed25519 signature', ED25519_SIGNATURE_BYTES);
}

export async function verifyTransportEd25519(
  data: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  boundedBytes(data, 'Ed25519 message');
  exactBytes(signature, 'Ed25519 signature', ED25519_SIGNATURE_BYTES);
  exactBytes(publicKey, 'Ed25519 public key', ED25519_PUBLIC_KEY_BYTES);
  const imported = await browserCrypto().subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify']);
  return browserCrypto().subtle.verify('Ed25519', imported, signature, data);
}

export async function deriveTransportAesGcmKey(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  usages: readonly KeyUsage[],
  extractable = false,
): Promise<CryptoKey> {
  const ikm = await importTransportHkdfKey(inputKeyMaterial, ['deriveKey']);
  return deriveTransportAesGcmKeyFromHkdfKey(ikm, salt, info, usages, extractable);
}

export async function importTransportHkdfKey(
  inputKeyMaterial: Uint8Array,
  usages: readonly KeyUsage[] = ['deriveBits', 'deriveKey'],
): Promise<CryptoKey> {
  boundedBytes(inputKeyMaterial, 'HKDF input key material', 1);
  return browserCrypto().subtle.importKey('raw', inputKeyMaterial, 'HKDF', false, hkdfUsages(usages));
}

export async function deriveTransportAesGcmKeyFromHkdfKey(
  inputKey: CryptoKey,
  salt: Uint8Array,
  info: Uint8Array,
  usages: readonly KeyUsage[],
  extractable = false,
): Promise<CryptoKey> {
  boundedBytes(salt, 'HKDF salt');
  boundedBytes(info, 'HKDF info');
  return browserCrypto().subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    inputKey,
    { name: 'AES-GCM', length: AES_GCM_KEY_BITS },
    extractable,
    aesUsages(usages),
  );
}

export async function deriveTransportHkdfBytes(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes = 32,
): Promise<Uint8Array> {
  const inputKey = await importTransportHkdfKey(inputKeyMaterial, ['deriveBits']);
  return deriveTransportHkdfBytesFromKey(inputKey, salt, info, lengthBytes);
}

export async function deriveTransportHkdfBytesFromKey(
  inputKey: CryptoKey,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes = 32,
): Promise<Uint8Array> {
  const checkedLength = assertSafeInteger(lengthBytes, 'HKDF output length', 1, MAX_RAW_BYTES);
  boundedBytes(salt, 'HKDF salt');
  boundedBytes(info, 'HKDF info');
  return new Uint8Array(await browserCrypto().subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    inputKey,
    checkedLength * 8,
  ));
}

export async function hashTransportSha256(data: Uint8Array): Promise<Uint8Array> {
  boundedBytes(data, 'SHA-256 input');
  return new Uint8Array(await browserCrypto().subtle.digest('SHA-256', data));
}

export async function generateTransportAesGcmKey(
  extractable = false,
  usages: readonly KeyUsage[] = ['encrypt', 'decrypt'],
): Promise<CryptoKey> {
  return browserCrypto().subtle.generateKey(
    { name: 'AES-GCM', length: AES_GCM_KEY_BITS },
    extractable,
    aesUsages(usages),
  );
}

export async function importTransportAesGcmKey(
  rawKey: Uint8Array,
  extractable = false,
  usages: readonly KeyUsage[] = ['encrypt', 'decrypt'],
): Promise<CryptoKey> {
  exactBytes(rawKey, 'AES-GCM key', AES_GCM_KEY_BITS / 8);
  return browserCrypto().subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: AES_GCM_KEY_BITS },
    extractable,
    aesUsages(usages),
  );
}

export async function exportTransportAesGcmKey(key: CryptoKey): Promise<Uint8Array> {
  const rawKey = new Uint8Array(await browserCrypto().subtle.exportKey('raw', key));
  return exactBytes(rawKey, 'AES-GCM key', AES_GCM_KEY_BITS / 8);
}

export async function createTransportP256EnvelopeKey(
  peerPublicKeySpki: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  usages: readonly KeyUsage[] = ['encrypt'],
): Promise<{ key: CryptoKey; ephemeralPublicKeySpki: Uint8Array }> {
  boundedBytes(peerPublicKeySpki, 'P-256 peer SPKI', 1);
  boundedBytes(salt, 'P-256 envelope salt');
  boundedBytes(info, 'P-256 envelope info');
  const peerPublicKey = await browserCrypto().subtle.importKey(
    'spki',
    peerPublicKeySpki,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ephemeral = await browserCrypto().subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const sharedSecret = new Uint8Array(await browserCrypto().subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    ephemeral.privateKey,
    256,
  ));
  try {
    exactBytes(sharedSecret, 'P-256 shared secret', 32);
    const key = await deriveTransportAesGcmKey(sharedSecret, salt, info, usages);
    const ephemeralPublicKeySpki = new Uint8Array(
      await browserCrypto().subtle.exportKey('spki', ephemeral.publicKey),
    );
    boundedBytes(ephemeralPublicKeySpki, 'P-256 ephemeral SPKI', 1);
    return { key, ephemeralPublicKeySpki };
  } finally {
    sharedSecret.fill(0);
  }
}

export async function sealTransportAesGcm(
  plaintext: Uint8Array,
  key: CryptoKey,
  aad?: Uint8Array,
  nonce = transportRandomBytes(AES_GCM_NONCE_BYTES),
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  boundedBytes(plaintext, 'AES-GCM plaintext');
  exactBytes(nonce, 'AES-GCM nonce', AES_GCM_NONCE_BYTES);
  if (aad) boundedBytes(aad, 'AES-GCM additional data');
  const algorithm: AesGcmParams = { name: 'AES-GCM', iv: nonce };
  if (aad) algorithm.additionalData = aad;
  const ciphertext = new Uint8Array(await browserCrypto().subtle.encrypt(algorithm, key, plaintext));
  return { ciphertext, nonce: nonce.slice() };
}

export async function openTransportAesGcm(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: CryptoKey,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  boundedBytes(ciphertext, 'AES-GCM ciphertext', 16);
  exactBytes(nonce, 'AES-GCM nonce', AES_GCM_NONCE_BYTES);
  if (aad) boundedBytes(aad, 'AES-GCM additional data');
  const algorithm: AesGcmParams = { name: 'AES-GCM', iv: nonce };
  if (aad) algorithm.additionalData = aad;
  return new Uint8Array(await browserCrypto().subtle.decrypt(algorithm, key, ciphertext));
}

export async function exportTransportPrivateKeyPkcs8(privateKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await browserCrypto().subtle.exportKey('pkcs8', privateKey));
}

export async function importTransportEd25519PublicKey(publicKey: Uint8Array): Promise<CryptoKey> {
  exactBytes(publicKey, 'Ed25519 public key', ED25519_PUBLIC_KEY_BYTES);
  return browserCrypto().subtle.importKey('raw', publicKey, 'Ed25519', true, ['verify']);
}

export async function importTransportEd25519PrivateKey(
  privateKeyPkcs8: Uint8Array,
  extractable: boolean,
): Promise<CryptoKey> {
  boundedBytes(privateKeyPkcs8, 'Ed25519 PKCS#8 private key', 1);
  return browserCrypto().subtle.importKey('pkcs8', privateKeyPkcs8, 'Ed25519', extractable, ['sign']);
}

export async function importTransportX25519PublicKey(publicKey: Uint8Array): Promise<CryptoKey> {
  exactBytes(publicKey, 'X25519 public key', X25519_KEY_BYTES);
  return browserCrypto().subtle.importKey('raw', publicKey, 'X25519', true, []);
}

export async function importTransportX25519PrivateKey(
  privateKeyPkcs8: Uint8Array,
  extractable: boolean,
): Promise<CryptoKey> {
  boundedBytes(privateKeyPkcs8, 'X25519 PKCS#8 private key', 1);
  return browserCrypto().subtle.importKey('pkcs8', privateKeyPkcs8, 'X25519', extractable, ['deriveBits']);
}
