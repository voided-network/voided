/* tslint:disable */
/* eslint-disable */

/**
 * Base64 decode
 */
export function base64Decode(encoded: string): Uint8Array;

/**
 * Base64 encode
 */
export function base64Encode(data: Uint8Array): string;

/**
 * Compare hashes in constant time
 */
export function compareHashes(a: Uint8Array, b: Uint8Array): boolean;

/**
 * Compress data
 */
export function compress(data: Uint8Array, algorithm?: string | null, level?: number | null): any;

/**
 * Generate a fresh deck and authenticated wrapper for an existing stable root.
 */
export function createRecoveryDeck(root_key: Uint8Array): any;

/**
 * Decompress data
 */
export function decompress(data: Uint8Array, algorithm: string): Uint8Array;

/**
 * Decompress with a caller-selected absolute output ceiling.
 *
 * This explicit path does not apply the legacy expansion-ratio heuristic.
 * The output ceiling is still constrained by voided-core's 512 MiB global
 * in-memory decompression limit.
 */
export function decompressBounded(data: Uint8Array, algorithm: string, max_output_size: number): Uint8Array;

/**
 * Decrypt data
 */
export function decrypt(encrypted: any, key: Uint8Array): Uint8Array;

/**
 * Decrypt bytes only when the caller supplies the exact authenticated context.
 */
export function decryptWithAad(encrypted: any, key: Uint8Array, aad: Uint8Array): Uint8Array;

/**
 * Derive AES key bytes from DH shared secret using HKDF.
 */
export function deriveKeyFromSharedSecret(shared_secret: Uint8Array, salt: string, info: string): Uint8Array;

/**
 * Derive a key using HKDF-SHA256
 */
export function deriveKeyHkdf(input_key_material: Uint8Array, salt: Uint8Array | null | undefined, info: Uint8Array): Uint8Array;

/**
 * Derive raw key material using HKDF-SHA256.
 */
export function deriveKeyHkdfRaw(input_key_material: Uint8Array, salt: Uint8Array | null | undefined, info: Uint8Array, length: number): Uint8Array;

/**
 * Derive a key using PBKDF2-HMAC-SHA256
 */
export function deriveKeyPbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array;

/**
 * Deterministically derive the 32-byte Recovery Key for a valid deck.
 */
export function deriveRecoveryKey(deck: any): Uint8Array;

/**
 * Encode a valid recovery deck as its canonical 29-byte permutation rank.
 */
export function encodeRecoveryDeck(deck: any): Uint8Array;

/**
 * Encrypt data using XChaCha20-Poly1305 by default or explicit AES-256-GCM.
 */
export function encrypt(data: Uint8Array, key: Uint8Array, algorithm?: string | null): any;

/**
 * Encrypt bytes while authenticating caller-supplied context without storing it in ciphertext.
 */
export function encryptWithAad(data: Uint8Array, key: Uint8Array, aad: Uint8Array, algorithm?: string | null): any;

/**
 * Fuse arbitrary bytes with the fused shell primitive.
 */
export function fuse(data: Uint8Array, key: Uint8Array, preset?: string | null, chunk_size?: number | null): Uint8Array;

/**
 * Generate fingerprint
 */
export function generateFingerprint(data: Uint8Array, length?: number | null): string;

/**
 * Generate HMAC
 */
export function generateHmac(data: Uint8Array, key: Uint8Array, algorithm?: string | null): string;

/**
 * Generate a random 256-bit encryption key (returns Uint8Array)
 */
export function generateKey(): Uint8Array;

/**
 * Generate a fresh standard 52-card recovery deck using the OS CSPRNG.
 */
export function generateRecoveryDeck(): any;

/**
 * Format a SHA-256 fingerprint for human comparison (not Signal's protocol).
 */
export function generateSafetyNumbers(data: Uint8Array, group_size?: number | null): string;

/**
 * Generate random salt
 */
export function generateSalt(length?: number | null): Uint8Array;

/**
 * Generate X25519 key pair (deterministic if seed provided).
 */
export function generateX25519KeyPair(seed?: Uint8Array | null): any;

/**
 * Generate a SHA-256 or SHA-512 hash
 */
export function hash(data: Uint8Array, algorithm?: string | null): string;

/**
 * Hash with PBKDF2 (high iterations)
 */
export function hashWithPbkdf2(data: Uint8Array, salt: Uint8Array, iterations: number): string;

/**
 * Generate a salted hash
 */
export function hashWithSalt(data: Uint8Array, salt: Uint8Array, algorithm?: string | null): string;

/**
 * Hex decode
 */
export function hexDecode(encoded: string): Uint8Array;

/**
 * Hex encode
 */
