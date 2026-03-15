//! XChaCha20-Poly1305 encryption implementation

use super::{Algorithm, EncryptionResult, Key};
use crate::{Error, Result};
use alloc::vec::Vec;
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;

/// Nonce size for XChaCha20-Poly1305 (192 bits)
pub const NONCE_SIZE: usize = 24;

/// Tag size for XChaCha20-Poly1305 (128 bits)
pub const TAG_SIZE: usize = 16;

/// Encrypt data using XChaCha20-Poly1305
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
pub fn encrypt_xchacha20(plaintext: &[u8], key: &Key, aad: &[u8]) -> Result<EncryptionResult> {
    // Generate random nonce (24 bytes for XChaCha20)
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    // Create cipher
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|e| Error::EncryptionFailed(e.to_string()))?;

    // Encrypt with AAD if provided
    let ciphertext_with_tag = if aad.is_empty() {
        cipher.encrypt(nonce, plaintext)
    } else {
        use chacha20poly1305::aead::Payload;
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
        algorithm: Algorithm::XChaCha20Poly1305,
        nonce: nonce_bytes.to_vec(),
        tag: tag.to_vec(),
    })
}

/// Decrypt data using XChaCha20-Poly1305
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
pub fn decrypt_xchacha20(encrypted: &EncryptionResult, key: &Key, aad: &[u8]) -> Result<Vec<u8>> {
    // Validate algorithm matches
    if encrypted.algorithm != Algorithm::XChaCha20Poly1305 {
        return Err(Error::DecryptionFailed(format!(
            "Algorithm mismatch: expected {:?}, got {:?}",
            Algorithm::XChaCha20Poly1305,
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

    let nonce = XNonce::from_slice(&encrypted.nonce);

    // Create cipher
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|e| Error::DecryptionFailed(e.to_string()))?;

    // Combine ciphertext and tag for decryption
    let mut ciphertext_with_tag = encrypted.ciphertext.clone();
    ciphertext_with_tag.extend_from_slice(&encrypted.tag);

    // Decrypt with AAD if provided
    let plaintext = if aad.is_empty() {
        cipher.decrypt(nonce, ciphertext_with_tag.as_ref())
    } else {
        use chacha20poly1305::aead::Payload;
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
    fn test_xchacha20_roundtrip() {
        let key = generate_key();
        let plaintext = b"Hello, XChaCha20-Poly1305!";

        let encrypted = encrypt_xchacha20(plaintext, &key, &[]).unwrap();
        assert_eq!(encrypted.algorithm, Algorithm::XChaCha20Poly1305);
        assert_eq!(encrypted.nonce.len(), NONCE_SIZE);
        assert_eq!(encrypted.tag.len(), TAG_SIZE);

        let decrypted = decrypt_xchacha20(&encrypted, &key, &[]).unwrap();
        assert_eq!(plaintext, &decrypted[..]);
    }

    #[test]
    fn test_xchacha20_with_aad() {
        let key = generate_key();
        let plaintext = b"Secret message";
        let aad = b"additional authenticated data";

        let encrypted = encrypt_xchacha20(plaintext, &key, aad).unwrap();
        let decrypted = decrypt_xchacha20(&encrypted, &key, aad).unwrap();

        assert_eq!(plaintext, &decrypted[..]);
    }

    #[test]
    fn test_xchacha20_wrong_key() {
        let key = generate_key();
        let wrong_key = generate_key();
        let plaintext = b"Secret message";

        let encrypted = encrypt_xchacha20(plaintext, &key, &[]).unwrap();
        let result = decrypt_xchacha20(&encrypted, &wrong_key, &[]);

        assert!(matches!(result, Err(Error::AuthenticationFailed)));
    }

    #[test]
    fn test_xchacha20_tampered_ciphertext() {
        let key = generate_key();
        let plaintext = b"Secret message";

        let mut encrypted = encrypt_xchacha20(plaintext, &key, &[]).unwrap();

        // Tamper with ciphertext
        if !encrypted.ciphertext.is_empty() {
            encrypted.ciphertext[0] ^= 0xFF;
        }

        let result = decrypt_xchacha20(&encrypted, &key, &[]);
        assert!(matches!(result, Err(Error::AuthenticationFailed)));
    }
}
