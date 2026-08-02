import { CryptoError } from "./errors";
import {
  assertWithinClientMemoryLimit,
  assertWithinClientUploadLimit,
} from "./limits";
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

const HKDF_SHA256_MAX_OUTPUT = 255 * 32;
const KDF_MAX_INPUT_BYTES = 1024 * 1024;
const SHARED_SECRET_CONTEXT_MAX_BYTES = 1024;
const PBKDF2_MIN_ITERATIONS = 100_000;
const PBKDF2_MAX_ITERATIONS = 1_000_000;
const PBKDF2_MIN_SALT_BYTES = 16;
const PBKDF2_MAX_SALT_BYTES = 1024;
const MAX_P256_SPKI_BYTES = 1024;
const MAX_P256_SPKI_BASE64_CHARS = 4 * Math.ceil(MAX_P256_SPKI_BYTES / 3);
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const AES_GCM_FIXED_OVERHEAD_BYTES = AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength"
)?.get;

function getUint8ArrayByteLength(value: unknown, label: string): number {
  if (
    !(value instanceof Uint8Array) ||
    !ArrayBuffer.isView(value) ||
    !TYPED_ARRAY_BYTE_LENGTH_GETTER
  ) {
    throw new CryptoError(`${label} must be a Uint8Array`);
  }
  try {
    return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
  } catch {
    throw new CryptoError(`${label} must be a valid Uint8Array`);
  }
}

function getOptionalUint8ArrayByteLength(
  value: unknown,
  label: string
): number {
  return value === undefined ? 0 : getUint8ArrayByteLength(value, label);
}

function assertAesGcmMemoryBudget(
  inputBytes: number,
  additionalDataBytes: number,
  label: string
): void {
  assertWithinClientMemoryLimit(
    inputBytes + additionalDataBytes + AES_GCM_FIXED_OVERHEAD_BYTES,
    `${label} plus AES-GCM IV/tag overhead`
  );
}

