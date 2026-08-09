/**
 * Crypto Backend - Rust Native Module ONLY
 * 
 * This module uses the Rust native binding exclusively.
 * No TypeScript fallbacks - if Rust isn't available, it throws.
 */

import {
  getNative,
  type NativeModule,
  type RecoveryDeckSetup,
} from './native/index.js';

export type { RecoveryDeckSetup } from './native/index.js';

// Get native module - throws if not available
let _native: NativeModule | null = null;

function native(): NativeModule {
  if (!_native) {
    _native = getNative();
  }
  return _native;
}

function boundedInteger(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a safe integer between ${minimum} and ${maximum}.`);
  }
  return value;
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
  boundedInteger('iterations', iterations, 100_000, 1_000_000);
  if (salt.length < 16 || salt.length > 1024) {
    throw new RangeError('PBKDF2 salt must be between 16 and 1024 bytes.');
  }
  return native().deriveKeyPbkdf2(password, salt, iterations);
}

// ============================================================================
// RECOVERY DECK
// ============================================================================

/** Generate a fresh CSPRNG-shuffled standard 52-card recovery deck. */
export function generateRecoveryDeck(): string[] {
  return native().generateRecoveryDeck();
}

/** Check for exactly 52 known canonical IDs with no missing or duplicate card. */
export function validateRecoveryDeck(deck: string[]): boolean {
  return native().validateRecoveryDeck(deck);
}

/** Encode a valid deck as the protocol's fixed 29-byte permutation rank. */
export function encodeRecoveryDeck(deck: string[]): Buffer {
  return native().encodeRecoveryDeck(deck);
}

/** Derive the deterministic 32-byte Recovery Key. Never persist the result. */
export function deriveRecoveryKey(deck: string[]): Buffer {
  return native().deriveRecoveryKey(deck);
}

/** Wrap an unchanged stable root key. Only the returned wrapper may be persisted. */
export function wrapRootWithRecoveryKey(
  rootKey: Buffer,
  recoveryKey: Buffer
): Buffer {
  return native().wrapRootWithRecoveryKey(rootKey, recoveryKey);
}

/** Unwrap a stable root key with a reconstructed Recovery Key. */
export function unwrapRootWithRecoveryKey(
  rootWrapper: Buffer,
  recoveryKey: Buffer
): Buffer {
  return native().unwrapRootWithRecoveryKey(rootWrapper, recoveryKey);
}

/** Generate a fresh deck and wrapper for an existing stable root key. */
export function createRecoveryDeck(rootKey: Buffer): RecoveryDeckSetup {
  return native().createRecoveryDeck(rootKey);
}

/** Rewrap the same stable root under a wholly fresh random deck. */
export function rotateRecoveryDeck(
  rootWrapper: Buffer,
  oldDeck: string[]
): RecoveryDeckSetup {
  return native().rotateRecoveryDeck(rootWrapper, oldDeck);
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
  boundedInteger('iterations', iterations, 100_000, 1_000_000);
  if (salt.length < 16 || salt.length > 1024) {
    throw new RangeError('PBKDF2 salt must be between 16 and 1024 bytes.');
  }
  return native().hashWithPbkdf2(data, salt, iterations);
}

export function verifyPbkdf2(
  data: Buffer,
  expectedHash: string,
  salt: Buffer,
  iterations: number
): boolean {
  boundedInteger('iterations', iterations, 100_000, 1_000_000);
  if (salt.length < 16 || salt.length > 1024) {
    throw new RangeError('PBKDF2 salt must be between 16 and 1024 bytes.');
  }
  return native().verifyPbkdf2(data, expectedHash, salt, iterations);
}

export function fingerprint(data: Buffer, length: number = 8): string {
  boundedInteger('length', length, 1, 32);
  return native().generateFingerprint(data, length);
}

/**
 * Human-readable groups derived from a SHA-256 fingerprint.
 * This is not Signal's Safety Number protocol and does not bind identities.
 */
export function safetyNumbers(data: Buffer, groupSize: number = 5): string {
  boundedInteger('groupSize', groupSize, 1, 32);
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
  shellNonce: Buffer;
}

export interface ProtectResult extends ProtectedArtifactInfo {
  artifact: Buffer;
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
// FUSED SHELL / FULL-FLOW
// ============================================================================

export function fuse(
  data: Buffer,
  key: Buffer,
  preset: 'compact' | 'balanced' | 'concealed' = 'balanced',
  chunkSize?: number,
): Buffer {
  return native().fuse(data, key, preset, chunkSize);
}

export function unfuse(data: Buffer, key: Buffer): Buffer {
  return native().unfuse(data, key);
}

export function inspectFused(data: Buffer): FusedShellInfo {
  return native().inspectFused(data);
}

export function protect(
  data: Buffer,
  key: Buffer,
  options: {
    preset?: 'compact' | 'balanced' | 'concealed';
    compressionAlgorithm?: 'gzip' | 'brotli' | 'none';
    compressionLevel?: number;
    encryptionAlgorithm?: 'xchacha20-poly1305' | 'aes-256-gcm';
    shellChunkSize?: number;
  } = {},
): ProtectResult {
  return native().protect(
    data,
    key,
    options.preset,
    options.compressionAlgorithm,
    options.compressionLevel,
    options.encryptionAlgorithm,
    options.shellChunkSize,
  );
}

export function open(artifact: Buffer, key: Buffer): Buffer {
  return native().open(artifact, key);
}

export function openRotationArtifact(artifact: Buffer, key: Buffer): Buffer {
  return native().openRotationArtifact(artifact, key);
}

export function inspectArtifact(artifact: Buffer): ProtectedArtifactInfo {
  return native().inspectArtifact(artifact);
}

export function inspectRotationArtifact(artifact: Buffer): ProtectedArtifactInfo {
  return native().inspectRotationArtifact(artifact);
}

export function repackArtifact(
  artifact: Buffer,
  key: Buffer,
  options: {
    preset?: 'compact' | 'balanced' | 'concealed';
    compressionAlgorithm?: 'gzip' | 'brotli' | 'none';
    compressionLevel?: number;
    encryptionAlgorithm?: 'xchacha20-poly1305' | 'aes-256-gcm';
    shellChunkSize?: number;
  } = {},
): ProtectResult {
  return native().repackArtifact(
    artifact,
    key,
    options.preset,
    options.compressionAlgorithm,
    options.compressionLevel,
    options.encryptionAlgorithm,
    options.shellChunkSize,
  );
}

// ============================================================================
// UTILITY
// ============================================================================

export function randomBytes(length: number): Buffer {
  boundedInteger('length', length, 1, 16 * 1024 * 1024);
  return native().randomBytes(length);
}

export function generateSalt(length: number = 16): Buffer {
  boundedInteger('length', length, 16, 1024);
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
