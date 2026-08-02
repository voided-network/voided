//! WebAssembly binding for voided-core encryption library.
//!
//! This crate provides wasm-bindgen bindings to expose voided-core's crypto primitives
//! to browser applications via WebAssembly.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

mod browser_limits;
use browser_limits::*;

const MAX_RANDOM_BYTES: u32 = 16 * 1024 * 1024;
const MIN_SALT_BYTES: u32 = 16;
const MAX_SALT_BYTES: u32 = 1024;
const MAX_JS_SAFE_INTEGER: u128 = 9_007_199_254_740_991;

fn serialize_byte_vec<S>(value: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_bytes(value)
}

fn js_error(message: impl AsRef<str>) -> JsValue {
    JsValue::from_str(message.as_ref())
}

fn validate_inspect_size(size: usize) -> Result<(), JsValue> {
    browser_limit(validate_len(
        size,
        0,
        ARTIFACT_MAX_BYTES,
        "keyless inspect input exceeds the browser artifact limit",
    ))
}

fn browser_limit(result: Result<(), &'static str>) -> Result<(), JsValue> {
    result.map_err(js_error)
}

fn bounded_decompression_limit(value: f64) -> Result<usize, &'static str> {
    if !value.is_finite()
        || value < 0.0
        || value.fract() != 0.0
        || value > voided_core::compression::MAX_DECOMPRESSED_SIZE as f64
    {
        return Err("bounded decompression output limit must be an integer from 0 to 536870912");
    }
    Ok(value as usize)
}

fn browser_output(output: Vec<u8>, max: usize, label: &'static str) -> Result<Vec<u8>, JsValue> {
    browser_limit(validate_len(output.len(), 0, max, label))?;
    Ok(output)
}

fn validate_key(key: &[u8]) -> Result<(), JsValue> {
    browser_limit(validate_exact_len(
        key.len(),
        32,
        "encryption key must contain exactly 32 bytes",
    ))
}

fn inspect_current_artifact_for_browser(
    artifact: &[u8],
) -> Result<voided_core::shell::ProtectedArtifactInfo, JsValue> {
    validate_inspect_size(artifact.len())?;
    let info =
        voided_core::shell::inspect_artifact(artifact).map_err(|e| js_error(e.to_string()))?;
    browser_limit(validate_artifact_info(&info, artifact.len()))?;
    Ok(info)
}

fn inspect_rotation_artifact_for_browser(
    artifact: &[u8],
) -> Result<voided_core::shell::ProtectedArtifactInfo, JsValue> {
    validate_inspect_size(artifact.len())?;
    let info = voided_core::shell::inspect_rotation_artifact(artifact)
        .map_err(|e| js_error(e.to_string()))?;
    browser_limit(validate_artifact_info(&info, artifact.len()))?;
    Ok(info)
}

fn js_safe_number(name: &str, value: usize) -> Result<f64, JsValue> {
    if value as u128 > MAX_JS_SAFE_INTEGER {
        return Err(js_error(format!(
            "{name} exceeds JavaScript's safe integer limit"
        )));
    }
    Ok(value as f64)
}

fn parse_hash_algorithm(value: Option<&str>) -> Result<voided_core::hash::HashAlgorithm, JsValue> {
    match value.unwrap_or("sha256") {
        "sha256" => Ok(voided_core::hash::HashAlgorithm::Sha256),
        "sha512" => Ok(voided_core::hash::HashAlgorithm::Sha512),
        _ => Err(js_error("unsupported hash algorithm")),
    }
}

fn parse_compression_name(
    value: Option<&str>,
) -> Result<voided_core::compression::CompressionAlgorithm, JsValue> {
    match value.unwrap_or("brotli") {
        "none" => Ok(voided_core::compression::CompressionAlgorithm::None),
        "gzip" => Ok(voided_core::compression::CompressionAlgorithm::Gzip),
        "brotli" => Ok(voided_core::compression::CompressionAlgorithm::Brotli),
        _ => Err(js_error("unsupported compression algorithm")),
    }
}

fn validate_compression_level(
    algorithm: voided_core::compression::CompressionAlgorithm,
    level: u32,
) -> Result<(), JsValue> {
    let valid = match algorithm {
        voided_core::compression::CompressionAlgorithm::None => level == 0 || level == 6,
        voided_core::compression::CompressionAlgorithm::Gzip => level <= 9,
        voided_core::compression::CompressionAlgorithm::Brotli => level <= 11,
    };
    if valid {
        Ok(())
    } else {
        Err(js_error(format!(
            "invalid compression level {level} for {}",
            algorithm.name()
        )))
    }
}

// Initialize panic hook for better error messages in debug
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Library version
#[wasm_bindgen]
pub fn version() -> String {
    voided_core::VERSION.to_string()
}

// ============================================================================
// Encryption
// ============================================================================

/// Result of an encryption operation
#[derive(Clone, Serialize, Deserialize)]
pub struct EncryptionResult {
    pub ciphertext: String,
    pub algorithm: String,
    pub nonce: String,
    pub tag: String,
}

/// X25519 key pair for key exchange operations.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct X25519KeyPair {
    #[serde(serialize_with = "serialize_byte_vec")]
    pub public_key: Vec<u8>,
    #[serde(serialize_with = "serialize_byte_vec")]
    pub private_key: Vec<u8>,
}

/// Generate a random 256-bit encryption key (returns Uint8Array)
#[wasm_bindgen(js_name = generateKey)]
pub fn generate_key() -> Vec<u8> {
    let key = voided_core::encryption::generate_key();
    key.as_bytes().to_vec()
}

