/**
 * Native binding loader for voided-node Rust module.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { verifyPackagedNativeArtifact } from './provenance.js';

// Types matching the Rust binding exports
export interface EncryptionResult {
  ciphertext: string;
  algorithm: string;
  nonce: string;
  tag: string;
}

export interface CompressionResult {
  compressed: Buffer;
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

export interface FusedShellInfo {
  version: number;
  preset: string;
  chunkSize: number;
  chunkCount: number;
  payloadSize: number;
  shellSize: number;
  metadataSize: number;
  tagSize: number;
}

export interface ProtectedArtifactInfo {
  version: number;
  preset: string;
  compressionAlgorithm: string;
  encryptionAlgorithm: string;
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

// Native module interface
export interface NativeModule {
  VERSION: string;

  // Encryption
  generateKey(): Buffer;
  encrypt(data: Buffer, key: Buffer, algorithm?: string): EncryptionResult;
  decrypt(encrypted: EncryptionResult, key: Buffer): Buffer;
  deriveKeyHkdf(ikm: Buffer, salt: Buffer | null, info: Buffer): Buffer;
  deriveKeyPbkdf2(password: Buffer, salt: Buffer, iterations: number): Buffer;

  // Hashing
  hash(data: Buffer, algorithm?: string): string;
  hashWithSalt(data: Buffer, salt: Buffer, algorithm?: string): string;
  compareHashes(a: Buffer, b: Buffer): boolean;
  generateHmac(data: Buffer, key: Buffer, algorithm?: string): string;
  verifyHmac(data: Buffer, hmac: string, key: Buffer, algorithm?: string): boolean;
  hashWithPbkdf2(data: Buffer, salt: Buffer, iterations: number): string;
  verifyPbkdf2(data: Buffer, expectedHash: string, salt: Buffer, iterations: number): boolean;
  generateFingerprint(data: Buffer, length?: number): string;
  generateSafetyNumbers(data: Buffer, groupSize?: number): string;
  generateSalt(length?: number): Buffer;

  // Compression
  compress(data: Buffer, algorithm?: string, level?: number): CompressionResult;
  decompress(data: Buffer, algorithm: string): Buffer;

  // Fused shell / full-flow
  fuse(data: Buffer, key: Buffer, preset?: string, chunkSize?: number): Buffer;
  unfuse(data: Buffer, key: Buffer): Buffer;
  inspectFused(data: Buffer): FusedShellInfo;
  protect(
    data: Buffer,
    key: Buffer,
    preset?: string,
    compressionAlgorithm?: string,
    compressionLevel?: number,
    encryptionAlgorithm?: string,
    shellChunkSize?: number,
  ): ProtectResult;
  open(artifact: Buffer, key: Buffer): Buffer;
  openRotationArtifact(artifact: Buffer, key: Buffer): Buffer;
  inspectArtifact(artifact: Buffer): ProtectedArtifactInfo;
  inspectRotationArtifact(artifact: Buffer): ProtectedArtifactInfo;
  repackArtifact(
    artifact: Buffer,
    key: Buffer,
    preset?: string,
    compressionAlgorithm?: string,
    compressionLevel?: number,
    encryptionAlgorithm?: string,
    shellChunkSize?: number,
  ): ProtectResult;

  // Utility
  randomBytes(length: number): Buffer;
  secureWipe(buffer: Buffer): void;
  base64Encode(data: Buffer): string;
  base64Decode(encoded: string): Buffer;
  hexEncode(data: Buffer): string;
  hexDecode(encoded: string): Buffer;
}

// ESM: Get current file's directory using import.meta.url
// This is defined at the top level so it captures the correct URL at module load time
const __ESM_DIRNAME__ = dirname(fileURLToPath(import.meta.url));

// Get directory path - works in both ESM and CJS contexts
function getCurrentDir(): string {
  // Check for CJS __dirname first (works in Jest)
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }

  // ESM: use the pre-computed directory
  return __ESM_DIRNAME__;
}

// Create require function using createRequire - this is the ONLY reliable way
// to load native .node modules in ESM. The bundler's require polyfill doesn't work.
// We use a variable name that the bundler won't transform.
const nativeRequire = createRequire(import.meta.url);

// Always use createRequire for native modules - bundler polyfills don't support .node files
function getRequire(): NodeRequire {
  return nativeRequire;
}

// Platform detection
function getPlatformIdentifier(): string {
  const platform = process.platform;
  const arch = process.arch;
  
  const platformMap: Record<string, string> = {
    'win32-x64': 'win32-x64-msvc',
    'win32-arm64': 'win32-arm64-msvc',
    'darwin-x64': 'darwin-x64',
    'darwin-arm64': 'darwin-arm64',
    'linux-x64': 'linux-x64-gnu',
    'linux-arm64': 'linux-arm64-gnu',
  };
  
  return platformMap[`${platform}-${arch}`] || `${platform}-${arch}`;
}

// Load only a package artifact whose digest and provenance manifest agree.
function loadNativeModule(): NativeModule {
  const platformId = getPlatformIdentifier();
  const currentDir = getCurrentDir();
  const nodeRequire = getRequire();
  
  // Find the package root (where package.json is)
  let packageRoot = currentDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(packageRoot, 'package.json'))) break;
    packageRoot = join(packageRoot, '..');
  }
  
  const { modulePath, manifest } = verifyPackagedNativeArtifact(
    packageRoot,
    platformId,
  );
  let mod: NativeModule;
  try {
    mod = nodeRequire(modulePath) as NativeModule;
  } catch (error) {
    throw new Error(
      `[voided-native] Verified native addon failed to load for ${platformId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (mod.VERSION !== manifest.coreVersion) {
    throw new Error(
      `[voided-native] Native core version ${mod.VERSION} does not match verified manifest ${manifest.coreVersion}`,
    );
  }
  return mod;
}

// Lazy initialization
let _native: NativeModule | null = null;

/**
 * Get the native module, loading it if necessary.
 * Throws if the native module cannot be loaded.
 */
export function getNative(): NativeModule {
  if (!_native) {
    _native = loadNativeModule();
  }
  return _native;
}

/**
 * Check if native module is available without throwing.
 */
export function isNativeAvailable(): boolean {
  try {
    getNative();
    return true;
  } catch {
    return false;
  }
}

// Default export
export default getNative;
