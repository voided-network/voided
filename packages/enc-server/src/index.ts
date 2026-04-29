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

  // Fused shell / full-flow
  fuse,
  unfuse,
  inspectFused,
  protect,
  open,
  openRotationArtifact,
  inspectArtifact,
  inspectRotationArtifact,
  repackArtifact,
  type FusedShellInfo,
  type ProtectedArtifactInfo,
  type ProtectResult,
  
  // Utility
  randomBytes,
  generateSalt,
  secureWipe,
  base64Encode,
  base64Decode,
  hexEncode,
  hexDecode,
} from "./crypto-backend.js";

// Also export as namespace for convenience
export * as rust from "./crypto-backend.js";

// ============================================================================
// HIGHER-LEVEL FEATURES (TS orchestration using Rust primitives)
// ============================================================================

// Key management
export { KeyManager, type StoredKey } from "./key-manager.js";

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
  benchmarkHashing,
  type OpBenchmarkResult,
} from "./benchmark-all.js";

// Historical planning metadata for the v2 fused-first migration.
// The current product protect/open path is the v3 whole-monolith artifact.
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