/// Encrypt data using XChaCha20-Poly1305 by default or explicit AES-256-GCM.
#[wasm_bindgen]
pub fn encrypt(data: &[u8], key: &[u8], algorithm: Option<String>) -> Result<JsValue, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "encryption input exceeds the browser plaintext limit",
    ))?;
    validate_key(key)?;
    let core_key = voided_core::encryption::Key::from_bytes(key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let algorithm = parse_authenticated_algorithm(algorithm.as_deref())?;
    let opts = voided_core::encryption::EncryptOptions {
        algorithm: Some(algorithm),
        aad: None,
    };

    let result = voided_core::encryption::encrypt(data, &core_key, Some(opts))
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    use base64::{engine::general_purpose::STANDARD, Engine};

    let js_result = EncryptionResult {
        ciphertext: STANDARD.encode(&result.ciphertext),
        algorithm: result.algorithm.name().to_string(),
        nonce: STANDARD.encode(&result.nonce),
        tag: STANDARD.encode(&result.tag),
    };

    serde_wasm_bindgen::to_value(&js_result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Encrypt bytes while authenticating caller-supplied context without storing it in ciphertext.
#[wasm_bindgen(js_name = encryptWithAad)]
pub fn encrypt_with_aad(
    data: &[u8],
    key: &[u8],
    aad: &[u8],
    algorithm: Option<String>,
) -> Result<JsValue, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "authenticated encryption input exceeds the browser plaintext limit",
    ))?;
    browser_limit(validate_len(
        aad.len(),
        0,
        RAW_MAX_BYTES,
        "authenticated additional data exceeds the browser raw-input limit",
    ))?;
    let algorithm = parse_authenticated_algorithm(algorithm.as_deref())?;
    let algorithm_overhead = match algorithm {
        voided_core::encryption::Algorithm::XChaCha20Poly1305 => 24 + 16,
        voided_core::encryption::Algorithm::Aes256Gcm => 12 + 16,
    };
    browser_limit(validate_aggregate_len(
        &[data.len(), aad.len(), algorithm_overhead],
        PLAINTEXT_MAX_BYTES,
        "authenticated encryption working set exceeds the browser plaintext limit",
    ))?;
    validate_key(key)?;
    let core_key = voided_core::encryption::Key::from_bytes(key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = voided_core::encryption::encrypt(
        data,
        &core_key,
        Some(voided_core::encryption::EncryptOptions {
            algorithm: Some(algorithm),
            aad: Some(aad.to_vec()),
        }),
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))?;
    encryption_result_to_js(result)
}

