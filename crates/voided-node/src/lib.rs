//! Node.js native binding for voided-core encryption library.
//!
//! This crate provides N-API bindings to expose voided-core's crypto primitives
//! to Node.js applications.

#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Re-export version
#[napi]
pub const VERSION: &str = voided_core::VERSION;

// ============================================================================
// Encryption
// ============================================================================

/// Result of an encryption operation
#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct EncryptionResult {
    /// Base64 encoded ciphertext
    pub ciphertext: String,
    /// Algorithm used ("aes-256-gcm" or "xchacha20-poly1305")
    pub algorithm: String,
    /// Base64 encoded nonce
    pub nonce: String,
    /// Base64 encoded authentication tag
    pub tag: String,
}

/// X25519 key pair for DH key exchange.
#[napi(object)]
#[derive(Clone)]
pub struct X25519KeyPair {
    /// 32-byte public key.
    pub public_key: Buffer,
    /// 32-byte private key seed.
    pub private_key: Buffer,
}

/// Generate a random 256-bit encryption key
#[napi]
pub fn generate_key() -> Buffer {
    let key = voided_core::encryption::generate_key();
    Buffer::from(key.as_bytes().to_vec())
}

/// Encrypt data using AES-256-GCM or XChaCha20-Poly1305
#[napi]
pub fn encrypt(data: Buffer, key: Buffer, algorithm: Option<String>) -> Result<EncryptionResult> {
    let key_bytes = key.as_ref();
    let core_key = voided_core::encryption::Key::from_bytes(key_bytes)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    let algo = algorithm.as_deref().map(|a| match a {
        "xchacha20-poly1305" => voided_core::encryption::Algorithm::XChaCha20Poly1305,
        _ => voided_core::encryption::Algorithm::Aes256Gcm,
    });

    let opts = algo.map(|a| voided_core::encryption::EncryptOptions {
        algorithm: Some(a),
        aad: None,
    });

    let result = voided_core::encryption::encrypt(data.as_ref(), &core_key, opts)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    use base64::{engine::general_purpose::STANDARD, Engine};

    Ok(EncryptionResult {
        ciphertext: STANDARD.encode(&result.ciphertext),
        algorithm: result.algorithm.name().to_string(),
        nonce: STANDARD.encode(&result.nonce),
        tag: STANDARD.encode(&result.tag),
    })
}

/// Decrypt data
#[napi]
pub fn decrypt(encrypted: EncryptionResult, key: Buffer) -> Result<Buffer> {
    let key_bytes = key.as_ref();
    let core_key = voided_core::encryption::Key::from_bytes(key_bytes)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    use base64::{engine::general_purpose::STANDARD, Engine};

    let algorithm = match encrypted.algorithm.as_str() {
        "xchacha20-poly1305" => voided_core::encryption::Algorithm::XChaCha20Poly1305,
        _ => voided_core::encryption::Algorithm::Aes256Gcm,
    };

    let core_result = voided_core::encryption::EncryptionResult {
        ciphertext: STANDARD
            .decode(&encrypted.ciphertext)
            .map_err(|e| Error::from_reason(e.to_string()))?,
        algorithm,
        nonce: STANDARD
            .decode(&encrypted.nonce)
            .map_err(|e| Error::from_reason(e.to_string()))?,
        tag: STANDARD
            .decode(&encrypted.tag)
            .map_err(|e| Error::from_reason(e.to_string()))?,
    };

    let decrypted = voided_core::encryption::decrypt(&core_result, &core_key)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(decrypted))
}

/// Derive a key using HKDF-SHA256
#[napi]
pub fn derive_key_hkdf(
    input_key_material: Buffer,
    salt: Option<Buffer>,
    info: Buffer,
) -> Result<Buffer> {
    let salt_ref = salt.as_ref().map(|s| s.as_ref());

    let key = voided_core::encryption::derive_key_hkdf(
        input_key_material.as_ref(),
        salt_ref,
        info.as_ref(),
    )
    .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(key.as_bytes().to_vec()))
}

/// Derive raw key material using HKDF-SHA256.
#[napi]
pub fn derive_key_hkdf_raw(
    input_key_material: Buffer,
    salt: Option<Buffer>,
    info: Buffer,
    length: u32,
) -> Result<Buffer> {
    let salt_ref = salt.as_ref().map(|s| s.as_ref());

    let key = voided_core::encryption::derive_key_hkdf_raw(
        input_key_material.as_ref(),
        salt_ref,
        info.as_ref(),
        length as usize,
    )
    .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(key))
}

