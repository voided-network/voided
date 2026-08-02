/**
 * Crypto Backend - Abstraction layer for browser cryptographic operations.
 *
 * Uses WASM (Rust) bindings in browsers. Node uses the TypeScript Web Crypto
 * implementation; browser fallback requires an explicit caller opt-in.
 *
 * This ensures the package works even without WASM,
 * while providing potential performance benefits when available.
 */

import { isWasmReady, getWasm, initWasm, type WasmModule } from './wasm/loader';
export { configureWasmLoader } from './wasm/loader';
export type { WasmLoaderOptions } from './wasm/loader';
import { CryptoService, HashService } from './crypto-service';
import * as tsCompression from './compression';
import { inspectCanonicalBase64 } from './base64-validation';
import {
  WASM_BOUNDED_DECOMPRESSION_MAX_BYTES,
  WASM_KDF_INPUT_MAX_BYTES,
  assertAggregateBytes,
  assertBytes as assertBoundaryBytes,
  assertCanonicalLowerHex,
  assertSafeInteger,
  hashAlgorithm,
  pbkdfParameters,
} from './wasm/boundary';

// Track which backend is in use
let _useWasm: boolean | null = null;
let _wasm: WasmModule | null = null;
let _tsCrypto: CryptoService | null = null;
let _tsHash: HashService | null = null;

const RAW_MAX_BYTES = 16 * 1024 * 1024;
const ENCRYPTION_MAX_BYTES = 100 * 1024 * 1024;
const ENCODED_ENCRYPTION_MAX_BYTES = ENCRYPTION_MAX_BYTES + 16;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)?.get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'length',
)?.get;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)?.get;
const HAS_OWN_PROPERTY = Object.prototype.hasOwnProperty;

function hasIntrinsicTypedArrayLength(value: object): boolean {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'length');
    if (descriptor) {
      return (
        descriptor.get === TYPED_ARRAY_LENGTH_GETTER &&
        descriptor.set === undefined
      );
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}

function getUint8ArrayByteLength(value: unknown, label: string): number {
  if (
    !TYPED_ARRAY_BYTE_LENGTH_GETTER ||
    !TYPED_ARRAY_LENGTH_GETTER ||
    !TYPED_ARRAY_TAG_GETTER
  ) {
    throw new Error(`${label} must be a Uint8Array`);
  }
  try {
    if (Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) !== 'Uint8Array') {
      throw new Error('wrong typed-array brand');
    }
    const length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
    if (
      Reflect.apply(HAS_OWN_PROPERTY, value, ['length']) ||
      !hasIntrinsicTypedArrayLength(value as object) ||
      Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) !== length
    ) {
      throw new Error('shadowed typed-array length');
    }
    return length;
  } catch {
    throw new Error(
      `${label} must be a Uint8Array (valid Uint8Array required)`,
    );
  }
}

