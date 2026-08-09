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
  shellNonce: Uint8Array;
}

export interface ProtectResult extends ProtectedArtifactInfo {
  artifact: Uint8Array;
}

export interface RecoveryDeckSetup {
  /** Ordered canonical card IDs. This array is secret key material. */
  deck: string[];
  /** Opaque authenticated root wrapper. This is the only persistable value. */
  rootWrapper: Uint8Array;
}

// WASM module interface
export interface WasmModule {
  version(): string;
  
  // Encryption
  generate_key(): Uint8Array;
  encrypt(data: Uint8Array, key: Uint8Array, algorithm?: string): EncryptionResult;
  decrypt(ciphertext: string, nonce: string, tag: string, key: Uint8Array, algorithm: string): Uint8Array;
  encrypt_with_aad(
    data: Uint8Array,
    key: Uint8Array,
    aad: Uint8Array,
    algorithm?: string,
  ): EncryptionResult;
  decrypt_with_aad(
    ciphertext: string,
    nonce: string,
    tag: string,
    key: Uint8Array,
    algorithm: string,
    aad: Uint8Array,
  ): Uint8Array;
  derive_key_hkdf(ikm: Uint8Array, salt: Uint8Array | null, info: Uint8Array): Uint8Array;
  derive_key_hkdf_raw?(ikm: Uint8Array, salt: Uint8Array | null, info: Uint8Array, length: number): Uint8Array;
  derive_key_pbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array;
  generate_recovery_deck?(): string[];
  validate_recovery_deck?(deck: string[]): boolean;
  encode_recovery_deck?(deck: string[]): Uint8Array;
  derive_recovery_key?(deck: string[]): Uint8Array;
  wrap_root_with_recovery_key?(rootKey: Uint8Array, recoveryKey: Uint8Array): Uint8Array;
  unwrap_root_with_recovery_key?(rootWrapper: Uint8Array, recoveryKey: Uint8Array): Uint8Array;
  create_recovery_deck?(rootKey: Uint8Array): RecoveryDeckSetup;
  rotate_recovery_deck?(rootWrapper: Uint8Array, oldDeck: string[]): RecoveryDeckSetup;
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
  decompress_bounded(
    data: Uint8Array,
    algorithm: string,
    maxOutputBytes: number,
  ): Uint8Array;

