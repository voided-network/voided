//! WebAssembly binding for voided-core encryption library.
//!
//! This crate provides wasm-bindgen bindings to expose voided-core's crypto primitives
//! to browser applications via WebAssembly.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

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
    pub public_key: Vec<u8>,
    pub private_key: Vec<u8>,
}

/// Generate a random 256-bit encryption key (returns Uint8Array)
#[wasm_bindgen(js_name = generateKey)]
pub fn generate_key() -> Vec<u8> {
    let key = voided_core::encryption::generate_key();
    key.as_bytes().to_vec()
}

/// Encrypt data using AES-256-GCM
#[wasm_bindgen]
pub fn encrypt(data: &[u8], key: &[u8], algorithm: Option<String>) -> Result<JsValue, JsValue> {
    let core_key = voided_core::encryption::Key::from_bytes(key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let algo = algorithm.as_deref().map(|a| match a {
        "xchacha20-poly1305" => voided_core::encryption::Algorithm::XChaCha20Poly1305,
        _ => voided_core::encryption::Algorithm::Aes256Gcm,
    });

    let opts = algo.map(|a| voided_core::encryption::EncryptOptions {
        algorithm: Some(a),
        aad: None,
    });

    let result = voided_core::encryption::encrypt(data, &core_key, opts)
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

/// Decrypt data
#[wasm_bindgen]
pub fn decrypt(encrypted: JsValue, key: &[u8]) -> Result<Vec<u8>, JsValue> {
    let enc: EncryptionResult =
        serde_wasm_bindgen::from_value(encrypted).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let core_key = voided_core::encryption::Key::from_bytes(key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    use base64::{engine::general_purpose::STANDARD, Engine};

    let algorithm = match enc.algorithm.as_str() {
        "xchacha20-poly1305" => voided_core::encryption::Algorithm::XChaCha20Poly1305,
        _ => voided_core::encryption::Algorithm::Aes256Gcm,
    };

    let core_result = voided_core::encryption::EncryptionResult {
        ciphertext: STANDARD
            .decode(&enc.ciphertext)
            .map_err(|e| JsValue::from_str(&e.to_string()))?,
        algorithm,
        nonce: STANDARD
            .decode(&enc.nonce)
            .map_err(|e| JsValue::from_str(&e.to_string()))?,
        tag: STANDARD
            .decode(&enc.tag)
            .map_err(|e| JsValue::from_str(&e.to_string()))?,
    };

    voided_core::encryption::decrypt(&core_result, &core_key)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Derive a key using HKDF-SHA256
#[wasm_bindgen(js_name = deriveKeyHkdf)]
pub fn derive_key_hkdf(
    input_key_material: &[u8],
    salt: Option<Vec<u8>>,
    info: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let salt_ref = salt.as_deref();

    let key = voided_core::encryption::derive_key_hkdf(input_key_material, salt_ref, info)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(key.as_bytes().to_vec())
}

/// Derive raw key material using HKDF-SHA256.
#[wasm_bindgen(js_name = deriveKeyHkdfRaw)]
pub fn derive_key_hkdf_raw(
    input_key_material: &[u8],
    salt: Option<Vec<u8>>,
    info: &[u8],
    length: u32,
) -> Result<Vec<u8>, JsValue> {
    let salt_ref = salt.as_deref();

    voided_core::encryption::derive_key_hkdf_raw(
        input_key_material,
        salt_ref,
        info,
        length as usize,
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Derive a key using PBKDF2-HMAC-SHA256
#[wasm_bindgen(js_name = deriveKeyPbkdf2)]
pub fn derive_key_pbkdf2(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
) -> Result<Vec<u8>, JsValue> {
    let key = voided_core::encryption::derive_key_pbkdf2(password, salt, iterations)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(key.as_bytes().to_vec())
}

/// Generate X25519 key pair (deterministic if seed provided).
#[wasm_bindgen(js_name = generateX25519KeyPair)]
pub fn generate_x25519_key_pair(seed: Option<Vec<u8>>) -> Result<JsValue, JsValue> {
    let pair = voided_core::encryption::generate_x25519_key_pair(seed.as_deref())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let js_pair = X25519KeyPair {
        public_key: pair.public_key.to_vec(),
        private_key: pair.private_key.to_vec(),
    };

    serde_wasm_bindgen::to_value(&js_pair).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Compute X25519 shared secret.
#[wasm_bindgen(js_name = x25519SharedSecret)]
pub fn x25519_shared_secret(
    our_private_key: &[u8],
    their_public_key: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let shared = voided_core::encryption::x25519_shared_secret(our_private_key, their_public_key)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(shared.to_vec())
}

/// Derive AES key bytes from DH shared secret using HKDF.
#[wasm_bindgen(js_name = deriveKeyFromSharedSecret)]
pub fn derive_key_from_shared_secret(
    shared_secret: &[u8],
    salt: &str,
    info: &str,
) -> Result<Vec<u8>, JsValue> {
    let key = voided_core::encryption::derive_key_from_shared_secret(shared_secret, salt, info)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(key.as_bytes().to_vec())
}

// ============================================================================
// Hashing
// ============================================================================

/// Generate a SHA-256 or SHA-512 hash
#[wasm_bindgen]
pub fn hash(data: &[u8], algorithm: Option<String>) -> String {
    let algo = match algorithm.as_deref() {
        Some("sha512") => voided_core::hash::HashAlgorithm::Sha512,
        _ => voided_core::hash::HashAlgorithm::Sha256,
    };

    voided_core::hash::hash_hex(data, algo)
}

/// Generate a salted hash
#[wasm_bindgen(js_name = hashWithSalt)]
pub fn hash_with_salt(data: &[u8], salt: &[u8], algorithm: Option<String>) -> String {
    let algo = match algorithm.as_deref() {
        Some("sha512") => voided_core::hash::HashAlgorithm::Sha512,
        _ => voided_core::hash::HashAlgorithm::Sha256,
    };

    voided_core::hash::hash_with_salt_hex(data, salt, algo)
}

/// Compare hashes in constant time
#[wasm_bindgen(js_name = compareHashes)]
pub fn compare_hashes(a: &[u8], b: &[u8]) -> bool {
    voided_core::hash::compare_hashes(a, b)
}

/// Generate HMAC
#[wasm_bindgen(js_name = generateHmac)]
pub fn generate_hmac(
    data: &[u8],
    key: &[u8],
    algorithm: Option<String>,
) -> Result<String, JsValue> {
    let algo = match algorithm.as_deref() {
        Some("sha512") => voided_core::hash::HashAlgorithm::Sha512,
        _ => voided_core::hash::HashAlgorithm::Sha256,
    };

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
    let algo = match algorithm.as_deref() {
        Some("sha512") => voided_core::hash::HashAlgorithm::Sha512,
        _ => voided_core::hash::HashAlgorithm::Sha256,
    };

    let hmac_bytes = hex::decode(hmac).map_err(|e| JsValue::from_str(&e.to_string()))?;

    voided_core::hash::verify_hmac(data, &hmac_bytes, key, algo)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Hash with PBKDF2 (high iterations)
#[wasm_bindgen(js_name = hashWithPbkdf2)]
pub fn hash_with_pbkdf2(data: &[u8], salt: &[u8], iterations: u32) -> String {
    let hash = voided_core::hash::hash_with_pbkdf2(data, salt, iterations);
    hex::encode(hash)
}

/// Verify PBKDF2 hash
#[wasm_bindgen(js_name = verifyPbkdf2)]
pub fn verify_pbkdf2(
    data: &[u8],
    expected_hash: &str,
    salt: &[u8],
    iterations: u32,
) -> Result<bool, JsValue> {
    let expected_bytes =
        hex::decode(expected_hash).map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(voided_core::hash::verify_pbkdf2(
        data,
        &expected_bytes,
        salt,
        iterations,
    ))
}

/// Generate fingerprint
#[wasm_bindgen(js_name = generateFingerprint)]
pub fn generate_fingerprint(data: &[u8], length: Option<u32>) -> String {
    voided_core::hash::generate_fingerprint(data, length.unwrap_or(8) as usize)
}

/// Generate safety numbers (Signal-style)
#[wasm_bindgen(js_name = generateSafetyNumbers)]
pub fn generate_safety_numbers(data: &[u8], group_size: Option<u32>) -> String {
    voided_core::hash::generate_safety_numbers(data, group_size.unwrap_or(5) as usize)
}

/// Generate random salt
#[wasm_bindgen(js_name = generateSalt)]
pub fn generate_salt(length: Option<u32>) -> Vec<u8> {
    voided_core::hash::generate_salt(length.unwrap_or(32) as usize)
}

// ============================================================================
// Compression
// ============================================================================

/// Compression result
#[derive(Clone, Serialize, Deserialize)]
pub struct CompressionResult {
    pub compressed: Vec<u8>,
    pub algorithm: String,
    pub original_size: u32,
    pub compressed_size: u32,
    pub compression_ratio: f64,
}

/// Fused shell metadata
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FusedShellInfo {
    pub version: u32,
    pub preset: String,
    pub chunk_size: u32,
    pub chunk_count: u32,
    pub payload_size: u32,
    pub shell_size: u32,
    pub metadata_size: u32,
    pub tag_size: u32,
}

/// Protected artifact metadata
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedArtifactInfo {
    pub version: u32,
    pub preset: String,
    pub compression_algorithm: String,
    pub encryption_algorithm: String,
    pub original_size: u32,
    pub compressed_size: u32,
    pub encrypted_size: u32,
    pub protected_size: u32,
    pub shell_chunk_size: u32,
    pub shell_chunk_count: u32,
    pub shell_nonce: Vec<u8>,
}

/// Result of protect/repack operations.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectResult {
    pub artifact: Vec<u8>,
    pub version: u32,
    pub preset: String,
    pub compression_algorithm: String,
    pub encryption_algorithm: String,
    pub original_size: u32,
    pub compressed_size: u32,
    pub encrypted_size: u32,
    pub protected_size: u32,
    pub shell_chunk_size: u32,
    pub shell_chunk_count: u32,
    pub shell_nonce: Vec<u8>,
}

/// Compress data
#[wasm_bindgen]
pub fn compress(
    data: &[u8],
    algorithm: Option<String>,
    level: Option<u32>,
) -> Result<JsValue, JsValue> {
    let algo = match algorithm.as_deref() {
        Some("gzip") => voided_core::compression::CompressionAlgorithm::Gzip,
        Some("none") => voided_core::compression::CompressionAlgorithm::None,
        _ => voided_core::compression::CompressionAlgorithm::Brotli,
    };

    let opts = voided_core::compression::CompressionOptions {
        algorithm: algo,
        min_size_threshold: 100,
        level: level.unwrap_or(6),
    };

    let result = voided_core::compression::compress(data, Some(opts))
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let js_result = CompressionResult {
        compressed: result.compressed,
        algorithm: result.algorithm.name().to_string(),
        original_size: result.original_size as u32,
        compressed_size: result.compressed_size as u32,
        compression_ratio: result.compression_ratio,
    };

    serde_wasm_bindgen::to_value(&js_result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Decompress data
#[wasm_bindgen]
pub fn decompress(data: &[u8], algorithm: &str) -> Result<Vec<u8>, JsValue> {
    let algo = match algorithm {
        "gzip" => voided_core::compression::CompressionAlgorithm::Gzip,
        "brotli" => voided_core::compression::CompressionAlgorithm::Brotli,
        _ => voided_core::compression::CompressionAlgorithm::None,
    };

    voided_core::compression::decompress(data, algo).map_err(|e| JsValue::from_str(&e.to_string()))
}

// ============================================================================
// Fused shell / full-flow
// ============================================================================

fn parse_key(key: &[u8]) -> Result<voided_core::encryption::Key, JsValue> {
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
) -> Option<voided_core::encryption::Algorithm> {
    algorithm.as_deref().map(|algorithm| match algorithm {
        "xchacha20-poly1305" => voided_core::encryption::Algorithm::XChaCha20Poly1305,
        _ => voided_core::encryption::Algorithm::Aes256Gcm,
    })
}

fn parse_compression_algorithm(
    algorithm: Option<String>,
) -> voided_core::compression::CompressionAlgorithm {
    match algorithm.as_deref() {
        Some("gzip") => voided_core::compression::CompressionAlgorithm::Gzip,
        Some("none") => voided_core::compression::CompressionAlgorithm::None,
        _ => voided_core::compression::CompressionAlgorithm::Brotli,
    }
}

fn shell_info_from_core(info: voided_core::shell::FusedShellInfo) -> FusedShellInfo {
    FusedShellInfo {
        version: info.version as u32,
        preset: info.preset_label,
        chunk_size: info.chunk_size,
        chunk_count: info.chunk_count as u32,
        payload_size: info.payload_size as u32,
        shell_size: info.shell_size as u32,
        metadata_size: info.metadata_size as u32,
        tag_size: info.tag_size as u32,
    }
}

fn artifact_info_from_core(info: voided_core::shell::ProtectedArtifactInfo) -> ProtectedArtifactInfo {
    ProtectedArtifactInfo {
        version: info.version as u32,
        preset: info.preset_label,
        compression_algorithm: info.compression_algorithm.name().to_string(),
        encryption_algorithm: info.encryption_algorithm.name().to_string(),
        original_size: info.original_size as u32,
        compressed_size: info.compressed_size as u32,
        encrypted_size: info.encrypted_size as u32,
        protected_size: info.protected_size as u32,
        shell_chunk_size: info.shell_chunk_size,
        shell_chunk_count: info.shell_chunk_count as u32,
        shell_nonce: info.shell_nonce.to_vec(),
    }
}

fn protect_result_from_core(result: voided_core::shell::ProtectResult) -> ProtectResult {
    ProtectResult {
        artifact: result.artifact,
        version: result.info.version as u32,
        preset: result.info.preset_label,
        compression_algorithm: result.info.compression_algorithm.name().to_string(),
        encryption_algorithm: result.info.encryption_algorithm.name().to_string(),
        original_size: result.info.original_size as u32,
        compressed_size: result.info.compressed_size as u32,
        encrypted_size: result.info.encrypted_size as u32,
        protected_size: result.info.protected_size as u32,
        shell_chunk_size: result.info.shell_chunk_size,
        shell_chunk_count: result.info.shell_chunk_count as u32,
        shell_nonce: result.info.shell_nonce.to_vec(),
    }
}

/// Fuse arbitrary bytes with the fused shell primitive.
#[wasm_bindgen]
pub fn fuse(
    data: &[u8],
    key: &[u8],
    preset: Option<String>,
    chunk_size: Option<u32>,
) -> Result<Vec<u8>, JsValue> {
    let key = parse_key(key)?;
    let preset = parse_preset(preset)?;

    voided_core::shell::fuse_bytes(
        data,
        &key,
        Some(voided_core::shell::FusedShellOptions {
            preset,
            chunk_size: chunk_size.map(|size| size as usize),
            shell_nonce: None,
        }),
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Reverse the fused shell primitive.
#[wasm_bindgen]
pub fn unfuse(data: &[u8], key: &[u8]) -> Result<Vec<u8>, JsValue> {
    let key = parse_key(key)?;
    voided_core::shell::unfuse_bytes(data, &key).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Inspect a fused shell envelope without a key.
#[wasm_bindgen(js_name = inspectFused)]
pub fn inspect_fused(data: &[u8]) -> Result<JsValue, JsValue> {
    let info = voided_core::shell::inspect_fused(data).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&shell_info_from_core(info))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Protect bytes with the fused-first Voided v2 full flow.
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
    let key = parse_key(key)?;
    let preset = parse_preset(preset)?;
    let result = voided_core::shell::protect(
        data,
        &key,
        Some(voided_core::shell::ProtectOptions {
            preset,
            compression_algorithm: parse_compression_algorithm(compression_algorithm),
            compression_level: compression_level.unwrap_or(6),
            compression_min_size_threshold: 100,
            encryption_algorithm: parse_encryption_algorithm(encryption_algorithm),
            shell_chunk_size: shell_chunk_size.map(|size| size as usize),
            shell_nonce: None,
        }),
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))?;

    serde_wasm_bindgen::to_value(&protect_result_from_core(result))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Open a fused protected artifact.
#[wasm_bindgen(js_name = open)]
pub fn open_artifact(artifact: &[u8], key: &[u8]) -> Result<Vec<u8>, JsValue> {
    let key = parse_key(key)?;
    voided_core::shell::open(artifact, &key).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Inspect a fused protected artifact without a key.
#[wasm_bindgen(js_name = inspectArtifact)]
pub fn inspect_artifact(artifact: &[u8]) -> Result<JsValue, JsValue> {
    let info =
        voided_core::shell::inspect_artifact(artifact).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&artifact_info_from_core(info))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Repack an artifact under a new fused preset/profile.
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
    let key = parse_key(key)?;
    let preset = parse_preset(preset)?;
    let result = voided_core::shell::repack_artifact(
        artifact,
        &key,
        Some(voided_core::shell::ProtectOptions {
            preset,
            compression_algorithm: parse_compression_algorithm(compression_algorithm),
            compression_level: compression_level.unwrap_or(6),
            compression_min_size_threshold: 100,
            encryption_algorithm: parse_encryption_algorithm(encryption_algorithm),
            shell_chunk_size: shell_chunk_size.map(|size| size as usize),
            shell_nonce: None,
        }),
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))?;

    serde_wasm_bindgen::to_value(&protect_result_from_core(result))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

// ============================================================================
// Utility
// ============================================================================

/// Generate random bytes
#[wasm_bindgen(js_name = randomBytes)]
pub fn random_bytes(length: u32) -> Vec<u8> {
    voided_core::util::random_bytes(length as usize)
}

/// Base64 encode
#[wasm_bindgen(js_name = base64Encode)]
pub fn base64_encode(data: &[u8]) -> String {
    voided_core::formats::base64_encode(data)
}

/// Base64 decode
#[wasm_bindgen(js_name = base64Decode)]
pub fn base64_decode(encoded: &str) -> Result<Vec<u8>, JsValue> {
    voided_core::formats::base64_decode(encoded).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Hex encode
#[wasm_bindgen(js_name = hexEncode)]
pub fn hex_encode(data: &[u8]) -> String {
    voided_core::formats::hex_encode(data)
}

/// Hex decode
#[wasm_bindgen(js_name = hexDecode)]
pub fn hex_decode(encoded: &str) -> Result<Vec<u8>, JsValue> {
    voided_core::formats::hex_decode(encoded).map_err(|e| JsValue::from_str(&e.to_string()))
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
    fn test_hash() {
        let data = b"hello world";
        let hash_result = hash(data, None);

        assert_eq!(
            hash_result,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[wasm_bindgen_test]
    fn test_random_bytes() {
        let bytes1 = random_bytes(32);
        let bytes2 = random_bytes(32);

        assert_eq!(bytes1.len(), 32);
        assert_ne!(bytes1, bytes2);
    }
}