/// Decrypt data
#[wasm_bindgen]
pub fn decrypt(encrypted: JsValue, key: &[u8]) -> Result<Vec<u8>, JsValue> {
    validate_key(key)?;
    let core_key = voided_core::encryption::Key::from_bytes(key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let core_result = encryption_result_from_js(encrypted)?;
    let plaintext = voided_core::encryption::decrypt(&core_result, &core_key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    browser_output(
        plaintext,
        PLAINTEXT_MAX_BYTES,
        "decrypted plaintext exceeds the browser limit",
    )
}

/// Decrypt bytes only when the caller supplies the exact authenticated context.
#[wasm_bindgen(js_name = decryptWithAad)]
pub fn decrypt_with_aad(encrypted: JsValue, key: &[u8], aad: &[u8]) -> Result<Vec<u8>, JsValue> {
    validate_key(key)?;
    browser_limit(validate_len(
        aad.len(),
        0,
        RAW_MAX_BYTES,
        "authenticated additional data exceeds the browser raw-input limit",
    ))?;
    let core_key = voided_core::encryption::Key::from_bytes(key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let core_result = encryption_result_from_js(encrypted)?;
    browser_limit(validate_aggregate_len(
        &[
            core_result.ciphertext.len(),
            aad.len(),
            core_result.nonce.len(),
            core_result.tag.len(),
        ],
        PLAINTEXT_MAX_BYTES,
        "authenticated decryption working set exceeds the browser plaintext limit",
    ))?;
    let plaintext = voided_core::encryption::decrypt_with_aad(&core_result, &core_key, aad)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    browser_output(
        plaintext,
        PLAINTEXT_MAX_BYTES,
        "authenticated decrypted plaintext exceeds the browser limit",
    )
}

fn parse_authenticated_algorithm(
    algorithm: Option<&str>,
) -> Result<voided_core::encryption::Algorithm, JsValue> {
    match algorithm.unwrap_or("xchacha20-poly1305") {
        "xchacha20-poly1305" => Ok(voided_core::encryption::Algorithm::XChaCha20Poly1305),
        "aes-256-gcm" => Ok(voided_core::encryption::Algorithm::Aes256Gcm),
        _ => Err(js_error("unsupported authenticated encryption algorithm")),
    }
}

fn encryption_result_to_js(
    result: voided_core::encryption::EncryptionResult,
) -> Result<JsValue, JsValue> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    serde_wasm_bindgen::to_value(&EncryptionResult {
        ciphertext: STANDARD.encode(&result.ciphertext),
        algorithm: result.algorithm.name().to_string(),
        nonce: STANDARD.encode(&result.nonce),
        tag: STANDARD.encode(&result.tag),
    })
    .map_err(|e| JsValue::from_str(&e.to_string()))
}

fn encryption_result_from_js(
    encrypted: JsValue,
) -> Result<voided_core::encryption::EncryptionResult, JsValue> {
    let encrypted: EncryptionResult =
        serde_wasm_bindgen::from_value(encrypted).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let algorithm = parse_authenticated_algorithm(Some(&encrypted.algorithm))?;
    let nonce_len = match algorithm {
        voided_core::encryption::Algorithm::XChaCha20Poly1305 => 24,
        voided_core::encryption::Algorithm::Aes256Gcm => 12,
    };
    Ok(voided_core::encryption::EncryptionResult {
        ciphertext: decode_canonical_base64(
            &encrypted.ciphertext,
            PLAINTEXT_MAX_BYTES,
            "ciphertext must be canonical base64 within the browser limit",
        )
        .map_err(js_error)?,
        algorithm,
        nonce: decode_canonical_base64_exact(
            &encrypted.nonce,
            nonce_len,
            "nonce must be canonical base64 with the exact algorithm length",
        )
        .map_err(js_error)?,
        tag: decode_canonical_base64_exact(
            &encrypted.tag,
            16,
            "authentication tag must be canonical base64 with exactly 16 bytes",
        )
        .map_err(js_error)?,
    })
}

/// Derive a key using HKDF-SHA256
#[wasm_bindgen(js_name = deriveKeyHkdf)]
pub fn derive_key_hkdf(
    input_key_material: &[u8],
    salt: Option<Vec<u8>>,
    info: &[u8],
) -> Result<Vec<u8>, JsValue> {
    browser_limit(validate_len(
        input_key_material.len(),
        1,
        KDF_INPUT_MAX_BYTES,
        "HKDF input key material exceeds its browser limit",
    ))?;
    if let Some(salt) = salt.as_deref() {
        browser_limit(validate_len(
            salt.len(),
            0,
            KDF_INPUT_MAX_BYTES,
            "HKDF salt exceeds its browser limit",
        ))?;
    }
    browser_limit(validate_len(
        info.len(),
        0,
        KDF_INPUT_MAX_BYTES,
        "HKDF info exceeds its browser limit",
    ))?;
    let salt_ref = salt.as_deref();

    let key = voided_core::encryption::derive_key_hkdf(input_key_material, salt_ref, info)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    browser_output(
        key.as_bytes().to_vec(),
        32,
        "HKDF returned an invalid key length",
    )
}

/// Derive raw key material using HKDF-SHA256.
#[wasm_bindgen(js_name = deriveKeyHkdfRaw)]
pub fn derive_key_hkdf_raw(
    input_key_material: &[u8],
    salt: Option<Vec<u8>>,
    info: &[u8],
    length: u32,
) -> Result<Vec<u8>, JsValue> {
    browser_limit(validate_len(
        input_key_material.len(),
        1,
        KDF_INPUT_MAX_BYTES,
        "HKDF input key material exceeds its browser limit",
    ))?;
    if let Some(salt) = salt.as_deref() {
        browser_limit(validate_len(
            salt.len(),
            0,
            KDF_INPUT_MAX_BYTES,
            "HKDF salt exceeds its browser limit",
        ))?;
    }
    browser_limit(validate_len(
        info.len(),
        0,
        KDF_INPUT_MAX_BYTES,
        "HKDF info exceeds its browser limit",
    ))?;
    browser_limit(validate_len(
        length as usize,
        1,
        HKDF_MAX_OUTPUT_BYTES,
        "HKDF output length exceeds the SHA-256 limit",
    ))?;
    let salt_ref = salt.as_deref();

    let output = voided_core::encryption::derive_key_hkdf_raw(
        input_key_material,
        salt_ref,
        info,
        length as usize,
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))?;
    browser_limit(validate_exact_len(
        output.len(),
        length as usize,
        "HKDF returned an invalid output length",
    ))?;
    Ok(output)
}

/// Derive a key using PBKDF2-HMAC-SHA256
#[wasm_bindgen(js_name = deriveKeyPbkdf2)]
pub fn derive_key_pbkdf2(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
) -> Result<Vec<u8>, JsValue> {
    browser_limit(validate_len(
        password.len(),
        1,
        KDF_INPUT_MAX_BYTES,
        "PBKDF2 input exceeds its browser limit",
    ))?;
    browser_limit(validate_len(
        salt.len(),
        MIN_SALT_BYTES as usize,
        MAX_SALT_BYTES as usize,
        "PBKDF2 salt length is invalid",
    ))?;
    let key = voided_core::encryption::derive_key_pbkdf2(password, salt, iterations)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    browser_output(
        key.as_bytes().to_vec(),
        32,
        "PBKDF2 returned an invalid key length",
    )
}

/// Generate X25519 key pair (deterministic if seed provided).
#[wasm_bindgen(js_name = generateX25519KeyPair)]
pub fn generate_x25519_key_pair(mut seed: Option<Vec<u8>>) -> Result<JsValue, JsValue> {
    if let Some(seed) = seed.as_deref() {
        browser_limit(validate_exact_len(
            seed.len(),
            32,
            "X25519 seed must contain exactly 32 bytes",
        ))?;
    }
    let pair_result = voided_core::encryption::generate_x25519_key_pair(seed.as_deref());
    if let Some(seed) = seed.as_mut() {
        seed.fill(0);
    }
    let pair = pair_result.map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut js_pair = X25519KeyPair {
        public_key: pair.public_key.to_vec(),
        private_key: pair.private_key.to_vec(),
    };

    let serialized =
        serde_wasm_bindgen::to_value(&js_pair).map_err(|e| JsValue::from_str(&e.to_string()));
    js_pair.private_key.fill(0);
    serialized
}

/// Compute X25519 shared secret.
#[wasm_bindgen(js_name = x25519SharedSecret)]
pub fn x25519_shared_secret(
    our_private_key: &[u8],
    their_public_key: &[u8],
) -> Result<Vec<u8>, JsValue> {
    browser_limit(validate_exact_len(
        our_private_key.len(),
        32,
        "X25519 private key must contain exactly 32 bytes",
    ))?;
    browser_limit(validate_exact_len(
        their_public_key.len(),
        32,
        "X25519 public key must contain exactly 32 bytes",
    ))?;
    let mut shared =
        voided_core::encryption::x25519_shared_secret(our_private_key, their_public_key)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let output = shared.to_vec();
    shared.fill(0);

    Ok(output)
}

/// Derive AES key bytes from DH shared secret using HKDF.
#[wasm_bindgen(js_name = deriveKeyFromSharedSecret)]
pub fn derive_key_from_shared_secret(
    shared_secret: &[u8],
    salt: &str,
    info: &str,
) -> Result<Vec<u8>, JsValue> {
    browser_limit(validate_exact_len(
        shared_secret.len(),
        32,
        "X25519 shared secret must contain exactly 32 bytes",
    ))?;
    browser_limit(validate_context(
        salt,
        "shared-secret salt context must contain 1 to 1024 UTF-8 bytes",
    ))?;
    browser_limit(validate_context(
        info,
        "shared-secret info context must contain 1 to 1024 UTF-8 bytes",
    ))?;
    let key = voided_core::encryption::derive_key_from_shared_secret(shared_secret, salt, info)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    browser_output(
        key.as_bytes().to_vec(),
        32,
        "shared-secret derivation returned an invalid key length",
    )
}

// ============================================================================
// Hashing
// ============================================================================

/// Generate a SHA-256 or SHA-512 hash
#[wasm_bindgen]
pub fn hash(data: &[u8], algorithm: Option<String>) -> Result<String, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "hash input exceeds the browser plaintext limit",
    ))?;
    Ok(voided_core::hash::hash_hex(
        data,
        parse_hash_algorithm(algorithm.as_deref())?,
    ))
}