function assertUint8ArrayWithinLimit(
  value: unknown,
  label: string,
  maxBytes: number,
): number {
  const length = getUint8ArrayByteLength(value, label);
  if (length > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  return length;
}

function assertAuthenticatedEncryptionAlgorithm(
  algorithm: unknown,
): asserts algorithm is AuthenticatedEncryptionResult['algorithm'] {
  if (algorithm !== 'xchacha20-poly1305' && algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported authenticated encryption algorithm');
  }
}

function assertExactUint8Array(
  value: unknown,
  label: string,
  expectedBytes: number,
): void {
  if (getUint8ArrayByteLength(value, label) !== expectedBytes) {
    throw new Error(`${label} must contain exactly ${expectedBytes} bytes`);
  }
}

/**
 * Check if we should use WASM module.
 * This is async and caches the result.
 */
export async function useWasmBackend(): Promise<boolean> {
  if (_useWasm === null) {
    try {
      _wasm = await getWasm();
      _useWasm = true;
    } catch (error) {
      const isNodeRuntime =
        typeof window === 'undefined' &&
        typeof process !== 'undefined' &&
        Boolean(process.versions?.node);
      if (!isNodeRuntime) {
        const detail = error instanceof Error ? `: ${error.message}` : '';
        throw new Error(
          'Voided WASM initialization failed; call forceTypeScriptBackend() explicitly to opt into the TypeScript backend' +
            detail,
        );
      }
      _useWasm = false;
    }
  }
  return _useWasm;
}

/**
 * Force TypeScript backend even if WASM is available.
 */
export function forceTypeScriptBackend(): void {
  _useWasm = false;
  _wasm = null;
}

/**
 * Force WASM backend. Will attempt to load WASM.
 */
export async function forceWasmBackend(): Promise<void> {
  _wasm = await initWasm();
  _useWasm = true;
}

/**
 * Get current backend name.
 */
export async function getCurrentBackend(): Promise<'wasm' | 'typescript'> {
  return (await useWasmBackend()) ? 'wasm' : 'typescript';
}

/**
 * Check synchronously if WASM is ready.
 */
export function isWasmBackendReady(): boolean {
  return isWasmReady();
}

// Get TS services
function getTsCrypto(): CryptoService {
  if (!_tsCrypto) {
    _tsCrypto = new CryptoService();
  }
  return _tsCrypto;
}

function getTsHash(): HashService {
  if (!_tsHash) {
    _tsHash = new HashService();
  }
  return _tsHash;
}

// Helper to convert Uint8Array key to CryptoKey for TS fallback
async function keyToCryptoKey(key: Uint8Array): Promise<CryptoKey> {
  assertExactUint8Array(key, 'AES-256 key', 32);
  // Use type assertion to satisfy TypeScript's strict BufferSource checks
  return crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ============================================================================
// ENCRYPTION FUNCTIONS
// ============================================================================

export interface EncryptionResult {
  data: string;
  iv: string;
  keyId: string;
  algorithm: string;
  compressed: boolean;
  originalSize: number;
  encryptedSize: number;
}

export interface AuthenticatedEncryptionResult {
  ciphertext: string;
  nonce: string;
  tag: string;
  algorithm: 'xchacha20-poly1305' | 'aes-256-gcm';
}

export interface FusedShellInfo {
  version: number;
  preset: 'compact' | 'balanced' | 'concealed' | string;
  chunkSize: number;
  chunkCount: number;
  payloadSize: number;
  shellSize: number;
  metadataSize: number;
  tagSize: number;
}

export interface ProtectedArtifactInfo {
  version: number;
  preset: 'compact' | 'balanced' | 'concealed' | string;
  compressionAlgorithm: 'gzip' | 'brotli' | 'none' | string;
  encryptionAlgorithm: 'xchacha20-poly1305' | 'aes-256-gcm' | string;
  originalSize: number;
  compressedSize: number;
  encryptedSize: number;
  protectedSize: number;
  shellChunkSize: number;
  shellChunkCount: number;
  shellNonce: Uint8Array;
}

export interface ProtectResult extends ProtectedArtifactInfo {
  artifact: Uint8Array;
}

/**
 * Generate a new encryption key.
 */
export async function generateKey(): Promise<Uint8Array> {
  if (await useWasmBackend()) {
    return _wasm!.generate_key();
  }
  return getTsCrypto().generateKeyBytes();
}

/**
 * Encrypt data with key.
 */
export async function encrypt(
  data: string | Uint8Array,
  key: Uint8Array
): Promise<EncryptionResult> {
  assertExactUint8Array(key, 'AES-256 key', 32);
  let dataBytes: Uint8Array;
  if (typeof data === 'string') {
    if (utf8ByteLength(data, ENCRYPTION_MAX_BYTES) > ENCRYPTION_MAX_BYTES) {
      throw new Error(`Encryption input exceeds ${ENCRYPTION_MAX_BYTES} bytes`);
    }
    dataBytes = new TextEncoder().encode(data);
  } else {
    assertUint8ArrayWithinLimit(
      data,
      'Encryption input',
      ENCRYPTION_MAX_BYTES,
    );
    dataBytes = data;
  }
  const dataLength = assertUint8ArrayWithinLimit(
    dataBytes,
    'Encryption input',
    ENCRYPTION_MAX_BYTES,
  );

  if (await useWasmBackend()) {
    // This compatibility API has always exposed AES-GCM's 12-byte IV shape.
    // Never inherit the WASM primitive's XChaCha default: doing so would
    // produce an EncryptionResult that this API's decrypt() correctly rejects.
    const result = _wasm!.encrypt(dataBytes, key, 'aes-256-gcm');
    if (result.algorithm !== 'aes-256-gcm') {
      throw new Error(
        `WASM returned an unexpected encryption algorithm: ${String(result.algorithm)}`,
      );
    }
    const nonce = base64ToBytes(result.nonce, 12);
    if (nonce.length !== 12) {
      throw new Error(`WASM returned an invalid AES-GCM IV length: ${nonce.length}`);
    }
    const ciphertext = base64ToBytes(result.ciphertext, ENCRYPTION_MAX_BYTES);
    const tag = base64ToBytes(result.tag, 16);
    if (tag.length !== 16) {
      throw new Error(`WASM returned an invalid AEAD tag length: ${tag.length}`);
    }
    const authenticatedCiphertext = new Uint8Array(ciphertext.length + tag.length);
    authenticatedCiphertext.set(ciphertext);
    authenticatedCiphertext.set(tag, ciphertext.length);
    return {
      data: bytesToBase64(authenticatedCiphertext),
      iv: bytesToBase64(nonce),
      keyId: 'default',
      algorithm: result.algorithm,
      compressed: false,
      originalSize: dataLength,
      encryptedSize: authenticatedCiphertext.length,
    };
  }

  // TS fallback
  const cryptoKey = await keyToCryptoKey(key);
  const encryptedBuffer = await getTsCrypto().encrypt(dataBytes, cryptoKey);
  const encryptedBytes = new Uint8Array(encryptedBuffer);

  // Extract IV (first 12 bytes) and ciphertext
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);

  // Encode to base64
  const ivB64 = bytesToBase64(iv);
  const dataB64 = bytesToBase64(ciphertext);

  return {
    data: dataB64,
    iv: ivB64,
    keyId: 'default',
    algorithm: 'aes-256-gcm',
    compressed: false,
    originalSize: dataLength,
    encryptedSize: ciphertext.length,
  };
}

/**
 * Decrypt data with key.
 */
export async function decrypt(
  encrypted: EncryptionResult,
  key: Uint8Array
): Promise<Uint8Array> {
  if (!encrypted || typeof encrypted !== 'object') {
    throw new Error('Encrypted result must be an object');
  }
  if (encrypted.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported encryption algorithm');
  }
  assertExactUint8Array(key, 'AES-256 key', 32);
  const ivBytes = base64ToBytes(encrypted.iv, 12);
  const dataBytes = base64ToBytes(encrypted.data, ENCODED_ENCRYPTION_MAX_BYTES);
  if (ivBytes.length !== 12) throw new Error('AES-GCM IV must contain exactly 12 bytes');
  if (dataBytes.length < 16) throw new Error('AES-GCM ciphertext is missing its tag');
  if (await useWasmBackend()) {
    const tagOffset = dataBytes.length - 16;
    return _wasm!.decrypt(
      bytesToBase64(dataBytes.subarray(0, tagOffset)),
      encrypted.iv,
      bytesToBase64(dataBytes.subarray(tagOffset)),
      key,
      encrypted.algorithm
    );
  }

  // TS fallback
  const cryptoKey = await keyToCryptoKey(key);

  return getTsCrypto().decrypt(dataBytes, ivBytes, cryptoKey, undefined, false);
}

/**
 * Encrypt bytes while binding caller-owned context as AEAD additional data.
 * XChaCha20-Poly1305 intentionally requires the first-party Voided WASM backend.
 */
export async function encryptWithAad(
  data: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array,
  algorithm: AuthenticatedEncryptionResult['algorithm'] = 'xchacha20-poly1305',
): Promise<AuthenticatedEncryptionResult> {
  const dataLength = assertUint8ArrayWithinLimit(
    data,
    'Authenticated encryption input',
    ENCRYPTION_MAX_BYTES,
  );
  assertExactUint8Array(key, 'AES-256 key', 32);
  const aadLength = assertUint8ArrayWithinLimit(
    aad,
    'Authenticated encryption additional data',
    RAW_MAX_BYTES,
  );
  assertAuthenticatedEncryptionAlgorithm(algorithm);
  assertAggregateBytes(
    'authenticated encryption working set',
    ENCRYPTION_MAX_BYTES,
    dataLength,
    aadLength,
    algorithm === 'xchacha20-poly1305' ? 24 : 12,
    16,
  );

  if (await useWasmBackend()) {
    const encrypted = _wasm!.encrypt_with_aad(data, key, aad, algorithm);
    return {
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      tag: encrypted.tag,
      algorithm: encrypted.algorithm as AuthenticatedEncryptionResult['algorithm'],
    };
  }
  if (algorithm !== 'aes-256-gcm') {
    throw new Error(
      'Voided XChaCha20-Poly1305 authenticated-data encryption requires the WASM backend',
    );
  }

  const cryptoKey = await keyToCryptoKey(key);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
        tagLength: 128,
      },
      cryptoKey,
      data as unknown as BufferSource,
    ),
  );
  const tagOffset = encrypted.length - 16;
  return {
    ciphertext: bytesToBase64(encrypted.subarray(0, tagOffset)),
    nonce: bytesToBase64(nonce),
    tag: bytesToBase64(encrypted.subarray(tagOffset)),
    algorithm,
  };
}

