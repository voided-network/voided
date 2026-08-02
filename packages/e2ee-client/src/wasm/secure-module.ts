import type {
  EncryptionResult,
  FusedShellInfo,
  ProtectedArtifactInfo,
  ProtectResult,
  WasmModule,
} from './loader';
import {
  WASM_ARTIFACT_MAX_BYTES,
  WASM_BOUNDED_DECOMPRESSION_MAX_BYTES,
  WASM_CONTEXT_MAX_BYTES,
  WASM_HKDF_MAX_OUTPUT_BYTES,
  WASM_KDF_INPUT_MAX_BYTES,
  WASM_PLAINTEXT_MAX_BYTES,
  WASM_RAW_MAX_BYTES,
  assertAggregateBytes,
  assertBytes,
  assertCanonicalBase64,
  assertCanonicalLowerHex,
  assertExactBytes,
  assertSafeInteger,
  assertUtf8String,
  authenticatedAlgorithm,
  callAfterPreflight,
  compressionAlgorithm,
  compressionLevel,
  fusedPreset,
  hashAlgorithm,
  optionalChunkSize,
  pbkdfParameters,
  validateArtifactInfo,
  validateBytesResult,
  validateCompressionResult,
  validateEncryptionResult,
  validateFusedShellInfo,
  validateHashResult,
  validateProtectResult,
} from './boundary';

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`[voided-wasm] ${label} must be a boolean`);
  }
  return value;
}

function assertNotAllZero(value: Uint8Array, label: string): void {
  let aggregate = 0;
  for (let index = 0; index < 32; index++) aggregate |= value[index];
  if (aggregate === 0) {
    throw new Error(`[voided-wasm] ${label} must not be all zero`);
  }
}

function assertBoundedString(
  value: unknown,
  label: string,
  maxCodeUnits: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxCodeUnits
  ) {
    throw new Error(`[voided-wasm] ${label} is invalid`);
  }
  return value;
}

function validateKeyPair(
  value: unknown,
): ReturnType<NonNullable<WasmModule['generate_x25519_key_pair']>> {
  if (!value || typeof value !== 'object') {
    throw new Error('[voided-wasm] X25519 key pair must be an object');
  }
  const pair = value as Record<string, unknown>;
  const publicKey = pair.public_key ?? pair.publicKey;
  assertExactBytes(publicKey, 'X25519 public key result', 32);
  assertNotAllZero(publicKey as Uint8Array, 'X25519 public key result');
  assertExactBytes(
    pair.private_key ?? pair.privateKey,
    'X25519 private key result',
    32,
  );
  return value as ReturnType<
    NonNullable<WasmModule['generate_x25519_key_pair']>
  >;
}

function validateProtectOptions(
  preset: string | undefined,
  compression: string | undefined,
  level: number | undefined,
  encryption: string | undefined,
  chunkSize: number | undefined,
): {
  preset: 'compact' | 'balanced' | 'concealed';
  compression: 'gzip' | 'brotli' | 'none';
  encryption: 'xchacha20-poly1305' | 'aes-256-gcm';
} {
  const checkedPreset = fusedPreset(preset);
  const checkedCompression = compressionAlgorithm(compression);
  compressionLevel(checkedCompression, level);
  const checkedEncryption = authenticatedAlgorithm(encryption);
  optionalChunkSize(chunkSize);
  return {
    preset: checkedPreset,
    compression: checkedCompression,
    encryption: checkedEncryption,
  };
}

function validateReturnedProtectConfiguration(
  result: ProtectResult,
  expected: ReturnType<typeof validateProtectOptions>,
): ProtectResult {
  if (
    result.preset !== expected.preset ||
    (result.compressionAlgorithm !== expected.compression &&
      result.compressionAlgorithm !== 'none') ||
    result.encryptionAlgorithm !== expected.encryption
  ) {
    throw new Error('[voided-wasm] protected artifact configuration mismatch');
  }
  return result;
}

/**
 * Wrap normalized wasm-bindgen functions with checks that run while values are
 * still JavaScript-owned. This is the only point where oversized hostile
 * inputs can be rejected before wasm-bindgen copies them into linear memory.
 */
