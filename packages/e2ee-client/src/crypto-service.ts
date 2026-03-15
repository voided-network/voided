import { CryptoError } from "./errors";
import { assertWithinClientUploadLimit } from "./limits";
import { getWasm, getWasmSync, isWasmReady, type WasmModule } from "./wasm/loader";

// Helper to cast binary values to BufferSource for Web Crypto API
const toBuffer = (data: ArrayBuffer | Uint8Array): BufferSource =>
  (data instanceof Uint8Array ? data : new Uint8Array(data)) as unknown as BufferSource;

const X25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

const X25519_BASEPOINT = (() => {
  const point = new Uint8Array(32);
  point[0] = 9;
  return point;
})();

/**
 * CryptoService - Handles all cryptographic operations for the E2EE client
 * Uses the Web Crypto API for browser-based encryption.
 * 
 * This class provides two sets of methods:
 * 1. Methods that work with CryptoKey (for VoidedE2EEClient internal use)
 * 2. Methods that work with Uint8Array (for crypto-backend compatibility)
 */
export class CryptoService {
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  // ============================================================================
  // METHODS THAT WORK WITH CryptoKey (for VoidedE2EEClient)
  // ============================================================================

  /**
   * Generate a new AES-256-GCM encryption key (CryptoKey)
   */
  async generateKey(): Promise<CryptoKey> {
    try {
      return await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true, // extractable
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`Failed to generate key: ${error}`);
    }
  }

  /**
   * Generate raw key bytes (32 bytes for AES-256)
   */
  generateKeyBytes(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  /**
   * Export key to base64 string
   */
  async exportKey(key: CryptoKey): Promise<string> {
    try {
      const rawKey = await crypto.subtle.exportKey("raw", key);
      return this.arrayBufferToBase64(rawKey);
    } catch (error) {
      throw new CryptoError(`Failed to export key: ${error}`);
    }
  }

  /**
   * Import key from base64 string
   */
  async importKey(keyString: string): Promise<CryptoKey> {
    try {
      const rawKey = this.base64ToArrayBuffer(keyString);
      return await crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`Failed to import key: ${error}`);
    }
  }

  /**
   * Encrypt data with CryptoKey
   */
  async encrypt(data: Uint8Array, key: CryptoKey): Promise<ArrayBuffer> {
    try {
      assertWithinClientUploadLimit(data.length);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: toBuffer(iv) },
        key,
        toBuffer(data)
      );
      
      // Return IV + ciphertext
      const result = new Uint8Array(iv.length + ciphertext.byteLength);
      result.set(iv, 0);
      result.set(new Uint8Array(ciphertext), iv.length);
      return result.buffer;
    } catch (error) {
      throw new CryptoError(`Encryption failed: ${error}`);
    }
  }

  /**
   * Decrypt data with CryptoKey
   */
  async decrypt(
    encryptedData: Uint8Array,
    iv: Uint8Array,
    key: CryptoKey
  ): Promise<Uint8Array> {
    try {
      // If the encrypted data includes the IV at the start, extract it
      const actualData = encryptedData.length > 12 && encryptedData.slice(0, 12).every((b, i) => b === iv[i])
        ? encryptedData.slice(12)
        : encryptedData;
        
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toBuffer(iv) },
        key,
        toBuffer(actualData)
      );
      return new Uint8Array(plaintext);
    } catch (error) {
      throw new CryptoError(`Decryption failed: ${error}`);
    }
  }

  /**
   * HKDF-SHA256 key derivation returning an AES-GCM key.
   */
  async hkdfDerive(
    ikm: ArrayBuffer | Uint8Array,
    salt: ArrayBuffer | Uint8Array,
    info: ArrayBuffer | Uint8Array,
    length = 256
  ): Promise<CryptoKey> {
    if (![128, 192, 256].includes(length)) {
      throw new CryptoError(
        `HKDF deriveKey requires AES length 128/192/256, received ${length}`
      );
    }

    try {
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(ikm),
        "HKDF",
        false,
        ["deriveBits", "deriveKey"]
      );

      return await crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: toBuffer(salt),
          info: toBuffer(info),
        },
        baseKey,
        { name: "AES-GCM", length },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`HKDF deriveKey failed: ${error}`);
    }
  }

  /**
   * HKDF-SHA256 key derivation returning raw bytes.
   */
  async hkdfDeriveRaw(
    ikm: ArrayBuffer | Uint8Array,
    salt: ArrayBuffer | Uint8Array,
    info: ArrayBuffer | Uint8Array,
    lengthBytes = 32
  ): Promise<ArrayBuffer> {
    if (lengthBytes <= 0) {
      throw new CryptoError(
        `HKDF deriveBits lengthBytes must be > 0, received ${lengthBytes}`
      );
    }

    const wasm = this.getReadyWasmModule();
    if (wasm?.derive_key_hkdf_raw) {
      const derived = wasm.derive_key_hkdf_raw(
        this.toUint8ArrayCopy(ikm),
        this.toUint8ArrayCopy(salt),
        this.toUint8ArrayCopy(info),
        lengthBytes
      );
      return this.typedArrayToArrayBuffer(derived);
    }

    try {
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(ikm),
        "HKDF",
        false,
        ["deriveBits", "deriveKey"]
      );

      return await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: toBuffer(salt),
          info: toBuffer(info),
        },
        baseKey,
        lengthBytes * 8
      );
    } catch (error) {
      throw new CryptoError(`HKDF deriveBits failed: ${error}`);
    }
  }

  /**
   * Derive raw key bytes using HKDF (legacy compatibility helper).
   */
  async deriveKey(
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array
  ): Promise<Uint8Array> {
    const derivedBits = await this.hkdfDeriveRaw(ikm, salt, info, 32);
    return new Uint8Array(derivedBits);
  }

  /**
   * Derive key using PBKDF2
   */
  async deriveKeyPbkdf2(
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number
  ): Promise<Uint8Array> {
    try {
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(password),
        "PBKDF2",
        false,
        ["deriveBits"]
      );

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: toBuffer(salt),
          iterations,
        },
        baseKey,
        256
      );

      return new Uint8Array(derivedBits);
    } catch (error) {
      throw new CryptoError(`Key derivation (PBKDF2) failed: ${error}`);
    }
  }

  /**
   * Derive encryption key from password
   */
  async deriveKeyFromPassword(
    password: string,
    salt: Uint8Array,
    iterations: number
  ): Promise<CryptoKey> {
    try {
      const passwordBuffer = this.textEncoder.encode(password);
      
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(passwordBuffer),
        "PBKDF2",
        false,
        ["deriveKey"]
      );

      return await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: toBuffer(salt),
          iterations,
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`Key derivation from password failed: ${error}`);
    }
  }

  /**
   * Generate random salt
   */
  generateSalt(length = 16): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Generate ECDSA signing key pair
   */
  async generateSigningKeyPair(): Promise<CryptoKeyPair> {
    try {
      return await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
    } catch (error) {
      throw new CryptoError(`Signing key pair generation failed: ${error}`);
    }
  }

  /**
   * Generate ECDH key agreement key pair
   */
  async generateKeyAgreementKeyPair(): Promise<CryptoKeyPair> {
    try {
      return await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
      );
    } catch (error) {
      throw new CryptoError(`Key agreement key pair generation failed: ${error}`);
    }
  }

  /**
   * Export public key to base64 SPKI format
   */
  async exportPublicKey(key: CryptoKey): Promise<string> {
    try {
      const exported = await crypto.subtle.exportKey("spki", key);
      return this.arrayBufferToBase64(exported);
    } catch (error) {
      throw new CryptoError(`Public key export failed: ${error}`);
    }
  }

  /**
   * Import public key from base64 SPKI format
   */
  async importPublicKey(
    keyString: string,
    usage: "ECDSA" | "ECDH"
  ): Promise<CryptoKey> {
    try {
      const keyBuffer = this.base64ToArrayBuffer(keyString);
      const algorithm =
        usage === "ECDSA"
          ? { name: "ECDSA", namedCurve: "P-256" }
          : { name: "ECDH", namedCurve: "P-256" };

      return await crypto.subtle.importKey(
        "spki",
        keyBuffer,
        algorithm,
        true,
        usage === "ECDSA" ? ["verify"] : []
      );
    } catch (error) {
      throw new CryptoError(`Public key import failed: ${error}`);
    }
  }

  /**
   * Derive shared key using ECDH
   */
  async deriveSharedKey(
    privateKey: CryptoKey,
    publicKey: CryptoKey
  ): Promise<CryptoKey> {
    try {
      return await crypto.subtle.deriveKey(
        { name: "ECDH", public: publicKey },
        privateKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`Shared key derivation failed: ${error}`);
    }
  }

  /**
   * Generate an X25519 key pair.
   * Returns raw 32-byte public/private key material.
   */
  async generateX25519KeyPair(
    seed?: ArrayBuffer | Uint8Array
  ): Promise<{ publicKey: ArrayBuffer; privateKey: ArrayBuffer }> {
    const privateKeyBytes = seed
      ? this.toUint8ArrayCopy(seed)
      : crypto.getRandomValues(new Uint8Array(32));

    if (privateKeyBytes.length !== 32) {
      throw new CryptoError(
        `X25519 private key seed must be 32 bytes, received ${privateKeyBytes.length}`
      );
    }

    try {
      const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        toBuffer(this.x25519Pkcs8FromSeed(privateKeyBytes)),
        { name: "X25519" } as AlgorithmIdentifier,
        false,
        ["deriveBits"]
      );

      const basepointPublicKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(X25519_BASEPOINT),
        { name: "X25519" } as AlgorithmIdentifier,
        false,
        []
      );

      const publicKey = await crypto.subtle.deriveBits(
        { name: "X25519", public: basepointPublicKey } as EcdhKeyDeriveParams,
        privateKey,
        256
      );

      return {
        publicKey,
        privateKey: this.typedArrayToArrayBuffer(privateKeyBytes),
      };
    } catch (error) {
      const wasm = await this.getAnyWasmModule();
      if (wasm?.generate_x25519_key_pair) {
        try {
          const pair = wasm.generate_x25519_key_pair(
            seed ? this.toUint8ArrayCopy(seed) : undefined
          );
          const publicBytes = "public_key" in pair ? pair.public_key : pair.publicKey;
          const privateBytes = "private_key" in pair ? pair.private_key : pair.privateKey;

          return {
            publicKey: this.typedArrayToArrayBuffer(publicBytes),
            privateKey: this.typedArrayToArrayBuffer(privateBytes),
          };
        } catch (wasmError) {
          throw new CryptoError(
            `X25519 key pair generation failed in WASM fallback: ${wasmError}`
          );
        }
      }

      throw new CryptoError(
        `X25519 key pair generation failed. Ensure runtime supports WebCrypto X25519 or WASM fallback: ${error}`
      );
    }
  }

  /**
   * Compute an X25519 shared secret (32 bytes).
   */
  async x25519SharedSecret(
    ourPrivateKey: ArrayBuffer | Uint8Array,
    theirPublicKey: ArrayBuffer | Uint8Array
  ): Promise<ArrayBuffer> {
    const privateKeyBytes = this.normalizeX25519PrivateKey(ourPrivateKey);
    const publicKeyBytes = this.toUint8ArrayCopy(theirPublicKey);

    if (publicKeyBytes.length !== 32) {
      throw new CryptoError(
        `X25519 public key must be 32 bytes, received ${publicKeyBytes.length}`
      );
    }

    try {
      const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        toBuffer(this.x25519Pkcs8FromSeed(privateKeyBytes)),
        { name: "X25519" } as AlgorithmIdentifier,
        false,
        ["deriveBits"]
      );
      const publicKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(publicKeyBytes),
        { name: "X25519" } as AlgorithmIdentifier,
        false,
        []
      );

      return await crypto.subtle.deriveBits(
        { name: "X25519", public: publicKey } as EcdhKeyDeriveParams,
        privateKey,
        256
      );
    } catch (error) {
      const wasm = await this.getAnyWasmModule();
      if (wasm?.x25519_shared_secret) {
        try {
          const shared = wasm.x25519_shared_secret(privateKeyBytes, publicKeyBytes);
          return this.typedArrayToArrayBuffer(shared);
        } catch (wasmError) {
          throw new CryptoError(
            `X25519 shared secret derivation failed in WASM fallback: ${wasmError}`
          );
        }
      }

      throw new CryptoError(
        `X25519 shared secret derivation failed: ${error}`
      );
    }
  }

  /**
   * Derive an AES-256-GCM key from a raw X25519 shared secret.
   */
  async deriveKeyFromSharedSecret(
    sharedSecret: ArrayBuffer | Uint8Array,
    salt: string,
    info: string
  ): Promise<CryptoKey> {
    const wasm = this.getReadyWasmModule();
    if (wasm?.derive_key_from_shared_secret) {
      const rawKey = wasm.derive_key_from_shared_secret(
        this.toUint8ArrayCopy(sharedSecret),
        salt,
        info
      );
      return crypto.subtle.importKey(
        "raw",
        toBuffer(rawKey),
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    }

    return this.hkdfDerive(
      sharedSecret,
      this.textEncoder.encode(salt),
      this.textEncoder.encode(info),
      256
    );
  }

  /**
   * Sign data with ECDSA
   */
  async signData(data: Uint8Array, key: CryptoKey): Promise<ArrayBuffer> {
    try {
      return await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        toBuffer(data)
      );
    } catch (error) {
      throw new CryptoError(`Signing failed: ${error}`);
    }
  }

  /**
   * Verify ECDSA signature
   */
  async verifySignature(
    data: Uint8Array,
    signature: ArrayBuffer,
    key: CryptoKey
  ): Promise<boolean> {
    try {
      return await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signature,
        toBuffer(data)
      );
    } catch (error) {
      throw new CryptoError(`Signature verification failed: ${error}`);
    }
  }

  /**
   * Get key fingerprint (hex string)
   */
  async getKeyFingerprint(key: CryptoKey): Promise<string> {
    try {
      const exported = await crypto.subtle.exportKey("raw", key);
      const hash = await crypto.subtle.digest("SHA-256", exported);
      const hex = this.arrayBufferToHex(hash);
      return hex.substring(0, 16); // 8 bytes = 16 hex chars
    } catch (error) {
      throw new CryptoError(`Fingerprint generation failed: ${error}`);
    }
  }

  /**
   * Get safety numbers for key verification
   */
  async getSafetyNumbers(key: CryptoKey): Promise<string> {
    try {
      const exported = await crypto.subtle.exportKey("raw", key);
      const hash = await crypto.subtle.digest("SHA-256", exported);
      const bytes = new Uint8Array(hash);
      
      // Convert to groups of 3-digit numbers
      const groups: string[] = [];
      for (let i = 0; i < bytes.length && groups.length < 8; i += 2) {
        const num = (bytes[i] * 256 + (bytes[i + 1] || 0)) % 1000;
        groups.push(num.toString().padStart(3, "0"));
      }
      
      return groups.join(" ");
    } catch (error) {
      throw new CryptoError(`Safety numbers generation failed: ${error}`);
    }
  }

  /**
   * Overwrite mutable byte buffers in place.
   */
  secureWipe(data: ArrayBuffer | Uint8Array): void {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    bytes.fill(0);
  }

  // ============================================================================
  // Helper methods
  // ============================================================================
  
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private arrayBufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private toUint8ArrayCopy(data: ArrayBuffer | Uint8Array): Uint8Array {
    return data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
  }

  private typedArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
  }

  private x25519Pkcs8FromSeed(seed: Uint8Array): Uint8Array {
    if (seed.length !== 32) {
      throw new CryptoError(
        `X25519 private key seed must be 32 bytes, received ${seed.length}`
      );
    }
    const out = new Uint8Array(X25519_PKCS8_PREFIX.length + seed.length);
    out.set(X25519_PKCS8_PREFIX, 0);
    out.set(seed, X25519_PKCS8_PREFIX.length);
    return out;
  }

  private normalizeX25519PrivateKey(data: ArrayBuffer | Uint8Array): Uint8Array {
    const bytes = this.toUint8ArrayCopy(data);
    if (bytes.length === 32) {
      return bytes;
    }
    if (
      bytes.length === X25519_PKCS8_PREFIX.length + 32 &&
      X25519_PKCS8_PREFIX.every((value, index) => bytes[index] === value)
    ) {
      return bytes.slice(X25519_PKCS8_PREFIX.length);
    }
    throw new CryptoError(
      `X25519 private key must be 32-byte raw seed or PKCS8. Received ${bytes.length} bytes`
    );
  }

  private getReadyWasmModule(): WasmModule | null {
    if (!isWasmReady()) {
      return null;
    }
    try {
      return getWasmSync();
    } catch {
      return null;
    }
  }

  private async getAnyWasmModule(): Promise<WasmModule | null> {
    const ready = this.getReadyWasmModule();
    if (ready) {
      return ready;
    }
    try {
      return await getWasm();
    } catch {
      return null;
    }
  }
}

