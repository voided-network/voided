// Export crypto backend (WASM + TS fallback)
export * as crypto from "./crypto-backend";
export {
  decompressBounded,
  useWasmBackend,
  forceTypeScriptBackend,
  forceWasmBackend,
  getCurrentBackend,
  isWasmBackendReady,
} from "./crypto-backend";

import {
  protect as protectArtifactBytes,
  open as openArtifactBytes,
  inspectArtifact as inspectArtifactBytes,
  type ProtectResult as RuntimeProtectResult,
  type ProtectedArtifactInfo as RuntimeProtectedArtifactInfo,
} from "./crypto-backend";

// Export WASM loader for advanced usage
export { 
  configureWasmLoader,
  initWasm, 
  getWasm, 
  isWasmReady, 
  getWasmError,
  getWasmSync,
} from "./wasm/loader";
export type { WasmLoaderOptions } from "./wasm/loader";

import {
  compress,
  decompress,
} from "./compression";
import { CryptoService } from "./crypto-service";
export { CryptoService, cryptoService } from "./crypto-service";
import { StorageService } from "./storage-service";
import { KeyManager, type KeyReadLease } from "./key-manager";
import {
  Validator,
  ValidationError,
  CryptoError,
  KeyError,
  E2EEError,
} from "./errors";
import {
  assertWithinClientMemoryLimit,
  assertWithinClientUploadLimit,
  CLIENT_CHUNK_CONCURRENCY,
  CLIENT_MIN_CHUNK_BYTES,
  CLIENT_MAX_CHUNK_BYTES,
  CLIENT_MAX_CHUNKS,
  CLIENT_MAX_ENCODED_BLOB_BYTES,
  CLIENT_MAX_IN_MEMORY_BYTES,
} from "./limits";
import { inspectCanonicalBase64 } from "./base64-validation";

// --- SAFE BASE64 HELPERS ---
function base64Encode(bytes: Uint8Array): string {
  // Prefer Node's Buffer when available (tests), otherwise fallback to browser btoa
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore Buffer may not exist in browser
    if (typeof Buffer !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore Buffer may not exist in browser
      return Buffer.from(bytes).toString("base64");
    }
  } catch {}
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize) as any
    );
  }
  return btoa(binary);
}

function base64Decode(
  b64: string,
  maxDecodedBytes = CLIENT_MAX_ENCODED_BLOB_BYTES
): Uint8Array {
  const inspection = inspectCanonicalBase64(b64, maxDecodedBytes);
  if (!inspection.ok && inspection.reason === "too-large") {
    throw new ValidationError("Base64 value exceeds the browser decoding limit");
  }
  if (!inspection.ok) {
    throw new ValidationError("Invalid canonical base64 value");
  }
  const decodedLength = inspection.decodedLength;
  // Prefer Node's Buffer when available (tests), otherwise fallback to browser atob
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore Buffer may not exist in browser
    if (typeof Buffer !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore Buffer may not exist in browser
      const decoded = new Uint8Array(Buffer.from(b64, "base64"));
      if (decoded.length !== decodedLength) {
        throw new ValidationError("Invalid canonical base64 value");
      }
      return decoded;
    }
  } catch {}
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.length !== decodedLength) {
    throw new ValidationError("Invalid canonical base64 value");
  }
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, value) => sum + value.length, 0);
  assertWithinClientMemoryLimit(total, "Combined cryptographic transcript");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const value of arrays) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export interface E2EEConfig {
  keyId?: string;
  autoGenerateKey?: boolean;
  storage?: E2EEStorage;
  enableSignatures?: boolean; // Enable digital signatures for authenticity
  /**
   * Removed: the old option was a static-key exchange, not a forward-secret
   * ratchet. Passing true now fails closed.
   */
  enableForwardSecrecy?: boolean;
  /** Explicit peer identity key used to verify signed blobs. */
  trustedSigningPublicKey?: string;
  enableChunking?: boolean; // Enable automatic chunking for large data (default: true)
  chunkSize?: number; // Chunk size in bytes (default: 2 MiB)
  minChunkThreshold?: number; // Minimum size to trigger chunking (default: 10 MiB)
}

export interface RotationOptions {
  force?: boolean; // Force rotate: delete old key, leave old data encrypted (unrecoverable) - DEFAULT: true
  migrate?: boolean; // Whether to attempt migration (default: false, requires enc-seq library for full migration)
  cutoffTime?: Date; // Time-based cutoff for migration (default: now)
}

export interface MigrationState {
  isActive: boolean;
  oldKeyVersion: number;
  newKeyVersion: number;
  cutoffTime: Date;
  lastProgress: number;
  createdAt: Date;
}

export interface E2EEStorage {
  getKey(keyId: string): Promise<string | null>;
  setKey(keyId: string, key: string): Promise<void>;
  removeKey(keyId: string): Promise<void>;
  getMigrationState(keyId: string): Promise<MigrationState | null>;
  setMigrationState(keyId: string, state: MigrationState): Promise<void>;
  removeMigrationState(keyId: string): Promise<void>;
  // Enhanced storage for advanced features
  getKeyPair(
    keyId: string,
    type: "signing" | "agreement"
  ): Promise<string | null>;
  setKeyPair(
    keyId: string,
    type: "signing" | "agreement",
    keyPair: string
  ): Promise<void>;
  removeKeyPair(keyId: string, type: "signing" | "agreement"): Promise<void>;
}

export interface EncryptedChunk {
  data: string; // Base64 encoded encrypted chunk data
  iv: string; // Base64 encoded IV for this chunk
  index: number; // Chunk index for reassembly
  plaintextSize: number; // Authenticated compressed bytes in this chunk
  signature?: string; // Required when signature mode is enabled
}

export interface EncryptedBlob {
  data?: string; // Base64 encoded encrypted data (for non-chunked data)
  iv?: string; // Base64 encoded IV (for non-chunked data)
  keyId: string;
  messageId: string; // Random per-message identifier, authenticated as AAD
  algorithm: "AES-GCM";
  version: "1.1";
  compression: {
    algorithm: "gzip" | "brotli" | "none";
    originalSize: number;
    compressedSize: number;
  };
  // Enhanced with signature support
  signature?: string; // Required when signature mode is enabled
  // Chunking support
  chunks?: EncryptedChunk[]; // Array of encrypted chunks (for large data)
  chunkInfo?: {
    totalChunks: number;
    chunkSize: number;
    isChunked: true;
  };
  // Authenticated as AEAD additional data.
  textEncoding: "utf8" | "utf16le";
}

export interface EncryptOptions {
  originalSizeBytes?: number;
  resumeTokenOriginalSize?: number;
  forceCompression?: boolean; // Explicitly opt in to compression
  /**
   * Defaults to none. Compressing secrets together with attacker-controlled
   * input can leak information through ciphertext length.
   */
  compressionAlgorithm?: "gzip" | "brotli" | "none" | "auto";
  compressionLevel?: number; // 1-9 for gzip, 1-11 for brotli
}

