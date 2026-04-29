// Export crypto backend (WASM + TS fallback)
export * as crypto from "./crypto-backend";
export {
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
  initWasm, 
  getWasm, 
  isWasmReady, 
  getWasmError,
  getWasmSync,
} from "./wasm/loader";

import {
  compress,
  decompress,
  stringToUint8Array,
} from "./compression";
import { CryptoService } from "./crypto-service";
import { StorageService } from "./storage-service";
import { KeyManager } from "./key-manager";
import {
  Validator,
  ValidationError,
  CryptoError,
  StorageError,
  KeyError,
  E2EEError,
} from "./errors";
import { assertWithinClientUploadLimit } from "./limits";

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

function base64Decode(b64: string): Uint8Array {
  // Prefer Node's Buffer when available (tests), otherwise fallback to browser atob
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore Buffer may not exist in browser
    if (typeof Buffer !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore Buffer may not exist in browser
      return new Uint8Array(Buffer.from(b64, "base64"));
    }
  } catch {}
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface E2EEConfig {
  keyId?: string;
  autoGenerateKey?: boolean;
  storage?: E2EEStorage;
  enableSignatures?: boolean; // Enable digital signatures for authenticity
  enableForwardSecrecy?: boolean; // Enable ephemeral keys and ratcheting
  enableChunking?: boolean; // Enable automatic chunking for large data (default: true)
  chunkSize?: number; // Chunk size in bytes (default: 10MB)
  minChunkThreshold?: number; // Minimum size to trigger chunking (default: 20MB)
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
  signature?: string; // Per-chunk signature (optional)
}

export interface EncryptedBlob {
  data?: string; // Base64 encoded encrypted data (for non-chunked data)
  iv?: string; // Base64 encoded IV (for non-chunked data)
  keyId: string;
  algorithm: "AES-GCM";
  version: "1.0";
  compression: {
    algorithm: "gzip" | "brotli" | "none";
    originalSize: number;
    compressedSize: number;
  };
  // Enhanced with signature support
  signature?: string; // Base64 encoded ECDSA signature (optional)
  ephemeralPublicKey?: string; // Base64 encoded ephemeral public key for forward secrecy
  // Chunking support
  chunks?: EncryptedChunk[]; // Array of encrypted chunks (for large data)
  chunkInfo?: {
    totalChunks: number;
    chunkSize: number;
    isChunked: true;
  };
  // Internal text encoding hint to ensure lossless round-trip for extreme Unicode
  textEncoding?: "utf8" | "utf16le";
}

export interface EncryptOptions {
  originalSizeBytes?: number;
  resumeTokenOriginalSize?: number;
  forceCompression?: boolean; // Override automatic compression skipping
  compressionAlgorithm?: "gzip" | "brotli" | "none" | "auto"; // Explicit compression control
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
  iterations?: number; // Default: 100000
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

