//! AES-256-GCM encryption implementation

use super::{Algorithm, EncryptionResult, Key};
use crate::{Error, Result};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use alloc::vec::Vec;
use rand::RngCore;

/// Nonce size for AES-256-GCM (96 bits)
pub const NONCE_SIZE: usize = 12;

/// Tag size for AES-256-GCM (128 bits)
pub const TAG_SIZE: usize = 16;

/// Encrypt data using AES-256-GCM
///
/// # Arguments
///
/// * `plaintext` - Data to encrypt
/// * `key` - 256-bit encryption key
/// * `aad` - Additional authenticated data (can be empty)
///
/// # Returns
///
/// Encrypted data with nonce and authentication tag
pub fn encrypt_aes_gcm(plaintext: &[u8], key: &Key, aad: &[u8]) -> Result<EncryptionResult> {
    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Create cipher
    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .map_err(|e| Error::EncryptionFailed(e.to_string()))?;

    // Encrypt with AAD if provided
    let ciphertext_with_tag = if aad.is_empty() {
        cipher.encrypt(nonce, plaintext)
    } else {
        use aes_gcm::aead::Payload;
        cipher.encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
    }
    .map_err(|e| Error::EncryptionFailed(e.to_string()))?;

    // Split ciphertext and tag
    let (ciphertext, tag) = ciphertext_with_tag.split_at(ciphertext_with_tag.len() - TAG_SIZE);

    Ok(EncryptionResult {
        ciphertext: ciphertext.to_vec(),
        algorithm: Algorithm::Aes256Gcm,
        nonce: nonce_bytes.to_vec(),
        tag: tag.to_vec(),
    })
}

/// Decrypt data using AES-256-GCM
///
/// # Arguments
///
/// * `encrypted` - Encrypted data with nonce and tag
/// * `key` - 256-bit decryption key
/// * `aad` - Additional authenticated data (must match encryption)
///
/// # Returns
///
/// Decrypted plaintext
pub fn decrypt_aes_gcm(encrypted: &EncryptionResult, key: &Key, aad: &[u8]) -> Result<Vec<u8>> {
    // Validate algorithm matches
    if encrypted.algorithm != Algorithm::Aes256Gcm {
        return Err(Error::DecryptionFailed(format!(
            "Algorithm mismatch: expected {:?}, got {:?}",
            Algorithm::Aes256Gcm,
            encrypted.algorithm
        )));
    }

    // Validate nonce length
    if encrypted.nonce.len() != NONCE_SIZE {
        return Err(Error::InvalidNonceLength {
            expected: NONCE_SIZE,
            actual: encrypted.nonce.len(),
        });
    }

    // Validate tag length
    if encrypted.tag.len() != TAG_SIZE {
        return Err(Error::DecryptionFailed(format!(
            "Invalid tag length: expected {}, got {}",
            TAG_SIZE,
            encrypted.tag.len()
        )));
    }

    let nonce = Nonce::from_slice(&encrypted.nonce);

    // Create cipher
    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .map_err(|e| Error::DecryptionFailed(e.to_string()))?;

    // Combine ciphertext and tag for decryption
    let mut ciphertext_with_tag = encrypted.ciphertext.clone();
    ciphertext_with_tag.extend_from_slice(&encrypted.tag);

    // Decrypt with AAD if provided
    let plaintext = if aad.is_empty() {
        cipher.decrypt(nonce, ciphertext_with_tag.as_ref())
    } else {
        use aes_gcm::aead::Payload;
        cipher.decrypt(
            nonce,
            Payload {
                msg: ciphertext_with_tag.as_ref(),
                aad,
            },
        )
    }
    .map_err(|_| Error::AuthenticationFailed)?;

    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encryption::generate_key;

    #[test]
    fn test_aes_gcm_roundtrip() {
        let key = generate_key();
        let plaintext = b"Hello, AES-GCM!";

        let encrypted = encrypt_aes_gcm(plaintext, &key, &[]).unwrap();
        assert_eq!(encrypted.algorithm, Algorithm::Aes256Gcm);
        assert_eq!(encrypted.nonce.len(), NONCE_SIZE);
        assert_eq!(encrypted.tag.len(), TAG_SIZE);

        let decrypted = decrypt_aes_gcm(&encrypted, &key, &[]).unwrap();
        assert_eq!(plaintext, &decrypted[..]);
    }

    #[test]
    fn test_aes_gcm_with_aad() {
        let key = generate_key();
        let plaintext = b"Secret message";
        let aad = b"additional authenticated data";

        let encrypted = encrypt_aes_gcm(plaintext, &key, aad).unwrap();
        let decrypted = decrypt_aes_gcm(&encrypted, &key, aad).unwrap();

        assert_eq!(plaintext, &decrypted[..]);
    }

    #[test]
    fn test_aes_gcm_wrong_key() {
        let key = generate_key();
        let wrong_key = generate_key();
        let plaintext = b"Secret message";

        let encrypted = encrypt_aes_gcm(plaintext, &key, &[]).unwrap();
        let result = decrypt_aes_gcm(&encrypted, &wrong_key, &[]);

        assert!(matches!(result, Err(Error::AuthenticationFailed)));
    }

    #[test]
    fn test_aes_gcm_tampered_ciphertext() {
        let key = generate_key();
        let plaintext = b"Secret message";

        let mut encrypted = encrypt_aes_gcm(plaintext, &key, &[]).unwrap();

        // Tamper with ciphertext
        if !encrypted.ciphertext.is_empty() {
            encrypted.ciphertext[0] ^= 0xFF;
        }

        let result = decrypt_aes_gcm(&encrypted, &key, &[]);
        assert!(matches!(result, Err(Error::AuthenticationFailed)));
    }

    #[test]
    fn test_aes_gcm_tampered_tag() {
        let key = generate_key();
        let plaintext = b"Secret message";

        let mut encrypted = encrypt_aes_gcm(plaintext, &key, &[]).unwrap();

        // Tamper with tag
        encrypted.tag[0] ^= 0xFF;

        let result = decrypt_aes_gcm(&encrypted, &key, &[]);
        assert!(matches!(result, Err(Error::AuthenticationFailed)));
    }
}