/// Derive a key using PBKDF2-HMAC-SHA256
#[napi]
pub fn derive_key_pbkdf2(password: Buffer, salt: Buffer, iterations: u32) -> Result<Buffer> {
    let key =
        voided_core::encryption::derive_key_pbkdf2(password.as_ref(), salt.as_ref(), iterations)
            .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(key.as_bytes().to_vec()))
}

/// Generate X25519 key pair.
#[napi]
pub fn generate_x25519_key_pair(seed: Option<Buffer>) -> Result<X25519KeyPair> {
    let pair = voided_core::encryption::generate_x25519_key_pair(seed.as_ref().map(|s| s.as_ref()))
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(X25519KeyPair {
        public_key: Buffer::from(pair.public_key.to_vec()),
        private_key: Buffer::from(pair.private_key.to_vec()),
    })
}

/// Compute X25519 shared secret.
#[napi]
pub fn x25519_shared_secret(our_private_key: Buffer, their_public_key: Buffer) -> Result<Buffer> {
    let shared = voided_core::encryption::x25519_shared_secret(
        our_private_key.as_ref(),
        their_public_key.as_ref(),
    )
    .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(shared.to_vec()))
}

/// Derive AES key bytes from shared secret.
#[napi]
pub fn derive_key_from_shared_secret(
    shared_secret: Buffer,
    salt: String,
    info: String,
) -> Result<Buffer> {
    let key = voided_core::encryption::derive_key_from_shared_secret(
        shared_secret.as_ref(),
        &salt,
        &info,
    )
    .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(key.as_bytes().to_vec()))
}

// ============================================================================
// Hashing
// ============================================================================

/// Generate a SHA-256 or SHA-512 hash
#[napi]
pub fn hash(data: Buffer, algorithm: Option<String>) -> String {
    let algo = match algorithm.as_deref() {
        Some("sha512") => voided_core::hash::HashAlgorithm::Sha512,
        _ => voided_core::hash::HashAlgorithm::Sha256,
    };

    voided_core::hash::hash_hex(data.as_ref(), algo)
}

/// Generate a salted hash
#[napi]
pub fn hash_with_salt(data: Buffer, salt: Buffer, algorithm: Option<String>) -> String {
    let algo = match algorithm.as_deref() {
        Some("sha512") => voided_core::hash::HashAlgorithm::Sha512,
        _ => voided_core::hash::HashAlgorithm::Sha256,
    };

    voided_core::hash::hash_with_salt_hex(data.as_ref(), salt.as_ref(), algo)
}

/// Compare hashes in constant time
#[napi]
pub fn compare_hashes(a: Buffer, b: Buffer) -> bool {
    voided_core::hash::compare_hashes(a.as_ref(), b.as_ref())
}

