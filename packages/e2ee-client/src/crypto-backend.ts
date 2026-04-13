/**
 * Crypto Backend - Abstraction layer for browser cryptographic operations.
 * 
 * Uses WASM (Rust) bindings when available, falls back to TypeScript
 * implementations (Web Crypto API) when WASM cannot be loaded.
 * 
 * This ensures the package works even without WASM,
 * while providing potential performance benefits when available.
 */

import { isWasmReady, getWasm, initWasm, type WasmModule } from './wasm/loader';
import { CryptoService, HashService } from './crypto-service';
import * as tsCompression from './compression';

// Track which backend is in use
let _useWasm: boolean | null = null;
let _wasm: WasmModule | null = null;
let _tsCrypto: CryptoService | null = null;
let _tsHash: HashService | null = null;

// For TS fallback, we need to cache imported keys
const _keyCache = new Map<string, CryptoKey>();

/**
 * Check if we should use WASM module.
 * This is async and caches the result.
 */
export async function useWasmBackend(): Promise<boolean> {
  if (_useWasm === null) {
    try {
      _wasm = await getWasm();
      _useWasm = true;
    } catch {
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
  const keyHex = Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
  
  if (_keyCache.has(keyHex)) {
    return _keyCache.get(keyHex)!;
  }
  
  // Use type assertion to satisfy TypeScript's strict BufferSource checks
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  
  _keyCache.set(keyHex, cryptoKey);
  return cryptoKey;
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
  const dataBytes = typeof data === 'string' 
    ? new TextEncoder().encode(data) 
    : data;
  
  if (await useWasmBackend()) {
    const result = _wasm!.encrypt(dataBytes, key);
    return {
      data: result.ciphertext,
      iv: result.nonce,
      keyId: 'default',
      algorithm: result.algorithm,
      compressed: false,
      originalSize: dataBytes.length,
      encryptedSize: result.ciphertext.length,
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
  const ivB64 = btoa(String.fromCharCode(...iv));
  const dataB64 = btoa(String.fromCharCode(...ciphertext));
  
  return {
    data: dataB64,
    iv: ivB64,
    keyId: 'default',
    algorithm: 'aes-256-gcm',
    compressed: false,
    originalSize: dataBytes.length,
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
  if (await useWasmBackend()) {
    return _wasm!.decrypt(
      encrypted.data,
      encrypted.iv,
      '', // tag is embedded in ciphertext for wasm
      key,
      encrypted.algorithm
    );
  }
  
  // TS fallback
  const cryptoKey = await keyToCryptoKey(key);
  
  // Decode base64
  const ivBytes = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));
  const dataBytes = Uint8Array.from(atob(encrypted.data), c => c.charCodeAt(0));
  
  return getTsCrypto().decrypt(dataBytes, ivBytes, cryptoKey);
}

/**
 * Derive key using HKDF.
 */
export async function deriveKeyHkdf(
  ikm: Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array
): Promise<Uint8Array> {
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
  if (await useWasmBackend()) {
    return _wasm!.hash(data, algorithm);
  }
  
  return getTsHash().hash(data, algorithm);
}

/**
 * Hash data with salt.
 */
export async function hashWithSalt(
  data: Uint8Array,
  salt: Uint8Array,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): Promise<string> {
  if (await useWasmBackend()) {
    return _wasm!.hash_with_salt(data, salt, algorithm);
  }
  
  return getTsHash().hashWithSalt(data, salt, algorithm);
}

/**
 * Compare hashes in constant time.
 */
export async function compareHashes(a: Uint8Array, b: Uint8Array): Promise<boolean> {
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
  if (await useWasmBackend()) {
    return _wasm!.generate_hmac(data, key, algorithm);
  }
  
  return getTsHash().hmac(data, key, algorithm);
}

/**
 * Generate fingerprint from data.
 */
export async function generateFingerprint(
  data: Uint8Array,
  length = 8
): Promise<string> {
  if (await useWasmBackend()) {
    return _wasm!.generate_fingerprint(data, length);
  }
  
  return getTsHash().fingerprint(data, length);
}

/**
 * Generate safety numbers for verification.
 */
export async function generateSafetyNumbers(
  data: Uint8Array,
  groupSize = 5
): Promise<string> {
  if (await useWasmBackend()) {
    return _wasm!.generate_safety_numbers(data, groupSize);
  }
  
  return getTsHash().safetyNumbers(data, groupSize);
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
  if (await useWasmBackend()) {
    return _wasm!.decompress(data, algorithm);
  }
  
  return tsCompression.decompress(data, algorithm);
}

// ============================================================================
// FUSED SHELL / FULL-FLOW
// ============================================================================

function fusedWasmOnlyError(): Error {
  return new Error(
    'Voided v2 fused shell APIs currently require the Rust WASM backend in e2ee-client'
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
  if (await useWasmBackend()) {
    return _wasm!.random_bytes(length);
  }
  
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generate random salt.
 */
export async function generateSalt(length = 16): Promise<Uint8Array> {
  if (await useWasmBackend()) {
    return _wasm!.generate_salt(length);
  }
  
  return randomBytes(length);
}

/**
 * Encode to Base64.
 */
export async function base64Encode(data: Uint8Array): Promise<string> {
  if (await useWasmBackend()) {
    return _wasm!.base64_encode(data);
  }
  
  // Browser-compatible base64 encoding
  let binary = '';
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode from Base64.
 */
export async function base64Decode(encoded: string): Promise<Uint8Array> {
  if (await useWasmBackend()) {
    return _wasm!.base64_decode(encoded);
  }
  
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode to Hex.
 */
export async function hexEncode(data: Uint8Array): Promise<string> {
  if (await useWasmBackend()) {
    return _wasm!.hex_encode(data);
  }
  
  return Array.from(data)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decode from Hex.
 */
export async function hexDecode(encoded: string): Promise<Uint8Array> {
  if (await useWasmBackend()) {
    return _wasm!.hex_decode(encoded);
  }
  
  const bytes = new Uint8Array(encoded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(encoded.substr(i * 2, 2), 16);
  }
  return bytes;
}