  // Fused shell / full-flow
  fuse(data: Uint8Array, key: Uint8Array, preset?: string, chunkSize?: number): Uint8Array;
  unfuse(data: Uint8Array, key: Uint8Array): Uint8Array;
  inspectFused(data: Uint8Array): FusedShellInfo;
  protect(
    data: Uint8Array,
    key: Uint8Array,
    preset?: string,
    compressionAlgorithm?: string,
    compressionLevel?: number,
    encryptionAlgorithm?: string,
    shellChunkSize?: number,
  ): ProtectResult;
  open(artifact: Uint8Array, key: Uint8Array): Uint8Array;
  inspectArtifact(artifact: Uint8Array): ProtectedArtifactInfo;
  repackArtifact(
    artifact: Uint8Array,
    key: Uint8Array,
    preset?: string,
    compressionAlgorithm?: string,
    compressionLevel?: number,
    encryptionAlgorithm?: string,
    shellChunkSize?: number,
  ): ProtectResult;

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

export interface WasmLoaderOptions {
  /**
   * Trusted URL of the wasm-bindgen JavaScript glue module. The adjacent
   * `voided_wasm_bg.wasm` file must be served beside it.
   */
  glueUrl: string | URL;
}

let configuredWasmGlueUrl: string | null = null;
let wasmInitializationStarted = false;

function normalizeWasmGlueUrl(value: unknown): string {
  let raw: string;
  if (typeof value === 'string') {
    raw = value;
  } else if (typeof URL !== 'undefined' && value instanceof URL) {
    raw = value.href;
  } else {
    throw new Error('[voided-wasm] glueUrl must be a string or URL');
  }
  if (raw.length === 0 || raw.length > 4096) {
    throw new Error('[voided-wasm] glueUrl has an invalid length');
  }

  const browserBase =
    typeof document !== 'undefined' && document.baseURI
      ? document.baseURI
      : typeof globalThis.location !== 'undefined'
        ? globalThis.location.href
        : undefined;
  let parsed: URL;
  try {
    parsed = browserBase ? new URL(raw, browserBase) : new URL(raw);
  } catch {
    throw new Error(
      '[voided-wasm] glueUrl must be absolute when no browser base URL is available',
    );
  }
  if (!['https:', 'http:', 'file:'].includes(parsed.protocol)) {
    throw new Error('[voided-wasm] glueUrl must use http, https, or file');
  }
  if (parsed.username || parsed.password) {
    throw new Error('[voided-wasm] glueUrl must not contain credentials');
  }
  if (!parsed.pathname.endsWith('/voided_wasm.js')) {
    throw new Error('[voided-wasm] glueUrl must end with /voided_wasm.js');
  }
  return parsed.href;
}

function applyWasmLoaderOptions(
  options: WasmLoaderOptions,
  allowSameAfterStart: boolean,
): void {
  if (
    !options ||
    typeof options !== 'object' ||
    !Object.prototype.hasOwnProperty.call(options, 'glueUrl') ||
    Object.keys(options).length !== 1
  ) {
    throw new Error('[voided-wasm] loader options must contain only glueUrl');
  }
  const normalized = normalizeWasmGlueUrl(options.glueUrl);
  if (wasmInitializationStarted) {
    if (allowSameAfterStart && normalized === configuredWasmGlueUrl) return;
    throw new Error(
      '[voided-wasm] WASM loader configuration cannot change after initialization has started',
    );
  }
  if (
    configuredWasmGlueUrl !== null &&
    configuredWasmGlueUrl !== normalized
  ) {
    throw new Error('[voided-wasm] WASM glue URL is already configured');
  }
  configuredWasmGlueUrl = normalized;
}

import { secureWasmModule } from './secure-module';

/**
 * Configure a trusted, host-served wasm-bindgen glue module before any WASM
 * initialization begins. A configured URL is fail-closed and never falls back
 * to package-relative assets.
 */
export function configureWasmLoader(options: WasmLoaderOptions): void {
  applyWasmLoaderOptions(options, false);
}

function runtimeModuleSpecifier(...segments: string[]): string {
  return segments.join('/');
}

async function importWasmBindings(): Promise<RawWasmModule> {
  if (configuredWasmGlueUrl !== null) {
    try {
      return (await import(
        /* @vite-ignore */
        configuredWasmGlueUrl
      )) as RawWasmModule;
    } catch {
      throw new Error(
        '[voided-wasm] Could not load the configured WASM glue module; ' +
          'no package-relative fallback was attempted',
      );
    }
  }

  try {
    // Dedicated dist/wasm/loader entry and the source-tree loader.
    // Build the specifier at runtime and preserve Vite's ignore marker so
    // downstream bundlers cannot inline the generated wasm-bindgen glue and
    // rebase its adjacent .wasm URL into their JavaScript output directory.
    const nestedBindingsPath = runtimeModuleSpecifier(
      '..',
      '..',
      'wasm',
      'voided_wasm.js',
    );
    return (await import(
      /* @vite-ignore */
      nestedBindingsPath
    )) as RawWasmModule;
  } catch (nestedError) {
    try {
      // Loader code bundled into dist/index or dist/crypto-backend.
      const rootBundleBindingsPath = runtimeModuleSpecifier(
        '..',
        'wasm',
        'voided_wasm.js',
      );
      return (await import(
        /* @vite-ignore */
        rootBundleBindingsPath
      )) as RawWasmModule;
    } catch (rootError) {
      const nestedDetail =
        nestedError instanceof Error ? nestedError.message : String(nestedError);
      const rootDetail =
        rootError instanceof Error ? rootError.message : String(rootError);
      throw new Error(
        `[voided-wasm] Could not load packaged WASM bindings (${nestedDetail}; ${rootDetail})`,
      );
    }
  }
}

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

function normalizeFusedShellInfo(result: any): FusedShellInfo {
  return {
    version: result.version,
    preset: result.preset,
    chunkSize: result.chunkSize ?? result.chunk_size,
    chunkCount: result.chunkCount ?? result.chunk_count,
    payloadSize: result.payloadSize ?? result.payload_size,
    shellSize: result.shellSize ?? result.shell_size,
    metadataSize: result.metadataSize ?? result.metadata_size,
    tagSize: result.tagSize ?? result.tag_size,
  };
}

function normalizeProtectedArtifactInfo(result: any): ProtectedArtifactInfo {
  return {
    version: result.version,
    preset: result.preset,
    compressionAlgorithm: result.compressionAlgorithm ?? result.compression_algorithm,
    encryptionAlgorithm: result.encryptionAlgorithm ?? result.encryption_algorithm,
    originalSize: result.originalSize ?? result.original_size,
    compressedSize: result.compressedSize ?? result.compressed_size,
    encryptedSize: result.encryptedSize ?? result.encrypted_size,
    protectedSize: result.protectedSize ?? result.protected_size,
    shellChunkSize: result.shellChunkSize ?? result.shell_chunk_size,
    shellChunkCount: result.shellChunkCount ?? result.shell_chunk_count,
    shellNonce: result.shellNonce ?? result.shell_nonce,
  };
}

function normalizeProtectResult(result: any): ProtectResult {
  return {
    artifact: result.artifact,
    ...normalizeProtectedArtifactInfo(result),
  };
}

function normalizeRecoveryDeckSetup(result: any): RecoveryDeckSetup {
  return {
    deck: result.deck,
    rootWrapper: result.rootWrapper ?? result.root_wrapper,
  };
}

function normalizeWasmModule(mod: RawWasmModule): WasmModule {
  const version = getExportFn<() => string>(mod, ["version", "VERSION"]);
  const generateKey = getExportFn<() => Uint8Array>(mod, ["generate_key", "generateKey"]);
  const encryptFn = getExportFn<
    (data: Uint8Array, key: Uint8Array, algorithm?: string) => EncryptionResult
  >(mod, ["encrypt"]);
  const decryptFn = getExportFn<(encrypted: any, key: Uint8Array) => Uint8Array>(mod, ["decrypt"]);
  const encryptWithAadFn = getExportFn<
    (
      data: Uint8Array,
      key: Uint8Array,
      aad: Uint8Array,
      algorithm?: string,
    ) => EncryptionResult
  >(mod, ["encryptWithAad", "encrypt_with_aad"]);
  const decryptWithAadFn = getExportFn<
    (encrypted: any, key: Uint8Array, aad: Uint8Array) => Uint8Array
  >(mod, ["decryptWithAad", "decrypt_with_aad"]);
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
  const decompressBoundedFn = getExportFn<
    (
      data: Uint8Array,
      algorithm: string,
      maxOutputBytes: number,
    ) => Uint8Array
  >(mod, ["decompressBounded", "decompress_bounded"]);
  const fuseFn = getExportFn<(data: Uint8Array, key: Uint8Array, preset?: string, chunkSize?: number) => Uint8Array>(
    mod,
    ["fuse"],
  );
  const unfuseFn = getExportFn<(data: Uint8Array, key: Uint8Array) => Uint8Array>(mod, ["unfuse"]);
  const inspectFusedFn = getExportFn<(data: Uint8Array) => any>(mod, ["inspectFused", "inspect_fused"]);
  const protectFn = getExportFn<
    (
      data: Uint8Array,
      key: Uint8Array,
      preset?: string,
      compressionAlgorithm?: string,
      compressionLevel?: number,
      encryptionAlgorithm?: string,
      shellChunkSize?: number,
    ) => any
  >(mod, ["protect"]);
  const openFn = getExportFn<(artifact: Uint8Array, key: Uint8Array) => Uint8Array>(mod, ["open"]);
  const inspectArtifactFn = getExportFn<(artifact: Uint8Array) => any>(mod, ["inspectArtifact", "inspect_artifact"]);
  const repackArtifactFn = getExportFn<
    (
      artifact: Uint8Array,
      key: Uint8Array,
      preset?: string,
      compressionAlgorithm?: string,
      compressionLevel?: number,
      encryptionAlgorithm?: string,
      shellChunkSize?: number,
    ) => any
  >(mod, ["repackArtifact", "repack_artifact"]);
  const randomBytes = getExportFn<(length: number) => Uint8Array>(mod, ["random_bytes", "randomBytes"]);
  const base64Encode = getExportFn<(data: Uint8Array) => string>(mod, ["base64_encode", "base64Encode"]);
  const base64Decode = getExportFn<(encoded: string) => Uint8Array>(mod, ["base64_decode", "base64Decode"]);
  const hexEncode = getExportFn<(data: Uint8Array) => string>(mod, ["hex_encode", "hexEncode"]);
  const hexDecode = getExportFn<(encoded: string) => Uint8Array>(mod, ["hex_decode", "hexDecode"]);

  const deriveHkdfRaw = mod.derive_key_hkdf_raw || mod.deriveKeyHkdfRaw;
  const generateX25519 = mod.generate_x25519_key_pair || mod.generateX25519KeyPair;
  const x25519SharedSecret = mod.x25519_shared_secret || mod.x25519SharedSecret;
  const deriveFromSharedSecret = mod.derive_key_from_shared_secret || mod.deriveKeyFromSharedSecret;
  const generateRecoveryDeck = mod.generate_recovery_deck || mod.generateRecoveryDeck;
  const validateRecoveryDeck = mod.validate_recovery_deck || mod.validateRecoveryDeck;
  const encodeRecoveryDeck = mod.encode_recovery_deck || mod.encodeRecoveryDeck;
  const deriveRecoveryKey = mod.derive_recovery_key || mod.deriveRecoveryKey;
  const wrapRootWithRecoveryKey = mod.wrap_root_with_recovery_key || mod.wrapRootWithRecoveryKey;
  const unwrapRootWithRecoveryKey = mod.unwrap_root_with_recovery_key || mod.unwrapRootWithRecoveryKey;
  const createRecoveryDeck = mod.create_recovery_deck || mod.createRecoveryDeck;
  const rotateRecoveryDeck = mod.rotate_recovery_deck || mod.rotateRecoveryDeck;

  return {
    version: () => version(),
    generate_key: () => generateKey(),
    encrypt: (data, key, algorithm) => encryptFn(data, key, algorithm),
    decrypt: (ciphertext, nonce, tag, key, algorithm) =>
      decryptFn({ ciphertext, nonce, tag, algorithm }, key),
    encrypt_with_aad: (data, key, aad, algorithm) =>
      encryptWithAadFn(data, key, aad, algorithm),
    decrypt_with_aad: (ciphertext, nonce, tag, key, algorithm, aad) =>
      decryptWithAadFn({ ciphertext, nonce, tag, algorithm }, key, aad),
    derive_key_hkdf: (ikm, salt, info) => deriveHkdf(ikm, salt, info),
    derive_key_hkdf_raw: deriveHkdfRaw
      ? (ikm, salt, info, length) => deriveHkdfRaw(ikm, salt, info, length)
      : undefined,
    derive_key_pbkdf2: (password, salt, iterations) => derivePbkdf2(password, salt, iterations),
    generate_recovery_deck: generateRecoveryDeck
      ? () => generateRecoveryDeck()
      : undefined,
    validate_recovery_deck: validateRecoveryDeck
      ? (deck) => validateRecoveryDeck(deck)
      : undefined,
    encode_recovery_deck: encodeRecoveryDeck
      ? (deck) => encodeRecoveryDeck(deck)
      : undefined,
    derive_recovery_key: deriveRecoveryKey
      ? (deck) => deriveRecoveryKey(deck)
      : undefined,
    wrap_root_with_recovery_key: wrapRootWithRecoveryKey
      ? (rootKey, recoveryKey) => wrapRootWithRecoveryKey(rootKey, recoveryKey)
      : undefined,
    unwrap_root_with_recovery_key: unwrapRootWithRecoveryKey
      ? (rootWrapper, recoveryKey) => unwrapRootWithRecoveryKey(rootWrapper, recoveryKey)
      : undefined,
    create_recovery_deck: createRecoveryDeck
      ? (rootKey) => normalizeRecoveryDeckSetup(createRecoveryDeck(rootKey))
      : undefined,
    rotate_recovery_deck: rotateRecoveryDeck
      ? (rootWrapper, oldDeck) =>
          normalizeRecoveryDeckSetup(rotateRecoveryDeck(rootWrapper, oldDeck))
      : undefined,
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
    decompress_bounded: (data, algorithm, maxOutputBytes) =>
      decompressBoundedFn(data, algorithm, maxOutputBytes),
    fuse: (data, key, preset, chunkSize) => fuseFn(data, key, preset, chunkSize),
    unfuse: (data, key) => unfuseFn(data, key),
    inspectFused: (data) => normalizeFusedShellInfo(inspectFusedFn(data)),
    protect: (data, key, preset, compressionAlgorithm, compressionLevel, encryptionAlgorithm, shellChunkSize) =>
      normalizeProtectResult(
        protectFn(
          data,
          key,
          preset,
          compressionAlgorithm,
          compressionLevel,
          encryptionAlgorithm,
          shellChunkSize,
        ),
      ),
    open: (artifact, key) => openFn(artifact, key),
    inspectArtifact: (artifact) => normalizeProtectedArtifactInfo(inspectArtifactFn(artifact)),
    repackArtifact: (
      artifact,
      key,
      preset,
      compressionAlgorithm,
      compressionLevel,
      encryptionAlgorithm,
      shellChunkSize,
    ) =>
      normalizeProtectResult(
        repackArtifactFn(
          artifact,
          key,
          preset,
          compressionAlgorithm,
          compressionLevel,
          encryptionAlgorithm,
          shellChunkSize,
        ),
      ),
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
export async function initWasm(options?: WasmLoaderOptions): Promise<WasmModule> {
  if (options !== undefined) {
    applyWasmLoaderOptions(options, true);
  }

  // Already initialized
  if (wasmModule) {
    return wasmModule;
  }
  
  // Already failed
  if (initError) {
    throw initError;
  }

  wasmInitializationStarted = true;
  
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
      const mod = await importWasmBindings();

      // Initialize if needed (wasm-bindgen generated code)
      if (typeof mod.default === 'function') {
        // wasm-bindgen resolves its adjacent .wasm asset from the imported JS
        // module URL, so no page-relative or caller-controlled URL is involved.
        await mod.default();
      }

      wasmModule = secureWasmModule(
        normalizeWasmModule(mod as unknown as RawWasmModule),
      );
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