/// Generate HMAC
#[napi]
pub fn generate_hmac(data: Buffer, key: Buffer, algorithm: Option<String>) -> Result<String> {
    let algo = match algorithm.as_deref() {
        Some("sha512") => voided_core::hash::HashAlgorithm::Sha512,
        _ => voided_core::hash::HashAlgorithm::Sha256,
    };

    voided_core::hash::generate_hmac_hex(data.as_ref(), key.as_ref(), algo)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Verify HMAC
#[napi]
pub fn verify_hmac(
    data: Buffer,
    hmac: String,
    key: Buffer,
    algorithm: Option<String>,
) -> Result<bool> {
    let algo = match algorithm.as_deref() {
        Some("sha512") => voided_core::hash::HashAlgorithm::Sha512,
        _ => voided_core::hash::HashAlgorithm::Sha256,
    };

    let hmac_bytes = hex::decode(&hmac).map_err(|e| Error::from_reason(e.to_string()))?;

    voided_core::hash::verify_hmac(data.as_ref(), &hmac_bytes, key.as_ref(), algo)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Hash with PBKDF2 (high iterations)
#[napi]
pub fn hash_with_pbkdf2(data: Buffer, salt: Buffer, iterations: u32) -> String {
    let hash = voided_core::hash::hash_with_pbkdf2(data.as_ref(), salt.as_ref(), iterations);
    hex::encode(hash)
}

/// Verify PBKDF2 hash
#[napi]
pub fn verify_pbkdf2(
    data: Buffer,
    expected_hash: String,
    salt: Buffer,
    iterations: u32,
) -> Result<bool> {
    let expected_bytes =
        hex::decode(&expected_hash).map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(voided_core::hash::verify_pbkdf2(
        data.as_ref(),
        &expected_bytes,
        salt.as_ref(),
        iterations,
    ))
}

/// Generate fingerprint
#[napi]
pub fn generate_fingerprint(data: Buffer, length: Option<u32>) -> String {
    voided_core::hash::generate_fingerprint(data.as_ref(), length.unwrap_or(8) as usize)
}

/// Generate safety numbers (Signal-style)
#[napi]
pub fn generate_safety_numbers(data: Buffer, group_size: Option<u32>) -> String {
    voided_core::hash::generate_safety_numbers(data.as_ref(), group_size.unwrap_or(5) as usize)
}

/// Generate random salt
#[napi]
pub fn generate_salt(length: Option<u32>) -> Buffer {
    let salt = voided_core::hash::generate_salt(length.unwrap_or(32) as usize);
    Buffer::from(salt)
}

// ============================================================================
// Compression
// ============================================================================

/// Result of compression
#[napi(object)]
#[derive(Clone)]
pub struct CompressionResult {
    /// Compressed data as Buffer
    pub compressed: Buffer,
    /// Algorithm used
    pub algorithm: String,
    /// Original size
    pub original_size: u32,
    /// Compressed size
    pub compressed_size: u32,
    /// Compression ratio
    pub compression_ratio: f64,
}

/// Compress data
#[napi]
pub fn compress(
    data: Buffer,
    algorithm: Option<String>,
    level: Option<u32>,
) -> Result<CompressionResult> {
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

    let result = voided_core::compression::compress(data.as_ref(), Some(opts))
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(CompressionResult {
        compressed: Buffer::from(result.compressed),
        algorithm: result.algorithm.name().to_string(),
        original_size: result.original_size as u32,
        compressed_size: result.compressed_size as u32,
        compression_ratio: result.compression_ratio,
    })
}

/// Decompress data
#[napi]
pub fn decompress(data: Buffer, algorithm: String) -> Result<Buffer> {
    let algo = match algorithm.as_str() {
        "gzip" => voided_core::compression::CompressionAlgorithm::Gzip,
        "brotli" => voided_core::compression::CompressionAlgorithm::Brotli,
        _ => voided_core::compression::CompressionAlgorithm::None,
    };

    let result = voided_core::compression::decompress(data.as_ref(), algo)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(result))
}

// ============================================================================
// Obfuscation
// ============================================================================

/// Result of obfuscation
#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct ObfuscationResult {
    /// Obfuscated text
    pub obfuscated: String,
    /// Original length
    pub original_length: u32,
    /// Obfuscated length
    pub obfuscated_length: u32,
    /// Expansion ratio
    pub expansion_ratio: f64,
    /// Unique chars obfuscated
    pub unique_chars_obfuscated: u32,
    /// Mappings used
    pub mappings_used: u32,
}

/// Map analysis result
#[napi(object)]
#[derive(Clone, Serialize, Deserialize)]
pub struct MapAnalysis {
    /// Estimated temperature
    pub temperature: f64,
    /// Total mappings
    pub total_mappings: u32,
    /// Average mappings per char
    pub average_mappings_per_char: f64,
    /// Average mapping length
    pub average_mapping_length: f64,
    /// Expansion ratio
    pub expansion_ratio: f64,
    /// Compute score
    pub compute_score: u32,
    /// Entropy
    pub entropy: f64,
}

/// Generate obfuscation map
#[napi]
pub fn generate_map(
    temperature: Option<f64>,
    seed: Option<String>,
    charset: Option<String>,
) -> HashMap<String, Vec<String>> {
    let opts = voided_core::obfuscation::GenerateMapOptions {
        temperature: temperature.unwrap_or(0.5),
        seed,
        charset,
    };

    let map = voided_core::obfuscation::generate_map(Some(opts));

    // Convert to HashMap<String, Vec<String>> for JS
    map.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
}

