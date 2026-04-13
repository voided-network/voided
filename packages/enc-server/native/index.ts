/**
 * Native binding loader for voided-node Rust module.
 * 
 * This module loads the compiled Rust native addon and provides
 * typed exports matching the existing TypeScript API.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

  // Utility
  randomBytes(length: number): Buffer;
  secureWipe(buffer: Buffer): void;
  base64Encode(data: Buffer): string;
  base64Decode(encoded: string): Buffer;
  hexEncode(data: Buffer): string;
  hexDecode(encoded: string): Buffer;
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

// Try to load native module from multiple locations
function loadNativeModule(): NativeModule {
  const platformId = getPlatformIdentifier();
  const moduleName = `voided-node.${platformId}.node`;
  
  const possiblePaths = [
    // Local development build
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'crates', 'voided-node', 'target', 'release', 'voided_node.node'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'crates', 'voided-node', 'target', 'debug', 'voided_node.node'),
    // Prebuilt binaries (npm package)
    join(dirname(fileURLToPath(import.meta.url)), '..', 'prebuilds', moduleName),
    join(dirname(fileURLToPath(import.meta.url)), '..', 'native', moduleName),
    // Platform-specific npm package
    join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', `@voideddev/enc-server-${platformId}`, moduleName),
  ];
  
  for (const modulePath of possiblePaths) {
    if (existsSync(modulePath)) {
      try {
        // Dynamic import for native module
        const mod = require(modulePath);
        console.log(`[voided-node] Loaded native module from: ${modulePath}`);
        return mod as NativeModule;
      } catch (err) {
        console.warn(`[voided-node] Failed to load from ${modulePath}:`, err);
      }
    }
  }
  
  throw new Error(
    `[voided-node] Failed to load native module for platform: ${platformId}\n` +
    `Tried paths:\n${possiblePaths.map(p => `  - ${p}`).join('\n')}\n` +
    `You may need to run the build script or install the platform-specific package.`
  );
}

// Lazy initialization
let _native: NativeModule | null = null;

/**
 * Get the native module, loading it if necessary.
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

// Export loaded module for direct access
export default getNative;