  async getKey(keyId: string): Promise<string | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.keysStoreName], "readonly");
        const store = transaction.objectStore(this.keysStoreName);
        const request = store.get(keyId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.key : null);
        };
      });
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      return null;
    }
  }

  async setKey(keyId: string, key: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.keysStoreName], "readwrite");
        const store = transaction.objectStore(this.keysStoreName);
        const request = store.put({ id: keyId, key });

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      throw new Error("Failed to store key: IndexedDB not available");
    }
  }

  async removeKey(keyId: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.keysStoreName], "readwrite");
        const store = transaction.objectStore(this.keysStoreName);
        const request = store.delete(keyId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      throw new Error("Failed to remove key: IndexedDB not available");
    }
  }

  async getMigrationState(keyId: string): Promise<MigrationState | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          [this.migrationStoreName],
          "readonly"
        );
        const store = transaction.objectStore(this.migrationStoreName);
        const request = store.get(keyId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = request.result;
          if (result && result.state) {
            // Convert stored dates back to Date objects
            const state = result.state;
            state.cutoffTime = new Date(state.cutoffTime);
            state.createdAt = new Date(state.createdAt);
            resolve(state);
          } else {
            resolve(null);
          }
        };
      });
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      return null;
    }
  }

  async setMigrationState(keyId: string, state: MigrationState): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          [this.migrationStoreName],
          "readwrite"
        );
        const store = transaction.objectStore(this.migrationStoreName);
        const request = store.put({ id: keyId, state });

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
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
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          [this.migrationStoreName],
          "readwrite"
        );
        const store = transaction.objectStore(this.migrationStoreName);
        const request = store.delete(keyId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
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
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          [this.keyPairsStoreName],
          "readonly"
        );
        const store = transaction.objectStore(this.keyPairsStoreName);
        const request = store.get(`${keyId}_${type}`);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.keyPair : null);
        };
      });
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.warn('IndexedDB access failed');
      return null;
    }
  }

  async setKeyPair(
    keyId: string,
    type: "signing" | "agreement",
    keyPair: string
  ): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          [this.keyPairsStoreName],
          "readwrite"
        );
        const store = transaction.objectStore(this.keyPairsStoreName);
        const request = store.put({ id: `${keyId}_${type}`, keyPair });

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
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
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          [this.keyPairsStoreName],
          "readwrite"
        );
        const store = transaction.objectStore(this.keyPairsStoreName);
        const request = store.delete(`${keyId}_${type}`);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
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
  private keyId: string;
  private storage: StorageService;
  private crypto: CryptoService;
  private keyManager: KeyManager;
  private enableSignatures: boolean;
  private enableForwardSecrecy: boolean;
  private enableChunking: boolean;
  private chunkSize: number;
  private minChunkThreshold: number;

  // Reusable buffers for better memory management
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  // Cached key pairs for advanced features
  private cachedSigningKeyPair?: CryptoKeyPair;
  private cachedAgreementKeyPair?: CryptoKeyPair;

  constructor(config: E2EEConfig = {}) {
    const configuredStorage = config.storage || new IndexedDBStorage();

    this.keyId = config.keyId || "default";
    this.enableSignatures = config.enableSignatures || false;
    this.enableForwardSecrecy = config.enableForwardSecrecy || false;
    this.enableChunking = config.enableChunking !== false; // Default to true
    this.chunkSize = config.chunkSize || 2 * 1024 * 1024; // 2MB default (reduced from 10MB)
    this.minChunkThreshold = config.minChunkThreshold || 10 * 1024 * 1024; // 10MB default (reduced from 20MB)

    Validator.validateKeyId(this.keyId);

    this.storage = new StorageService(configuredStorage);
    this.crypto = new CryptoService();
    this.keyManager = new KeyManager(this.storage, this.crypto, this.keyId);
  }

  /**
   * Derive encryption key from password using PBKDF2
   */
  public async deriveKeyFromPassword(
    options: KeyDerivationOptions
  ): Promise<void> {
    const {
      password,
      salt = this.crypto.generateSalt(),
      iterations = 100000,
    } = options;

    try {
      const derivedKey = await this.crypto.deriveKeyFromPassword(
        password,
        salt,
        iterations
      );
      await this.keyManager.setKey(derivedKey, 1);

      // Store salt for future derivations (you'll need to extend storage for this)
      // For now, we'll just derive the key and store it
    } catch (error) {
      throw new KeyError(
        `Key derivation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // Debug-only: detect surrogate anomalies in a JS string
  private logSurrogateAnalysis(tag: string, input: string): void {
    try {
      const unpairedHigh: number[] = [];
      const unpairedLow: number[] = [];
      let pairCount = 0;
      for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
          if (next >= 0xdc00 && next <= 0xdfff) {
            pairCount++;
            i++;
          } else {
            unpairedHigh.push(i);
          }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          const prev = i - 1 >= 0 ? input.charCodeAt(i - 1) : 0;
          if (!(prev >= 0xd800 && prev <= 0xdbff)) {
            unpairedLow.push(i);
          }
        }
      }
    } catch {}
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
   * Generate and store key agreement key pair for forward secrecy
   */
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
      await this.keyManager.setKey(sharedKey, 1);
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
      const key = await this.keyManager.getCurrentKey();
      return await this.crypto.getKeyFingerprint(key);
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
      const key = await this.keyManager.getCurrentKey();
      return await this.crypto.getSafetyNumbers(key);
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
      const ourFingerprint = await this.getKeyFingerprint();
      const ourSafetyNumbers = await this.getSafetyNumbers();

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
    const chunks: Uint8Array[] = [];
    const totalLength = data.length;
    const chunkSize = this.chunkSize;

    // Use byte-based chunking for efficiency
    for (let i = 0; i < totalLength; i += chunkSize) {
      const chunk = data.slice(i, Math.min(i + chunkSize, totalLength));
      chunks.push(chunk);
    }
    return chunks;
  }

  private determineCompressionStrategy(
    data: string,
    options?: EncryptOptions
  ): boolean {
    // If user explicitly forces compression, never skip
    if (options?.forceCompression === true) {
      return false;
    }

    // If user explicitly sets algorithm to 'none', always skip
    if (options?.compressionAlgorithm === "none") {
      return true;
    }

    // If user provides explicit algorithm, don't skip
    if (
      options?.compressionAlgorithm &&
      options.compressionAlgorithm !== "auto"
    ) {
      return false;
    }

    // Legacy behavior: skip compression for small data with advanced features
    // This maintains backward compatibility while allowing override
    if (
      this.enableSignatures &&
      this.enableForwardSecrecy &&
      data.length < 1000
    ) {
      return true;
    }

    return false;
  }

  private getCompressionAlgorithm(
    options?: EncryptOptions,
    shouldSkip: boolean = false
  ): "gzip" | "brotli" | "none" | "auto" {
    if (shouldSkip) {
      return "none";
    }

    return options?.compressionAlgorithm || "auto";
  }

  /**
   * Encrypt a single chunk with all security features
   */
  private async encryptChunk(
    chunkData: string,
    chunkIndex: number
  ): Promise<EncryptedChunk> {
    // Get current key
    const key = await this.keyManager.getCurrentKey();

    // Compress chunk data
    const compressionResult = await compress(chunkData, {
      algorithm: "auto",
      minSizeThreshold: 100,
      compressionLevel: 6,
    });

    let ephemeralPublicKey: string | undefined;
    let encryptionKey = key;

    // Use ephemeral key for forward secrecy if enabled
    if (this.enableForwardSecrecy && this.cachedAgreementKeyPair) {
      const ephemeralKeyPair = await this.crypto.generateKeyAgreementKeyPair();
      ephemeralPublicKey = await this.crypto.exportPublicKey(
        ephemeralKeyPair.publicKey
      );

      // Derive shared secret with our long-term key
      encryptionKey = await this.crypto.deriveSharedKey(
        ephemeralKeyPair.privateKey,
        this.cachedAgreementKeyPair.publicKey
      );
    }

    // Encrypt compressed chunk data
    // Ensure we encrypt the raw bytes; when skipCompression was active, compressed already holds raw bytes
    const encryptedBuffer = await this.crypto.encrypt(
      compressionResult.compressed,
      encryptionKey
    );
    const encryptedArray = new Uint8Array(encryptedBuffer);

    // Extract IV (first 12 bytes)
    const iv = encryptedArray.slice(0, 12);

    // Convert to base64 efficiently
    const dataBase64 = base64Encode(encryptedArray);

    let signature: string | undefined;

    // Add digital signature if enabled
    if (this.enableSignatures && this.cachedSigningKeyPair) {
      const signatureBuffer = await this.crypto.signData(
        encryptedArray,
        this.cachedSigningKeyPair.privateKey
      );
      signature = base64Encode(new Uint8Array(signatureBuffer));
    }

    return {
      data: dataBase64,
      iv: base64Encode(iv),
      index: chunkIndex,
      signature,
    };
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
      // Enforce client-side limit at entry using computed size if original not provided
      const computedSize = this.textEncoder.encode(data).length;
      const originalSize = options?.originalSizeBytes ?? computedSize;
      assertWithinClientUploadLimit(originalSize);

      if (options?.resumeTokenOriginalSize !== undefined) {
        assertWithinClientUploadLimit(options.resumeTokenOriginalSize);
      }

      // Check if data should be chunked
      if (this.shouldChunk(data.length)) {
        return await this.encryptWithChunking(data, options);
      } else {
        return await this.encryptWithoutChunking(data, options);
      }
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

    if (this.enableForwardSecrecy) {
      throw new CryptoError(
        "VoidedE2EEClient.protect does not yet support forward secrecy wrapping"
      );
    }

    try {
      const { bytes, textEncoding } = this.encodeProtectableText(data);
      assertWithinClientUploadLimit(bytes.length);

      // Ensure we do not race with a concurrent rotation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.keyManager as any).waitForRotationComplete?.();
      const key = await this.keyManager.getCurrentKey();
      const rawKey = await this.exportRawKeyBytes(key);

      const protectedArtifact = await protectArtifactBytes(bytes, rawKey, {
        preset: options.preset,
        compressionAlgorithm: options.compressionAlgorithm,
        compressionLevel: options.compressionLevel,
        encryptionAlgorithm: options.encryptionAlgorithm,
        shellChunkSize: options.shellChunkSize,
      });

      return this.toProtectedBlob(protectedArtifact, textEncoding);
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
   * Encrypt data with chunking for large files - OPTIMIZED VERSION
   */
  private async encryptWithChunking(
    data: string,
    options?: EncryptOptions
  ): Promise<EncryptedBlob> {
    try {
      // Chunker guard: re-check size before processing first chunk
      const computedSize = this.textEncoder.encode(data).length;
      const originalSize = options?.originalSizeBytes ?? computedSize;
      assertWithinClientUploadLimit(originalSize);

      // Enhanced compression logic for chunked data
      const shouldSkipCompression = this.determineCompressionStrategy(
        data,
        options
      );
      const compressionAlgorithm = this.getCompressionAlgorithm(
        options,
        shouldSkipCompression
      );
      const compressionLevel = options?.compressionLevel || 6;

      // Compress the entire data first
      let compressionResult;
      try {
        compressionResult = await compress(data, {
          algorithm: compressionAlgorithm,
          minSizeThreshold: shouldSkipCompression ? Infinity : 100,
          compressionLevel: compressionLevel,
        });
      } catch (compressionError) {
        //if (process.env.NODE_ENV !== 'test') console.warn('Compression failed for large data, proceeding without compression');
        const dataBytes = stringToUint8Array(data);
        compressionResult = {
          compressed: dataBytes,
          algorithm: "none" as any,
          originalSize: data.length,
          compressedSize: dataBytes.length,
        };
      }

      // Split compressed data into chunks (work directly with bytes)
      const dataChunks = this.chunkBytes(compressionResult.compressed);

      // Ensure we do not race with a concurrent rotation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.keyManager as any).waitForRotationComplete?.();
      // Get current key once
      const key = await this.keyManager.getCurrentKey();

      // Encrypt chunks in parallel for better performance
      const chunkPromises = dataChunks.map(async (chunkBytes, i) => {
        // Encrypt chunk directly
        const encryptedBuffer = await this.crypto.encrypt(chunkBytes, key);
        const encryptedArray = new Uint8Array(encryptedBuffer);

        // Extract IV (first 12 bytes)
        const iv = encryptedArray.slice(0, 12);

        // Convert to base64 efficiently
        const dataBase64 = base64Encode(encryptedArray);

        let chunkSignature: string | undefined;

        // Add per-chunk signature if enabled
        if (this.enableSignatures && this.cachedSigningKeyPair) {
          const signatureBuffer = await this.crypto.signData(
            encryptedArray,
            this.cachedSigningKeyPair.privateKey
          );
          chunkSignature = base64Encode(new Uint8Array(signatureBuffer));
        }

        return {
          data: dataBase64,
          iv: base64Encode(iv),
          index: i,
          signature: chunkSignature,
        };
      });

      const encryptedChunks = await Promise.all(chunkPromises);

      // Generate global signature if enabled
      let globalSignature: string | undefined;
      if (this.enableSignatures && this.cachedSigningKeyPair) {
        const allChunkData = encryptedChunks
          .map((chunk) => chunk.data)
          .join("");
        const globalData = this.textEncoder.encode(allChunkData);
        const signatureBuffer = await this.crypto.signData(
          globalData,
          this.cachedSigningKeyPair.privateKey
        );
        globalSignature = base64Encode(new Uint8Array(signatureBuffer));
      }

      // Generate ephemeral public key if enabled
      let ephemeralPublicKey: string | undefined;
      if (this.enableForwardSecrecy && this.cachedAgreementKeyPair) {
        ephemeralPublicKey = await this.crypto.exportPublicKey(
          this.cachedAgreementKeyPair.publicKey
        );
      }

      const blob: EncryptedBlob = {
        keyId: this.keyId,
        algorithm: "AES-GCM",
        version: "1.0",
        compression: {
          algorithm: compressionResult.algorithm,
          originalSize: data.length,
          compressedSize: compressionResult.compressedSize,
        },
        chunks: encryptedChunks,
        chunkInfo: {
          totalChunks: dataChunks.length,
          chunkSize: this.chunkSize,
          isChunked: true,
        },
      };

      if (globalSignature) {
        blob.signature = globalSignature;
      }

      if (ephemeralPublicKey) {
        blob.ephemeralPublicKey = ephemeralPublicKey;
      }

      return blob;
    } catch (error) {
      //if (process.env.NODE_ENV !== 'test') console.error('Chunking encryption error:', error);
      throw error;
    }
  }

  /**
   * Encrypt data without chunking (OPTIMIZED for large data)
   */
  private async encryptWithoutChunking(
    data: string,
    options?: EncryptOptions
  ): Promise<EncryptedBlob> {
    // Ensure we do not race with a concurrent rotation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.keyManager as any).waitForRotationComplete?.();
    // Get current key
    const key = await this.keyManager.getCurrentKey();

    // Use efficient encoding for all data sizes
    let compressionResult;
    let textEncoding: "utf8" | "utf16le" = "utf8";
    const originalStringLength = data.length;

    try {
      this.logSurrogateAnalysis("enc:src", data);
      // Guard also on non-chunk path prior to compression
      const computedSize = this.textEncoder.encode(data).length;
      const originalSize = options?.originalSizeBytes ?? computedSize;
      assertWithinClientUploadLimit(originalSize);

      // Enhanced compression logic with user control
      const shouldSkipCompression = this.determineCompressionStrategy(
        data,
        options
      );
      const compressionAlgorithm = this.getCompressionAlgorithm(
        options,
        shouldSkipCompression
      );
      const compressionLevel = options?.compressionLevel || 6;

      // If input contains unpaired surrogates, preserve exact UTF-16 code units
      if (this.hasUnpairedSurrogates(data)) {
        const utf16Bytes = this.stringToUtf16LEBytes(data);
        compressionResult = await compress(utf16Bytes, {
          algorithm: compressionAlgorithm,
          minSizeThreshold: shouldSkipCompression ? Infinity : 100,
          compressionLevel: compressionLevel,
        });
        textEncoding = "utf16le";
      } else {
        // Use consistent UTF-8 encoding for compression input
        compressionResult = await compress(data, {
          algorithm: compressionAlgorithm,
          minSizeThreshold: shouldSkipCompression ? Infinity : 100,
          compressionLevel: compressionLevel,
        });
        textEncoding = "utf8";
      }
    } catch (compressionError) {
      //if (process.env.NODE_ENV !== 'test') console.warn('Compression failed, proceeding without compression');
      const dataBytes = stringToUint8Array(data);
      compressionResult = {
        compressed: dataBytes,
        algorithm: "none" as any,
        originalSize: originalStringLength,
        compressedSize: dataBytes.length,
      };
      textEncoding = "utf8";
    }

    let ephemeralPublicKey: string | undefined;
    let encryptionKey = key;

    // Use ephemeral key for forward secrecy if enabled
    if (this.enableForwardSecrecy && this.cachedAgreementKeyPair) {
      const ephemeralKeyPair = await this.crypto.generateKeyAgreementKeyPair();
      ephemeralPublicKey = await this.crypto.exportPublicKey(
        ephemeralKeyPair.publicKey
      );

      // Derive shared secret with our long-term key
      encryptionKey = await this.crypto.deriveSharedKey(
        ephemeralKeyPair.privateKey,
        this.cachedAgreementKeyPair.publicKey
      );
    }

    // Encrypt compressed data with size limit check
    const dataToEncrypt = compressionResult.compressed;

    // Web Crypto API has limits on data size, so we need to handle large data differently
    if (dataToEncrypt.length > 64 * 1024 * 1024) {
      // 64MB limit
      throw new CryptoError(
        "Data too large for single encryption operation. Maximum size is 64MB."
      );
    }

    const encryptedBuffer = await this.crypto.encrypt(
      dataToEncrypt,
      encryptionKey
    );
    const encryptedArray = new Uint8Array(encryptedBuffer);

    // Extract IV (first 12 bytes)
    const iv = encryptedArray.slice(0, 12);

    // Convert to base64 efficiently
    const dataBase64 = base64Encode(encryptedArray);

    let signature: string | undefined;

    // Add digital signature if enabled
    if (this.enableSignatures && this.cachedSigningKeyPair) {
      const signatureBuffer = await this.crypto.signData(
        encryptedArray,
        this.cachedSigningKeyPair.privateKey
      );
      signature = base64Encode(new Uint8Array(signatureBuffer));
    }

    const blob: EncryptedBlob = {
      data: dataBase64,
      iv: base64Encode(iv),
      keyId: this.keyId,
      algorithm: "AES-GCM",
      version: "1.0",
      compression: {
        algorithm: compressionResult.algorithm,
        originalSize: originalStringLength,
        compressedSize: compressionResult.compressedSize,
      },
      textEncoding,
    };

    if (signature) {
      blob.signature = signature;
    }

    if (ephemeralPublicKey) {
      blob.ephemeralPublicKey = ephemeralPublicKey;
    }

    return blob;
  }

  /**
   * Decrypt data with decompression and optional signature verification
   */
  public async decrypt(blob: EncryptedBlob): Promise<string> {
    // Input validation
    Validator.validateEncryptedBlob(blob);

    try {
      // Check if data is chunked
      if (blob.chunkInfo?.isChunked && blob.chunks) {
        return await this.decryptChunkedData(blob);
      } else {
        return await this.decryptNonChunkedData(blob);
      }
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

    try {
      const artifact = base64Decode(blob.artifact);

      // Ensure we do not race with a concurrent rotation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.keyManager as any).waitForRotationComplete?.();
      const decryptionKey = await this.keyManager.getCurrentKey();

      try {
        const rawKey = await this.exportRawKeyBytes(decryptionKey);
        const plaintext = await openArtifactBytes(artifact, rawKey);
        return this.decodeProtectedText(plaintext, blob.textEncoding);
      } catch (decryptError) {
        const migrationState = await this.keyManager.getMigrationStatus();
        if (migrationState?.isActive) {
          const legacyKey = await this.keyManager.getLegacyKey();
          if (legacyKey) {
            const rawLegacyKey = await this.exportRawKeyBytes(legacyKey);
            const plaintext = await openArtifactBytes(artifact, rawLegacyKey);
            return this.decodeProtectedText(plaintext, blob.textEncoding);
          }
        }

        throw decryptError;
      }
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
      return this.toProtectedBlobInfo(info, blob.keyId, blob.textEncoding);
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
   * Decrypt chunked data by processing each chunk and reassembling - OPTIMIZED VERSION
   */
  private async decryptChunkedData(blob: EncryptedBlob): Promise<string> {
    if (!blob.chunks || !blob.chunkInfo) {
      throw new CryptoError(
        "Invalid chunked data: missing chunks or chunk info"
      );
    }

    // Verify global signature if present
    if (blob.signature && this.enableSignatures && this.cachedSigningKeyPair) {
      const allChunkData = blob.chunks.map((chunk) => chunk.data).join("");
      const globalData = this.textEncoder.encode(allChunkData);
      const signatureData = base64Decode(blob.signature);

      const isValid = await this.crypto.verifySignature(
        globalData,
        signatureData.buffer as ArrayBuffer,
        this.cachedSigningKeyPair.publicKey
      );

      if (!isValid) {
        throw new CryptoError(
          "Invalid global signature - data may have been tampered with"
        );
      }
    }

    // Sort chunks by index to ensure correct order
    const sortedChunks = blob.chunks.sort((a, b) => a.index - b.index);

    // Ensure we do not race with a concurrent rotation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.keyManager as any).waitForRotationComplete?.();
    // Get decryption key once
    const decryptionKey = await this.keyManager.getCurrentKey();

    // Decrypt chunks in parallel for better performance
    const decryptPromises = sortedChunks.map(async (chunk, i) => {
      // Decode base64 chunk data
      const encryptedData = base64Decode(chunk.data);
      const iv = base64Decode(chunk.iv);

      // Decrypt chunk directly to bytes
      const decrypted = await this.crypto.decrypt(
        encryptedData,
        iv,
        decryptionKey
      );
      return decrypted;
    });

    const decryptedChunks = await Promise.all(decryptPromises);

    // Reassemble compressed bytes
    const totalCompressedSize = decryptedChunks.reduce(
      (sum, chunk) => sum + chunk.length,
      0
    );
    const compressedBytes = new Uint8Array(totalCompressedSize);
    let offset = 0;

    for (const chunk of decryptedChunks) {
      compressedBytes.set(chunk, offset);
      offset += chunk.length;
    }

    // Decompress once
    const decompressed = await decompress(
      compressedBytes,
      blob.compression.algorithm
    );

    // Use the stored textEncoding to decode properly
    let decoded: string;
    if (blob.textEncoding === "utf16le") {
      decoded = this.utf16LEBytesToString(decompressed);
    } else {
      decoded = this.textDecoder.decode(decompressed);
    }

    return decoded;
  }

  /**
   * Decrypt a single chunk
   */
  private async decryptSingleChunk(
    chunk: EncryptedChunk,
    blob: EncryptedBlob
  ): Promise<string> {
    // Ensure we do not race with a concurrent rotation for key retrieval
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.keyManager as any).waitForRotationComplete?.();
    let decryptionKey = await this.keyManager.getCurrentKey();

    // Handle ephemeral key for forward secrecy
    if (blob.ephemeralPublicKey && this.cachedAgreementKeyPair) {
      const ephemeralPublicKey = await this.crypto.importPublicKey(
        blob.ephemeralPublicKey,
        "ECDH"
      );
      decryptionKey = await this.crypto.deriveSharedKey(
        this.cachedAgreementKeyPair.privateKey,
        ephemeralPublicKey
      );
    }

    // Decode base64 chunk data
    const encryptedData = base64Decode(chunk.data);
    const iv = base64Decode(chunk.iv);

    // Verify chunk signature if present
    if (chunk.signature && this.enableSignatures && this.cachedSigningKeyPair) {
      const signatureData = base64Decode(chunk.signature);
      const isValid = await this.crypto.verifySignature(
        encryptedData,
        signatureData.buffer as ArrayBuffer,
        this.cachedSigningKeyPair.publicKey
      );

      if (!isValid) {
        throw new CryptoError(
          `Invalid chunk signature at index ${chunk.index} - data may have been tampered with`
        );
      }
    }

    // Decrypt chunk
    try {
      const decrypted = await this.crypto.decrypt(
        encryptedData,
        iv,
        decryptionKey
      );
      const decompressed = await decompress(
        decrypted,
        blob.compression.algorithm
      );
      const decoded = this.textDecoder.decode(decompressed);
      return decoded;
    } catch (decryptError) {
      // If current key fails and we're in migration, try legacy key
      const migrationState = await this.keyManager.getMigrationStatus();
      if (migrationState?.isActive) {
        const legacyKey = await this.keyManager.getLegacyKey();
        if (legacyKey) {
          const decrypted = await this.crypto.decrypt(
            encryptedData,
            iv,
            legacyKey
          );
          const decompressed = await decompress(
            decrypted,
            blob.compression.algorithm
          );
          const decoded = this.textDecoder.decode(decompressed);
          return decoded;
        }
      }
      throw decryptError;
    }
  }

  /**
   * Decrypt non-chunked data (original method)
   */
  private async decryptNonChunkedData(blob: EncryptedBlob): Promise<string> {
    if (!blob.data || !blob.iv) {
      throw new CryptoError("Invalid non-chunked data: missing data or IV");
    }

    let decryptionKey = await this.keyManager.getCurrentKey();

    // Handle ephemeral key for forward secrecy
    if (blob.ephemeralPublicKey && this.cachedAgreementKeyPair) {
      const ephemeralPublicKey = await this.crypto.importPublicKey(
        blob.ephemeralPublicKey,
        "ECDH"
      );
      decryptionKey = await this.crypto.deriveSharedKey(
        this.cachedAgreementKeyPair.privateKey,
        ephemeralPublicKey
      );
    }

    // Decode base64 data
    const encryptedData = base64Decode(blob.data);
    const iv = base64Decode(blob.iv);

    // Verify signature if present
    if (blob.signature && this.enableSignatures && this.cachedSigningKeyPair) {
      const signatureData = base64Decode(blob.signature);
      const isValid = await this.crypto.verifySignature(
        encryptedData,
        signatureData.buffer as ArrayBuffer,
        this.cachedSigningKeyPair.publicKey
      );

      if (!isValid) {
        throw new CryptoError(
          "Invalid signature - data may have been tampered with"
        );
      }
    }

    // Try current key first
    try {
      const decrypted = await this.crypto.decrypt(
        encryptedData,
        iv,
        decryptionKey
      );
      const decompressed = await decompress(
        decrypted,
        blob.compression.algorithm
      );

      // FIXED: Use the stored textEncoding to decode properly
      let decoded: string;
      if (blob.textEncoding === "utf16le") {
        // Convert UTF-16LE bytes back to string
        decoded = this.utf16LEBytesToString(decompressed);
      } else {
        // Default UTF-8 decoding
        decoded = this.textDecoder.decode(decompressed);
      }

      this.logSurrogateAnalysis("dec:out", decoded);
      return decoded;
    } catch (decryptError) {
      // If current key fails and we're in migration, try legacy key
      const migrationState = await this.keyManager.getMigrationStatus();
      if (migrationState?.isActive) {
        const legacyKey = await this.keyManager.getLegacyKey();
        if (legacyKey) {
          const decrypted = await this.crypto.decrypt(
            encryptedData,
            iv,
            legacyKey
          );
          const decompressed = await decompress(
            decrypted,
            blob.compression.algorithm
          );

          // FIXED: Use the stored textEncoding for legacy decryption too
          let decoded: string;
          if (blob.textEncoding === "utf16le") {
            decoded = this.utf16LEBytesToString(decompressed);
          } else {
            decoded = this.textDecoder.decode(decompressed);
          }

          this.logSurrogateAnalysis("dec:out-legacy", decoded);
          return decoded;
        }
      }
      // If no legacy key or not in migration, re-throw the original error
      throw decryptError;
    }
  }

  // Add this helper method to the VoidedE2EEClient class:
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

  private encodeProtectableText(input: string): {
    bytes: Uint8Array;
    textEncoding: "utf8" | "utf16le";
  } {
    if (this.hasUnpairedSurrogates(input)) {
      return {
        bytes: this.stringToUtf16LEBytes(input),
        textEncoding: "utf16le",
      };
    }

    return {
      bytes: this.textEncoder.encode(input),
      textEncoding: "utf8",
    };
  }

  private decodeProtectedText(
    bytes: Uint8Array,
    textEncoding: "utf8" | "utf16le" | undefined
  ): string {
    if (textEncoding === "utf16le") {
      return this.utf16LEBytesToString(bytes);
    }

    return this.textDecoder.decode(bytes);
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
    keyId: string,
    textEncoding: "utf8" | "utf16le" | undefined
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
      textEncoding,
    };
  }

  /**
   * Export current key as base64 string
   */
  public async exportKey(): Promise<string> {
    try {
      const key = await this.keyManager.getCurrentKey();
      return await this.crypto.exportKey(key);
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
      await this.keyManager.setKey(key, 1); // Import as version 1
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
      if (force) {
        return await this.keyManager.forceRotate();
      } else if (migrate) {
        return await this.keyManager.startMigration(cutoffTime);
      } else {
        throw new ValidationError("Invalid rotation options");
      }
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
      await this.keyManager.deleteKey();
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
    try {
      return await this.keyManager.hasKey();
    } catch (error) {
      return false;
    }
  }

  /**
   * Get migration status
   */
  public async getMigrationStatus(): Promise<MigrationState | null> {
    try {
      return await this.keyManager.getMigrationStatus();
    } catch (error) {
      return null;
    }
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
    try {
      return await this.keyManager.getCurrentKeyVersion();
    } catch (error) {
      return 0;
    }
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
    try {
      const status = await this.keyManager.getMigrationStatus();
      if (!status) return null;

      return {
        oldKeyVersion: status.oldKeyVersion,
        newKeyVersion: status.newKeyVersion,
        cutoffTime: status.cutoffTime,
        createdAt: status.createdAt,
      };
    } catch (error) {
      return null;
    }
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
): Promise<void> {
  return getDefaultClient().deriveKeyFromPassword(options);
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
export { KeySharing } from "./key-sharing";