export function hexEncode(data: Uint8Array): string;

export function init(): void;

/**
 * Inspect a current VOF3 whole-monolith artifact without a key.
 */
export function inspectArtifact(artifact: Uint8Array): any;

/**
 * Inspect a fused shell envelope without a key.
 */
export function inspectFused(data: Uint8Array): any;

/**
 * Inspect either a current VOF3 artifact or an explicit legacy VOF2 rotation artifact.
 */
export function inspectRotationArtifact(artifact: Uint8Array): any;

/**
 * Open a current VOF3 whole-monolith artifact.
 */
export function open(artifact: Uint8Array, key: Uint8Array): Uint8Array;

/**
 * Open either a current VOF3 artifact or an explicit legacy VOF2 rotation artifact.
 */
export function openRotationArtifact(artifact: Uint8Array, key: Uint8Array): Uint8Array;

/**
 * Protect bytes with the Voided 1.0 whole-monolith full flow.
 */
export function protect(data: Uint8Array, key: Uint8Array, preset?: string | null, compression_algorithm?: string | null, compression_level?: number | null, encryption_algorithm?: string | null, shell_chunk_size?: number | null): any;

/**
 * Generate random bytes
 */
export function randomBytes(length: number): Uint8Array;

/**
 * Repack a current VOF3 monolith artifact under a new full-flow configuration.
 */
export function repackArtifact(artifact: Uint8Array, key: Uint8Array, preset?: string | null, compression_algorithm?: string | null, compression_level?: number | null, encryption_algorithm?: string | null, shell_chunk_size?: number | null): any;

/**
 * Replace a deck by rewrapping the same stable root under a fresh random deck.
 */
export function rotateRecoveryDeck(old_root_wrapper: Uint8Array, old_deck: any): any;

/**
 * Reverse the fused shell primitive.
 */
export function unfuse(data: Uint8Array, key: Uint8Array): Uint8Array;

/**
 * Recover a stable 32-byte root from an authenticated recovery wrapper.
 */
export function unwrapRootWithRecoveryKey(root_wrapper: Uint8Array, recovery_key: Uint8Array): Uint8Array;

/**
 * Return whether card IDs form one exact valid 52-card permutation.
 */
export function validateRecoveryDeck(deck: any): boolean;

/**
 * Verify HMAC
 */
export function verifyHmac(data: Uint8Array, hmac: string, key: Uint8Array, algorithm?: string | null): boolean;

/**
 * Verify PBKDF2 hash
 */
export function verifyPbkdf2(data: Uint8Array, expected_hash: string, salt: Uint8Array, iterations: number): boolean;

/**
 * Library version
 */
export function version(): string;

/**
 * Wrap a stable 32-byte root with a derived Recovery Key.
 */
export function wrapRootWithRecoveryKey(root_key: Uint8Array, recovery_key: Uint8Array): Uint8Array;

/**
 * Compute X25519 shared secret.
 */
