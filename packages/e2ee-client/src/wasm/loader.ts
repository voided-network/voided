/**
 * WASM loader for voided-wasm module.
 * 
 * This module handles lazy initialization of the WASM module
 * and provides typed exports matching the existing TypeScript API.
 * 
 * Usage:
 * ```ts
 * import { initWasm, getWasm, isWasmReady } from '@voideddev/e2ee-client/wasm';
 * 
 * // Initialize WASM (optional - auto-initializes on first use)
 * await initWasm();
 * 
 * // Use WASM functions
 * const wasm = await getWasm();
 * const key = wasm.generateKey();
 * ```
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
  generate_key(): Uint8Array;
  encrypt(data: Uint8Array, key: Uint8Array, algorithm?: string): EncryptionResult;
  decrypt(ciphertext: string, nonce: string, tag: string, key: Uint8Array, algorithm: string): Uint8Array;
  derive_key_hkdf(ikm: Uint8Array, salt: Uint8Array | null, info: Uint8Array): Uint8Array;
  derive_key_hkdf_raw?(ikm: Uint8Array, salt: Uint8Array | null, info: Uint8Array, length: number): Uint8Array;
  derive_key_pbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array;
  generate_x25519_key_pair?(seed?: Uint8Array | null): { public_key: Uint8Array; private_key: Uint8Array } | { publicKey: Uint8Array; privateKey: Uint8Array };
  x25519_shared_secret?(ourPrivateKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array;
  derive_key_from_shared_secret?(sharedSecret: Uint8Array, salt: string, info: string): Uint8Array;
  
  // Hashing
  hash(data: Uint8Array, algorithm?: string): string;
  hash_with_salt(data: Uint8Array, salt: Uint8Array, algorithm?: string): string;
  compare_hashes(a: Uint8Array, b: Uint8Array): boolean;
  generate_hmac(data: Uint8Array, key: Uint8Array, algorithm?: string): string;
  verify_hmac(data: Uint8Array, hmac: string, key: Uint8Array, algorithm?: string): boolean;
  hash_with_pbkdf2(data: Uint8Array, salt: Uint8Array, iterations: number): string;
  verify_pbkdf2(data: Uint8Array, expectedHash: string, salt: Uint8Array, iterations: number): boolean;
  generate_fingerprint(data: Uint8Array, length?: number): string;
  generate_safety_numbers(data: Uint8Array, groupSize?: number): string;
  generate_salt(length?: number): Uint8Array;

  // Compression
  compress(data: Uint8Array, algorithm?: string, level?: number): CompressionResult;
  decompress(data: Uint8Array, algorithm: string): Uint8Array;

  // Utility
  random_bytes(length: number): Uint8Array;
  base64_encode(data: Uint8Array): string;
  base64_decode(encoded: string): Uint8Array;
  hex_encode(data: Uint8Array): string;
  hex_decode(encoded: string): Uint8Array;
}

type RawWasmModule = Record<string, (...args: any[]) => any> & {
  default?: (...args: any[]) => Promise<unknown>;
};

function getExportFn<T extends (...args: any[]) => any>(
  mod: RawWasmModule,
  names: string[],
): T {
  for (const name of names) {
    const candidate = mod[name];
    if (typeof candidate === "function") {
      return candidate as T;
    }
  }
  throw new Error(`[voided-wasm] Missing WASM export: ${names.join(" | ")}`);
}

function normalizeCompressionResult(result: any): CompressionResult {
  return {
    compressed: result.compressed,
    algorithm: result.algorithm,
    originalSize: result.originalSize ?? result.original_size,
    compressedSize: result.compressedSize ?? result.compressed_size,
    compressionRatio: result.compressionRatio ?? result.compression_ratio,
  };
}

function normalizeWasmModule(mod: RawWasmModule): WasmModule {
  const version = getExportFn<() => string>(mod, ["version", "VERSION"]);
  const generateKey = getExportFn<() => Uint8Array>(mod, ["generate_key", "generateKey"]);
  const encryptFn = getExportFn<
    (data: Uint8Array, key: Uint8Array, algorithm?: string) => EncryptionResult
  >(mod, ["encrypt"]);
  const decryptFn = getExportFn<(encrypted: any, key: Uint8Array) => Uint8Array>(mod, ["decrypt"]);
  const deriveHkdf = getExportFn<
    (ikm: Uint8Array, salt: Uint8Array | null, info: Uint8Array) => Uint8Array
  >(mod, ["derive_key_hkdf", "deriveKeyHkdf"]);
  const derivePbkdf2 = getExportFn<
    (password: Uint8Array, salt: Uint8Array, iterations: number) => Uint8Array
  >(mod, ["derive_key_pbkdf2", "deriveKeyPbkdf2"]);
  const hashFn = getExportFn<(data: Uint8Array, algorithm?: string) => string>(mod, ["hash"]);
  const hashWithSaltFn = getExportFn<
    (data: Uint8Array, salt: Uint8Array, algorithm?: string) => string
  >(mod, ["hash_with_salt", "hashWithSalt"]);
  const compareHashes = getExportFn<(a: Uint8Array, b: Uint8Array) => boolean>(
    mod,
    ["compare_hashes", "compareHashes"],
  );
  const generateHmac = getExportFn<
    (data: Uint8Array, key: Uint8Array, algorithm?: string) => string
  >(mod, ["generate_hmac", "generateHmac"]);
  const generateFingerprint = getExportFn<
    (data: Uint8Array, length?: number) => string
  >(mod, ["generate_fingerprint", "generateFingerprint"]);
  const generateSafetyNumbers = getExportFn<
    (data: Uint8Array, groupSize?: number) => string
  >(mod, ["generate_safety_numbers", "generateSafetyNumbers"]);
  const generateSalt = getExportFn<(length?: number) => Uint8Array>(mod, ["generate_salt", "generateSalt"]);
  const compressFn = getExportFn<(data: Uint8Array, algorithm?: string, level?: number) => any>(mod, ["compress"]);
  const decompressFn = getExportFn<(data: Uint8Array, algorithm: string) => Uint8Array>(mod, ["decompress"]);
  const randomBytes = getExportFn<(length: number) => Uint8Array>(mod, ["random_bytes", "randomBytes"]);
  const base64Encode = getExportFn<(data: Uint8Array) => string>(mod, ["base64_encode", "base64Encode"]);
  const base64Decode = getExportFn<(encoded: string) => Uint8Array>(mod, ["base64_decode", "base64Decode"]);
  const hexEncode = getExportFn<(data: Uint8Array) => string>(mod, ["hex_encode", "hexEncode"]);
  const hexDecode = getExportFn<(encoded: string) => Uint8Array>(mod, ["hex_decode", "hexDecode"]);

  const deriveHkdfRaw = mod.derive_key_hkdf_raw || mod.deriveKeyHkdfRaw;
  const generateX25519 = mod.generate_x25519_key_pair || mod.generateX25519KeyPair;
  const x25519SharedSecret = mod.x25519_shared_secret || mod.x25519SharedSecret;
  const deriveFromSharedSecret = mod.derive_key_from_shared_secret || mod.deriveKeyFromSharedSecret;

  return {
    version: () => version(),
    generate_key: () => generateKey(),
    encrypt: (data, key, algorithm) => encryptFn(data, key, algorithm),
    decrypt: (ciphertext, nonce, tag, key, algorithm) =>
      decryptFn({ ciphertext, nonce, tag, algorithm }, key),
    derive_key_hkdf: (ikm, salt, info) => deriveHkdf(ikm, salt, info),
    derive_key_hkdf_raw: deriveHkdfRaw
      ? (ikm, salt, info, length) => deriveHkdfRaw(ikm, salt, info, length)
      : undefined,
    derive_key_pbkdf2: (password, salt, iterations) => derivePbkdf2(password, salt, iterations),
    generate_x25519_key_pair: generateX25519
      ? (seed) => generateX25519(seed ?? null)
      : undefined,
    x25519_shared_secret: x25519SharedSecret
      ? (ourPrivateKey, theirPublicKey) => x25519SharedSecret(ourPrivateKey, theirPublicKey)
      : undefined,
    derive_key_from_shared_secret: deriveFromSharedSecret
      ? (sharedSecret, salt, info) => deriveFromSharedSecret(sharedSecret, salt, info)
      : undefined,
    hash: (data, algorithm) => hashFn(data, algorithm),
    hash_with_salt: (data, salt, algorithm) => hashWithSaltFn(data, salt, algorithm),
    compare_hashes: (a, b) => compareHashes(a, b),
    generate_hmac: (data, key, algorithm) => generateHmac(data, key, algorithm),
    verify_hmac: (data, hmac, key, algorithm) => {
      const verify = mod.verify_hmac || mod.verifyHmac;
      if (typeof verify !== "function") {
        throw new Error("[voided-wasm] Missing WASM export: verify_hmac | verifyHmac");
      }
      return verify(data, hmac, key, algorithm);
    },
    hash_with_pbkdf2: (data, salt, iterations) => {
      const hashWithPbkdf2 = mod.hash_with_pbkdf2 || mod.hashWithPbkdf2;
      if (typeof hashWithPbkdf2 !== "function") {
        throw new Error("[voided-wasm] Missing WASM export: hash_with_pbkdf2 | hashWithPbkdf2");
      }
      return hashWithPbkdf2(data, salt, iterations);
    },
    verify_pbkdf2: (data, expectedHash, salt, iterations) => {
      const verifyPbkdf2 = mod.verify_pbkdf2 || mod.verifyPbkdf2;
      if (typeof verifyPbkdf2 !== "function") {
        throw new Error("[voided-wasm] Missing WASM export: verify_pbkdf2 | verifyPbkdf2");
      }
      return verifyPbkdf2(data, expectedHash, salt, iterations);
    },
    generate_fingerprint: (data, length) => generateFingerprint(data, length),
    generate_safety_numbers: (data, groupSize) => generateSafetyNumbers(data, groupSize),
    generate_salt: (length) => generateSalt(length),
    compress: (data, algorithm, level) => normalizeCompressionResult(compressFn(data, algorithm, level)),
    decompress: (data, algorithm) => decompressFn(data, algorithm),
    random_bytes: (length) => randomBytes(length),
    base64_encode: (data) => base64Encode(data),
    base64_decode: (encoded) => base64Decode(encoded),
    hex_encode: (data) => hexEncode(data),
    hex_decode: (encoded) => hexDecode(encoded),
  };
}

// Module state
let wasmModule: WasmModule | null = null;
let initPromise: Promise<WasmModule> | null = null;
let initError: Error | null = null;

// Detect if running in Node.js (not browser)
const isNode = typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node;

/**
 * Initialize the WASM module.
 * Safe to call multiple times - will only initialize once.
 * In Node.js environment, this will immediately fail as WASM is for browsers only.
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
  
  // In Node.js, skip WASM entirely - use TypeScript fallback
  if (isNode) {
    initError = new Error('WASM not available in Node.js - use TypeScript fallback');
    throw initError;
  }
  
  // Already initializing
  if (initPromise) {
    return initPromise;
  }
  
  // Start initialization (browser only)
  initPromise = (async () => {
    try {
      // Dynamic import of the WASM module
      // In the built package, this will be at the wasm/ directory
      const mod = await import('../../wasm/voided_wasm.js');
      
      // Initialize if needed (wasm-bindgen generated code)
      if (typeof mod.default === 'function') {
        await mod.default();
      }
      
      wasmModule = normalizeWasmModule(mod as unknown as RawWasmModule);
      console.log('[voided-wasm] WASM module initialized');
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

/**
 * Reset WASM state (for testing).
 */
export function resetWasm(): void {
  wasmModule = null;
  initPromise = null;
  initError = null;
}

// Auto-initialize in background when module is imported in browser only
// Skip in Node.js to avoid unnecessary console spam
if (typeof window !== 'undefined' && !isNode) {
  initWasm().catch(() => {
    // Don't throw or log - TypeScript fallback will be used
  });
}