/** Decrypt bytes only when the exact authenticated context is supplied. */
export async function decryptWithAad(
  encrypted: AuthenticatedEncryptionResult,
  key: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (!encrypted || typeof encrypted !== 'object') {
    throw new Error('Authenticated encrypted result must be an object');
  }
  assertExactUint8Array(key, 'AES-256 key', 32);
  const aadLength = assertUint8ArrayWithinLimit(
    aad,
    'Authenticated decryption additional data',
    RAW_MAX_BYTES,
  );
  assertAuthenticatedEncryptionAlgorithm(encrypted.algorithm);
  const ciphertextLength = assertCanonicalBase64WithinLimit(
    encrypted.ciphertext,
    ENCRYPTION_MAX_BYTES,
    'Authenticated ciphertext',
  );
  const expectedNonceBytes = encrypted.algorithm === 'xchacha20-poly1305' ? 24 : 12;
  if (
    assertCanonicalBase64WithinLimit(
      encrypted.nonce,
      expectedNonceBytes,
      'AEAD nonce',
    ) !== expectedNonceBytes
  ) {
    throw new Error(`AEAD nonce must contain exactly ${expectedNonceBytes} bytes`);
  }
  if (
    assertCanonicalBase64WithinLimit(encrypted.tag, 16, 'AEAD tag') !== 16
  ) {
    throw new Error('AEAD tag must contain exactly 16 bytes');
  }
  assertAggregateBytes(
    'authenticated decryption working set',
    ENCRYPTION_MAX_BYTES,
    ciphertextLength,
    aadLength,
    expectedNonceBytes,
    16,
  );

  if (await useWasmBackend()) {
    return _wasm!.decrypt_with_aad(
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      key,
      encrypted.algorithm,
      aad,
    );
  }
  if (encrypted.algorithm !== 'aes-256-gcm') {
    throw new Error(
      'Voided XChaCha20-Poly1305 authenticated-data decryption requires the WASM backend',
    );
  }

  const cryptoKey = await keyToCryptoKey(key);
  const nonce = base64ToBytes(encrypted.nonce, 12);
  const ciphertext = base64ToBytes(encrypted.ciphertext, ENCRYPTION_MAX_BYTES);
  const tag = base64ToBytes(encrypted.tag, 16);
  if (nonce.length !== 12) throw new Error('AES-GCM nonce must contain exactly 12 bytes');
  if (tag.length !== 16) throw new Error('AES-GCM tag must contain exactly 16 bytes');
  const payload = new Uint8Array(ciphertext.length + tag.length);
  payload.set(ciphertext);
  payload.set(tag, ciphertext.length);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
        tagLength: 128,
      },
      cryptoKey,
      payload as unknown as BufferSource,
    ),
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function utf8ByteLength(value: string, stopAfter: number): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}