/**
 * HashService - Handles all hashing operations for the E2EE client
 */
export class HashService {
  private readonly textEncoder = new TextEncoder();

  /**
   * Hash data with given algorithm
   */
  async hash(
    data: Uint8Array,
    algorithm: "sha256" | "sha512" = "sha256"
  ): Promise<string> {
    try {
      // Map algorithm names to Web Crypto format
      const algorithmName = algorithm === "sha256" ? "SHA-256" : "SHA-512";
      const hashBuffer = await crypto.subtle.digest(algorithmName, toBuffer(data));
      return this.arrayBufferToHex(hashBuffer);
    } catch (error) {
      throw new CryptoError(`Failed to generate ${algorithm} hash: ${error}`);
    }
  }

  /**
   * Hash data with salt
   */
  async hashWithSalt(
    data: Uint8Array,
    salt: Uint8Array,
    algorithm: "sha256" | "sha512" = "sha256"
  ): Promise<string> {
    try {
      const combined = new Uint8Array(data.length + salt.length);
      combined.set(data, 0);
      combined.set(salt, data.length);
      return await this.hash(combined, algorithm);
    } catch (error) {
      throw new CryptoError(`Failed to hash with salt: ${error}`);
    }
  }

  /**
   * Compare two byte arrays (constant-time)
   */
  compare(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }

