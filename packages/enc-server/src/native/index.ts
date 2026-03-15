/**
 * Native binding loader for voided-node Rust module.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

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

export type ObfuscationMap = Record<string, string[]>;

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
  
  // Obfuscation
  generateMap(temperature?: number, seed?: string, charset?: string): ObfuscationMap;
  obfuscate(text: string, map: ObfuscationMap, seed?: string, strategy?: string): ObfuscationResult;
  deobfuscate(obfuscatedText: string, map: ObfuscationMap): string;
  analyzeMap(map: ObfuscationMap): MapAnalysis;
  getExpansionRatio(map: ObfuscationMap): number;
  
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

// Try to load native module from multiple locations
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
  
  // Find the workspace root by looking for crates folder
  let workspaceRoot = packageRoot;
  for (let i = 0; i < 10; i++) {
    const cratesPath = join(workspaceRoot, 'crates');
    if (existsSync(cratesPath)) break;
    workspaceRoot = join(workspaceRoot, '..');
  }
  
  const possiblePaths = [
    // 1. PUBLISHED PACKAGE: prebuilds/{platform}/voided_node.node
    join(packageRoot, 'prebuilds', platformId, 'voided_node.node'),
    // 2. PUBLISHED PACKAGE: native/voided_node.node (fallback)
    join(packageRoot, 'native', 'voided_node.node'),
    // 3. DEVELOPMENT: crates build output
    join(workspaceRoot, 'target', 'release', 'voided_node.node'),
    join(workspaceRoot, 'crates', 'target', 'release', 'voided_node.node'),
    join(workspaceRoot, 'crates', 'voided-node', 'voided_node.node'),
    // 4. DEVELOPMENT: debug builds
    join(workspaceRoot, 'target', 'debug', 'voided_node.node'),
    join(workspaceRoot, 'crates', 'target', 'debug', 'voided_node.node'),
    // 5. Relative to current directory
    join(currentDir, 'voided_node.node'),
    join(currentDir, '..', 'native', 'voided_node.node'),
  ];
  
  const errors: string[] = [];
  
  for (const modulePath of possiblePaths) {
    if (existsSync(modulePath)) {
      try {
        const mod = nodeRequire(modulePath);
        console.log(`[voided-native] Loaded native module from: ${modulePath}`);
        return mod as NativeModule;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`${modulePath}: ${errMsg}`);
      }
    }
  }
  
  // Build error message with both missing paths and load errors
  const missingPaths = possiblePaths.filter(p => !existsSync(p));
  
  let errorMessage = `[voided-native] Native module not found for platform: ${platformId}\n\n`;
  
  if (errors.length > 0) {
    errorMessage += `Files found but failed to load:\n${errors.map(e => `  - ${e}`).join('\n')}\n\n`;
  }
  
  if (missingPaths.length > 0) {
    errorMessage += `Paths not found:\n${missingPaths.slice(0, 5).map(p => `  - ${p}`).join('\n')}\n\n`;
  }
  
  errorMessage += `This package includes prebuilt binaries. If your platform is missing,\n` +
    `you may need to build from source:\n\n` +
    `  1. Install Rust: https://rustup.rs\n` +
    `  2. Build: cd crates && cargo build --release -p voided-node\n` +
    `  3. Copy the .node file to: prebuilds/${platformId}/voided_node.node`;
  
  throw new Error(errorMessage);
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