export interface ProtectOptions {
  preset?: "compact" | "balanced" | "concealed";
  compressionAlgorithm?: "gzip" | "brotli" | "none";
  compressionLevel?: number;
  encryptionAlgorithm?: "aes-256-gcm" | "xchacha20-poly1305";
  shellChunkSize?: number;
}

export interface ProtectedBlob {
  artifact: string;
  keyId: string;
  version: "2.0";
  pipeline: "compression->encryption->fused-shell";
  preset: "compact" | "balanced" | "concealed";
  compression: {
    algorithm: "gzip" | "brotli" | "none";
    originalSize: number;
    compressedSize: number;
  };
  encryptionAlgorithm: "aes-256-gcm" | "xchacha20-poly1305";
  shell: {
    chunkSize: number;
    chunkCount: number;
  };
  protectedSize: number;
  textEncoding?: "utf8" | "utf16le";
}

export type ProtectedBlobInfo = Omit<ProtectedBlob, "artifact">;

export interface KeyDerivationOptions {
  password: string;
  salt?: Uint8Array; // If not provided, will be generated
  iterations?: number; // Default/minimum: 600000
}

export interface PasswordKeyDerivationRecord {
  version: 1;
  algorithm: "PBKDF2-SHA256";
  salt: string;
  iterations: number;
  /** Monotonic primary-key version this recovery record describes. */
  keyVersion: number;
}

export interface KeyVerificationResult {
  fingerprint: string;
  safetyNumbers: string;
  verified: boolean;
}

/**
 * IndexedDB storage adapter for browser environments
 * Enhanced with support for key pairs and advanced features
 */
export class IndexedDBStorage implements E2EEStorage {
  private dbName = "voideddev-e2ee";
  private keysStoreName = "keys";
  private migrationStoreName = "migrations";
  private keyPairsStoreName = "keyPairs";
  private version = 3; // Increment version to add key pairs store

  private async getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create keys store if it doesn't exist
        if (!db.objectStoreNames.contains(this.keysStoreName)) {
          db.createObjectStore(this.keysStoreName, { keyPath: "id" });
        }

        // Create migrations store if it doesn't exist
        if (!db.objectStoreNames.contains(this.migrationStoreName)) {
          db.createObjectStore(this.migrationStoreName, { keyPath: "id" });
        }

