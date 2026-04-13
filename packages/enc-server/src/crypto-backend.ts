/**
 * Crypto Backend - Rust Native Module ONLY
 * 
 * This module uses the Rust native binding exclusively.
 * No TypeScript fallbacks - if Rust isn't available, it throws.
 */

import { getNative, type NativeModule } from './native/index.js';

// Get native module - throws if not available
let _native: NativeModule | null = null;

function native(): NativeModule {
  if (!_native) {
    _native = getNative();
  }
  return _native;
}

// ============================================================================
// ENCRYPTION
// ============================================================================

export interface EncryptResult {
  encrypted: Buffer;
  algorithm: 'xchacha20-poly1305' | 'aes-256-gcm';
  nonce: Buffer;
  tag: Buffer;
}

export function generateKey(): Buffer {
  return native().generateKey();
}

export function encrypt(
  data: Buffer,
  key: Buffer,
  algorithm?: 'xchacha20-poly1305' | 'aes-256-gcm'
): EncryptResult {
  const result = native().encrypt(data, key, algorithm);
  return {
    encrypted: Buffer.from(result.ciphertext, 'base64'),
    algorithm: result.algorithm as 'xchacha20-poly1305' | 'aes-256-gcm',
    nonce: Buffer.from(result.nonce, 'base64'),
    tag: Buffer.from(result.tag, 'base64'),
  };
}

export function decrypt(encrypted: EncryptResult, key: Buffer): Buffer {
  const input = {
    ciphertext: encrypted.encrypted.toString('base64'),
    algorithm: encrypted.algorithm,
    nonce: encrypted.nonce.toString('base64'),
    tag: encrypted.tag.toString('base64'),
  };
  return native().decrypt(input, key);
}

// ============================================================================
// KEY DERIVATION
// ============================================================================

export function deriveKeyHkdf(
  ikm: Buffer,
  salt: Buffer | null,
  info: Buffer
): Buffer {
  return native().deriveKeyHkdf(ikm, salt, info);
}

export function deriveKeyPbkdf2(
  password: Buffer,
  salt: Buffer,
  iterations: number
): Buffer {
  return native().deriveKeyPbkdf2(password, salt, iterations);
}

// ============================================================================
// HASHING
// ============================================================================

export function hash(data: Buffer, algorithm: 'sha256' | 'sha512' = 'sha256'): string {
  return native().hash(data, algorithm);
}

export function hashWithSalt(
  data: Buffer,
  salt: Buffer,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): string {
  return native().hashWithSalt(data, salt, algorithm);
}

export function compareHashes(a: Buffer, b: Buffer): boolean {
  return native().compareHashes(a, b);
}

export function generateHmac(
  data: Buffer,
  key: Buffer,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): string {
  return native().generateHmac(data, key, algorithm);
}

export function verifyHmac(
  data: Buffer,
  hmac: string,
  key: Buffer,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): boolean {
  return native().verifyHmac(data, hmac, key, algorithm);
}

export function hashPbkdf2(data: Buffer, salt: Buffer, iterations: number): string {
  return native().hashWithPbkdf2(data, salt, iterations);
}

export function verifyPbkdf2(
  data: Buffer,
  expectedHash: string,
  salt: Buffer,
  iterations: number
): boolean {
  return native().verifyPbkdf2(data, expectedHash, salt, iterations);
}

export function fingerprint(data: Buffer, length: number = 8): string {
  return native().generateFingerprint(data, length);
}

export function safetyNumbers(data: Buffer, groupSize: number = 5): string {
  return native().generateSafetyNumbers(data, groupSize);
}

// ============================================================================
// COMPRESSION
// ============================================================================

export interface CompressionResult {
  compressed: Buffer;
  algorithm: 'gzip' | 'brotli' | 'none';
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

export function compress(
  data: Buffer,
  algorithm: 'gzip' | 'brotli' = 'brotli',
  level: number = 6
): CompressionResult {
  const result = native().compress(data, algorithm, level);
  return {
    compressed: result.compressed,
    algorithm: result.algorithm as 'gzip' | 'brotli' | 'none',
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    compressionRatio: result.compressionRatio,
  };
}

export function decompress(data: Buffer, algorithm: 'gzip' | 'brotli'): Buffer {
  return native().decompress(data, algorithm);
}

// ============================================================================
// UTILITY
// ============================================================================

export function randomBytes(length: number): Buffer {
  return native().randomBytes(length);
}

export function generateSalt(length: number = 16): Buffer {
  return native().generateSalt(length);
}

export function secureWipe(buffer: Buffer): void {
  native().secureWipe(buffer);
}

export function base64Encode(data: Buffer): string {
  return native().base64Encode(data);
}

export function base64Decode(encoded: string): Buffer {
  return native().base64Decode(encoded);
}

export function hexEncode(data: Buffer): string {
  return native().hexEncode(data);
}

export function hexDecode(encoded: string): Buffer {
  return native().hexDecode(encoded);
}