/// Generate a salted hash
#[wasm_bindgen(js_name = hashWithSalt)]
pub fn hash_with_salt(
    data: &[u8],
    salt: &[u8],
    algorithm: Option<String>,
) -> Result<String, JsValue> {
    browser_limit(validate_len(
        salt.len(),
        0,
        RAW_MAX_BYTES,
        "salted-hash salt exceeds the browser raw-input limit",
    ))?;
    browser_limit(validate_aggregate_len(
        &[data.len(), salt.len(), SALTED_HASH_TRANSCRIPT_RESERVE_BYTES],
        PLAINTEXT_MAX_BYTES,
        "salted-hash transcript exceeds the browser plaintext limit",
    ))?;
    Ok(voided_core::hash::hash_with_salt_hex(
        data,
        salt,
        parse_hash_algorithm(algorithm.as_deref())?,
    ))
}

/// Compare hashes in constant time
#[wasm_bindgen(js_name = compareHashes)]
pub fn compare_hashes(a: &[u8], b: &[u8]) -> Result<bool, JsValue> {
    browser_limit(validate_len(
        a.len(),
        0,
        64,
        "first hash comparison input exceeds the digest limit",
    ))?;
    browser_limit(validate_len(
        b.len(),
        0,
        64,
        "second hash comparison input exceeds the digest limit",
    ))?;
    Ok(voided_core::hash::compare_hashes(a, b))
}

/// Generate HMAC
#[wasm_bindgen(js_name = generateHmac)]
pub fn generate_hmac(
    data: &[u8],
    key: &[u8],
    algorithm: Option<String>,
) -> Result<String, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "HMAC input exceeds the browser plaintext limit",
    ))?;
    browser_limit(validate_len(
        key.len(),
        1,
        KDF_INPUT_MAX_BYTES,
        "HMAC key exceeds its browser limit",
    ))?;
    let algo = parse_hash_algorithm(algorithm.as_deref())?;

    voided_core::hash::generate_hmac_hex(data, key, algo)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Verify HMAC
#[wasm_bindgen(js_name = verifyHmac)]
pub fn verify_hmac(
    data: &[u8],
    hmac: &str,
    key: &[u8],
    algorithm: Option<String>,
) -> Result<bool, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "HMAC verification input exceeds the browser plaintext limit",
    ))?;
    browser_limit(validate_len(
        key.len(),
        1,
        KDF_INPUT_MAX_BYTES,
        "HMAC verification key exceeds its browser limit",
    ))?;
    let algo = parse_hash_algorithm(algorithm.as_deref())?;
    let expected_len = match algo {
        voided_core::hash::HashAlgorithm::Sha256 => 32,
        voided_core::hash::HashAlgorithm::Sha512 => 64,
    };
    let hmac_bytes = decode_canonical_lower_hex(
        hmac,
        expected_len,
        Some(expected_len),
        "expected HMAC must be canonical lowercase hexadecimal with the exact digest length",
    )
    .map_err(js_error)?;

    voided_core::hash::verify_hmac(data, &hmac_bytes, key, algo)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Hash with PBKDF2 (high iterations)
#[wasm_bindgen(js_name = hashWithPbkdf2)]
pub fn hash_with_pbkdf2(data: &[u8], salt: &[u8], iterations: u32) -> Result<String, JsValue> {
    browser_limit(validate_len(
        data.len(),
        1,
        KDF_INPUT_MAX_BYTES,
        "PBKDF2 input exceeds its browser limit",
    ))?;
    browser_limit(validate_len(
        salt.len(),
        MIN_SALT_BYTES as usize,
        MAX_SALT_BYTES as usize,
        "PBKDF2 salt length is invalid",
    ))?;
    let hash = voided_core::hash::hash_with_pbkdf2(data, salt, iterations)
        .map_err(|e| js_error(e.to_string()))?;
    Ok(hex::encode(hash))
}

