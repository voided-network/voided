/**
 * @voideddev/enc-server
 * 
 * Server-side encryption library powered by Rust.
 * All cryptographic operations use the native Rust module.
 */

// ============================================================================
// CORE CRYPTO - All from Rust native module
// ============================================================================

export {
  // Encryption
  generateKey,
  encrypt,
  decrypt,
  type EncryptResult,
  
  // Key derivation
  deriveKeyHkdf,
  deriveKeyPbkdf2,
  
  // Hashing
  hash,
  hashWithSalt,
  compareHashes,
  generateHmac,
  verifyHmac,
  hashPbkdf2,
  verifyPbkdf2,
  fingerprint,
  safetyNumbers,
  
  // Compression
  compress,
  decompress,
  type CompressionResult,
  
  // Obfuscation
  generateMap,
  obfuscate,
  deobfuscate,
  analyzeMap,
  getExpansionRatio,
  type ObfuscationMap,
  type ObfuscationResult,
  type MapAnalysis,
  
  // Utility
  randomBytes,
  generateSalt,
  secureWipe,
  base64Encode,
  base64Decode,
  hexEncode,
  hexDecode,
  
  // High-level pipeline
  encryptWithMap,
  decryptWithMap,
  decryptWithMapString,
  type EncryptWithMapOptions,
  type EncryptWithMapResult,
} from "./crypto-backend.js";

// Also export as namespace for convenience
export * as rust from "./crypto-backend.js";

// ============================================================================
// HIGHER-LEVEL FEATURES (TS orchestration using Rust primitives)
// ============================================================================

// Key management
export { KeyManager, type StoredKey } from "./key-manager.js";

// Re-encryption for key rotation
export { reEncryptWithNewKey } from "./reencrypt.js";

// Signing (uses Node.js crypto - not yet migrated to Rust)
export { 
  SigningService, 
  signingService,
  RECOMMENDED_ALGORITHMS,
  type SigningAlgorithm,
  type GeneratedKeyPair,
} from "./signing-service.js";

// Stats tracking
export { StatsTracker, type Metric } from "./stats.js";

// Streaming utilities
export {
  createCompressionStream,
  createDecompressionStream,
  createEncryptionStream,
  createDecryptionStream,
  createObfuscateStream,
  createDeobfuscateStream,
  createChunker,
  createLineSplitter,
} from "./streams.js";

// Limits utilities
export {
  SERVER_MAX_UPLOAD_BYTES,
  SERVER_MAX_UPLOAD_HUMAN,
  VOI_SERVER_FILE_TOO_LARGE,
  STREAMING_THRESHOLD_BYTES,
  VOI_STREAMING_REQUIRED,
  assertWithinServerUploadLimit,
  shouldStream,
  createByteLimitGuard,
} from "./limits.js";

// Benchmarking
export {
  benchmarkAll,
  benchmarkCompression,
  benchmarkEncryption,
  benchmarkObfuscation,
  benchmarkHashing,
  benchmarkPipeline,
  type OpBenchmarkResult,
} from "./benchmark-all.js";

// Planning metadata for the fused-first Voided v2 migration
export {
  VOIDED_V2_PRESET_PLAN,
  DEFAULT_VOIDED_V2_POLICY_PLAN,
  HIGH_SECURITY_VOIDED_V2_POLICY_PLAN,
  listVoidedV2Presets,
  resolveVoidedV2Preset,
  type VoidedV2PolicyPlan,
  type VoidedV2PresetAlias,
  type VoidedV2PresetId,
  type VoidedV2PresetPlanEntry,
  type VoidedV2PresetStatus,
  type VoidedV2PresetSupport,
  type VoidedV2RoleAlias,
} from "./v2-profile-plan.js";

// ============================================================================
// SERVICE CLASS
// ============================================================================

import {
  generateKey,
  generateMap,
  obfuscate as rustObfuscate,
  deobfuscate as rustDeobfuscate,
  encryptWithMap,
  decryptWithMapString,
  type ObfuscationMap,
  type EncryptWithMapResult,
} from "./crypto-backend.js";

export interface VoidedServiceOptions {
  encryptionKey?: Buffer;
  temperature?: number;
  seed?: string;
  compressionAlgorithm?: 'brotli' | 'gzip';
}

/**
 * VoidedService - High-level encryption service
 *
 * @deprecated This convenience wrapper belongs to deprecated Voided v1. It is
 * not part of the Voided v2 fused-first surface.
 */
export class VoidedService {
  private key: Buffer;
  private temperature: number;
  private seed?: string;
  private compressionAlgorithm: 'brotli' | 'gzip';
  
  constructor(options: VoidedServiceOptions = {}) {
    this.key = options.encryptionKey ?? generateKey();
    this.temperature = options.temperature ?? 0.5;
    this.seed = options.seed;
    this.compressionAlgorithm = options.compressionAlgorithm ?? 'brotli';
  }
  
  /**
   * Get the encryption key
   */
  getKey(): Buffer {
    return this.key;
  }
  
  /**
   * Encrypt data with full pipeline
   */
  encrypt(data: string | Buffer): EncryptWithMapResult {
    return encryptWithMap(data, {
      key: this.key,
      temperature: this.temperature,
      seed: this.seed,
      compressionAlgorithm: this.compressionAlgorithm,
    });
  }
  
  /**
   * Decrypt data with full pipeline
   */
  decrypt(obfuscatedData: string, map: ObfuscationMap): string {
    return decryptWithMapString(obfuscatedData, map, this.key);
  }
  
  /**
   * Simple obfuscation (no encryption)
   */
  obfuscateOnly(data: string): { obfuscated: string; map: ObfuscationMap } {
    if (!this.seed) {
      throw new Error('VoidedService requires a seed parameter for obfuscateOnly. Provide a seed in the constructor options.');
    }
    const map = generateMap(this.temperature, this.seed);
    const result = rustObfuscate(data, map, this.seed);
    return { obfuscated: result.obfuscated, map };
  }
  
  /**
   * Simple deobfuscation
   */
  deobfuscateOnly(data: string, map: ObfuscationMap): string {
    return rustDeobfuscate(data, map);
  }
}
