//! Encryption module providing AEAD encryption primitives.
//!
//! Supports AES-256-GCM (primary) and XChaCha20-Poly1305 (preferred when available).

mod aes_gcm;
mod key;
mod xchacha20;

pub use aes_gcm::{decrypt_aes_gcm, encrypt_aes_gcm};
pub use key::{
    derive_key_from_shared_secret, derive_key_hkdf, derive_key_hkdf_raw, derive_key_pbkdf2,
    generate_key, generate_x25519_key_pair, x25519_shared_secret, Key, X25519KeyPair,
    X25519_KEY_SIZE,
};
pub use xchacha20::{decrypt_xchacha20, encrypt_xchacha20};

use crate::{Error, Result, FORMAT_VERSION, MAGIC_ENCRYPTED};
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

/// Supported encryption algorithms
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum Algorithm {
    /// AES-256-GCM with 12-byte nonce
    Aes256Gcm = 0x01,
    /// XChaCha20-Poly1305 with 24-byte nonce
    XChaCha20Poly1305 = 0x02,
}

impl Algorithm {
    /// Get algorithm from byte identifier
    pub fn from_byte(byte: u8) -> Result<Self> {
        match byte {
            0x01 => Ok(Algorithm::Aes256Gcm),
            0x02 => Ok(Algorithm::XChaCha20Poly1305),
            _ => Err(Error::UnsupportedAlgorithm(byte)),
        }
    }

    /// Get nonce length for this algorithm
    pub fn nonce_len(&self) -> usize {
        match self {
            Algorithm::Aes256Gcm => 12,
            Algorithm::XChaCha20Poly1305 => 24,
        }
    }

    /// Get algorithm name as string
    pub fn name(&self) -> &'static str {
        match self {
            Algorithm::Aes256Gcm => "aes-256-gcm",
            Algorithm::XChaCha20Poly1305 => "xchacha20-poly1305",
        }
    }
}

/// Result of an encryption operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionResult {
    /// Encrypted ciphertext
    pub ciphertext: Vec<u8>,
    /// Algorithm used
    pub algorithm: Algorithm,
    /// Nonce/IV used
    pub nonce: Vec<u8>,
    /// Authentication tag
    pub tag: Vec<u8>,
}

impl EncryptionResult {
    /// Serialize to binary format
    pub fn to_bytes(&self) -> Vec<u8> {
        let nonce_len = self.nonce.len();
        let total_len = 8 + nonce_len + self.ciphertext.len() + self.tag.len();
        let mut buf = Vec::with_capacity(total_len);

        // Magic bytes
        buf.extend_from_slice(MAGIC_ENCRYPTED);
        // Version
        buf.push(FORMAT_VERSION);
        // Algorithm
        buf.push(self.algorithm as u8);
        // Nonce length
        buf.push(nonce_len as u8);
        // Reserved
        buf.push(0x00);
        // Nonce
        buf.extend_from_slice(&self.nonce);
        // Ciphertext
        buf.extend_from_slice(&self.ciphertext);
        // Tag
        buf.extend_from_slice(&self.tag);

        buf
    }

    /// Deserialize from binary format
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        if data.len() < 8 {
            return Err(Error::TruncatedPayload {
                expected: 8,
                actual: data.len(),
            });
        }

        // Check magic
        if &data[0..4] != MAGIC_ENCRYPTED {
            return Err(Error::InvalidFormat);
        }

        // Check version
        let version = data[4];
        if version != FORMAT_VERSION {
            return Err(Error::UnsupportedVersion(version));
        }

        // Parse algorithm
        let algorithm = Algorithm::from_byte(data[5])?;

        // Parse nonce length
        let nonce_len = data[6] as usize;
        if nonce_len != algorithm.nonce_len() {
            return Err(Error::InvalidNonceLength {
                expected: algorithm.nonce_len(),
                actual: nonce_len,
            });
        }

        // Minimum size check
        let min_size = 8 + nonce_len + 16; // header + nonce + tag
        if data.len() < min_size {
            return Err(Error::TruncatedPayload {
                expected: min_size,
                actual: data.len(),
            });
        }

        // Extract nonce
        let nonce = data[8..8 + nonce_len].to_vec();

        // Extract tag (last 16 bytes)
        let tag = data[data.len() - 16..].to_vec();

        // Extract ciphertext (between nonce and tag)
        let ciphertext = data[8 + nonce_len..data.len() - 16].to_vec();