        // Create key pairs store if it doesn't exist
        if (!db.objectStoreNames.contains(this.keyPairsStoreName)) {
          db.createObjectStore(this.keyPairsStoreName, { keyPath: "id" });
        }
      };
    });
  }

  /**
   * An IndexedDB request may succeed and its enclosing transaction may still
   * abort. Resolve reads and writes only after transaction.oncomplete so the
   * caller never treats an uncommitted value (including null) as authoritative.
   */
  private awaitTransactionResult<T>(
    transaction: IDBTransaction,
    request: IDBRequest,
    readResult: (result: unknown) => T
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let requestSucceeded = false;
      let value: T;
      let requestFailure: unknown;

      request.onsuccess = () => {
        try {
          value = readResult(request.result);
          requestSucceeded = true;
        } catch (error) {
          requestFailure = error;
          try {
            transaction.abort();
          } catch {
            // The transaction may already be finishing; oncomplete below still
            // refuses to resolve a failed result conversion.
          }
        }
      };
      request.onerror = () => {
        requestFailure = request.error;
      };

      const rejectTransaction = () =>
        {
          try {
            transaction.db.close();
          } catch {}
          reject(
          requestFailure ??
            transaction.error ??
            request.error ??
            new Error("IndexedDB transaction failed")
          );
        };
      transaction.onerror = rejectTransaction;
      transaction.onabort = rejectTransaction;
      transaction.oncomplete = () => {
        try {
          transaction.db.close();
        } catch {}
        if (requestFailure || !requestSucceeded) {
          rejectTransaction();
          return;
        }
        resolve(value!);
      };
    });
  }

  async getKey(keyId: string): Promise<string | null> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.keysStoreName], "readonly");
      const request = transaction.objectStore(this.keysStoreName).get(keyId);
      return this.awaitTransactionResult(transaction, request, (result: any) =>
        result ? result.key : null
      );
    } catch (error) {
      throw new Error(
        `Failed to read key from IndexedDB: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async setKey(keyId: string, key: string): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.keysStoreName], "readwrite");
      const request = transaction.objectStore(this.keysStoreName).put({ id: keyId, key });
      return this.awaitTransactionResult(transaction, request, () => undefined);
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      throw new Error("Failed to store key: IndexedDB not available");
    }
  }

  async removeKey(keyId: string): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction([this.keysStoreName], "readwrite");
      const request = transaction.objectStore(this.keysStoreName).delete(keyId);
      return this.awaitTransactionResult(transaction, request, () => undefined);
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      throw new Error("Failed to remove key: IndexedDB not available");
    }
  }

  async getMigrationState(keyId: string): Promise<MigrationState | null> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.migrationStoreName],
        "readonly"
      );
      const request = transaction.objectStore(this.migrationStoreName).get(keyId);
      return this.awaitTransactionResult(transaction, request, (result: any) => {
        if (!result?.state) return null;
        return {
          ...result.state,
          cutoffTime: new Date(result.state.cutoffTime),
          createdAt: new Date(result.state.createdAt),
        } as MigrationState;
      });
    } catch (error) {
      throw new Error(
        `Failed to read migration state from IndexedDB: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async setMigrationState(keyId: string, state: MigrationState): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.migrationStoreName],
        "readwrite"
      );
      const request = transaction.objectStore(this.migrationStoreName).put({ id: keyId, state });
      return this.awaitTransactionResult(transaction, request, () => undefined);
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      throw new Error(
        "Failed to store migration state: IndexedDB not available"
      );
    }
  }

  async removeMigrationState(keyId: string): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.migrationStoreName],
        "readwrite"
      );
      const request = transaction.objectStore(this.migrationStoreName).delete(keyId);
      return this.awaitTransactionResult(transaction, request, () => undefined);
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      throw new Error(
        "Failed to remove migration state: IndexedDB not available"
      );
    }
  }

  async getKeyPair(
    keyId: string,
    type: "signing" | "agreement"
  ): Promise<string | null> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.keyPairsStoreName],
        "readonly"
      );
      const request = transaction.objectStore(this.keyPairsStoreName).get(`${keyId}_${type}`);
      return this.awaitTransactionResult(transaction, request, (result: any) =>
        result ? result.keyPair : null
      );
    } catch (error) {
      throw new Error(
        `Failed to read key pair from IndexedDB: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async setKeyPair(
    keyId: string,
    type: "signing" | "agreement",
    keyPair: string
  ): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.keyPairsStoreName],
        "readwrite"
      );
      const request = transaction.objectStore(this.keyPairsStoreName).put({ id: `${keyId}_${type}`, keyPair });
      return this.awaitTransactionResult(transaction, request, () => undefined);
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      throw new Error("Failed to store key pair: IndexedDB not available");
    }
  }

  async removeKeyPair(
    keyId: string,
    type: "signing" | "agreement"
  ): Promise<void> {
    try {
      const db = await this.getDB();
      const transaction = db.transaction(
        [this.keyPairsStoreName],
        "readwrite"
      );
      const request = transaction.objectStore(this.keyPairsStoreName).delete(`${keyId}_${type}`);
      return this.awaitTransactionResult(transaction, request, () => undefined);
    } catch (error) {
      //console.warn('IndexedDB access failed');
      throw new Error("Failed to remove key pair: IndexedDB not available");
    }
  }
}

/**
 * Main E2EE Client for browser-based end-to-end encryption
 * Enhanced with advanced cryptographic features
 */
export class VoidedE2EEClient {
  private static readonly PBKDF2_MIN_ITERATIONS = 600_000;
  private static readonly PBKDF2_MAX_ITERATIONS = 1_000_000;
  private static readonly PASSWORD_MIN_LENGTH = 12;
  private keyId: string;
  private storage: StorageService;
  private crypto: CryptoService;
  private keyManager: KeyManager;
  private enableSignatures: boolean;
  private enableChunking: boolean;
  private chunkSize: number;
  private minChunkThreshold: number;

  // Reusable buffers for better memory management
  private readonly textEncoder = new TextEncoder();

  // Cached key pairs for advanced features
  private cachedSigningKeyPair?: CryptoKeyPair;
  private cachedAgreementKeyPair?: CryptoKeyPair;
  private trustedSigningPublicKey?: string;
  private trustedVerificationKey?: CryptoKey;

  constructor(config: E2EEConfig = {}) {
    const configuredStorage = config.storage || new IndexedDBStorage();

    this.keyId = config.keyId || "default";
    this.enableSignatures = config.enableSignatures || false;
    if (config.enableForwardSecrecy) {
      throw new ValidationError(
        "enableForwardSecrecy was removed because the legacy mode was not a forward-secret ratchet"
      );
    }
    this.trustedSigningPublicKey = config.trustedSigningPublicKey;
    this.enableChunking = config.enableChunking !== false;
    this.chunkSize = config.chunkSize ?? 2 * 1024 * 1024;
    this.minChunkThreshold = config.minChunkThreshold ?? 10 * 1024 * 1024;

    Validator.validateKeyId(this.keyId);
    if (
      !Number.isSafeInteger(this.chunkSize) ||
      this.chunkSize < CLIENT_MIN_CHUNK_BYTES ||
      this.chunkSize > CLIENT_MAX_CHUNK_BYTES
    ) {
      throw new ValidationError(
        `chunkSize must be an integer from ${CLIENT_MIN_CHUNK_BYTES} to ${CLIENT_MAX_CHUNK_BYTES} bytes`
      );
    }
    if (
      !Number.isSafeInteger(this.minChunkThreshold) ||
      this.minChunkThreshold <= 0 ||
      this.minChunkThreshold > CLIENT_MAX_IN_MEMORY_BYTES
    ) {
      throw new ValidationError(
        `minChunkThreshold must be an integer from 1 to ${CLIENT_MAX_IN_MEMORY_BYTES} bytes`
      );
    }

    this.storage = new StorageService(configuredStorage);
    this.crypto = new CryptoService();
    this.keyManager = new KeyManager(this.storage, this.crypto, this.keyId);
  }

  /**
   * Derive encryption key from password using PBKDF2
   */
  public async deriveKeyFromPassword(
    options: KeyDerivationOptions
  ): Promise<PasswordKeyDerivationRecord> {
    if (!options || typeof options !== "object") {
      throw new KeyError("Key derivation failed: options are required");
    }
    const {
      password,
      salt: suppliedSalt = this.crypto.generateSalt(),
      iterations = VoidedE2EEClient.PBKDF2_MIN_ITERATIONS,
    } = options;

    try {
      if (typeof password !== "string") {
        throw new ValidationError("Password must be a string");
      }
      if (!(suppliedSalt instanceof Uint8Array)) {
        throw new ValidationError("PBKDF2 salt must be a Uint8Array");
      }
      const salt = new Uint8Array(suppliedSalt);
      if (password.length < VoidedE2EEClient.PASSWORD_MIN_LENGTH) {
        throw new ValidationError(
          `Password must contain at least ${VoidedE2EEClient.PASSWORD_MIN_LENGTH} characters`
        );
      }
      if (salt.length < 16 || salt.length > 64) {
        throw new ValidationError("PBKDF2 salt must contain 16 to 64 bytes");
      }
      if (
        !Number.isSafeInteger(iterations) ||
        iterations < VoidedE2EEClient.PBKDF2_MIN_ITERATIONS ||
        iterations > VoidedE2EEClient.PBKDF2_MAX_ITERATIONS
      ) {
        throw new ValidationError(
          `PBKDF2 iterations must be an integer from ${VoidedE2EEClient.PBKDF2_MIN_ITERATIONS} to ${VoidedE2EEClient.PBKDF2_MAX_ITERATIONS}`
        );
      }
      const derivedKey = await this.crypto.deriveKeyFromPassword(
        password,
        salt,
        iterations
      );
      let record: PasswordKeyDerivationRecord | undefined;
      await this.keyManager.setKey(
        derivedKey,
        1,
        {
          beforeCommit: async keyVersion => {
            record = {
              version: 1,
              algorithm: "PBKDF2-SHA256",
              salt: base64Encode(salt),
              iterations,
              keyVersion,
            };
            const storageKey = this.getInternalStorageKey("password-kdf");
            const serialized = JSON.stringify(record);
            await this.storage.setKey(storageKey, serialized);
            if (await this.storage.getKey(storageKey) !== serialized) {
              throw new KeyError("Password derivation metadata storage verification failed");
            }
          },
        }
      );
      if (!record) throw new KeyError("Password derivation metadata was not committed");
      return record;
    } catch (error) {
      throw new KeyError(
        `Key derivation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  public async getPasswordKeyDerivationRecord(): Promise<PasswordKeyDerivationRecord | null> {
    return this.keyManager.withKeyReadLease(async lease => {
      const stored = await this.storage.getKey(
        this.getInternalStorageKey("password-kdf")
      );
      if (!stored) return null;
      let record: unknown;
      try {
        record = JSON.parse(stored);
      } catch {
        throw new KeyError("Stored password derivation metadata is invalid");
      }
      if (
        !record ||
        typeof record !== "object" ||
        (record as PasswordKeyDerivationRecord).version !== 1 ||
        (record as PasswordKeyDerivationRecord).algorithm !== "PBKDF2-SHA256" ||
        !Number.isSafeInteger((record as PasswordKeyDerivationRecord).iterations) ||
        (record as PasswordKeyDerivationRecord).iterations <
          VoidedE2EEClient.PBKDF2_MIN_ITERATIONS ||
        (record as PasswordKeyDerivationRecord).iterations >
          VoidedE2EEClient.PBKDF2_MAX_ITERATIONS ||
        !Number.isSafeInteger((record as PasswordKeyDerivationRecord).keyVersion) ||
        (record as PasswordKeyDerivationRecord).keyVersion < 1
      ) {
        throw new KeyError("Stored password derivation metadata is invalid");
      }
      const salt = base64Decode(
        (record as PasswordKeyDerivationRecord).salt,
        64
      );
      if (salt.length < 16) {
        throw new KeyError("Stored password derivation salt is invalid");
      }
      const activeVersion = await lease.getPersistedKeyVersion();
      if (activeVersion !== (record as PasswordKeyDerivationRecord).keyVersion) {
        return null;
      }
      return record as PasswordKeyDerivationRecord;
    });
  }

  private hasUnpairedSurrogates(input: string): boolean {
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
        if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
        i++;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        const prev = i - 1 >= 0 ? input.charCodeAt(i - 1) : 0;
        if (!(prev >= 0xd800 && prev <= 0xdbff)) return true;
      }
    }
    return false;
  }

  /**
   * Generate and store signing key pair for digital signatures
   */
  public async generateSigningKeys(): Promise<string> {
    try {
      const keyPair = await this.crypto.generateSigningKeyPair();
      const publicKeyString = await this.crypto.exportPublicKey(
        keyPair.publicKey
      );

      // Store the key pair in memory
      this.cachedSigningKeyPair = keyPair;

      return publicKeyString;
    } catch (error) {
      throw new KeyError(
        `Signing key generation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Select the peer identity key that signed incoming blobs. Generating a local
   * signing key never implicitly trusts it for incoming data.
   */
  public async setTrustedSigningPublicKey(publicKey: string): Promise<void> {
    const imported = await this.crypto.importPublicKey(publicKey, "ECDSA");
    this.trustedSigningPublicKey = publicKey;
    this.trustedVerificationKey = imported;
  }

  /** Generate an agreement key pair for explicit application key agreement. */
  public async generateAgreementKeys(): Promise<string> {
    try {
      const keyPair = await this.crypto.generateKeyAgreementKeyPair();
      const publicKeyString = await this.crypto.exportPublicKey(
        keyPair.publicKey
      );

      // Store the key pair in memory
      this.cachedAgreementKeyPair = keyPair;

      return publicKeyString;
    } catch (error) {
      throw new KeyError(
        `Agreement key generation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Perform key agreement with another party's public key
   */
  public async performKeyAgreement(
    theirPublicKeyString: string
  ): Promise<void> {
    try {
      if (!this.cachedAgreementKeyPair) {
        await this.generateAgreementKeys();
      }

      const theirPublicKey = await this.crypto.importPublicKey(
        theirPublicKeyString,
        "ECDH"
      );
      const sharedKey = await this.crypto.deriveSharedKey(
        this.cachedAgreementKeyPair!.privateKey,
        theirPublicKey
      );

      // Use the shared key as our encryption key
      await this.keyManager.setKey(
        sharedKey,
        1,
        {
          afterCommit: () => this.storage.removeKey(this.getInternalStorageKey("password-kdf")),
        }
      );
    } catch (error) {
      throw new KeyError(
        `Key agreement failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get key fingerprint for identity verification
   */
  public async getKeyFingerprint(): Promise<string> {
    try {
      return await this.keyManager.withKeyReadLease(async lease => {
        const key = await lease.getCurrentKey();
        return this.crypto.getKeyFingerprint(key);
      });
    } catch (error) {
      throw new KeyError(
        `Fingerprint generation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get safety numbers for identity verification (like Signal)
   */
  public async getSafetyNumbers(): Promise<string> {
    try {
      return await this.keyManager.withKeyReadLease(async lease => {
        const key = await lease.getCurrentKey();
        return this.crypto.getSafetyNumbers(key);
      });
    } catch (error) {
      throw new KeyError(
        `Safety numbers generation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Verify another party's key fingerprint
   */
  public async verifyFingerprint(
    theirFingerprint: string
  ): Promise<KeyVerificationResult> {
    try {
      const { ourFingerprint, ourSafetyNumbers } =
        await this.keyManager.withKeyReadLease(async lease => {
          const key = await lease.getCurrentKey();
          return {
            ourFingerprint: await this.crypto.getKeyFingerprint(key),
            ourSafetyNumbers: await this.crypto.getSafetyNumbers(key),
          };
        });

      return {
        fingerprint: ourFingerprint,
        safetyNumbers: ourSafetyNumbers,
        verified: ourFingerprint === theirFingerprint,
      };
    } catch (error) {
      throw new KeyError(
        `Fingerprint verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Determine if data should be chunked based on size and configuration
   */
  private shouldChunk(dataSize: number): boolean {
    // Enable chunking for very large data to avoid stack overflow
    return this.enableChunking && dataSize >= this.minChunkThreshold;
  }

  /**
   * Split bytes into chunks for processing - OPTIMIZED VERSION
   */
  private chunkBytes(data: Uint8Array): Uint8Array[] {
    const totalLength = data.length;
    const chunkSize = this.chunkSize;
    const chunkCount = Math.ceil(totalLength / chunkSize);
    if (chunkCount < 1 || chunkCount > CLIENT_MAX_CHUNKS) {
      throw new CryptoError(
        `Chunk count must be between 1 and ${CLIENT_MAX_CHUNKS}`
      );
    }
    const chunks = new Array<Uint8Array>(chunkCount);

    // Use byte-based chunking for efficiency
    for (let index = 0; index < chunkCount; index++) {
      const offset = index * chunkSize;
      chunks[index] = data.subarray(
        offset,
        Math.min(offset + chunkSize, totalLength)
      );
    }
    return chunks;
  }

  private determineCompressionStrategy(
    _data: string,
    options?: EncryptOptions
  ): boolean {
    // Compression is opt-in. This prevents the high-level default from
    // co-compressing secrets and attacker-controlled input into a length oracle.
    return !options?.forceCompression && !options?.compressionAlgorithm;
  }

  private getCompressionAlgorithm(
    options?: EncryptOptions,
    shouldSkip: boolean = false
  ): "gzip" | "brotli" | "none" | "auto" {
    if (shouldSkip) return "none";
    const requested =
      options?.compressionAlgorithm ??
      (options?.forceCompression ? "auto" : "none");
    if (!["gzip", "brotli", "none", "auto"].includes(requested)) {
      throw new ValidationError("Unsupported compression algorithm");
    }
    return requested;
  }

  private createMessageId(): string {
    return base64Encode(crypto.getRandomValues(new Uint8Array(16)));
  }

  private buildEnvelopeAad(
    blob: EncryptedBlob,
    index: number,
    plaintextSize: number
  ): Uint8Array {
    return this.textEncoder.encode(
      JSON.stringify({
        domain: "voided/e2ee-client/aead/v1.1",
        version: blob.version,
        messageId: blob.messageId,
        keyId: blob.keyId,
        algorithm: blob.algorithm,
        compressionAlgorithm: blob.compression.algorithm,
        originalSize: blob.compression.originalSize,
        compressedSize: blob.compression.compressedSize,
        textEncoding: blob.textEncoding,
        chunked: Boolean(blob.chunkInfo?.isChunked),
        totalChunks: blob.chunkInfo?.totalChunks ?? 1,
        chunkSize: blob.chunkInfo?.chunkSize ?? plaintextSize,
        index,
        plaintextSize,
      })
    );
  }

  private buildSignaturePayload(
    aad: Uint8Array,
    encryptedData?: Uint8Array
  ): Uint8Array {
    const domain = this.textEncoder.encode("voided/e2ee-client/signature/v1\0");
    return concatBytes(domain, aad, encryptedData ?? new Uint8Array(0));
  }

  private requireSigningKeyForEncryption(): CryptoKey {
    if (!this.cachedSigningKeyPair) {
      throw new CryptoError(
        "Signature mode requires generateSigningKeys() before encryption"
      );
    }
    return this.cachedSigningKeyPair.privateKey;
  }

  private async getTrustedVerificationKey(): Promise<CryptoKey> {
    if (this.trustedVerificationKey) return this.trustedVerificationKey;
    if (!this.trustedSigningPublicKey) {
      throw new CryptoError(
        "Signature mode requires an explicitly trusted peer signing public key"
      );
    }
    this.trustedVerificationKey = await this.crypto.importPublicKey(
      this.trustedSigningPublicKey,
      "ECDSA"
    );
    return this.trustedVerificationKey;
  }

  private async signPayload(payload: Uint8Array): Promise<string> {
    const signature = await this.crypto.signData(
      payload,
      this.requireSigningKeyForEncryption()
    );
    return base64Encode(new Uint8Array(signature));
  }

  private async verifyRequiredSignature(
    payload: Uint8Array,
    signature: string | undefined,
    label: string
  ): Promise<void> {
    if (!signature) {
      throw new CryptoError(`Missing required ${label} signature`);
    }
    const verificationKey = await this.getTrustedVerificationKey();
    const signatureBytes = base64Decode(signature, 1024);
    const valid = await this.crypto.verifySignature(
      payload,
      signatureBytes.buffer.slice(
        signatureBytes.byteOffset,
        signatureBytes.byteOffset + signatureBytes.byteLength
      ) as ArrayBuffer,
      verificationKey
    );
    if (!valid) {
      throw new CryptoError(`Invalid ${label} signature`);
    }
  }

  /**
   * Encrypt data with compression and optional digital signature
   */
  public async encrypt(
    data: string,
    options?: EncryptOptions
  ): Promise<EncryptedBlob> {
    // Input validation
    Validator.validateData(data);

    try {
      // Compute the exact chosen encoding length without allocating a full
      // buffer, then encode once only after the browser memory cap is known.
      const prepared = this.encodeAuthenticatedText(data);
      const originalSize = options?.originalSizeBytes ?? prepared.bytes.length;
      assertWithinClientUploadLimit(originalSize);

      if (options?.resumeTokenOriginalSize !== undefined) {
        assertWithinClientUploadLimit(options.resumeTokenOriginalSize);
      }

      return await this.keyManager.withKeyReadLease(async lease => {
        const key = await lease.getCurrentKey();
        if (this.shouldChunk(prepared.bytes.length)) {
          return this.encryptWithChunking(
            data,
            prepared.bytes,
            prepared.textEncoding,
            key,
            options
          );
        }
        return this.encryptWithoutChunking(
          data,
          prepared.bytes,
          prepared.textEncoding,
          key,
          options
        );
      });
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof CryptoError ||
        error instanceof E2EEError
      ) {
        throw error;
      }
      throw new CryptoError(
        `Encryption failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Protect data with the Voided v3 whole-monolith full flow.
   */
  public async protect(
    data: string,
    options: ProtectOptions = {}
  ): Promise<ProtectedBlob> {
    Validator.validateData(data);

    if (this.enableSignatures) {
      throw new CryptoError(
        "VoidedE2EEClient.protect does not yet support signature wrapping"
      );
    }

    try {
      const { bytes, textEncoding } = this.encodeProtectableText(data);
      assertWithinClientUploadLimit(bytes.length);

      return await this.keyManager.withKeyReadLease(async lease => {
        const key = await lease.getCurrentKey();
        const rawKey = await this.exportRawKeyBytes(key);
        try {
          const protectedArtifact = await protectArtifactBytes(bytes, rawKey, {
            preset: options.preset,
            // Compression is opt-in in the high-level browser API because mixing
            // secrets and attacker-controlled data creates a length oracle.
            compressionAlgorithm: options.compressionAlgorithm ?? "none",
            compressionLevel: options.compressionLevel,
            encryptionAlgorithm: options.encryptionAlgorithm,
            shellChunkSize: options.shellChunkSize,
          });
          return this.toProtectedBlob(protectedArtifact, textEncoding);
        } finally {
          this.crypto.secureWipe(rawKey);
        }
      });
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof CryptoError ||
        error instanceof E2EEError
      ) {
        throw error;
      }
      throw new CryptoError(
        `Protect failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Encrypt data with bounded chunk concurrency and authenticated framing.
   */
  private async encryptWithChunking(
    data: string,
    plaintextBytes: Uint8Array,
    textEncoding: "utf8" | "utf16le",
    key: CryptoKey,
    options?: EncryptOptions
  ): Promise<EncryptedBlob> {
    const originalSize = options?.originalSizeBytes ?? plaintextBytes.length;
    assertWithinClientUploadLimit(originalSize);
    assertWithinClientMemoryLimit(plaintextBytes.length, "Plaintext");

    const shouldSkipCompression = this.determineCompressionStrategy(data, options);
    const compressionResult = await compress(plaintextBytes, {
      algorithm: this.getCompressionAlgorithm(options, shouldSkipCompression),
      minSizeThreshold: shouldSkipCompression ? Infinity : 100,
      compressionLevel: options?.compressionLevel ?? 6,
    });
    assertWithinClientMemoryLimit(
      compressionResult.compressed.length,
      "Compressed plaintext"
    );

    const dataChunks = this.chunkBytes(compressionResult.compressed);
    if (this.enableSignatures) this.requireSigningKeyForEncryption();

    const blob: EncryptedBlob = {
      keyId: this.keyId,
      messageId: this.createMessageId(),
      algorithm: "AES-GCM",
      version: "1.1",
      compression: {
        algorithm: compressionResult.algorithm,
        originalSize: plaintextBytes.length,
        compressedSize: compressionResult.compressed.length,
      },
      textEncoding,
      chunks: [],
      chunkInfo: {
        totalChunks: dataChunks.length,
        chunkSize: this.chunkSize,
        isChunked: true,
      },
    };

    blob.chunks = await mapWithConcurrency(
      dataChunks,
      CLIENT_CHUNK_CONCURRENCY,
      async (chunkBytes, index): Promise<EncryptedChunk> => {
        const aad = this.buildEnvelopeAad(blob, index, chunkBytes.length);
        const encrypted = new Uint8Array(
          await this.crypto.encrypt(chunkBytes, key, aad)
        );
        const chunk: EncryptedChunk = {
          data: base64Encode(encrypted),
          iv: base64Encode(encrypted.subarray(0, 12)),
          index,
          plaintextSize: chunkBytes.length,
        };
        if (this.enableSignatures) {
          chunk.signature = await this.signPayload(
            this.buildSignaturePayload(aad, encrypted)
          );
        }
        return chunk;
      }
    );

    if (this.enableSignatures) {
      const headerAad = this.buildEnvelopeAad(
        blob,
        -1,
        blob.compression.compressedSize
      );
      blob.signature = await this.signPayload(
        this.buildSignaturePayload(headerAad)
      );
    }
    return blob;
  }

  /**
   * Encrypt a single authenticated browser envelope.
   */
  private async encryptWithoutChunking(
    data: string,
    plaintextBytes: Uint8Array,
    textEncoding: "utf8" | "utf16le",
    key: CryptoKey,
    options?: EncryptOptions
  ): Promise<EncryptedBlob> {
    const originalSize = options?.originalSizeBytes ?? plaintextBytes.length;
    assertWithinClientUploadLimit(originalSize);
    assertWithinClientMemoryLimit(plaintextBytes.length, "Plaintext");

    const shouldSkipCompression = this.determineCompressionStrategy(data, options);
    const compressionResult = await compress(plaintextBytes, {
      algorithm: this.getCompressionAlgorithm(options, shouldSkipCompression),
      minSizeThreshold: shouldSkipCompression ? Infinity : 100,
      compressionLevel: options?.compressionLevel ?? 6,
    });
    assertWithinClientMemoryLimit(
      compressionResult.compressed.length,
      "Compressed plaintext"
    );
    if (this.enableSignatures) this.requireSigningKeyForEncryption();

    const blob: EncryptedBlob = {
      keyId: this.keyId,
      messageId: this.createMessageId(),
      algorithm: "AES-GCM",
      version: "1.1",
      compression: {
        algorithm: compressionResult.algorithm,
        originalSize: plaintextBytes.length,
        compressedSize: compressionResult.compressed.length,
      },
      textEncoding,
    };
    const aad = this.buildEnvelopeAad(
      blob,
      0,
      compressionResult.compressed.length
    );
    const encrypted = new Uint8Array(
      await this.crypto.encrypt(compressionResult.compressed, key, aad)
    );
    blob.data = base64Encode(encrypted);
    blob.iv = base64Encode(encrypted.subarray(0, 12));

    if (this.enableSignatures) {
      blob.signature = await this.signPayload(
        this.buildSignaturePayload(aad, encrypted)
      );
    }
    return blob;
  }

  /**
   * Decrypt data with decompression and optional signature verification
   */
  public async decrypt(blob: EncryptedBlob): Promise<string> {
    // Input validation
    Validator.validateEncryptedBlob(blob);
    if (blob.keyId !== this.keyId) {
      throw new CryptoError("Encrypted blob keyId does not match this client");
    }

    try {
      return await this.keyManager.withKeyReadLease(async lease => {
        if (blob.chunkInfo?.isChunked && blob.chunks) {
          return this.decryptChunkedData(blob, lease);
        }
        return this.decryptNonChunkedData(blob, lease);
      });
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof CryptoError ||
        error instanceof E2EEError
      ) {
        throw error;
      }
      throw new CryptoError(
        `Decryption failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Open a v3 monolith protected blob.
   */
  public async open(blob: ProtectedBlob): Promise<string> {
    Validator.validateProtectedBlob(blob);
    if (blob.keyId !== this.keyId) {
      throw new CryptoError("Protected blob keyId does not match this client");
    }

    try {
      const artifact = base64Decode(blob.artifact);

      return await this.keyManager.withKeyReadLease(async lease => {
        const decryptionKey = await lease.getCurrentKey();
        try {
          const rawKey = await this.exportRawKeyBytes(decryptionKey);
          try {
            const plaintext = await openArtifactBytes(artifact, rawKey);
            return this.decodeProtectedText(plaintext, blob.textEncoding);
          } finally {
            this.crypto.secureWipe(rawKey);
          }
        } catch (decryptError) {
          const migrationState = await lease.getMigrationStatus();
          if (migrationState?.isActive) {
            const legacyKey = await lease.getLegacyKey();
            if (legacyKey) {
              const rawLegacyKey = await this.exportRawKeyBytes(legacyKey);
              try {
                const plaintext = await openArtifactBytes(artifact, rawLegacyKey);
                return this.decodeProtectedText(plaintext, blob.textEncoding);
              } finally {
                this.crypto.secureWipe(rawLegacyKey);
              }
            }
          }
          throw decryptError;
        }
      });
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof CryptoError ||
        error instanceof E2EEError
      ) {
        throw error;
      }
      throw new CryptoError(
        `Open failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Inspect a v3 monolith protected blob without opening it.
   */
  public async inspectProtected(blob: ProtectedBlob): Promise<ProtectedBlobInfo> {
    Validator.validateProtectedBlob(blob);

    try {
      const artifact = base64Decode(blob.artifact);
      const info = await inspectArtifactBytes(artifact);
      return this.toProtectedBlobInfo(info, blob.keyId);
    } catch (error) {
      if (error instanceof ValidationError || error instanceof CryptoError) {
        throw error;
      }
      throw new CryptoError(
        `Inspect failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Decrypt chunked data without ever accepting a partial or mixed-key result.
   */
  private async decryptChunkedData(
    blob: EncryptedBlob,
    lease: KeyReadLease
  ): Promise<string> {
    if (!blob.chunks || !blob.chunkInfo) {
      throw new CryptoError("Invalid chunked data: missing chunks or chunk info");
    }
    if (this.enableSignatures) {
      const headerAad = this.buildEnvelopeAad(
        blob,
        -1,
        blob.compression.compressedSize
      );
      await this.verifyRequiredSignature(
        this.buildSignaturePayload(headerAad),
        blob.signature,
        "envelope"
      );
      for (const chunk of blob.chunks) {
        const encrypted = base64Decode(
          chunk.data,
          CLIENT_MAX_CHUNK_BYTES + 12 + 16
        );
        const aad = this.buildEnvelopeAad(
          blob,
          chunk.index,
          chunk.plaintextSize
        );
        await this.verifyRequiredSignature(
          this.buildSignaturePayload(aad, encrypted),
          chunk.signature,
          `chunk ${chunk.index}`
        );
      }
    }

    const currentKey = await lease.getCurrentKey();
    let decryptedChunks: Uint8Array[];
    try {
      decryptedChunks = await this.decryptChunksWithKey(blob, currentKey);
    } catch (currentError) {
      const legacyKey = await lease.getLegacyKey();
      if (!legacyKey) throw currentError;
      decryptedChunks = await this.decryptChunksWithKey(blob, legacyKey);
    }

    const totalCompressedSize = decryptedChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0
    );
    if (totalCompressedSize !== blob.compression.compressedSize) {
      throw new CryptoError(
        "Chunk plaintext total does not match authenticated compression metadata"
      );
    }
    assertWithinClientMemoryLimit(totalCompressedSize, "Chunk plaintext total");
    const compressedBytes = new Uint8Array(totalCompressedSize);
    let offset = 0;
    for (const chunk of decryptedChunks) {
      compressedBytes.set(chunk, offset);
      offset += chunk.length;
    }
    return await this.decompressAndDecode(blob, compressedBytes);
  }

  private async decryptChunksWithKey(
    blob: EncryptedBlob,
    key: CryptoKey
  ): Promise<Uint8Array[]> {
    return await mapWithConcurrency(
      blob.chunks!,
      CLIENT_CHUNK_CONCURRENCY,
      async (chunk): Promise<Uint8Array> => {
        const encrypted = base64Decode(
          chunk.data,
          CLIENT_MAX_CHUNK_BYTES + 12 + 16
        );
        const iv = base64Decode(chunk.iv, 12);
        if (iv.length !== 12) throw new CryptoError("Invalid AES-GCM IV length");
        const aad = this.buildEnvelopeAad(
          blob,
          chunk.index,
          chunk.plaintextSize
        );
        const decrypted = await this.crypto.decrypt(encrypted, iv, key, aad);
        if (decrypted.length !== chunk.plaintextSize) {
          throw new CryptoError(
            `Chunk ${chunk.index} size does not match authenticated metadata`
          );
        }
        return decrypted;
      }
    );
  }

  private async decryptNonChunkedData(
    blob: EncryptedBlob,
    lease: KeyReadLease
  ): Promise<string> {
    if (!blob.data || !blob.iv) {
      throw new CryptoError("Invalid non-chunked data: missing data or IV");
    }
    const encrypted = base64Decode(
      blob.data,
      CLIENT_MAX_IN_MEMORY_BYTES + 12 + 16
    );
    const iv = base64Decode(blob.iv, 12);
    if (iv.length !== 12) throw new CryptoError("Invalid AES-GCM IV length");
    const aad = this.buildEnvelopeAad(
      blob,
      0,
      blob.compression.compressedSize
    );
    if (this.enableSignatures) {
      await this.verifyRequiredSignature(
        this.buildSignaturePayload(aad, encrypted),
        blob.signature,
        "envelope"
      );
    }

    const currentKey = await lease.getCurrentKey();
    let decrypted: Uint8Array;
    try {
      decrypted = await this.crypto.decrypt(encrypted, iv, currentKey, aad);
    } catch (currentError) {
      const legacyKey = await lease.getLegacyKey();
      if (!legacyKey) throw currentError;
      decrypted = await this.crypto.decrypt(encrypted, iv, legacyKey, aad);
    }
    if (decrypted.length !== blob.compression.compressedSize) {
      throw new CryptoError(
        "Plaintext size does not match authenticated compression metadata"
      );
    }
    return await this.decompressAndDecode(blob, decrypted);
  }

  private async decompressAndDecode(
    blob: EncryptedBlob,
    compressed: Uint8Array
  ): Promise<string> {
    const decompressed = await decompress(
      compressed,
      blob.compression.algorithm,
      {
        expectedOutputBytes: blob.compression.originalSize,
        maxOutputBytes: CLIENT_MAX_IN_MEMORY_BYTES,
        maxExpansionRatio: 512,
      }
    );
    if (blob.textEncoding === "utf16le") {
      if (decompressed.length % 2 !== 0) {
        throw new CryptoError("Invalid authenticated UTF-16LE byte length");
      }
      return this.utf16LEBytesToString(decompressed);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(decompressed);
  }

  // UTF-16LE helpers preserve otherwise unpaired JavaScript surrogates.
  private utf16LEBytesToString(bytes: Uint8Array): string {
    let result = "";
    for (let i = 0; i < bytes.length; i += 2) {
      const low = bytes[i];
      const high = bytes[i + 1] || 0;
      const codeUnit = low | (high << 8);
      result += String.fromCharCode(codeUnit);
    }
    return result;
  }

  // Also fix the UTF-16LE encoding to ensure it's consistent:
  private stringToUtf16LEBytes(input: string): Uint8Array {
    const out = new Uint8Array(input.length * 2);
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      out[i * 2] = code & 0xff;
      out[i * 2 + 1] = (code >>> 8) & 0xff;
    }
    return out;
  }

  private encodeAuthenticatedText(input: string): {
    bytes: Uint8Array;
    textEncoding: "utf8" | "utf16le";
  } {
    const textEncoding = this.hasUnpairedSurrogates(input)
      ? "utf16le"
      : "utf8";
    const byteLength = textEncoding === "utf16le"
      ? input.length * 2
      : this.utf8ByteLength(input, CLIENT_MAX_IN_MEMORY_BYTES);
    assertWithinClientMemoryLimit(byteLength, "Plaintext");
    const bytes = textEncoding === "utf16le"
      ? this.stringToUtf16LEBytes(input)
      : this.textEncoder.encode(input);
    if (bytes.length !== byteLength) {
      throw new CryptoError("Text encoding length preflight mismatch");
    }
    return {
      bytes,
      textEncoding,
    };
  }

  private utf8ByteLength(input: string, stopAfter: number): number {
    let bytes = 0;
    for (let index = 0; index < input.length; index++) {
      const code = input.charCodeAt(index);
      if (code <= 0x7f) {
        bytes += 1;
      } else if (code <= 0x7ff) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
      if (bytes > stopAfter) return bytes;
    }
    return bytes;
  }

  private encodeProtectableText(input: string): {
    bytes: Uint8Array;
    textEncoding: "utf8" | "utf16le";
  } {
    const domain = this.textEncoder.encode("VOI-TEXT-1");
    const { bytes, textEncoding } = this.encodeAuthenticatedText(input);
    return {
      bytes: concatBytes(
        domain,
        Uint8Array.of(textEncoding === "utf16le" ? 1 : 0),
        bytes
      ),
      textEncoding,
    };
  }

  private decodeProtectedText(
    bytes: Uint8Array,
    _textEncoding: "utf8" | "utf16le" | undefined
  ): string {
    const domain = this.textEncoder.encode("VOI-TEXT-1");
    if (bytes.length < domain.length + 1) {
      throw new CryptoError("Protected text envelope is missing");
    }
    for (let i = 0; i < domain.length; i++) {
      if (bytes[i] !== domain[i]) {
        throw new CryptoError("Protected text envelope is invalid");
      }
    }
    const encoding = bytes[domain.length];
    const plaintext = bytes.subarray(domain.length + 1);
    if (encoding === 1) {
      if (plaintext.length % 2 !== 0) {
        throw new CryptoError("Protected UTF-16LE payload has invalid length");
      }
      return this.utf16LEBytesToString(plaintext);
    }
    if (encoding === 0) {
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    }
    throw new CryptoError("Protected text envelope has an unknown encoding");
  }

  private getInternalStorageKey(purpose: string): string {
    return `${this.keyId}::voided:internal:${purpose}`;
  }

  private async exportRawKeyBytes(key: CryptoKey): Promise<Uint8Array> {
    return base64Decode(await this.crypto.exportKey(key));
  }

  private toProtectedBlob(
    result: RuntimeProtectResult,
    textEncoding: "utf8" | "utf16le"
  ): ProtectedBlob {
    return {
      artifact: base64Encode(result.artifact),
      keyId: this.keyId,
      version: "2.0",
      pipeline: "compression->encryption->fused-shell",
      preset: result.preset as ProtectedBlob["preset"],
      compression: {
        algorithm: result.compressionAlgorithm as ProtectedBlob["compression"]["algorithm"],
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
      },
      encryptionAlgorithm: result.encryptionAlgorithm as ProtectedBlob["encryptionAlgorithm"],
      shell: {
        chunkSize: result.shellChunkSize,
        chunkCount: result.shellChunkCount,
      },
      protectedSize: result.protectedSize,
      textEncoding,
    };
  }

  private toProtectedBlobInfo(
    info: RuntimeProtectedArtifactInfo,
    keyId: string
  ): ProtectedBlobInfo {
    return {
      keyId,
      version: "2.0",
      pipeline: "compression->encryption->fused-shell",
      preset: info.preset as ProtectedBlob["preset"],
      compression: {
        algorithm: info.compressionAlgorithm as ProtectedBlob["compression"]["algorithm"],
        originalSize: info.originalSize,
        compressedSize: info.compressedSize,
      },
      encryptionAlgorithm: info.encryptionAlgorithm as ProtectedBlob["encryptionAlgorithm"],
      shell: {
        chunkSize: info.shellChunkSize,
        chunkCount: info.shellChunkCount,
      },
      protectedSize: info.protectedSize,
    };
  }

  /**
   * Export current key as base64 string
   */
  public async exportKey(): Promise<string> {
    try {
      return await this.keyManager.withKeyReadLease(async lease => {
        const key = await lease.getCurrentKey();
        return this.crypto.exportKey(key);
      });
    } catch (error) {
      throw new Error(
        `Key export failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Import key from base64 string
   */
  public async importKey(keyString: string): Promise<void> {
    // Input validation
    Validator.validateKeyString(keyString);

    try {
      const key = await this.crypto.importKey(keyString);
      await this.keyManager.setKey(
        key,
        1,
        {
          afterCommit: () => this.storage.removeKey(this.getInternalStorageKey("password-kdf")),
        }
      );
    } catch (error) {
      if (error instanceof ValidationError || error instanceof KeyError) {
        throw error;
      }
      throw new KeyError(
        `Key import failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Rotate encryption key
   */
  public async rotateKey(options: RotationOptions = {}): Promise<string> {
    // Input validation
    Validator.validateRotationOptions(options);

    const { force = true, migrate = false, cutoffTime = new Date() } = options;

    try {
      let rotatedKey: string;
      if (force) {
        rotatedKey = await this.keyManager.forceRotate(
          () => this.storage.removeKey(this.getInternalStorageKey("password-kdf"))
        );
      } else if (migrate) {
        rotatedKey = await this.keyManager.startMigration(
          cutoffTime,
          () => this.storage.removeKey(this.getInternalStorageKey("password-kdf"))
        );
      } else {
        throw new ValidationError("Invalid rotation options");
      }
      return rotatedKey;
    } catch (error) {
      if (error instanceof ValidationError || error instanceof KeyError) {
        throw error;
      }
      throw new KeyError(
        `Key rotation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Delete current key and all cached key pairs
   */
  public async deleteKey(): Promise<void> {
    try {
      await this.keyManager.deleteKey(
        () => this.storage.removeKey(this.getInternalStorageKey("password-kdf"))
      );
      this.clearCachedKeyPairs();
    } catch (error) {
      throw new Error(
        `Key deletion failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Clear cached keys from memory with secure wiping
   */
  public clearCachedKey(): void {
    this.keyManager.clearCache();
    this.clearCachedKeyPairs();
  }

  /**
   * Clear cached key pairs with secure wiping
   */
  private clearCachedKeyPairs(): void {
    this.cachedSigningKeyPair = undefined;
    this.cachedAgreementKeyPair = undefined;
  }

  /**
   * Check if key exists
   */
  public async hasKey(): Promise<boolean> {
    return await this.keyManager.hasKey();
  }

  /**
   * Get migration status
   */
  public async getMigrationStatus(): Promise<MigrationState | null> {
    return await this.keyManager.getMigrationStatus();
  }

  /**
   * Finalize migration (remove old key)
   */
  public async finalizeMigration(): Promise<void> {
    try {
      await this.keyManager.finalizeMigration();
    } catch (error) {
      throw new Error(
        `Migration finalization failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get current key version
   */
  public async getCurrentKeyVersion(): Promise<number> {
    return await this.keyManager.getCurrentKeyVersion();
  }

  /**
   * Get migration info
   */
  public async getMigrationInfo(): Promise<{
    oldKeyVersion: number;
    newKeyVersion: number;
    cutoffTime: Date;
    createdAt: Date;
  } | null> {
    const status = await this.keyManager.getMigrationStatus();
    if (!status) return null;

    return {
      oldKeyVersion: status.oldKeyVersion,
      newKeyVersion: status.newKeyVersion,
      cutoffTime: status.cutoffTime,
      createdAt: status.createdAt,
    };
  }
}

// Default client instance
let defaultClient: VoidedE2EEClient | null = null;

function getDefaultClient(): VoidedE2EEClient {
  if (!defaultClient) {
    defaultClient = new VoidedE2EEClient();
  }
  return defaultClient;
}

// Convenience functions for simple usage
export async function encrypt(
  data: string,
  options?: EncryptOptions
): Promise<EncryptedBlob> {
  return getDefaultClient().encrypt(data, options);
}

export async function decrypt(blob: EncryptedBlob): Promise<string> {
  return getDefaultClient().decrypt(blob);
}

export async function protect(
  data: string,
  options?: ProtectOptions
): Promise<ProtectedBlob> {
  return getDefaultClient().protect(data, options);
}

export async function open(blob: ProtectedBlob): Promise<string> {
  return getDefaultClient().open(blob);
}

export async function inspectProtected(
  blob: ProtectedBlob
): Promise<ProtectedBlobInfo> {
  return getDefaultClient().inspectProtected(blob);
}

export async function exportKey(): Promise<string> {
  return getDefaultClient().exportKey();
}

export async function importKey(keyString: string): Promise<void> {
  return getDefaultClient().importKey(keyString);
}

export async function rotateKey(): Promise<string> {
  return getDefaultClient().rotateKey();
}

// Enhanced convenience functions for advanced features
export async function deriveKeyFromPassword(
  options: KeyDerivationOptions
): Promise<PasswordKeyDerivationRecord> {
  return getDefaultClient().deriveKeyFromPassword(options);
}

export async function getPasswordKeyDerivationRecord(): Promise<PasswordKeyDerivationRecord | null> {
  return getDefaultClient().getPasswordKeyDerivationRecord();
}

export async function getKeyFingerprint(): Promise<string> {
  return getDefaultClient().getKeyFingerprint();
}

export async function getSafetyNumbers(): Promise<string> {
  return getDefaultClient().getSafetyNumbers();
}

// Export UI components
export {
  VoidedKeyExport,
  VoidedKeyImport,
  createKeyExport,
  createKeyImport,
  type KeyExportOptions,
  type KeyImportOptions,
} from "./key-ui";

// Export hash service
export { hashService } from "./hash-service";

// Export additive key-sharing features
export {
  KeySharing,
  type KeySharingContext,
  type KeySharingReplayStore,
} from "./key-sharing";