function assertCanonicalBase64WithinLimit(
  value: unknown,
  maxDecodedBytes: number,
  label = 'Base64 value',
): number {
  const inspection = inspectCanonicalBase64(value, maxDecodedBytes);
  if (!inspection.ok && inspection.reason === 'too-large') {
    throw new Error(`${label} exceeds its size limit`);
  }
  if (!inspection.ok) {
    throw new Error(`${label} is not canonical base64`);
  }
  return inspection.decodedLength;
}

function base64ToBytes(value: string, maxDecodedBytes: number): Uint8Array {
  const decodedLength = assertCanonicalBase64WithinLimit(
    value,
    maxDecodedBytes,
  );
  const binary = atob(value);
  if (binary.length !== decodedLength) throw new Error('Base64 value is noncanonical');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes;
}

/**
 * Derive key using HKDF.
 */
export async function deriveKeyHkdf(
  ikm: Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array
): Promise<Uint8Array> {
  assertBoundaryBytes(
    ikm,
    'HKDF input key material',
    WASM_KDF_INPUT_MAX_BYTES,
    1,
  );
  if (salt !== null) {
    assertBoundaryBytes(salt, 'HKDF salt', WASM_KDF_INPUT_MAX_BYTES);
  }
  assertBoundaryBytes(info, 'HKDF info', WASM_KDF_INPUT_MAX_BYTES);
  if (await useWasmBackend()) {
    return _wasm!.derive_key_hkdf(ikm, salt, info);
  }

  return getTsCrypto().deriveKey(ikm, salt || new Uint8Array(), info);
}