/// Obfuscate text
#[napi]
pub fn obfuscate(
    text: String,
    map: HashMap<String, Vec<String>>,
    seed: Option<String>,
    strategy: Option<String>,
) -> Result<ObfuscationResult> {
    // Convert HashMap back to BTreeMap<char, Vec<String>>
    let core_map: std::collections::BTreeMap<char, Vec<String>> = map
        .into_iter()
        .filter_map(|(k, v)| k.chars().next().map(|c| (c, v)))
        .collect();

    let strat = match strategy.as_deref() {
        Some("round-robin") => voided_core::obfuscation::SelectionStrategy::RoundRobin,
        Some("shortest") => voided_core::obfuscation::SelectionStrategy::Shortest,
        Some("longest") => voided_core::obfuscation::SelectionStrategy::Longest,
        _ => voided_core::obfuscation::SelectionStrategy::Random,
    };

    let opts = voided_core::obfuscation::ObfuscationOptions {
        seed: seed.unwrap_or_else(|| "default-seed".to_string()),
        strategy: strat,
    };

    let result = voided_core::obfuscation::obfuscate(&text, &core_map, Some(opts));

    Ok(ObfuscationResult {
        obfuscated: result.obfuscated,
        original_length: result.stats.original_length as u32,
        obfuscated_length: result.stats.obfuscated_length as u32,
        expansion_ratio: result.stats.expansion_ratio,
        unique_chars_obfuscated: result.stats.unique_chars_obfuscated as u32,
        mappings_used: result.stats.mappings_used as u32,
    })
}

/// Deobfuscate text
#[napi]
pub fn deobfuscate(obfuscated_text: String, map: HashMap<String, Vec<String>>) -> String {
    // Convert HashMap back to BTreeMap<char, Vec<String>>
    let core_map: std::collections::BTreeMap<char, Vec<String>> = map
        .into_iter()
        .filter_map(|(k, v)| k.chars().next().map(|c| (c, v)))
        .collect();

    voided_core::obfuscation::deobfuscate(&obfuscated_text, &core_map)
}

/// Analyze obfuscation map
#[napi]
pub fn analyze_map(map: HashMap<String, Vec<String>>) -> MapAnalysis {
    // Convert HashMap back to BTreeMap<char, Vec<String>>
    let core_map: std::collections::BTreeMap<char, Vec<String>> = map
        .into_iter()
        .filter_map(|(k, v)| k.chars().next().map(|c| (c, v)))
        .collect();

    let analysis = voided_core::obfuscation::analyze_map(&core_map);

    MapAnalysis {
        temperature: analysis.temperature,
        total_mappings: analysis.total_mappings as u32,
        average_mappings_per_char: analysis.average_mappings_per_char,
        average_mapping_length: analysis.average_mapping_length,
        expansion_ratio: analysis.expansion_ratio,
        compute_score: analysis.compute_score,
        entropy: analysis.entropy,
    }
}

/// Get expansion ratio for a map
#[napi]
pub fn get_expansion_ratio(map: HashMap<String, Vec<String>>) -> f64 {
    let core_map: std::collections::BTreeMap<char, Vec<String>> = map
        .into_iter()
        .filter_map(|(k, v)| k.chars().next().map(|c| (c, v)))
        .collect();

    voided_core::obfuscation::get_expansion_ratio(&core_map)
}

// ============================================================================
// Utility
// ============================================================================

/// Generate random bytes
#[napi]
pub fn random_bytes(length: u32) -> Buffer {
    let bytes = voided_core::util::random_bytes(length as usize);
    Buffer::from(bytes)
}

/// Securely wipe a buffer
#[napi]
pub fn secure_wipe(mut buffer: Buffer) {
    voided_core::util::secure_wipe(buffer.as_mut());
}

/// Base64 encode
#[napi]
pub fn base64_encode(data: Buffer) -> String {
    voided_core::formats::base64_encode(data.as_ref())
}

/// Base64 decode
#[napi]
pub fn base64_decode(encoded: String) -> Result<Buffer> {
    let bytes = voided_core::formats::base64_decode(&encoded)
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(Buffer::from(bytes))
}

/// Hex encode
#[napi]
pub fn hex_encode(data: Buffer) -> String {
    voided_core::formats::hex_encode(data.as_ref())
}

/// Hex decode
#[napi]
pub fn hex_decode(encoded: String) -> Result<Buffer> {
    let bytes = voided_core::formats::hex_decode(&encoded)
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(Buffer::from(bytes))
}