/// Verify PBKDF2 hash
#[wasm_bindgen(js_name = verifyPbkdf2)]
pub fn verify_pbkdf2(
    data: &[u8],
    expected_hash: &str,
    salt: &[u8],
    iterations: u32,
) -> Result<bool, JsValue> {
    browser_limit(validate_len(
        data.len(),
        1,
        KDF_INPUT_MAX_BYTES,
        "PBKDF2 input exceeds its browser limit",
    ))?;
    browser_limit(validate_len(
        salt.len(),
        MIN_SALT_BYTES as usize,
        MAX_SALT_BYTES as usize,
        "PBKDF2 salt length is invalid",
    ))?;
    let expected_bytes = decode_canonical_lower_hex(
        expected_hash,
        32,
        Some(32),
        "expected PBKDF2 hash must be canonical lowercase hexadecimal with 32 bytes",
    )
    .map_err(js_error)?;

    voided_core::hash::verify_pbkdf2(data, &expected_bytes, salt, iterations)
        .map_err(|e| js_error(e.to_string()))
}

/// Generate fingerprint
#[wasm_bindgen(js_name = generateFingerprint)]
pub fn generate_fingerprint(data: &[u8], length: Option<u32>) -> Result<String, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "fingerprint input exceeds the browser plaintext limit",
    ))?;
    let length = length.unwrap_or(8);
    if !(1..=voided_core::hash::MAX_FINGERPRINT_BYTES as u32).contains(&length) {
        return Err(js_error(
            "fingerprint length must be between 1 and 32 bytes",
        ));
    }
    Ok(voided_core::hash::generate_fingerprint(
        data,
        length as usize,
    ))
}

/// Format a SHA-256 fingerprint for human comparison (not Signal's protocol).
#[wasm_bindgen(js_name = generateSafetyNumbers)]
pub fn generate_safety_numbers(data: &[u8], group_size: Option<u32>) -> Result<String, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "safety-number input exceeds the browser plaintext limit",
    ))?;
    voided_core::hash::generate_safety_numbers(data, group_size.unwrap_or(5) as usize)
        .map_err(|e| js_error(e.to_string()))
}

/// Generate random salt
#[wasm_bindgen(js_name = generateSalt)]
pub fn generate_salt(length: Option<u32>) -> Result<Vec<u8>, JsValue> {
    let length = length.unwrap_or(32);
    if !(MIN_SALT_BYTES..=MAX_SALT_BYTES).contains(&length) {
        return Err(js_error(format!(
            "salt length must be between {MIN_SALT_BYTES} and {MAX_SALT_BYTES} bytes"
        )));
    }
    Ok(voided_core::hash::generate_salt(length as usize))
}

// ============================================================================
// Compression
// ============================================================================

/// Compression result
#[derive(Clone, Serialize, Deserialize)]
pub struct CompressionResult {
    #[serde(serialize_with = "serialize_byte_vec")]
    pub compressed: Vec<u8>,
    pub algorithm: String,
    pub original_size: f64,
    pub compressed_size: f64,
    pub compression_ratio: f64,
}

/// Fused shell metadata
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FusedShellInfo {
    pub version: u32,
    pub preset: String,
    pub chunk_size: u32,
    pub chunk_count: f64,
    pub payload_size: f64,
    pub shell_size: f64,
    pub metadata_size: f64,
    pub tag_size: f64,
}

/// Protected artifact metadata
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedArtifactInfo {
    pub version: u32,
    pub preset: String,
    pub compression_algorithm: String,
    pub encryption_algorithm: String,
    pub original_size: f64,
    pub compressed_size: f64,
    pub encrypted_size: f64,
    pub protected_size: f64,
    pub shell_chunk_size: u32,
    pub shell_chunk_count: f64,
    #[serde(serialize_with = "serialize_byte_vec")]
    pub shell_nonce: Vec<u8>,
}

/// Result of protect/repack operations.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectResult {
    #[serde(serialize_with = "serialize_byte_vec")]
    pub artifact: Vec<u8>,
    pub version: u32,
    pub preset: String,
    pub compression_algorithm: String,
    pub encryption_algorithm: String,
    pub original_size: f64,
    pub compressed_size: f64,
    pub encrypted_size: f64,
    pub protected_size: f64,
    pub shell_chunk_size: u32,
    pub shell_chunk_count: f64,
    #[serde(serialize_with = "serialize_byte_vec")]
    pub shell_nonce: Vec<u8>,
}

/// Compress data
#[wasm_bindgen]
pub fn compress(
    data: &[u8],
    algorithm: Option<String>,
    level: Option<u32>,
) -> Result<JsValue, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "compression input exceeds the browser plaintext limit",
    ))?;
    let algo = parse_compression_name(algorithm.as_deref())?;
    let level = level.unwrap_or(6);
    validate_compression_level(algo, level)?;

    let opts = voided_core::compression::CompressionOptions {
        algorithm: algo,
        min_size_threshold: 100,
        level,
    };

    let result = voided_core::compression::compress(data, Some(opts))
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    browser_limit(validate_len(
        result.compressed.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "compressed output exceeds the browser plaintext limit",
    ))?;

    let js_result = CompressionResult {
        compressed: result.compressed,
        algorithm: result.algorithm.name().to_string(),
        original_size: result.original_size as f64,
        compressed_size: result.compressed_size as f64,
        compression_ratio: result.compression_ratio,
    };

    serde_wasm_bindgen::to_value(&js_result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Decompress data
#[wasm_bindgen]
pub fn decompress(data: &[u8], algorithm: &str) -> Result<Vec<u8>, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "compressed input exceeds the browser plaintext limit",
    ))?;
    let algo = parse_compression_name(Some(algorithm))?;

    decompress_with_browser_limit(data, algo, PLAINTEXT_MAX_BYTES)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Decompress with a caller-selected absolute output ceiling.