/**
 * Derive key using PBKDF2.
 */
export async function deriveKeyPbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  pbkdfParameters(password, salt, iterations);
  if (await useWasmBackend()) {
    return _wasm!.derive_key_pbkdf2(password, salt, iterations);
  }

  return getTsCrypto().deriveKeyPbkdf2(password, salt, iterations);
}

// ============================================================================
// HASHING FUNCTIONS
// ============================================================================

/**
 * Hash data.
 */
export async function hash(
  data: Uint8Array,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): Promise<string> {
  assertBoundaryBytes(data, 'Hash input', ENCRYPTION_MAX_BYTES);
  const checkedAlgorithm = hashAlgorithm(algorithm);
  if (await useWasmBackend()) {
    return _wasm!.hash(data, checkedAlgorithm);
  }

  return getTsHash().hash(data, checkedAlgorithm);
}

/**
 * Hash data with salt.
 */
export async function hashWithSalt(
  data: Uint8Array,
  salt: Uint8Array,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): Promise<string> {
  const dataLength = assertBoundaryBytes(
    data,
    'Salted hash input',
    ENCRYPTION_MAX_BYTES,
  );
  const saltLength = assertBoundaryBytes(
    salt,
    'Salted hash salt',
    RAW_MAX_BYTES,
  );
  assertAggregateBytes(
    'salted hash transcript',
    ENCRYPTION_MAX_BYTES,
    dataLength,
    saltLength,
    64,
  );
  const checkedAlgorithm = hashAlgorithm(algorithm);
  if (await useWasmBackend()) {
    return _wasm!.hash_with_salt(data, salt, checkedAlgorithm);
  }

  return getTsHash().hashWithSalt(data, salt, checkedAlgorithm);
}