        Ok(EncryptionResult {
            ciphertext,
            algorithm,
            nonce,
            tag,
        })
    }

    /// Serialize to JSON format
    pub fn to_json(&self) -> Result<String> {
        #[derive(Serialize)]
        struct JsonFormat<'a> {
            v: &'static str,
            alg: &'a str,
            nonce: String,
            ct: String,
            tag: String,
        }

        use base64::{engine::general_purpose::STANDARD, Engine};

        let json = JsonFormat {
            v: "1.0",
            alg: self.algorithm.name(),
            nonce: STANDARD.encode(&self.nonce),
            ct: STANDARD.encode(&self.ciphertext),
            tag: STANDARD.encode(&self.tag),
        };

        serde_json::to_string(&json).map_err(|e| Error::SerializationError(e.to_string()))
    }

    /// Deserialize from JSON format
    pub fn from_json(json: &str) -> Result<Self> {
        #[derive(Deserialize)]
        struct JsonFormat {
            v: String,
            alg: String,
            nonce: String,
            ct: String,
            tag: String,
        }

        let parsed: JsonFormat = serde_json::from_str(json)?;

        if parsed.v != "1.0" {
            return Err(Error::UnsupportedVersion(0));
        }

        let algorithm = match parsed.alg.as_str() {
            "aes-256-gcm" => Algorithm::Aes256Gcm,
            "xchacha20-poly1305" => Algorithm::XChaCha20Poly1305,
            _ => return Err(Error::UnsupportedAlgorithm(0)),
        };

        use base64::{engine::general_purpose::STANDARD, Engine};

        Ok(EncryptionResult {
            ciphertext: STANDARD.decode(&parsed.ct)?,
            algorithm,
            nonce: STANDARD.decode(&parsed.nonce)?,
            tag: STANDARD.decode(&parsed.tag)?,
        })
    }
}

impl Drop for EncryptionResult {
    fn drop(&mut self) {
        self.ciphertext.zeroize();
        self.nonce.zeroize();
        self.tag.zeroize();
    }
}

/// Encryption options
#[derive(Debug, Clone, Default)]
pub struct EncryptOptions {
    /// Preferred algorithm (defaults to AES-256-GCM)
    pub algorithm: Option<Algorithm>,
    /// Additional authenticated data
    pub aad: Option<Vec<u8>>,
}

/// Encrypt data using AEAD encryption.
///
/// Prefers XChaCha20-Poly1305 if specified, otherwise uses AES-256-GCM.
///
/// # Arguments
///
/// * `plaintext` - Data to encrypt
/// * `key` - 256-bit encryption key
/// * `options` - Optional encryption options
///
/// # Returns
///
/// Encrypted data with algorithm, nonce, and authentication tag.
pub fn encrypt(
    plaintext: &[u8],
    key: &Key,
    options: Option<EncryptOptions>,
) -> Result<EncryptionResult> {
    let opts = options.unwrap_or_default();
    let algorithm = opts.algorithm.unwrap_or(Algorithm::Aes256Gcm);
    let aad = opts.aad.as_deref().unwrap_or(&[]);

    match algorithm {
        Algorithm::Aes256Gcm => encrypt_aes_gcm(plaintext, key, aad),
        Algorithm::XChaCha20Poly1305 => encrypt_xchacha20(plaintext, key, aad),
    }
}

/// Decrypt data using AEAD decryption.
///
/// Automatically detects the algorithm from the encrypted data.
///
/// # Arguments
///
/// * `encrypted` - Encrypted data (binary format or EncryptionResult)
/// * `key` - 256-bit decryption key
///
/// # Returns
///
/// Decrypted plaintext.
pub fn decrypt(encrypted: &EncryptionResult, key: &Key) -> Result<Vec<u8>> {
    decrypt_with_aad(encrypted, key, &[])
}

/// Decrypt data using AEAD decryption with Additional Authenticated Data.
///
/// # Arguments
///
/// * `encrypted` - Encrypted data (binary format or EncryptionResult)
/// * `key` - 256-bit decryption key
/// * `aad` - Additional authenticated data (must match what was used during encryption)
///
/// # Returns
///
/// Decrypted plaintext.
pub fn decrypt_with_aad(encrypted: &EncryptionResult, key: &Key, aad: &[u8]) -> Result<Vec<u8>> {
    match encrypted.algorithm {
        Algorithm::Aes256Gcm => decrypt_aes_gcm(encrypted, key, aad),
        Algorithm::XChaCha20Poly1305 => decrypt_xchacha20(encrypted, key, aad),
    }
}

/// Decrypt data from binary format.
pub fn decrypt_bytes(data: &[u8], key: &Key) -> Result<Vec<u8>> {
    let encrypted = EncryptionResult::from_bytes(data)?;
    decrypt(&encrypted, key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = generate_key();
        let plaintext = b"Hello, World!";

        let encrypted = encrypt(plaintext, &key, None).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();

        assert_eq!(plaintext, &decrypted[..]);
    }

    #[test]
    fn test_binary_serialization() {
        let key = generate_key();
        let plaintext = b"Test data for serialization";

        let encrypted = encrypt(plaintext, &key, None).unwrap();
        let bytes = encrypted.to_bytes();
        let restored = EncryptionResult::from_bytes(&bytes).unwrap();

        assert_eq!(encrypted.algorithm, restored.algorithm);
        assert_eq!(encrypted.nonce, restored.nonce);
        assert_eq!(encrypted.ciphertext, restored.ciphertext);
        assert_eq!(encrypted.tag, restored.tag);
    }

    #[test]
    fn test_json_serialization() {
        let key = generate_key();
        let plaintext = b"Test data for JSON";

        let encrypted = encrypt(plaintext, &key, None).unwrap();
        let json = encrypted.to_json().unwrap();
        let restored = EncryptionResult::from_json(&json).unwrap();

        assert_eq!(encrypted.algorithm, restored.algorithm);
        assert_eq!(encrypted.nonce, restored.nonce);
        assert_eq!(encrypted.ciphertext, restored.ciphertext);
        assert_eq!(encrypted.tag, restored.tag);
    }
}
