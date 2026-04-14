//! Node.js native binding for voided-core encryption library.
//!
//! This crate provides N-API bindings to expose voided-core's crypto primitives
//! to Node.js applications.

#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::{Deserialize, Serialize};

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

/// Fused shell metadata
#[napi(object)]
#[derive(Clone)]
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
#[napi(object)]
#[derive(Clone)]
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
    pub shell_nonce: Buffer,
}

/// Result of a protect or repack operation.
#[napi(object)]
#[derive(Clone)]
pub struct ProtectResult {
    pub artifact: Buffer,
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
    pub shell_nonce: Buffer,
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
// Fused shell / full-flow
// ============================================================================

fn parse_key(key: Buffer) -> Result<voided_core::encryption::Key> {
    voided_core::encryption::Key::from_bytes(key.as_ref())
        .map_err(|e| Error::from_reason(e.to_string()))
}

fn parse_preset(preset: Option<String>) -> Result<voided_core::shell::FusedPreset> {
    preset
        .as_deref()
        .map(voided_core::shell::FusedPreset::from_name)
        .transpose()
        .map_err(|e| Error::from_reason(e.to_string()))
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

fn artifact_info_from_core(
    info: voided_core::shell::ProtectedArtifactInfo,
) -> ProtectedArtifactInfo {
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
        shell_nonce: Buffer::from(info.shell_nonce.to_vec()),
    }
}

fn protect_result_from_core(result: voided_core::shell::ProtectResult) -> ProtectResult {
    ProtectResult {
        artifact: Buffer::from(result.artifact),
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
        shell_nonce: Buffer::from(result.info.shell_nonce.to_vec()),
    }
}

/// Fuse arbitrary bytes with the fused shell primitive.
#[napi]
pub fn fuse(
    data: Buffer,
    key: Buffer,
    preset: Option<String>,
    chunk_size: Option<u32>,
) -> Result<Buffer> {
    let key = parse_key(key)?;
    let preset = parse_preset(preset)?;
    let bytes = voided_core::shell::fuse_bytes(
        data.as_ref(),
        &key,
        Some(voided_core::shell::FusedShellOptions {
            preset,
            chunk_size: chunk_size.map(|size| size as usize),
            shell_nonce: None,
        }),
    )
    .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(bytes))
}

/// Reverse the fused shell primitive.
#[napi]
pub fn unfuse(data: Buffer, key: Buffer) -> Result<Buffer> {
    let key = parse_key(key)?;
    let bytes = voided_core::shell::unfuse_bytes(data.as_ref(), &key)
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(Buffer::from(bytes))
}

/// Inspect a fused shell envelope without a key.
#[napi]
pub fn inspect_fused(data: Buffer) -> Result<FusedShellInfo> {
    let info = voided_core::shell::inspect_fused(data.as_ref())
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(shell_info_from_core(info))
}

/// Protect bytes with the fused-first Voided v2 full flow.
#[napi]
pub fn protect(
    data: Buffer,
    key: Buffer,
    preset: Option<String>,
    compression_algorithm: Option<String>,
    compression_level: Option<u32>,
    encryption_algorithm: Option<String>,
    shell_chunk_size: Option<u32>,
) -> Result<ProtectResult> {
    let key = parse_key(key)?;
    let preset = parse_preset(preset)?;
    let result = voided_core::shell::protect(
        data.as_ref(),
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
    .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(protect_result_from_core(result))
}

/// Open a fused protected artifact.
#[napi(js_name = "open")]
pub fn open_artifact(artifact: Buffer, key: Buffer) -> Result<Buffer> {
    let key = parse_key(key)?;
    let bytes = voided_core::shell::open(artifact.as_ref(), &key)
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(Buffer::from(bytes))
}

/// Inspect a fused protected artifact without a key.
#[napi]
pub fn inspect_artifact(artifact: Buffer) -> Result<ProtectedArtifactInfo> {
    let info = voided_core::shell::inspect_artifact(artifact.as_ref())
        .map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(artifact_info_from_core(info))
}

/// Repack an artifact under a new fused preset/profile.
#[napi]
pub fn repack_artifact(
    artifact: Buffer,
    key: Buffer,
    preset: Option<String>,
    compression_algorithm: Option<String>,
    compression_level: Option<u32>,
    encryption_algorithm: Option<String>,
    shell_chunk_size: Option<u32>,
) -> Result<ProtectResult> {
    let key = parse_key(key)?;
    let preset = parse_preset(preset)?;
    let result = voided_core::shell::repack_artifact(
        artifact.as_ref(),
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
    .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(protect_result_from_core(result))
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