/**
 * Compare hashes in constant time.
 */
export async function compareHashes(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  assertBoundaryBytes(a, 'First hash comparison input', 64);
  assertBoundaryBytes(b, 'Second hash comparison input', 64);
  if (await useWasmBackend()) {
    return _wasm!.compare_hashes(a, b);
  }

  return getTsHash().compare(a, b);
}

/**
 * Generate HMAC.
 */
export async function generateHmac(
  data: Uint8Array,
  key: Uint8Array,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): Promise<string> {
  assertBoundaryBytes(data, 'HMAC input', ENCRYPTION_MAX_BYTES);
  assertBoundaryBytes(key, 'HMAC key', WASM_KDF_INPUT_MAX_BYTES, 1);
  const checkedAlgorithm = hashAlgorithm(algorithm);
  if (await useWasmBackend()) {
    return _wasm!.generate_hmac(data, key, checkedAlgorithm);
  }

  return getTsHash().hmac(data, key, checkedAlgorithm);
}

/**
 * Generate fingerprint from data.
 */
export async function generateFingerprint(
  data: Uint8Array,
  length = 8
): Promise<string> {
  assertBoundaryBytes(data, 'Fingerprint input', ENCRYPTION_MAX_BYTES);
  const checkedLength = assertSafeInteger(
    length,
    'fingerprint length',
    1,
    32,
  );
  if (await useWasmBackend()) {
    return _wasm!.generate_fingerprint(data, checkedLength);
  }

  return getTsHash().fingerprint(data, checkedLength);
}

/**
 * Generate safety numbers for verification.
 */
export async function generateSafetyNumbers(
  data: Uint8Array,
  groupSize = 5
): Promise<string> {
  assertBoundaryBytes(data, 'Safety-number input', ENCRYPTION_MAX_BYTES);
  const checkedGroupSize = assertSafeInteger(
    groupSize,
    'safety-number group size',
    1,
    32,
  );
  if (await useWasmBackend()) {
    return _wasm!.generate_safety_numbers(data, checkedGroupSize);
  }

  return getTsHash().safetyNumbers(data, checkedGroupSize);
}

// ============================================================================
// COMPRESSION FUNCTIONS
// ============================================================================

/**
 * Compress data.
 */
export async function compress(
  data: Uint8Array,
  algorithm: 'gzip' | 'brotli' = 'gzip'
): Promise<tsCompression.CompressionResult> {
  assertUint8ArrayWithinLimit(data, 'Compression input', ENCRYPTION_MAX_BYTES);
  if (algorithm !== 'gzip' && algorithm !== 'brotli') {
    throw new Error(`Unsupported compression algorithm: ${String(algorithm)}`);
  }
  if (await useWasmBackend()) {
    const result = _wasm!.compress(data, algorithm);
    return {
      compressed: new Uint8Array(result.compressed),
      algorithm: result.algorithm as 'gzip' | 'brotli' | 'none',
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      compressionRatio: result.compressionRatio,
    };
  }

  return tsCompression.compress(data, { algorithm });
}

/**
 * Decompress data.
 */
export async function decompress(
  data: Uint8Array,
  algorithm: 'gzip' | 'brotli'
): Promise<Uint8Array> {
  assertUint8ArrayWithinLimit(
    data,
    'Compressed browser input',
    ENCRYPTION_MAX_BYTES,
  );
  if (algorithm !== 'gzip' && algorithm !== 'brotli') {
    throw new Error(`Unsupported compression algorithm: ${String(algorithm)}`);
  }
  if (await useWasmBackend()) {
    const output = _wasm!.decompress(data, algorithm);
    assertUint8ArrayWithinLimit(
      output,
      'Decompressed browser output',
      ENCRYPTION_MAX_BYTES,
    );
    return output;
  }

  return tsCompression.decompress(data, algorithm);
}