export function secureWasmModule(raw: WasmModule): WasmModule {
  const inspectFused = (data: Uint8Array): FusedShellInfo => {
    let inputLength = 0;
    return callAfterPreflight(
      () => {
        inputLength = assertBytes(
          data,
          'fused shell input',
          WASM_ARTIFACT_MAX_BYTES,
        );
      },
      () => raw.inspectFused(data),
      (info) => validateFusedShellInfo(info, inputLength),
    );
  };

  const inspectArtifact = (
    artifact: Uint8Array,
  ): ProtectedArtifactInfo => {
    let inputLength = 0;
    return callAfterPreflight(
      () => {
        inputLength = assertBytes(
          artifact,
          'protected artifact input',
          WASM_ARTIFACT_MAX_BYTES,
        );
      },
      () => raw.inspectArtifact(artifact),
      (info) => validateArtifactInfo(info, inputLength),
    );
  };

  return {
    version: () =>
      callAfterPreflight(
        () => undefined,
        () => raw.version(),
        (value) => assertBoundedString(value, 'version result', 128),
      ),
    generate_key: () =>
      validateBytesResult(raw.generate_key(), 'generated key', 32, 32),
    encrypt: (data, key, algorithm) => {
      const checkedAlgorithm = authenticatedAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          assertBytes(data, 'encryption input', WASM_PLAINTEXT_MAX_BYTES);
          assertExactBytes(key, 'encryption key', 32);
        },
        () => raw.encrypt(data, key, checkedAlgorithm),
        (value) =>
          validateEncryptionResult(
            value,
            checkedAlgorithm,
          ) as EncryptionResult,
      );
    },
    decrypt: (ciphertext, nonce, tag, key, algorithm) => {
      if (algorithm === undefined) {
        throw new Error(
          '[voided-wasm] authenticated encryption algorithm is required',
        );
      }
      const checkedAlgorithm = authenticatedAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          assertCanonicalBase64(
            ciphertext,
            'ciphertext',
            WASM_PLAINTEXT_MAX_BYTES,
          );
          assertCanonicalBase64(
            nonce,
            'nonce',
            checkedAlgorithm === 'xchacha20-poly1305' ? 24 : 12,
            checkedAlgorithm === 'xchacha20-poly1305' ? 24 : 12,
          );
          assertCanonicalBase64(tag, 'authentication tag', 16, 16);
          assertExactBytes(key, 'decryption key', 32);
        },
        () => raw.decrypt(ciphertext, nonce, tag, key, checkedAlgorithm),
        (value) =>
          validateBytesResult(
            value,
            'decrypted plaintext',
            WASM_PLAINTEXT_MAX_BYTES,
          ),
      );
    },
    encrypt_with_aad: (data, key, aad, algorithm) => {
      const checkedAlgorithm = authenticatedAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          const dataLength = assertBytes(
            data,
            'authenticated encryption input',
            WASM_PLAINTEXT_MAX_BYTES,
          );
          assertExactBytes(key, 'authenticated encryption key', 32);
          const aadLength = assertBytes(
            aad,
            'authenticated additional data',
            WASM_RAW_MAX_BYTES,
          );
          assertAggregateBytes(
            'authenticated encryption working set',
            WASM_PLAINTEXT_MAX_BYTES,
            dataLength,
            aadLength,
            checkedAlgorithm === 'xchacha20-poly1305' ? 24 : 12,
            16,
          );
        },
        () => raw.encrypt_with_aad(data, key, aad, checkedAlgorithm),
        (value) =>
          validateEncryptionResult(
            value,
            checkedAlgorithm,
          ) as EncryptionResult,
      );
    },
    decrypt_with_aad: (
      ciphertext,
      nonce,
      tag,
      key,
      algorithm,
      aad,
    ) => {
      if (algorithm === undefined) {
        throw new Error(
          '[voided-wasm] authenticated encryption algorithm is required',
        );
      }
      const checkedAlgorithm = authenticatedAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          const ciphertextLength = assertCanonicalBase64(
            ciphertext,
            'ciphertext',
            WASM_PLAINTEXT_MAX_BYTES,
          );
          assertCanonicalBase64(
            nonce,
            'nonce',
            checkedAlgorithm === 'xchacha20-poly1305' ? 24 : 12,
            checkedAlgorithm === 'xchacha20-poly1305' ? 24 : 12,
          );
          assertCanonicalBase64(tag, 'authentication tag', 16, 16);
          assertExactBytes(key, 'authenticated decryption key', 32);
          const aadLength = assertBytes(
            aad,
            'authenticated additional data',
            WASM_RAW_MAX_BYTES,
          );
          assertAggregateBytes(
            'authenticated decryption working set',
            WASM_PLAINTEXT_MAX_BYTES,
            ciphertextLength,
            aadLength,
            checkedAlgorithm === 'xchacha20-poly1305' ? 24 : 12,
            16,
          );
        },
        () =>
          raw.decrypt_with_aad(
            ciphertext,
            nonce,
            tag,
            key,
            checkedAlgorithm,
            aad,
          ),
        (value) =>
          validateBytesResult(
            value,
            'authenticated decrypted plaintext',
            WASM_PLAINTEXT_MAX_BYTES,
          ),
      );
    },
    derive_key_hkdf: (ikm, salt, info) =>
      callAfterPreflight(
        () => {
          assertBytes(ikm, 'HKDF input key material', WASM_KDF_INPUT_MAX_BYTES, 1);
          if (salt !== null) {
            assertBytes(salt, 'HKDF salt', WASM_KDF_INPUT_MAX_BYTES);
          }
          assertBytes(info, 'HKDF info', WASM_KDF_INPUT_MAX_BYTES);
        },
        () => raw.derive_key_hkdf(ikm, salt, info),
        (value) => validateBytesResult(value, 'HKDF key result', 32, 32),
      ),
    derive_key_hkdf_raw: raw.derive_key_hkdf_raw
      ? (ikm, salt, info, length) =>
          callAfterPreflight(
            () => {
              assertBytes(
                ikm,
                'HKDF input key material',
                WASM_KDF_INPUT_MAX_BYTES,
                1,
              );
              if (salt !== null) {
                assertBytes(salt, 'HKDF salt', WASM_KDF_INPUT_MAX_BYTES);
              }
              assertBytes(info, 'HKDF info', WASM_KDF_INPUT_MAX_BYTES);
              assertSafeInteger(
                length,
                'HKDF output length',
                1,
                WASM_HKDF_MAX_OUTPUT_BYTES,
              );
            },
            () => raw.derive_key_hkdf_raw!(ikm, salt, info, length),
            (value) =>
              validateBytesResult(
                value,
                'HKDF raw result',
                WASM_HKDF_MAX_OUTPUT_BYTES,
                length,
              ),
          )
      : undefined,
    derive_key_pbkdf2: (password, salt, iterations) =>
      callAfterPreflight(
        () => pbkdfParameters(password, salt, iterations),
        () => raw.derive_key_pbkdf2(password, salt, iterations),
        (value) => validateBytesResult(value, 'PBKDF2 key result', 32, 32),
      ),
    generate_x25519_key_pair: raw.generate_x25519_key_pair
      ? (seed) =>
          callAfterPreflight(
            () => {
              if (seed !== undefined && seed !== null) {
                assertExactBytes(seed, 'X25519 seed', 32);
              }
            },
            () => raw.generate_x25519_key_pair!(seed),
            validateKeyPair,
          )
      : undefined,
    x25519_shared_secret: raw.x25519_shared_secret
      ? (ourPrivateKey, theirPublicKey) =>
          callAfterPreflight(
            () => {
              assertExactBytes(ourPrivateKey, 'X25519 private key', 32);
              assertExactBytes(theirPublicKey, 'X25519 public key', 32);
              assertNotAllZero(theirPublicKey, 'X25519 public key');
            },
            () =>
              raw.x25519_shared_secret!(ourPrivateKey, theirPublicKey),
            (value) => {
              const checked = validateBytesResult(
                value,
                'X25519 shared secret result',
                32,
                32,
              );
              assertNotAllZero(checked, 'X25519 shared secret result');
              return checked;
            },
          )
      : undefined,
    derive_key_from_shared_secret: raw.derive_key_from_shared_secret
      ? (sharedSecret, salt, info) =>
          callAfterPreflight(
            () => {
              assertExactBytes(sharedSecret, 'X25519 shared secret', 32);
              assertNotAllZero(sharedSecret, 'X25519 shared secret');
              assertUtf8String(
                salt,
                'shared-secret salt context',
                WASM_CONTEXT_MAX_BYTES,
                1,
              );
              assertUtf8String(
                info,
                'shared-secret info context',
                WASM_CONTEXT_MAX_BYTES,
                1,
              );
            },
            () =>
              raw.derive_key_from_shared_secret!(sharedSecret, salt, info),
            (value) =>
              validateBytesResult(
                value,
                'shared-secret derived key result',
                32,
                32,
              ),
          )
      : undefined,
    hash: (data, algorithm) => {
      const checkedAlgorithm = hashAlgorithm(algorithm);
      return callAfterPreflight(
        () => assertBytes(data, 'hash input', WASM_PLAINTEXT_MAX_BYTES),
        () => raw.hash(data, checkedAlgorithm),
        (value) => validateHashResult(value, checkedAlgorithm),
      );
    },
    hash_with_salt: (data, salt, algorithm) => {
      const checkedAlgorithm = hashAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          const dataLength = assertBytes(
            data,
            'salted hash input',
            WASM_PLAINTEXT_MAX_BYTES,
          );
          const saltLength = assertBytes(
            salt,
            'salted hash salt',
            WASM_RAW_MAX_BYTES,
          );
          if (dataLength > WASM_PLAINTEXT_MAX_BYTES - saltLength - 64) {
            throw new Error('[voided-wasm] salted hash transcript exceeds its size limit');
          }
        },
        () => raw.hash_with_salt(data, salt, checkedAlgorithm),
        (value) => validateHashResult(value, checkedAlgorithm),
      );
    },
    compare_hashes: (a, b) =>
      callAfterPreflight(
        () => {
          assertBytes(a, 'first hash comparison input', 64);
          assertBytes(b, 'second hash comparison input', 64);
        },
        () => raw.compare_hashes(a, b),
        (value) => assertBoolean(value, 'hash comparison result'),
      ),
    generate_hmac: (data, key, algorithm) => {
      const checkedAlgorithm = hashAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          assertBytes(data, 'HMAC input', WASM_PLAINTEXT_MAX_BYTES);
          assertBytes(key, 'HMAC key', WASM_KDF_INPUT_MAX_BYTES, 1);
        },
        () => raw.generate_hmac(data, key, checkedAlgorithm),
        (value) => validateHashResult(value, checkedAlgorithm, 'HMAC result'),
      );
    },
    verify_hmac: (data, hmac, key, algorithm) => {
      const checkedAlgorithm = hashAlgorithm(algorithm);
      return callAfterPreflight(
        () => {
          assertBytes(data, 'HMAC verification input', WASM_PLAINTEXT_MAX_BYTES);
          assertBytes(key, 'HMAC verification key', WASM_KDF_INPUT_MAX_BYTES, 1);
          assertCanonicalLowerHex(
            hmac,
            'expected HMAC',
            checkedAlgorithm === 'sha256' ? 32 : 64,
            checkedAlgorithm === 'sha256' ? 32 : 64,
          );
        },
        () => raw.verify_hmac(data, hmac, key, checkedAlgorithm),
        (value) => assertBoolean(value, 'HMAC verification result'),
      );
    },
    hash_with_pbkdf2: (data, salt, iterations) =>
      callAfterPreflight(
        () => pbkdfParameters(data, salt, iterations),
        () => raw.hash_with_pbkdf2(data, salt, iterations),
        (value) => {
          assertCanonicalLowerHex(value, 'PBKDF2 hash result', 32, 32);
          return value;
        },
      ),
    verify_pbkdf2: (data, expectedHash, salt, iterations) =>
      callAfterPreflight(
        () => {
          pbkdfParameters(data, salt, iterations);
          assertCanonicalLowerHex(expectedHash, 'expected PBKDF2 hash', 32, 32);
        },
        () => raw.verify_pbkdf2(data, expectedHash, salt, iterations),
        (value) => assertBoolean(value, 'PBKDF2 verification result'),
      ),
    generate_fingerprint: (data, length) => {
      const checkedLength = assertSafeInteger(
        length ?? 8,
        'fingerprint length',
        1,
        32,
      );
      return callAfterPreflight(
        () =>
          assertBytes(data, 'fingerprint input', WASM_PLAINTEXT_MAX_BYTES),
        () => raw.generate_fingerprint(data, checkedLength),
        (value) => {
          assertCanonicalLowerHex(
            value,
            'fingerprint result',
            checkedLength,
            checkedLength,
          );
          return value;
        },
      );
    },
    generate_safety_numbers: (data, groupSize) => {
      const checkedGroupSize = assertSafeInteger(
        groupSize ?? 5,
        'safety-number group size',
        1,
        32,
      );
      return callAfterPreflight(
        () =>
          assertBytes(data, 'safety-number input', WASM_PLAINTEXT_MAX_BYTES),
        () => raw.generate_safety_numbers(data, checkedGroupSize),
        (value) =>
          assertBoundedString(value, 'safety-number result', 160),
      );
    },
    generate_salt: (length) => {
      const checkedLength = assertSafeInteger(
        length ?? 32,
        'salt length',
        16,
        1024,
      );
      return callAfterPreflight(
        () => undefined,
        () => raw.generate_salt(checkedLength),
        (value) =>
          validateBytesResult(
            value,
            'generated salt result',
            checkedLength,
            checkedLength,
          ),
      );
    },
    compress: (data, algorithm, level) => {
      const checkedAlgorithm = compressionAlgorithm(algorithm);
      const checkedLevel = compressionLevel(checkedAlgorithm, level);
      let inputLength = 0;
      return callAfterPreflight(
        () => {
          inputLength = assertBytes(
            data,
            'compression input',
            WASM_PLAINTEXT_MAX_BYTES,
          );
        },
        () => raw.compress(data, checkedAlgorithm, checkedLevel),
        (value) =>
          validateCompressionResult(
            value,
            inputLength,
            checkedAlgorithm,
          ),
      );
    },
    decompress: (data, algorithm) => {
      if (typeof algorithm !== 'string') {
        throw new Error('[voided-wasm] compression algorithm is required');
      }
      const checkedAlgorithm = compressionAlgorithm(algorithm);
      return callAfterPreflight(
        () =>
          assertBytes(
            data,
            'compressed input',
            WASM_PLAINTEXT_MAX_BYTES,
          ),
        () => raw.decompress(data, checkedAlgorithm),
        (value) =>
          validateBytesResult(
            value,
            'decompressed output',
            WASM_PLAINTEXT_MAX_BYTES,
          ),
      );
    },
    decompress_bounded: (data, algorithm, maxOutputBytes) => {
      if (typeof algorithm !== 'string') {
        throw new Error('[voided-wasm] compression algorithm is required');
      }
      const checkedAlgorithm = compressionAlgorithm(algorithm);
      let checkedMaxOutputBytes = 0;
      return callAfterPreflight(
        () => {
          assertBytes(
            data,
            'bounded compressed input',
            WASM_BOUNDED_DECOMPRESSION_MAX_BYTES,
          );
          checkedMaxOutputBytes = assertSafeInteger(
            maxOutputBytes,
            'bounded decompression output limit',
            0,
            WASM_BOUNDED_DECOMPRESSION_MAX_BYTES,
          );
        },
        () =>
          raw.decompress_bounded(
            data,
            checkedAlgorithm,
            checkedMaxOutputBytes,
          ),
        (value) =>
          validateBytesResult(
            value,
            'bounded decompressed output',
            checkedMaxOutputBytes,
          ),
      );
    },
    fuse: (data, key, preset, chunkSize) => {
      const checkedPreset = fusedPreset(preset);
      const checkedChunkSize = optionalChunkSize(chunkSize);
      return callAfterPreflight(
        () => {
          assertBytes(data, 'fused shell plaintext', WASM_PLAINTEXT_MAX_BYTES);
          assertExactBytes(key, 'fused shell key', 32);
        },
        () => raw.fuse(data, key, checkedPreset, checkedChunkSize),
        (value) =>
          validateBytesResult(
            value,
            'fused shell result',
            WASM_ARTIFACT_MAX_BYTES,
          ),
      );
    },
    unfuse: (data, key) =>
      callAfterPreflight(
        () => {
          assertBytes(data, 'fused shell input', WASM_ARTIFACT_MAX_BYTES);
          assertExactBytes(key, 'fused shell key', 32);
          inspectFused(data);
        },
        () => raw.unfuse(data, key),
        (value) =>
          validateBytesResult(
            value,
            'unfused plaintext',
            WASM_PLAINTEXT_MAX_BYTES,
          ),
      ),
    inspectFused,
    protect: (
      data,
      key,
      preset,
      compression,
      level,
      encryption,
      shellChunkSize,
    ) => {
      const expected = validateProtectOptions(
        preset,
        compression,
        level,
        encryption,
        shellChunkSize,
      );
      let inputLength = 0;
      return callAfterPreflight(
        () => {
          inputLength = assertBytes(
            data,
            'protect plaintext',
            WASM_PLAINTEXT_MAX_BYTES,
          );
          assertExactBytes(key, 'protect key', 32);
        },
        () =>
          raw.protect(
            data,
            key,
            expected.preset,
            expected.compression,
            level,
            expected.encryption,
            shellChunkSize,
          ),
        (value) =>
          validateReturnedProtectConfiguration(
            validateProtectResult(
              value,
              inputLength,
            ) as ProtectResult,
            expected,
          ),
      );
    },
    open: (artifact, key) =>
      callAfterPreflight(
        () => {
          assertBytes(
            artifact,
            'protected artifact input',
            WASM_ARTIFACT_MAX_BYTES,
          );
          assertExactBytes(key, 'protected artifact key', 32);
          inspectArtifact(artifact);
        },
        () => raw.open(artifact, key),
        (value) =>
          validateBytesResult(
            value,
            'opened artifact plaintext',
            WASM_PLAINTEXT_MAX_BYTES,
          ),
      ),
    inspectArtifact,
    repackArtifact: (
      artifact,
      key,
      preset,
      compression,
      level,
      encryption,
      shellChunkSize,
    ) => {
      const expected = validateProtectOptions(
        preset,
        compression,
        level,
        encryption,
        shellChunkSize,
      );
      let originalSize = 0;
      return callAfterPreflight(
        () => {
          assertBytes(
            artifact,
            'protected artifact input',
            WASM_ARTIFACT_MAX_BYTES,
          );
          assertExactBytes(key, 'protected artifact key', 32);
          originalSize = inspectArtifact(artifact).originalSize;
        },
        () =>
          raw.repackArtifact(
            artifact,
            key,
            expected.preset,
            expected.compression,
            level,
            expected.encryption,
            shellChunkSize,
          ),
        (value) =>
          validateReturnedProtectConfiguration(
            validateProtectResult(value, originalSize) as ProtectResult,
            expected,
          ),
      );
    },
    random_bytes: (length) => {
      const checkedLength = assertSafeInteger(
        length,
        'random byte length',
        1,
        WASM_RAW_MAX_BYTES,
      );
      return callAfterPreflight(
        () => undefined,
        () => raw.random_bytes(checkedLength),
        (value) =>
          validateBytesResult(
            value,
            'random byte result',
            checkedLength,
            checkedLength,
          ),
      );
    },
    base64_encode: (data) => {
      let inputLength = 0;
      return callAfterPreflight(
        () => {
          inputLength = assertBytes(data, 'base64 input', WASM_RAW_MAX_BYTES);
        },
        () => raw.base64_encode(data),
        (value) => {
          assertCanonicalBase64(
            value,
            'base64 result',
            inputLength,
            inputLength,
          );
          return value;
        },
      );
    },
    base64_decode: (encoded) => {
      let decodedLength = 0;
      return callAfterPreflight(
        () => {
          decodedLength = assertCanonicalBase64(
            encoded,
            'base64 input',
            WASM_RAW_MAX_BYTES,
          );
        },
        () => raw.base64_decode(encoded),
        (value) =>
          validateBytesResult(
            value,
            'base64 decoded result',
            decodedLength,
            decodedLength,
          ),
      );
    },
    hex_encode: (data) => {
      let inputLength = 0;
      return callAfterPreflight(
        () => {
          inputLength = assertBytes(data, 'hex input', WASM_RAW_MAX_BYTES);
        },
        () => raw.hex_encode(data),
        (value) => {
          assertCanonicalLowerHex(
            value,
            'hex result',
            inputLength,
            inputLength,
          );
          return value;
        },
      );
    },
    hex_decode: (encoded) => {
      let decodedLength = 0;
      return callAfterPreflight(
        () => {
          decodedLength = assertCanonicalLowerHex(
            encoded,
            'hex input',
            WASM_RAW_MAX_BYTES,
          );
        },
        () => raw.hex_decode(encoded),
        (value) =>
          validateBytesResult(
            value,
            'hex decoded result',
            decodedLength,
            decodedLength,
          ),
      );
    },
  };
}