///
/// This explicit path does not apply the legacy expansion-ratio heuristic.
/// The output ceiling is still constrained by voided-core's 512 MiB global
/// in-memory decompression limit.
#[wasm_bindgen(js_name = decompressBounded)]
pub fn decompress_bounded(
    data: &[u8],
    algorithm: &str,
    max_output_size: f64,
) -> Result<Vec<u8>, JsValue> {
    let max_output_size = bounded_decompression_limit(max_output_size).map_err(js_error)?;
    browser_limit(validate_len(
        data.len(),
        0,
        voided_core::compression::MAX_DECOMPRESSED_SIZE,
        "bounded decompression input exceeds the global in-memory limit",
    ))?;
    let algo = parse_compression_name(Some(algorithm))?;

    voided_core::compression::decompress_bounded(data, algo, max_output_size)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

fn decompress_with_browser_limit(
    data: &[u8],
    algorithm: voided_core::compression::CompressionAlgorithm,
    max_output_size: usize,
) -> voided_core::Result<Vec<u8>> {
    voided_core::compression::decompress_with_limits(
        data,
        algorithm,
        max_output_size,
        voided_core::compression::MAX_COMPRESSION_RATIO,
    )
}

// ============================================================================
// Fused shell / full-flow
// ============================================================================

fn parse_key(key: &[u8]) -> Result<voided_core::encryption::Key, JsValue> {
    validate_key(key)?;
    voided_core::encryption::Key::from_bytes(key).map_err(|e| JsValue::from_str(&e.to_string()))
}

fn parse_preset(preset: Option<String>) -> Result<voided_core::shell::FusedPreset, JsValue> {
    preset
        .as_deref()
        .map(voided_core::shell::FusedPreset::from_name)
        .transpose()
        .map_err(|e| JsValue::from_str(&e.to_string()))
        .map(|preset| preset.unwrap_or_default())
}

fn parse_encryption_algorithm(
    algorithm: Option<String>,
) -> Result<Option<voided_core::encryption::Algorithm>, JsValue> {
    algorithm
        .as_deref()
        .map(|value| parse_authenticated_algorithm(Some(value)))
        .transpose()
}

fn parse_compression_algorithm(
    algorithm: Option<String>,
) -> Result<voided_core::compression::CompressionAlgorithm, JsValue> {
    parse_compression_name(algorithm.as_deref())
}

fn shell_info_from_core(
    info: voided_core::shell::FusedShellInfo,
) -> Result<FusedShellInfo, JsValue> {
    Ok(FusedShellInfo {
        version: info.version as u32,
        preset: info.preset_label,
        chunk_size: info.chunk_size,
        chunk_count: js_safe_number("chunk count", info.chunk_count)?,
        payload_size: js_safe_number("payload size", info.payload_size)?,
        shell_size: js_safe_number("shell size", info.shell_size)?,
        metadata_size: js_safe_number("metadata size", info.metadata_size)?,
        tag_size: js_safe_number("tag size", info.tag_size)?,
    })
}

fn artifact_info_from_core(
    info: voided_core::shell::ProtectedArtifactInfo,
) -> Result<ProtectedArtifactInfo, JsValue> {
    Ok(ProtectedArtifactInfo {
        version: info.version as u32,
        preset: info.preset_label,
        compression_algorithm: info.compression_algorithm.name().to_string(),
        encryption_algorithm: info.encryption_algorithm.name().to_string(),
        original_size: js_safe_number("original size", info.original_size)?,
        compressed_size: js_safe_number("compressed size", info.compressed_size)?,
        encrypted_size: js_safe_number("encrypted size", info.encrypted_size)?,
        protected_size: js_safe_number("protected size", info.protected_size)?,
        shell_chunk_size: info.shell_chunk_size,
        shell_chunk_count: js_safe_number("shell chunk count", info.shell_chunk_count)?,
        shell_nonce: info.shell_nonce.to_vec(),
    })
}

fn protect_result_from_core(
    result: voided_core::shell::ProtectResult,
) -> Result<ProtectResult, JsValue> {
    browser_limit(validate_artifact_info(&result.info, result.artifact.len()))?;
    Ok(ProtectResult {
        artifact: result.artifact,
        version: result.info.version as u32,
        preset: result.info.preset_label,
        compression_algorithm: result.info.compression_algorithm.name().to_string(),
        encryption_algorithm: result.info.encryption_algorithm.name().to_string(),
        original_size: js_safe_number("original size", result.info.original_size)?,
        compressed_size: js_safe_number("compressed size", result.info.compressed_size)?,
        encrypted_size: js_safe_number("encrypted size", result.info.encrypted_size)?,
        protected_size: js_safe_number("protected size", result.info.protected_size)?,
        shell_chunk_size: result.info.shell_chunk_size,
        shell_chunk_count: js_safe_number("shell chunk count", result.info.shell_chunk_count)?,
        shell_nonce: result.info.shell_nonce.to_vec(),
    })
}

/// Fuse arbitrary bytes with the fused shell primitive.
#[wasm_bindgen]
pub fn fuse(
    data: &[u8],
    key: &[u8],
    preset: Option<String>,
    chunk_size: Option<u32>,
) -> Result<Vec<u8>, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "fused shell plaintext exceeds the browser limit",
    ))?;
    if let Some(chunk_size) = chunk_size {
        browser_limit(validate_len(
            chunk_size as usize,
            1,
            CHUNK_MAX_BYTES,
            "fused shell chunk size is invalid",
        ))?;
    }
    let key = parse_key(key)?;
    let preset = parse_preset(preset)?;

    let output = voided_core::shell::fuse_bytes(
        data,
        &key,
        Some(voided_core::shell::FusedShellOptions {
            preset,
            chunk_size: chunk_size.map(|size| size as usize),
            shell_nonce: None,
        }),
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))?;
    browser_output(
        output,
        ARTIFACT_MAX_BYTES,
        "fused shell output exceeds the browser artifact limit",
    )
}