/**
 * Decompress with an explicit absolute output ceiling.
 *
 * This API is intentionally WASM-only: falling back to a decoder that
 * materializes unbounded output would violate the method's security contract.
 */
export async function decompressBounded(
  data: Uint8Array,
  algorithm: 'gzip' | 'brotli',
  maxOutputBytes: number,
): Promise<Uint8Array> {
  assertUint8ArrayWithinLimit(
    data,
    'Bounded compressed browser input',
    WASM_BOUNDED_DECOMPRESSION_MAX_BYTES,
  );
  if (algorithm !== 'gzip' && algorithm !== 'brotli') {
    throw new Error(`Unsupported compression algorithm: ${String(algorithm)}`);
  }
  if (
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 0 ||
    maxOutputBytes > WASM_BOUNDED_DECOMPRESSION_MAX_BYTES
  ) {
    throw new Error(
      `Bounded decompression output limit must be an integer from 0 to ${WASM_BOUNDED_DECOMPRESSION_MAX_BYTES}`,
    );
  }
  if (!(await useWasmBackend())) {
    throw new Error(
      'Bounded decompression requires the Rust WASM backend in e2ee-client',
    );
  }

  const output = _wasm!.decompress_bounded(
    data,
    algorithm,
    maxOutputBytes,
  );
  assertUint8ArrayWithinLimit(
    output,
    'Bounded decompressed browser output',
    maxOutputBytes,
  );
  return output;
}

// ============================================================================
// FUSED SHELL / FULL-FLOW
// ============================================================================

function fusedWasmOnlyError(): Error {
  return new Error(
    'Voided v3 shell and monolith artifact APIs currently require the Rust WASM backend in e2ee-client'
  );
}

export async function fuse(
  data: Uint8Array,
  key: Uint8Array,
  preset: 'compact' | 'balanced' | 'concealed' = 'balanced',
  chunkSize?: number,
): Promise<Uint8Array> {
  if (await useWasmBackend()) {
    return _wasm!.fuse(data, key, preset, chunkSize);
  }

  throw fusedWasmOnlyError();
}

export async function unfuse(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (await useWasmBackend()) {
    return _wasm!.unfuse(data, key);
  }

  throw fusedWasmOnlyError();
}

export async function inspectFused(data: Uint8Array): Promise<FusedShellInfo> {
  if (await useWasmBackend()) {
    return _wasm!.inspectFused(data);
  }

  throw fusedWasmOnlyError();
}

export async function protect(
  data: Uint8Array,
  key: Uint8Array,
  options: {
    preset?: 'compact' | 'balanced' | 'concealed';
    compressionAlgorithm?: 'gzip' | 'brotli' | 'none';
    compressionLevel?: number;
    encryptionAlgorithm?: 'xchacha20-poly1305' | 'aes-256-gcm';
    shellChunkSize?: number;
  } = {},
): Promise<ProtectResult> {
  if (await useWasmBackend()) {
    return _wasm!.protect(
      data,
      key,
      options.preset,
      options.compressionAlgorithm,
      options.compressionLevel,
      options.encryptionAlgorithm,
      options.shellChunkSize,
    );
  }

  throw fusedWasmOnlyError();
}

export async function open(artifact: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  if (await useWasmBackend()) {
    return _wasm!.open(artifact, key);
  }

  throw fusedWasmOnlyError();
}

export async function inspectArtifact(artifact: Uint8Array): Promise<ProtectedArtifactInfo> {
  if (await useWasmBackend()) {
    return _wasm!.inspectArtifact(artifact);
  }

  throw fusedWasmOnlyError();
}

