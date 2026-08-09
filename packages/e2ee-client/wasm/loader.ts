/**
 * WASM loader for voided-wasm module.
 *
 * This module handles lazy initialization of the WASM module
 * and provides typed exports matching the existing TypeScript API.
 */

// Types matching the WASM binding exports
export interface EncryptionResult {
  ciphertext: string;
  algorithm: string;
  nonce: string;
  tag: string;
}

export interface CompressionResult {
  compressed: Uint8Array;
  algorithm: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

// WASM module interface
export interface WasmModule {
  version(): string;

  // Encryption
  generateKey(): Uint8Array;
  encrypt(data: Uint8Array, key: Uint8Array, algorithm?: string): EncryptionResult;
  decrypt(encrypted: EncryptionResult, key: Uint8Array): Uint8Array;
  deriveKeyHkdf(ikm: Uint8Array, salt: Uint8Array | null, info: Uint8Array): Uint8Array;
  deriveKeyPbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array;

  // Hashing
  hash(data: Uint8Array, algorithm?: string): string;
  hashWithSalt(data: Uint8Array, salt: Uint8Array, algorithm?: string): string;
  compareHashes(a: Uint8Array, b: Uint8Array): boolean;
  generateHmac(data: Uint8Array, key: Uint8Array, algorithm?: string): string;
  verifyHmac(data: Uint8Array, hmac: string, key: Uint8Array, algorithm?: string): boolean;
  hashWithPbkdf2(data: Uint8Array, salt: Uint8Array, iterations: number): string;
  verifyPbkdf2(data: Uint8Array, expectedHash: string, salt: Uint8Array, iterations: number): boolean;
  generateFingerprint(data: Uint8Array, length?: number): string;
  generateSafetyNumbers(data: Uint8Array, groupSize?: number): string;
  generateSalt(length?: number): Uint8Array;

  // Compression
  compress(data: Uint8Array, algorithm?: string, level?: number): CompressionResult;
  decompress(data: Uint8Array, algorithm: string): Uint8Array;

  // Utility
  randomBytes(length: number): Uint8Array;
  base64Encode(data: Uint8Array): string;
  base64Decode(encoded: string): Uint8Array;
  hexEncode(data: Uint8Array): string;
  hexDecode(encoded: string): Uint8Array;
}

// Module state
let wasmModule: WasmModule | null = null;
let initPromise: Promise<WasmModule> | null = null;
let initError: Error | null = null;

/**
 * Initialize the WASM module.
 * Safe to call multiple times - will only initialize once.
 */
export async function initWasm(): Promise<WasmModule> {
  // Already initialized
  if (wasmModule) {
    return wasmModule;
  }

  // Already failed
  if (initError) {
    throw initError;
  }

  // Already initializing
  if (initPromise) {
    return initPromise;
  }

  // Start initialization
  initPromise = (async () => {
    try {
      // Try to load the WASM module
      // The actual path will depend on the bundler and build setup
      const mod = await import('./voided_wasm.js');

      // Initialize if needed (wasm-bindgen generated code)
      if (typeof mod.default === 'function') {
        await mod.default();
      }

      wasmModule = mod as unknown as WasmModule;
      return wasmModule;
    } catch (err) {
      initError = err instanceof Error ? err : new Error(String(err));
      throw initError;
    }
  })();

  return initPromise;
}

/**
 * Get the WASM module, initializing if necessary.
 * This is async because WASM must be loaded asynchronously.
 */
export async function getWasm(): Promise<WasmModule> {
  if (wasmModule) {
    return wasmModule;
  }
  return initWasm();
}

/**
 * Check if WASM module is already initialized.
 */
export function isWasmReady(): boolean {
  return wasmModule !== null;
}

/**
 * Check if WASM initialization failed.
 */
export function getWasmError(): Error | null {
  return initError;
}

/**
 * Get WASM module synchronously.
 * Throws if not yet initialized - call initWasm() first.
 */
export function getWasmSync(): WasmModule {
  if (!wasmModule) {
    throw new Error(
      '[voided-wasm] WASM module not initialized. ' +
      'Call initWasm() or use getWasm() before accessing synchronously.'
    );
  }
  return wasmModule;
}

// Auto-initialize in background when module is imported
// This makes the first crypto operation faster
if (typeof window !== 'undefined') {
  // Browser environment - auto-init
  initWasm().catch((err) => {
    console.warn('[voided-wasm] Background initialization failed:', err);
  });
}

export default getWasm;
