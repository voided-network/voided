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
// OBFUSCATION
// ============================================================================

export type ObfuscationMap = Record<string, string[]>;

export interface ObfuscationResult {
  obfuscated: string;
  originalLength: number;
  obfuscatedLength: number;
  expansionRatio: number;
  uniqueCharsObfuscated: number;
  mappingsUsed: number;
}

export interface MapAnalysis {
  temperature: number;
  totalMappings: number;
  averageMappingsPerChar: number;
  averageMappingLength: number;
  expansionRatio: number;
  computeScore: number;
  entropy: number;
}

export function generateMap(
  temperature?: number,
  seed?: string,
  charset?: string
): ObfuscationMap {
  // Require a seed for deterministic, reusable map generation
  // The same seed will always produce the same map, allowing map reuse
  if (!seed) {
    throw new Error('generateMap requires a seed parameter for deterministic map generation. The same seed will always produce the same map, allowing you to reuse maps across multiple operations.');
  }
  return native().generateMap(temperature, seed, charset);
}

export function obfuscate(
  text: string,
  map: ObfuscationMap,
  seed?: string,
  strategy?: string
): ObfuscationResult {
  // Use round-robin strategy by default for deterministic obfuscation
  // This ensures the same text with the same map produces the same output
  const actualStrategy = strategy ?? 'round-robin';
  return native().obfuscate(text, map, seed, actualStrategy);
}

export function deobfuscate(obfuscatedText: string, map: ObfuscationMap): string {
  return native().deobfuscate(obfuscatedText, map);
}

export function analyzeMap(map: ObfuscationMap): MapAnalysis {
  return native().analyzeMap(map);
}

export function getExpansionRatio(map: ObfuscationMap): number {
  return native().getExpansionRatio(map);
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

// ============================================================================
// HIGH-LEVEL PIPELINE
// ============================================================================

export interface EncryptWithMapOptions {
  key: Buffer;
  temperature?: number;
  seed?: string;
  map?: ObfuscationMap; // Optional: provide existing map to reuse
  compressionAlgorithm?: 'brotli' | 'gzip';
  compressionLevel?: number;
}

export interface EncryptWithMapResult {
  data: string;
  map: ObfuscationMap;
  originalSize: number;
  compressedSize: number;
  encryptedSize: number;
  compressionUsed: 'brotli' | 'gzip' | 'none';
}

/**
 * Full encryption pipeline: compress → encrypt → obfuscate
 */
export function encryptWithMap(
  data: string | Buffer,
  options: EncryptWithMapOptions
): EncryptWithMapResult {
  const { key, temperature = 0.5, seed, compressionAlgorithm = 'brotli', compressionLevel = 6 } = options;
  
  const inputBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const originalSize = inputBuffer.length;
  
  // Step 1: Compress (may return 'none' if data doesn't compress well)
  const compressed = compress(inputBuffer, compressionAlgorithm, compressionLevel);
  
  // Step 2: Encrypt
  const encrypted = encrypt(compressed.compressed, key);
  
  // Step 3: Generate map and obfuscate
  // Use provided map, or generate a new one with seed
  let map: ObfuscationMap;
  if (options.map) {
    // Reuse provided map
    map = options.map;
  } else {
    // Generate new map - seed is required for deterministic, reusable maps
    if (!seed) {
      throw new Error('encryptWithMap requires either a map parameter (to reuse an existing map) or a seed parameter (to generate a new deterministic map). Provide a seed to ensure the same map can be used for multiple encryptions.');
    }
    map = generateMap(temperature, seed);
  }
  
  // Serialize encrypted result for obfuscation (include compression algorithm used)
  const encryptedJson = JSON.stringify({
    e: encrypted.encrypted.toString('base64'),
    a: encrypted.algorithm,
    n: encrypted.nonce.toString('base64'),
    t: encrypted.tag.toString('base64'),
    c: compressed.algorithm, // compression algorithm actually used
  });
  
  // Use round-robin strategy for deterministic obfuscation that preserves JSON structure
  // Use the seed if provided, otherwise use a default (but map should be provided if no seed)
  const obfuscationSeed = seed ?? 'default';
  const obfuscatedResult = obfuscate(encryptedJson, map, obfuscationSeed, 'round-robin');
  
  return {
    data: obfuscatedResult.obfuscated,
    map,
    originalSize,
    compressedSize: compressed.compressedSize,
    encryptedSize: encrypted.encrypted.length,
    compressionUsed: compressed.algorithm,
  };
}

/**
 * Full decryption pipeline: deobfuscate → decrypt → decompress
 */
export function decryptWithMap(
  obfuscatedData: string,
  map: ObfuscationMap,
  key: Buffer
): Buffer {
  // Step 1: Deobfuscate
  const deobfuscatedText = deobfuscate(obfuscatedData, map);
  
  // Step 2: Parse and decrypt
  const parsed = JSON.parse(deobfuscatedText);
  const encryptResult: EncryptResult = {
    encrypted: Buffer.from(parsed.e, 'base64'),
    algorithm: parsed.a,
    nonce: Buffer.from(parsed.n, 'base64'),
    tag: Buffer.from(parsed.t, 'base64'),
  };
  
  const decrypted = decrypt(encryptResult, key);
  
  // Step 3: Decompress (only if compression was used)
  const compressionUsed = parsed.c as 'brotli' | 'gzip' | 'none';
  if (compressionUsed === 'none') {
    return decrypted;
  }
  
  return decompress(decrypted, compressionUsed);
}

/**
 * Decrypt and return as string
 */
export function decryptWithMapString(
  obfuscatedData: string,
  map: ObfuscationMap,
  key: Buffer
): string {
  return decryptWithMap(obfuscatedData, map, key).toString('utf8');
}