class X25519AgreementRejectedError extends CryptoError {
  constructor(detail: string) {
    super(`X25519 agreement rejected: ${detail}`);
    this.name = "X25519AgreementRejectedError";
  }
}

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
    let rawKey: ArrayBuffer | null = null;
    try {
      rawKey = await crypto.subtle.exportKey("raw", key) as ArrayBuffer;
      return this.arrayBufferToBase64(rawKey);
    } catch (error) {
      throw new CryptoError(`Failed to export key: ${error}`);
    } finally {
      if (rawKey) this.secureWipe(rawKey);
    }
  }

  /**
   * Import key from base64 string
   */
  async importKey(keyString: string): Promise<CryptoKey> {
    try {
      if (
        typeof keyString !== "string" ||
        keyString.length !== 44 ||
        !/^[A-Za-z0-9+/]{43}=$/.test(keyString)
      ) {
        throw new CryptoError("AES-256 key must be canonical base64 encoding exactly 32 bytes");
      }
      const rawKey = this.base64ToArrayBuffer(keyString);
      if (
        rawKey.byteLength !== 32 ||
        this.arrayBufferToBase64(rawKey) !== keyString
      ) {
        this.secureWipe(rawKey);
        throw new CryptoError("AES-256 key must be canonical base64 encoding exactly 32 bytes");
      }
      try {
        return await crypto.subtle.importKey(
          "raw",
          rawKey,
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );
      } finally {
        this.secureWipe(rawKey);
      }
    } catch (error) {
      throw new CryptoError(`Failed to import key: ${error}`);
    }
  }

  /**
   * Encrypt data with CryptoKey
   */
  async encrypt(
    data: Uint8Array,
    key: CryptoKey,
    additionalData?: Uint8Array
  ): Promise<ArrayBuffer> {
    try {
      const dataBytes = getUint8ArrayByteLength(data, "Encryption input");
      const additionalDataBytes = getOptionalUint8ArrayByteLength(
        additionalData,
        "Encryption additional data"
      );
      assertAesGcmMemoryBudget(dataBytes, additionalDataBytes, "Encryption input");
      assertWithinClientUploadLimit(dataBytes);
      const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
      const algorithm: AesGcmParams = {
        name: "AES-GCM",
        iv: toBuffer(iv),
        tagLength: 128,
      };
      if (additionalData !== undefined) {
        algorithm.additionalData = toBuffer(additionalData);
      }
      const ciphertext = await crypto.subtle.encrypt(
        algorithm,
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
    key: CryptoKey,
    additionalData?: Uint8Array,
    encryptedDataIncludesIv = true
  ): Promise<Uint8Array> {
    try {
      const encryptedDataBytes = getUint8ArrayByteLength(
        encryptedData,
        "Encrypted input"
      );
      const ivBytes = getUint8ArrayByteLength(iv, "AES-GCM IV");
      const additionalDataBytes = getOptionalUint8ArrayByteLength(
        additionalData,
        "Decryption additional data"
      );
      if (typeof encryptedDataIncludesIv !== "boolean") {
        throw new CryptoError("encryptedDataIncludesIv must be a boolean");
      }
      if (ivBytes !== AES_GCM_IV_BYTES) {
        throw new CryptoError("AES-GCM IV must contain exactly 12 bytes");
      }
      assertAesGcmMemoryBudget(
        encryptedDataBytes,
        additionalDataBytes,
        "Encrypted input"
      );

      const minimumEncryptedBytes =
        AES_GCM_TAG_BYTES +
        (encryptedDataIncludesIv ? AES_GCM_IV_BYTES : 0);
      if (encryptedDataBytes < minimumEncryptedBytes) {
        throw new CryptoError(
          `Encrypted payload must contain at least ${minimumEncryptedBytes} bytes including its AES-GCM tag`
        );
      }

      let actualData = encryptedData;
      if (encryptedDataIncludesIv) {
        let difference = 0;
        for (let index = 0; index < AES_GCM_IV_BYTES; index++) {
          difference |= encryptedData[index] ^ iv[index];
        }
        if (difference !== 0) {
          throw new CryptoError("Encrypted IV prefix does not match the envelope IV");
        }
        actualData = encryptedData.subarray(AES_GCM_IV_BYTES);
      }
        
      const algorithm: AesGcmParams = {
        name: "AES-GCM",
        iv: toBuffer(iv),
        tagLength: 128,
      };
      if (additionalData !== undefined) {
        algorithm.additionalData = toBuffer(additionalData);
      }
      const plaintext = await crypto.subtle.decrypt(
        algorithm,
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

    const [ikmBytes, saltBytes, infoBytes] = this.copyAndValidateKdfInputs(
      ikm,
      salt,
      info
    );
    try {
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(ikmBytes),
        "HKDF",
        false,
        ["deriveBits", "deriveKey"]
      );

      return await crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: toBuffer(saltBytes),
          info: toBuffer(infoBytes),
        },
        baseKey,
        { name: "AES-GCM", length },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`HKDF deriveKey failed: ${error}`);
    } finally {
      this.secureWipe(ikmBytes);
      this.secureWipe(saltBytes);
      this.secureWipe(infoBytes);
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
    if (
      !Number.isSafeInteger(lengthBytes) ||
      lengthBytes <= 0 ||
      lengthBytes > HKDF_SHA256_MAX_OUTPUT
    ) {
      throw new CryptoError(
        `HKDF-SHA256 lengthBytes must be an integer from 1 to ${HKDF_SHA256_MAX_OUTPUT}, received ${lengthBytes}`
      );
    }

    const [ikmBytes, saltBytes, infoBytes] = this.copyAndValidateKdfInputs(
      ikm,
      salt,
      info
    );
    try {
      const wasm = this.getReadyWasmModule();
      if (wasm?.derive_key_hkdf_raw) {
        const derived = wasm.derive_key_hkdf_raw(
          ikmBytes,
          saltBytes,
          infoBytes,
          lengthBytes
        );
        try {
          if (derived.length !== lengthBytes) {
            throw new CryptoError(
              `WASM HKDF returned ${derived.length} bytes, expected ${lengthBytes}`
            );
          }
          return this.typedArrayToArrayBuffer(derived);
        } finally {
          this.secureWipe(derived);
        }
      }

      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(ikmBytes),
        "HKDF",
        false,
        ["deriveBits", "deriveKey"]
      );

      return await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: toBuffer(saltBytes),
          info: toBuffer(infoBytes),
        },
        baseKey,
        lengthBytes * 8
      );
    } catch (error) {
      if (error instanceof CryptoError) throw error;
      throw new CryptoError(`HKDF deriveBits failed: ${error}`);
    } finally {
      this.secureWipe(ikmBytes);
      this.secureWipe(saltBytes);
      this.secureWipe(infoBytes);
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
    if (
      !Number.isSafeInteger(iterations) ||
      iterations < PBKDF2_MIN_ITERATIONS ||
      iterations > PBKDF2_MAX_ITERATIONS
    ) {
      throw new CryptoError(
        `PBKDF2 iterations must be an integer from ${PBKDF2_MIN_ITERATIONS} to ${PBKDF2_MAX_ITERATIONS}`
      );
    }
    if (
      !(password instanceof Uint8Array) ||
      password.length < 1 ||
      password.length > KDF_MAX_INPUT_BYTES
    ) {
      throw new CryptoError(
        `PBKDF2 password must contain 1 to ${KDF_MAX_INPUT_BYTES} bytes`
      );
    }
    const saltBytes = this.copyAndValidatePbkdf2Salt(salt);
    const passwordBytes = new Uint8Array(password);
    try {
      const baseKey = await crypto.subtle.importKey(
        "raw",
        toBuffer(passwordBytes),
        "PBKDF2",
        false,
        ["deriveBits"]
      );

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: toBuffer(saltBytes),
          iterations,
        },
        baseKey,
        256
      );

      return new Uint8Array(derivedBits);
    } catch (error) {
      throw new CryptoError(`Key derivation (PBKDF2) failed: ${error}`);
    } finally {
      this.secureWipe(passwordBytes);
      this.secureWipe(saltBytes);
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
    if (
      !Number.isSafeInteger(iterations) ||
      iterations < PBKDF2_MIN_ITERATIONS ||
      iterations > PBKDF2_MAX_ITERATIONS
    ) {
      throw new CryptoError(
        `PBKDF2 iterations must be an integer from ${PBKDF2_MIN_ITERATIONS} to ${PBKDF2_MAX_ITERATIONS}`
      );
    }
    if (typeof password !== "string") {
      throw new CryptoError("PBKDF2 password must be a string");
    }
    const saltBytes = this.copyAndValidatePbkdf2Salt(salt);
    const passwordBuffer = this.textEncoder.encode(password);
    if (
      passwordBuffer.length < 1 ||
      passwordBuffer.length > KDF_MAX_INPUT_BYTES
    ) {
      this.secureWipe(passwordBuffer);
      this.secureWipe(saltBytes);
      throw new CryptoError(
        `PBKDF2 password must contain 1 to ${KDF_MAX_INPUT_BYTES} UTF-8 bytes`
      );
    }
    try {
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
          salt: toBuffer(saltBytes),
          iterations,
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (error) {
      throw new CryptoError(`Key derivation from password failed: ${error}`);
    } finally {
      this.secureWipe(passwordBuffer);
      this.secureWipe(saltBytes);
    }
  }

  /**
   * Generate random salt
   */
  generateSalt(length = 16): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 16 || length > 64) {
      throw new CryptoError("Salt length must be an integer from 16 to 64 bytes");
    }
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
    let keyBuffer: ArrayBuffer | null = null;
    try {
      if (usage !== "ECDSA" && usage !== "ECDH") {
        throw new CryptoError(
          `Public key usage must be ECDSA or ECDH, received ${String(usage)}`
        );
      }
      if (
        typeof keyString !== "string" ||
        keyString.length === 0 ||
        keyString.length > MAX_P256_SPKI_BASE64_CHARS ||
        keyString.length % 4 !== 0 ||
        !CANONICAL_BASE64_PATTERN.test(keyString)
      ) {
        throw new CryptoError(
          `P-256 SPKI must be canonical base64 no larger than ${MAX_P256_SPKI_BASE64_CHARS} characters`
        );
      }

      keyBuffer = this.base64ToArrayBuffer(keyString);
      if (
        keyBuffer.byteLength === 0 ||
        keyBuffer.byteLength > MAX_P256_SPKI_BYTES ||
        this.arrayBufferToBase64(keyBuffer) !== keyString
      ) {
        throw new CryptoError(
          `P-256 SPKI must decode canonically to 1-${MAX_P256_SPKI_BYTES} bytes`
        );
      }
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
    } finally {
      if (keyBuffer) {
        this.secureWipe(keyBuffer);
      }
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

    try {
      if (privateKeyBytes.length !== 32) {
        throw new CryptoError(
          `X25519 private key seed must be 32 bytes, received ${privateKeyBytes.length}`
        );
      }

      try {
        let privateKeyPkcs8: Uint8Array | null = null;
        let privateKey: CryptoKey;
        try {
          privateKeyPkcs8 = this.x25519Pkcs8FromSeed(privateKeyBytes);
          privateKey = await crypto.subtle.importKey(
            "pkcs8",
            toBuffer(privateKeyPkcs8),
            { name: "X25519" } as AlgorithmIdentifier,
            false,
            ["deriveBits"]
          );
        } finally {
          if (privateKeyPkcs8) this.secureWipe(privateKeyPkcs8);
        }

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
          let privateBytes: Uint8Array | null = null;
          try {
            const pair = wasm.generate_x25519_key_pair(privateKeyBytes);
            const publicBytes =
              "public_key" in pair ? pair.public_key : pair.publicKey;
            privateBytes =
              "private_key" in pair ? pair.private_key : pair.privateKey;

            return {
              publicKey: this.typedArrayToArrayBuffer(publicBytes),
              privateKey: this.typedArrayToArrayBuffer(privateBytes),
            };
          } catch (wasmError) {
            throw new CryptoError(
              `X25519 key pair generation failed in WASM fallback: ${wasmError}`
            );
          } finally {
            if (privateBytes) this.secureWipe(privateBytes);
          }
        }

        throw new CryptoError(
          `X25519 key pair generation failed. Ensure runtime supports WebCrypto X25519 or WASM fallback: ${error}`
        );
      }
    } finally {
      this.secureWipe(privateKeyBytes);
    }
  }

  /**
   * Compute an X25519 shared secret (32 bytes).
   */
  async x25519SharedSecret(
    ourPrivateKey: ArrayBuffer | Uint8Array,
    theirPublicKey: ArrayBuffer | Uint8Array
  ): Promise<ArrayBuffer> {
    const publicKeyBytes = this.toUint8ArrayCopy(theirPublicKey);

    if (publicKeyBytes.length !== 32) {
      throw new CryptoError(
        `X25519 public key must be 32 bytes, received ${publicKeyBytes.length}`
      );
    }
    if (this.isAllZero(publicKeyBytes)) {
      throw new X25519AgreementRejectedError("peer public key is all zero");
    }

    const privateKeyBytes = this.normalizeX25519PrivateKey(ourPrivateKey);
    try {
      let webCryptoError: unknown;
      try {
        const privateKeyPkcs8 = this.x25519Pkcs8FromSeed(privateKeyBytes);
        let privateKey: CryptoKey;
        try {
          privateKey = await crypto.subtle.importKey(
            "pkcs8",
            toBuffer(privateKeyPkcs8),
            { name: "X25519" } as AlgorithmIdentifier,
            false,
            ["deriveBits"]
          );
        } finally {
          this.secureWipe(privateKeyPkcs8);
        }
        const publicKey = await crypto.subtle.importKey(
          "raw",
          toBuffer(publicKeyBytes),
          { name: "X25519" } as AlgorithmIdentifier,
          false,
          []
        );

        const shared = await crypto.subtle.deriveBits(
          { name: "X25519", public: publicKey } as EcdhKeyDeriveParams,
          privateKey,
          256
        );
        this.assertContributoryX25519Secret(shared, "WebCrypto");
        return shared;
      } catch (error) {
        if (error instanceof X25519AgreementRejectedError) {
          throw error;
        }
        webCryptoError = error;
      }

      const wasm = await this.getAnyWasmModule();
      if (wasm?.x25519_shared_secret) {
        let shared: Uint8Array | null = null;
        try {
          shared = wasm.x25519_shared_secret(privateKeyBytes, publicKeyBytes);
          this.assertContributoryX25519Secret(shared, "Voided WASM");
          return this.typedArrayToArrayBuffer(shared);
        } catch (wasmError) {
          if (wasmError instanceof X25519AgreementRejectedError) {
            throw wasmError;
          }
          throw new CryptoError(
            `X25519 shared secret derivation failed in WASM fallback: ${wasmError}`
          );
        } finally {
          if (shared) {
            this.secureWipe(shared);
          }
        }
      }

      throw new CryptoError(
        `X25519 shared secret derivation failed: ${webCryptoError}`
      );
    } finally {
      this.secureWipe(privateKeyBytes);
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
    if (
      typeof salt !== "string" ||
      typeof info !== "string" ||
      salt.length < 1 ||
      salt.length > SHARED_SECRET_CONTEXT_MAX_BYTES ||
      info.length < 1 ||
      info.length > SHARED_SECRET_CONTEXT_MAX_BYTES
    ) {
      throw new CryptoError("Shared-secret salt and info must be strings");
    }
    const secretBytes = this.toUint8ArrayCopy(sharedSecret);
    const saltBytes = this.textEncoder.encode(salt);
    const infoBytes = this.textEncoder.encode(info);
    try {
      this.assertContributoryX25519Secret(
        secretBytes,
        "Caller-provided X25519"
      );
      this.validateSharedSecretContext("salt", saltBytes);
      this.validateSharedSecretContext("info", infoBytes);

      const wasm = this.getReadyWasmModule();
      if (wasm?.derive_key_from_shared_secret) {
        const wasmSecret = new Uint8Array(secretBytes);
        let rawKey: Uint8Array | null = null;
        try {
          rawKey = wasm.derive_key_from_shared_secret(wasmSecret, salt, info);
          if (rawKey.length !== 32) {
            throw new CryptoError(
              `WASM shared-secret derivation returned ${rawKey.length} bytes, expected 32`
            );
          }
          return await crypto.subtle.importKey(
            "raw",
            toBuffer(rawKey),
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
          );
        } finally {
          this.secureWipe(wasmSecret);
          if (rawKey) this.secureWipe(rawKey);
        }
      }

      return await this.hkdfDerive(secretBytes, saltBytes, infoBytes, 256);
    } finally {
      this.secureWipe(secretBytes);
      this.secureWipe(saltBytes);
      this.secureWipe(infoBytes);
    }
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
    let exported: ArrayBuffer | null = null;
    let hash: ArrayBuffer | null = null;
    try {
      exported = await crypto.subtle.exportKey("raw", key) as ArrayBuffer;
      hash = await crypto.subtle.digest("SHA-256", exported);
      const hex = this.arrayBufferToHex(hash);
      return hex.substring(0, 16); // 8 bytes = 16 hex chars
    } catch (error) {
      throw new CryptoError(`Fingerprint generation failed: ${error}`);
    } finally {
      if (exported) this.secureWipe(exported);
      if (hash) this.secureWipe(hash);
    }
  }

  /**
   * Get safety numbers for key verification
   */
  async getSafetyNumbers(key: CryptoKey): Promise<string> {
    let exported: ArrayBuffer | null = null;
    let hash: ArrayBuffer | null = null;
    try {
      exported = await crypto.subtle.exportKey("raw", key) as ArrayBuffer;
      hash = await crypto.subtle.digest("SHA-256", exported);
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
    } finally {
      if (exported) this.secureWipe(exported);
      if (hash) this.secureWipe(hash);
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
    if (!(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) {
      throw new CryptoError("Cryptographic byte input must be an ArrayBuffer or Uint8Array");
    }
    return data instanceof Uint8Array
      ? new Uint8Array(data)
      : new Uint8Array(data.slice(0));
  }

  private copyAndValidateKdfInput(
    label: string,
    data: ArrayBuffer | Uint8Array,
    minimumBytes: number
  ): Uint8Array {
    const bytes = this.toUint8ArrayCopy(data);
    if (bytes.length < minimumBytes || bytes.length > KDF_MAX_INPUT_BYTES) {
      this.secureWipe(bytes);
      throw new CryptoError(
        `${label} must contain ${minimumBytes} to ${KDF_MAX_INPUT_BYTES} bytes`
      );
    }
    return bytes;
  }

  private copyAndValidateKdfInputs(
    ikm: ArrayBuffer | Uint8Array,
    salt: ArrayBuffer | Uint8Array,
    info: ArrayBuffer | Uint8Array
  ): [Uint8Array, Uint8Array, Uint8Array] {
    const copies: Uint8Array[] = [];
    try {
      copies.push(this.copyAndValidateKdfInput("HKDF input key material", ikm, 1));
      copies.push(this.copyAndValidateKdfInput("HKDF salt", salt, 0));
      copies.push(this.copyAndValidateKdfInput("HKDF info", info, 0));
      return copies as [Uint8Array, Uint8Array, Uint8Array];
    } catch (error) {
      for (const copy of copies) this.secureWipe(copy);
      throw error;
    }
  }

  private copyAndValidatePbkdf2Salt(salt: Uint8Array): Uint8Array {
    if (!(salt instanceof Uint8Array)) {
      throw new CryptoError("PBKDF2 salt must be a Uint8Array");
    }
    const bytes = new Uint8Array(salt);
    if (
      bytes.length < PBKDF2_MIN_SALT_BYTES ||
      bytes.length > PBKDF2_MAX_SALT_BYTES
    ) {
      this.secureWipe(bytes);
      throw new CryptoError(
        `PBKDF2 salt must contain ${PBKDF2_MIN_SALT_BYTES} to ${PBKDF2_MAX_SALT_BYTES} bytes`
      );
    }
    return bytes;
  }

  private validateSharedSecretContext(
    label: "salt" | "info",
    bytes: Uint8Array
  ): void {
    if (
      bytes.length < 1 ||
      bytes.length > SHARED_SECRET_CONTEXT_MAX_BYTES
    ) {
      throw new CryptoError(
        `Shared-secret ${label} must contain 1 to ${SHARED_SECRET_CONTEXT_MAX_BYTES} UTF-8 bytes`
      );
    }
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
      const privateKey = bytes.slice(X25519_PKCS8_PREFIX.length);
      this.secureWipe(bytes);
      return privateKey;
    }
    this.secureWipe(bytes);
    throw new CryptoError(
      `X25519 private key must be 32-byte raw seed or PKCS8. Received ${bytes.length} bytes`
    );
  }

  private assertContributoryX25519Secret(
    sharedSecret: ArrayBuffer | Uint8Array,
    backend: string
  ): void {
    const bytes = sharedSecret instanceof Uint8Array
      ? sharedSecret
      : new Uint8Array(sharedSecret);
    if (bytes.length !== 32) {
      this.secureWipe(bytes);
      throw new CryptoError(
        `${backend} returned an invalid X25519 shared secret length: ${bytes.length}`
      );
    }
    if (this.isAllZero(bytes)) {
      this.secureWipe(bytes);
      throw new X25519AgreementRejectedError(
        `${backend} produced an all-zero shared secret from a low-order or invalid peer public key`
      );
    }
  }

  private isAllZero(bytes: Uint8Array): boolean {
    let combined = 0;
    for (const byte of bytes) {
      combined |= byte;
    }
    return combined === 0;
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
  private readonly saltedHashDomain = this.textEncoder.encode(
    "voided:hash-with-salt:v2"
  );

  /**
   * Hash data with given algorithm
   */
  async hash(
    data: Uint8Array,
    algorithm: "sha256" | "sha512" = "sha256"
  ): Promise<string> {
    const algorithmName = this.webCryptoHashName(algorithm);
    try {
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
    this.webCryptoHashName(algorithm);
    const transcriptLength =
      this.saltedHashDomain.length + 16 + data.length + salt.length;
    assertWithinClientMemoryLimit(transcriptLength, "Salted hash transcript");
    let transcript: Uint8Array | null = null;
    try {
      transcript = new Uint8Array(transcriptLength);
      let offset = 0;
      transcript.set(this.saltedHashDomain, offset);
      offset += this.saltedHashDomain.length;
      this.writeU64Be(transcript, offset, data.length);
      offset += 8;
      transcript.set(data, offset);
      offset += data.length;
      this.writeU64Be(transcript, offset, salt.length);
      offset += 8;
      transcript.set(salt, offset);
      return await this.hash(transcript, algorithm);
    } catch (error) {
      throw new CryptoError(`Failed to hash with salt: ${error}`);
    } finally {
      transcript?.fill(0);
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
    const algorithmName = this.webCryptoHashName(algorithm);
    try {
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
    this.assertSafeIntegerInRange(length, 1, 32, "Fingerprint length");
    const hash = await this.hash(data, "sha256");
    return hash.substring(0, length * 2);
  }

  /**
   * Generate safety numbers
   */
  async safetyNumbers(data: Uint8Array, groupSize = 5): Promise<string> {
    this.assertSafeIntegerInRange(
      groupSize,
      1,
      32,
      "Fingerprint group size"
    );
    const hash = await this.hash(data, "sha256");
    const bytes = this.hexToBytes(hash);
    
    const groups: string[] = [];
    for (let i = 0; i < bytes.length; i += groupSize) {
      const slice = bytes.slice(i, i + groupSize);
      const groupNums = Array.from(slice).map((b) =>
        b.toString().padStart(3, "0")
      );
      groups.push(groupNums.join(" "));
    }
    
    return groups.join("  ");
  }

  private webCryptoHashName(algorithm: unknown): "SHA-256" | "SHA-512" {
    switch (algorithm) {
      case "sha256":
        return "SHA-256";
      case "sha512":
        return "SHA-512";
      default:
        throw new CryptoError(
          `Unsupported hash algorithm: ${
            typeof algorithm === "string" ? algorithm : typeof algorithm
          }`
        );
    }
  }

  private writeU64Be(
    target: Uint8Array,
    offset: number,
    value: number
  ): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CryptoError(`Hash transcript length is invalid: ${value}`);
    }
    let remaining = BigInt(value);
    for (let index = 7; index >= 0; index--) {
      target[offset + index] = Number(remaining & 0xffn);
      remaining >>= 8n;
    }
  }

  private assertSafeIntegerInRange(
    value: number,
    minimum: number,
    maximum: number,
    label: string
  ): void {
    if (
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new CryptoError(
        `${label} must be a safe integer from ${minimum} to ${maximum}, received ${value}`
      );
    }
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