export function x25519SharedSecret(our_private_key: Uint8Array, their_public_key: Uint8Array): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly base64Decode: (a: number, b: number, c: number) => void;
    readonly base64Encode: (a: number, b: number, c: number) => void;
    readonly compareHashes: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly compress: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly createRecoveryDeck: (a: number, b: number, c: number) => void;
    readonly decompress: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decompressBounded: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly decrypt: (a: number, b: number, c: number, d: number) => void;
    readonly decryptWithAad: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly deriveKeyFromSharedSecret: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly deriveKeyHkdf: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly deriveKeyHkdfRaw: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly deriveKeyPbkdf2: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly deriveRecoveryKey: (a: number, b: number) => void;
    readonly encodeRecoveryDeck: (a: number, b: number) => void;
    readonly encrypt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly encryptWithAad: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly fuse: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly generateFingerprint: (a: number, b: number, c: number, d: number) => void;
    readonly generateHmac: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly generateKey: (a: number) => void;
    readonly generateRecoveryDeck: (a: number) => void;
    readonly generateSafetyNumbers: (a: number, b: number, c: number, d: number) => void;
    readonly generateSalt: (a: number, b: number) => void;
    readonly generateX25519KeyPair: (a: number, b: number, c: number) => void;
    readonly hash: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly hashWithPbkdf2: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly hashWithSalt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly hexDecode: (a: number, b: number, c: number) => void;
    readonly hexEncode: (a: number, b: number, c: number) => void;
    readonly inspectArtifact: (a: number, b: number, c: number) => void;
    readonly inspectFused: (a: number, b: number, c: number) => void;
    readonly inspectRotationArtifact: (a: number, b: number, c: number) => void;
    readonly open: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly openRotationArtifact: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly protect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly randomBytes: (a: number, b: number) => void;
    readonly repackArtifact: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => void;
    readonly rotateRecoveryDeck: (a: number, b: number, c: number, d: number) => void;
    readonly unfuse: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly unwrapRootWithRecoveryKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly validateRecoveryDeck: (a: number) => number;
    readonly verifyHmac: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly verifyPbkdf2: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly version: (a: number) => void;
    readonly wrapRootWithRecoveryKey: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly x25519SharedSecret: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly init: () => void;
    readonly BroccoliConcatFinish: (a: number, b: number, c: number) => number;
    readonly BroccoliConcatFinished: (a: number, b: number, c: number) => number;
    readonly BroccoliConcatStream: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly BroccoliConcatStreaming: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly BroccoliCreateInstance: (a: number) => void;
    readonly BroccoliCreateInstanceWithWindowSize: (a: number, b: number) => void;
    readonly BroccoliDestroyInstance: (a: number) => void;
    readonly BroccoliNewBrotliFile: (a: number) => void;
    readonly BrotliEncoderCompress: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly BrotliEncoderCompressMulti: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly BrotliEncoderCompressStream: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly BrotliEncoderCompressStreaming: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly BrotliEncoderCompressWorkPool: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => number;
    readonly BrotliEncoderCreateInstance: (a: number, b: number, c: number) => number;
    readonly BrotliEncoderCreateWorkPool: (a: number, b: number, c: number, d: number) => number;
    readonly BrotliEncoderDestroyInstance: (a: number) => void;
    readonly BrotliEncoderDestroyWorkPool: (a: number) => void;
    readonly BrotliEncoderFreeU8: (a: number, b: number, c: number) => void;
    readonly BrotliEncoderFreeUsize: (a: number, b: number, c: number) => void;
    readonly BrotliEncoderHasMoreOutput: (a: number) => number;
    readonly BrotliEncoderIsFinished: (a: number) => number;
    readonly BrotliEncoderMallocU8: (a: number, b: number) => number;
    readonly BrotliEncoderMallocUsize: (a: number, b: number) => number;
    readonly BrotliEncoderMaxCompressedSize: (a: number) => number;
    readonly BrotliEncoderMaxCompressedSizeMulti: (a: number, b: number) => number;
    readonly BrotliEncoderSetCustomDictionary: (a: number, b: number, c: number) => void;
    readonly BrotliEncoderSetParameter: (a: number, b: number, c: number) => number;
    readonly BrotliEncoderTakeOutput: (a: number, b: number) => number;
    readonly BrotliEncoderVersion: () => number;
    readonly CBrotliDecoderErrorString: (a: number) => number;
    readonly CBrotliDecoderGetErrorCode: (a: number) => number;
    readonly CBrotliDecoderGetErrorString: (a: number) => number;
    readonly CBrotliDecoderHasMoreOutput: (a: number) => number;
    readonly CBrotliDecoderIsFinished: (a: number) => number;
    readonly CBrotliDecoderIsUsed: (a: number) => number;
    readonly CBrotliDecoderTakeOutput: (a: number, b: number) => number;
    readonly BrotliDecoderErrorString: (a: number) => number;
    readonly BrotliDecoderGetErrorCode: (a: number) => number;
    readonly BrotliDecoderGetErrorString: (a: number) => number;
    readonly BrotliDecoderHasMoreOutput: (a: number) => number;
    readonly BrotliDecoderIsFinished: (a: number) => number;
    readonly BrotliDecoderIsUsed: (a: number) => number;
    readonly BrotliDecoderTakeOutput: (a: number, b: number) => number;
    readonly BrotliDecoderFreeU8: (a: number, b: number, c: number) => void;
    readonly BrotliDecoderVersion: () => number;
    readonly BrotliDecoderMallocU8: (a: number, b: number) => number;
    readonly BrotliDecoderFreeUsize: (a: number, b: number, c: number) => void;
    readonly BrotliDecoderDecompress: (a: number, b: number, c: number, d: number) => number;
    readonly BrotliDecoderMallocUsize: (a: number, b: number) => number;
    readonly BrotliDecoderSetParameter: (a: number, b: number, c: number) => void;
    readonly BrotliDecoderCreateInstance: (a: number, b: number, c: number) => number;
    readonly BrotliDecoderDestroyInstance: (a: number) => void;
    readonly BrotliDecoderDecompressStream: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly BrotliDecoderDecompressPrealloc: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly BrotliDecoderDecompressStreaming: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly BrotliDecoderDecompressWithReturnInfo: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