/// Reverse the fused shell primitive.
#[wasm_bindgen]
pub fn unfuse(data: &[u8], key: &[u8]) -> Result<Vec<u8>, JsValue> {
    validate_inspect_size(data.len())?;
    let info = voided_core::shell::inspect_fused(data).map_err(|e| js_error(e.to_string()))?;
    browser_limit(validate_fused_info(&info, data.len()))?;
    let key = parse_key(key)?;
    let plaintext = voided_core::shell::unfuse_bytes(data, &key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    browser_output(
        plaintext,
        PLAINTEXT_MAX_BYTES,
        "unfused plaintext exceeds the browser limit",
    )
}

/// Inspect a fused shell envelope without a key.
#[wasm_bindgen(js_name = inspectFused)]
pub fn inspect_fused(data: &[u8]) -> Result<JsValue, JsValue> {
    validate_inspect_size(data.len())?;
    let info =
        voided_core::shell::inspect_fused(data).map_err(|e| JsValue::from_str(&e.to_string()))?;
    browser_limit(validate_fused_info(&info, data.len()))?;
    serde_wasm_bindgen::to_value(&shell_info_from_core(info)?)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Protect bytes with the Voided v3 whole-monolith full flow.
#[wasm_bindgen]
pub fn protect(
    data: &[u8],
    key: &[u8],
    preset: Option<String>,
    compression_algorithm: Option<String>,
    compression_level: Option<u32>,
    encryption_algorithm: Option<String>,
    shell_chunk_size: Option<u32>,
) -> Result<JsValue, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        PLAINTEXT_MAX_BYTES,
        "protect plaintext exceeds the browser limit",
    ))?;
    if let Some(chunk_size) = shell_chunk_size {
        browser_limit(validate_len(
            chunk_size as usize,
            1,
            CHUNK_MAX_BYTES,
            "protected artifact chunk size is invalid",
        ))?;
    }
    let key = parse_key(key)?;
    let preset = parse_preset(preset)?;
    let compression_algorithm = parse_compression_algorithm(compression_algorithm)?;
    let compression_level = compression_level.unwrap_or(6);
    validate_compression_level(compression_algorithm, compression_level)?;
    let result = voided_core::shell::protect(
        data,
        &key,
        Some(voided_core::shell::ProtectOptions {
            preset,
            compression_algorithm,
            compression_level,
            compression_min_size_threshold: 100,
            encryption_algorithm: parse_encryption_algorithm(encryption_algorithm)?,
            shell_chunk_size: shell_chunk_size.map(|size| size as usize),
            shell_nonce: None,
        }),
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))?;

    serde_wasm_bindgen::to_value(&protect_result_from_core(result)?)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Open a Voided v3 whole-monolith artifact.
#[wasm_bindgen(js_name = open)]
pub fn open_artifact(artifact: &[u8], key: &[u8]) -> Result<Vec<u8>, JsValue> {
    inspect_current_artifact_for_browser(artifact)?;
    let key = parse_key(key)?;
    let plaintext =
        voided_core::shell::open(artifact, &key).map_err(|e| JsValue::from_str(&e.to_string()))?;
    browser_output(
        plaintext,
        PLAINTEXT_MAX_BYTES,
        "opened artifact plaintext exceeds the browser limit",
    )
}

/// Open either a current v3 artifact or an explicit legacy VOF2 rotation artifact.
#[wasm_bindgen(js_name = openRotationArtifact)]
pub fn open_rotation_artifact(artifact: &[u8], key: &[u8]) -> Result<Vec<u8>, JsValue> {
    inspect_rotation_artifact_for_browser(artifact)?;
    let key = parse_key(key)?;
    let plaintext = voided_core::shell::open_rotation_artifact(artifact, &key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    browser_output(
        plaintext,
        PLAINTEXT_MAX_BYTES,
        "opened rotation artifact plaintext exceeds the browser limit",
    )
}

/// Inspect a Voided v3 whole-monolith artifact without a key.
#[wasm_bindgen(js_name = inspectArtifact)]
pub fn inspect_artifact(artifact: &[u8]) -> Result<JsValue, JsValue> {
    let info = inspect_current_artifact_for_browser(artifact)?;
    serde_wasm_bindgen::to_value(&artifact_info_from_core(info)?)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Inspect either a current v3 artifact or an explicit legacy VOF2 rotation artifact.
#[wasm_bindgen(js_name = inspectRotationArtifact)]
pub fn inspect_rotation_artifact(artifact: &[u8]) -> Result<JsValue, JsValue> {
    let info = inspect_rotation_artifact_for_browser(artifact)?;
    serde_wasm_bindgen::to_value(&artifact_info_from_core(info)?)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Repack a current v3 monolith artifact under a new full-flow configuration.
#[wasm_bindgen(js_name = repackArtifact)]
pub fn repack_artifact(
    artifact: &[u8],
    key: &[u8],
    preset: Option<String>,
    compression_algorithm: Option<String>,
    compression_level: Option<u32>,
    encryption_algorithm: Option<String>,
    shell_chunk_size: Option<u32>,
) -> Result<JsValue, JsValue> {
    inspect_current_artifact_for_browser(artifact)?;
    if let Some(chunk_size) = shell_chunk_size {
        browser_limit(validate_len(
            chunk_size as usize,
            1,
            CHUNK_MAX_BYTES,
            "protected artifact chunk size is invalid",
        ))?;
    }
    let key = parse_key(key)?;
    let preset = parse_preset(preset)?;
    let compression_algorithm = parse_compression_algorithm(compression_algorithm)?;
    let compression_level = compression_level.unwrap_or(6);
    validate_compression_level(compression_algorithm, compression_level)?;
    let result = voided_core::shell::repack_artifact(
        artifact,
        &key,
        Some(voided_core::shell::ProtectOptions {
            preset,
            compression_algorithm,
            compression_level,
            compression_min_size_threshold: 100,
            encryption_algorithm: parse_encryption_algorithm(encryption_algorithm)?,
            shell_chunk_size: shell_chunk_size.map(|size| size as usize),
            shell_nonce: None,
        }),
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))?;

    serde_wasm_bindgen::to_value(&protect_result_from_core(result)?)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

// ============================================================================
// Utility
// ============================================================================

/// Generate random bytes
#[wasm_bindgen(js_name = randomBytes)]
pub fn random_bytes(length: u32) -> Result<Vec<u8>, JsValue> {
    if !(1..=MAX_RANDOM_BYTES).contains(&length) {
        return Err(js_error(format!(
            "random byte length must be between 1 and {MAX_RANDOM_BYTES}"
        )));
    }
    Ok(voided_core::util::random_bytes(length as usize))
}

/// Base64 encode
#[wasm_bindgen(js_name = base64Encode)]
pub fn base64_encode(data: &[u8]) -> Result<String, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        RAW_MAX_BYTES,
        "base64 input exceeds the browser raw-input limit",
    ))?;
    Ok(voided_core::formats::base64_encode(data))
}