  /**
   * Generate HMAC
   */
  async hmac(
    data: Uint8Array,
    key: Uint8Array,
    algorithm: "sha256" | "sha512" = "sha256"
  ): Promise<string> {
    try {
      const algorithmName = algorithm === "sha256" ? "SHA-256" : "SHA-512";
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(key),
        { name: "HMAC", hash: algorithmName },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign("HMAC", cryptoKey, toBuffer(data));
      return this.arrayBufferToHex(signature);
    } catch (error) {
      throw new CryptoError(`Failed to generate HMAC: ${error}`);
    }
  }

  /**
   * Generate fingerprint
   */
  async fingerprint(data: Uint8Array, length = 8): Promise<string> {
    const hash = await this.hash(data, "sha256");
    return hash.substring(0, length * 2);
  }

  /**
   * Generate safety numbers
   */
  async safetyNumbers(data: Uint8Array, groupSize = 5): Promise<string> {
    const hash = await this.hash(data, "sha256");
    const bytes = this.hexToBytes(hash);
    
    const groups: string[] = [];
    for (let i = 0; i < bytes.length && groups.length < 8; i += groupSize) {
      const slice = bytes.slice(i, i + groupSize);
      const groupNums = Array.from(slice).map((b) =>
        b.toString().padStart(3, "0")
      );
      groups.push(groupNums.join(" "));
    }
    
    return groups.join("  ");
  }

  private arrayBufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }
}

// Export singleton instances
export const cryptoService = new CryptoService();
export const hashService = new HashService();
