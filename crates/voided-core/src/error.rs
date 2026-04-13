//! Error types for voided-core

use thiserror::Error;

/// Result type alias for voided-core operations
pub type Result<T> = core::result::Result<T, Error>;

/// Errors that can occur during cryptographic operations
#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// Invalid format - magic bytes mismatch
    #[error("Invalid format: expected magic bytes")]
    InvalidFormat,

    /// Unsupported version number
    #[error("Unsupported version: {0}")]
    UnsupportedVersion(u8),

    /// Unsupported algorithm identifier
    #[error("Unsupported algorithm: {0}")]
    UnsupportedAlgorithm(u8),

    /// Unsupported fused preset identifier
    #[error("Unsupported fused preset: {0}")]
    UnsupportedPreset(u8),

    /// Data shorter than expected
    #[error("Truncated payload: expected at least {expected} bytes, got {actual}")]
    TruncatedPayload {
        /// Expected minimum size in bytes
        expected: usize,
        /// Actual size received
        actual: usize,
    },

    /// Authentication tag verification failed
    #[error("Authentication failed: invalid tag")]
    AuthenticationFailed,

    /// Encryption operation failed
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),

    /// Decryption operation failed
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),

    /// Decompression failed
    #[error("Decompression failed: {0}")]
    DecompressionFailed(String),

    /// Compression failed
    #[error("Compression failed: {0}")]
    CompressionFailed(String),

    /// Invalid UTF-8 sequence
    #[error("Invalid UTF-8: {0}")]
    InvalidUtf8(String),

    /// Invalid Base64 encoding
    #[error("Invalid Base64: {0}")]
    InvalidBase64(String),

    /// Invalid hex encoding
    #[error("Invalid hex: {0}")]
    InvalidHex(String),

    /// Size mismatch after decompression
    #[error("Size mismatch: expected {expected}, got {actual}")]
    SizeMismatch {
        /// Expected size in bytes
        expected: usize,
        /// Actual size in bytes
        actual: usize,
    },

    /// Required field missing in JSON
    #[error("Missing field: {0}")]
    MissingField(String),

    /// Invalid key format
    #[error("Invalid key format: {0}")]
    InvalidKeyFormat(String),

    /// Invalid key length
    #[error("Invalid key length: expected {expected}, got {actual}")]
    InvalidKeyLength {
        /// Expected key length in bytes
        expected: usize,
        /// Actual key length in bytes
        actual: usize,
    },

    /// Invalid nonce length
    #[error("Invalid nonce length: expected {expected}, got {actual}")]
    InvalidNonceLength {
        /// Expected nonce length in bytes
        expected: usize,
        /// Actual nonce length in bytes
        actual: usize,
    },

    /// Invalid runtime configuration
    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    /// Signing operation failed
    #[error("Signing failed: {0}")]
    SigningFailed(String),

    /// Signature verification failed
    #[error("Signature verification failed")]
    SignatureVerificationFailed,

    /// Key generation failed
    #[error("Key generation failed: {0}")]
    KeyGenerationFailed(String),

    /// Key derivation failed
    #[error("Key derivation failed: {0}")]
    KeyDerivationFailed(String),

    /// Hash operation failed
    #[error("Hash operation failed: {0}")]
    HashFailed(String),

    /// Payload too large
    #[error("Payload too large: {size} bytes exceeds limit of {limit} bytes")]
    PayloadTooLarge {
        /// Actual payload size in bytes
        size: usize,
        /// Maximum allowed size in bytes
        limit: usize,
    },

    /// Random number generation failed
    #[error("Random generation failed: {0}")]
    RandomFailed(String),

    /// Serialization error
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// Deserialization error
    #[error("Deserialization error: {0}")]
    DeserializationError(String),
}

impl From<base64::DecodeError> for Error {
    fn from(e: base64::DecodeError) -> Self {
        Error::InvalidBase64(e.to_string())
    }
}

impl From<core::str::Utf8Error> for Error {
    fn from(e: core::str::Utf8Error) -> Self {
        Error::InvalidUtf8(e.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::DeserializationError(e.to_string())
    }
}