/// Base64 decode
#[wasm_bindgen(js_name = base64Decode)]
pub fn base64_decode(encoded: &str) -> Result<Vec<u8>, JsValue> {
    decode_canonical_base64(
        encoded,
        RAW_MAX_BYTES,
        "base64 input must be canonical and within the browser raw-input limit",
    )
    .map_err(js_error)
}

/// Hex encode
#[wasm_bindgen(js_name = hexEncode)]
pub fn hex_encode(data: &[u8]) -> Result<String, JsValue> {
    browser_limit(validate_len(
        data.len(),
        0,
        RAW_MAX_BYTES,
        "hex input exceeds the browser raw-input limit",
    ))?;
    Ok(voided_core::formats::hex_encode(data))
}

/// Hex decode
#[wasm_bindgen(js_name = hexDecode)]
pub fn hex_decode(encoded: &str) -> Result<Vec<u8>, JsValue> {
    decode_canonical_lower_hex(
        encoded,
        RAW_MAX_BYTES,
        None,
        "hex input must be canonical lowercase and within the browser raw-input limit",
    )
    .map_err(js_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_encrypt_decrypt() {
        let key = generate_key();
        let data = b"Hello, WASM!";

        let encrypted = encrypt(data, &key, None).unwrap();
        let decrypted = decrypt(encrypted, &key).unwrap();

        assert_eq!(data.to_vec(), decrypted);
    }

    #[wasm_bindgen_test]
    fn test_xchacha_authenticated_data_roundtrip_and_rejection() {
        let key = generate_key();
        let data = b"owned media epoch";
        let aad = b"session=owned-screen|epoch=7";
        let encrypted =
            encrypt_with_aad(data, &key, aad, Some("xchacha20-poly1305".to_string())).unwrap();

        let decrypted = decrypt_with_aad(encrypted.clone(), &key, aad).unwrap();
        assert_eq!(data.to_vec(), decrypted);
        assert!(decrypt_with_aad(encrypted, &key, b"session=other|epoch=7").is_err());
    }

    #[wasm_bindgen_test]
    fn test_encrypt_rejects_unknown_algorithm() {
        let key = generate_key();
        assert!(encrypt(b"strict", &key, Some("aes".to_string())).is_err());
    }

    #[wasm_bindgen_test]
    fn test_keyless_inspect_size_limit_without_large_allocation() {
        assert!(validate_inspect_size(ARTIFACT_MAX_BYTES).is_ok());
        assert!(validate_inspect_size(ARTIFACT_MAX_BYTES + 1).is_err());
    }

    #[test]
    fn browser_decompression_helper_enforces_its_output_cap() {
        let plaintext = vec![0x41; 4096];
        let compressed = voided_core::compression::compress(
            &plaintext,
            Some(voided_core::compression::CompressionOptions {
                algorithm: voided_core::compression::CompressionAlgorithm::Gzip,
                min_size_threshold: 0,
                level: 6,
            }),
        )
        .unwrap();
        assert_eq!(
            compressed.algorithm,
            voided_core::compression::CompressionAlgorithm::Gzip
        );
        assert!(
            decompress_with_browser_limit(&compressed.compressed, compressed.algorithm, 1024,)
                .is_err()
        );
        assert_eq!(
            decompress_with_browser_limit(
                &compressed.compressed,
                compressed.algorithm,
                plaintext.len(),
            )
            .unwrap(),
            plaintext
        );
    }

    #[test]
    fn bounded_decompression_limit_rejects_fractional_nonfinite_and_oversized_values() {
        assert_eq!(bounded_decompression_limit(0.0), Ok(0));
        assert_eq!(
            bounded_decompression_limit(voided_core::compression::MAX_DECOMPRESSED_SIZE as f64,),
            Ok(voided_core::compression::MAX_DECOMPRESSED_SIZE)
        );
        assert!(bounded_decompression_limit(-1.0).is_err());
        assert!(bounded_decompression_limit(1.5).is_err());
        assert!(bounded_decompression_limit(f64::NAN).is_err());
        assert!(bounded_decompression_limit(f64::INFINITY).is_err());
        assert!(bounded_decompression_limit(
            voided_core::compression::MAX_DECOMPRESSED_SIZE as f64 + 1.0,
        )
        .is_err());
    }

    #[wasm_bindgen_test]
    fn test_hash() {
        let data = b"hello world";
        let hash_result = hash(data, None).unwrap();

        assert_eq!(
            hash_result,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[wasm_bindgen_test]
    fn test_random_bytes() {
        let bytes1 = random_bytes(32).unwrap();
        let bytes2 = random_bytes(32).unwrap();

        assert_eq!(bytes1.len(), 32);
        assert_ne!(bytes1, bytes2);
    }
}