export async function repackArtifact(
  artifact: Uint8Array,
  key: Uint8Array,
  options: {
    preset?: 'compact' | 'balanced' | 'concealed';
    compressionAlgorithm?: 'gzip' | 'brotli' | 'none';
    compressionLevel?: number;
    encryptionAlgorithm?: 'xchacha20-poly1305' | 'aes-256-gcm';
    shellChunkSize?: number;
  } = {},
): Promise<ProtectResult> {
  if (await useWasmBackend()) {
    return _wasm!.repackArtifact(
      artifact,
      key,
      options.preset,
      options.compressionAlgorithm,
      options.compressionLevel,
      options.encryptionAlgorithm,
      options.shellChunkSize,
    );
  }

  throw fusedWasmOnlyError();
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate random bytes.
 */
export async function randomBytes(length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(length) || length < 1 || length > RAW_MAX_BYTES) {
    throw new Error(`Random byte length must be an integer from 1 to ${RAW_MAX_BYTES}`);
  }
  if (await useWasmBackend()) {
    return _wasm!.random_bytes(length);
  }

  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < bytes.length; offset += 65_536) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65_536, bytes.length)));
  }
  return bytes;
}

/**
 * Generate random salt.
 */
export async function generateSalt(length = 16): Promise<Uint8Array> {
  if (!Number.isSafeInteger(length) || length < 16 || length > 1024) {
    throw new Error('Salt length must be an integer from 16 to 1024 bytes');
  }
  if (await useWasmBackend()) {
    return _wasm!.generate_salt(length);
  }

  return randomBytes(length);
}

/**
 * Encode to Base64.
 */
export async function base64Encode(data: Uint8Array): Promise<string> {
  assertBoundaryBytes(data, 'Base64 input', RAW_MAX_BYTES);
  if (await useWasmBackend()) {
    return _wasm!.base64_encode(data);
  }

  return bytesToBase64(data);
}

/**
 * Decode from Base64.
 */
export async function base64Decode(encoded: string): Promise<Uint8Array> {
  // Validate and cap before either JS or WASM is allowed to allocate.
  return base64ToBytes(encoded, RAW_MAX_BYTES);
}

/**
 * Encode to Hex.
 */
export async function hexEncode(data: Uint8Array): Promise<string> {
  const inputLength = assertBoundaryBytes(data, 'Hex input', RAW_MAX_BYTES);
  if (await useWasmBackend()) {
    return _wasm!.hex_encode(data);
  }

  const encoded = new Uint8Array(inputLength * 2);
  try {
    for (let index = 0; index < inputLength; index++) {
      const byte = data[index];
      const high = byte >>> 4;
      const low = byte & 0x0f;
      encoded[index * 2] = high < 10 ? 0x30 + high : 0x61 + high - 10;
      encoded[index * 2 + 1] = low < 10 ? 0x30 + low : 0x61 + low - 10;
    }
    return new TextDecoder().decode(encoded);
  } finally {
    encoded.fill(0);
  }
}

/**
 * Decode from Hex.
 */
export async function hexDecode(encoded: string): Promise<Uint8Array> {
  const decodedLength = assertCanonicalLowerHex(
    encoded,
    'Hex input',
    RAW_MAX_BYTES,
  );
  if (await useWasmBackend()) {
    return _wasm!.hex_decode(encoded);
  }
  const bytes = new Uint8Array(decodedLength);
  for (let i = 0; i < bytes.length; i++) {
    const highCode = encoded.charCodeAt(i * 2);
    const lowCode = encoded.charCodeAt(i * 2 + 1);
    const high = highCode <= 0x39 ? highCode - 0x30 : highCode - 0x61 + 10;
    const low = lowCode <= 0x39 ? lowCode - 0x30 : lowCode - 0x61 + 10;
    bytes[i] = (high << 4) | low;
  }
  return bytes;
}
