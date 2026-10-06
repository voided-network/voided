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

/// Encrypt data using AES-256-GCM.
///
/// This low-level function is stateless and cannot count invocations across
/// processes. Callers must prevent nonce reuse and rotate a key before
/// 2^32 encryptions. Prefer XChaCha20-Poly1305 for distributed or very
/// high-volume systems where global per-key invocation accounting is not
/// reliable.
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
    encrypt_with_nonce(plaintext, key, &generate_nonce(), aad)
}

/// Encrypt once with Voided-generated nonce-dependent authenticated metadata.
///
/// The callback receives the generated nonce before encryption and must return
/// the exact AAD that the receiver will reconstruct. It cannot select or reuse
/// a nonce. The same per-key AES-GCM invocation limit as [`encrypt_aes_gcm`]
/// applies; this function does not provide distributed invocation accounting.
pub fn encrypt_aes_gcm_with_nonce_aad(
    plaintext: &[u8],
    key: &Key,
    make_aad: impl FnOnce(&[u8]) -> Vec<u8>,
) -> Result<EncryptionResult> {
    let nonce_bytes = generate_nonce();
    let aad = make_aad(&nonce_bytes);
    encrypt_with_nonce(plaintext, key, &nonce_bytes, &aad)
}

fn generate_nonce() -> [u8; NONCE_SIZE] {
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    nonce_bytes
}

fn encrypt_with_nonce(
    plaintext: &[u8],
    key: &Key,
    nonce_bytes: &[u8; NONCE_SIZE],
    aad: &[u8],
) -> Result<EncryptionResult> {
    let nonce = Nonce::from_slice(nonce_bytes);

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

    // Combine ciphertext and tag for decryption
    let mut ciphertext_with_tag = encrypted.ciphertext.clone();
    ciphertext_with_tag.extend_from_slice(&encrypted.tag);
    decrypt_aes_gcm_sealed(&ciphertext_with_tag, &encrypted.nonce, key, aad)
}

/// Open borrowed AES-256-GCM ciphertext with its appended 16-byte tag.
///
/// This keeps framing adapters from copying a large ciphertext into separate
/// owned ciphertext/tag vectors and then joining those vectors again.
pub fn decrypt_aes_gcm_sealed(
    ciphertext_with_tag: &[u8],
    nonce_bytes: &[u8],
    key: &Key,
    aad: &[u8],
) -> Result<Vec<u8>> {
    if nonce_bytes.len() != NONCE_SIZE {
        return Err(Error::InvalidNonceLength {
            expected: NONCE_SIZE,
            actual: nonce_bytes.len(),
        });
    }
    if ciphertext_with_tag.len() < TAG_SIZE {
        return Err(Error::AuthenticationFailed);
    }
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(key.as_bytes())
        .map_err(|e| Error::DecryptionFailed(e.to_string()))?;

    // Decrypt with AAD if provided
    let plaintext = if aad.is_empty() {
        cipher.decrypt(nonce, ciphertext_with_tag)
    } else {
        use aes_gcm::aead::Payload;
        cipher.decrypt(
            nonce,
            Payload {
                msg: ciphertext_with_tag,
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

    fn sealed(result: &EncryptionResult) -> Vec<u8> {
        [result.ciphertext.as_slice(), result.tag.as_slice()].concat()
    }

    #[test]
    fn nonce_dependent_aad_is_built_once_and_authenticated() {
        let key = generate_key();
        let mut calls = 0;
        let encrypted = encrypt_aes_gcm_with_nonce_aad(b"immutable object", &key, |nonce| {
            calls += 1;
            [b"header:".as_slice(), nonce].concat()
        })
        .unwrap();
        assert_eq!(calls, 1);
        let aad = [b"header:".as_slice(), &encrypted.nonce].concat();
        assert_eq!(
            decrypt_aes_gcm_sealed(&sealed(&encrypted), &encrypted.nonce, &key, &aad).unwrap(),
            b"immutable object"
        );
        assert!(matches!(
            decrypt_aes_gcm_sealed(
                &sealed(&encrypted),
                &encrypted.nonce,
                &key,
                b"different header"
            ),
            Err(Error::AuthenticationFailed)
        ));
        let next = encrypt_aes_gcm_with_nonce_aad(b"immutable object", &key, |nonce| {
            [b"header:".as_slice(), nonce].concat()
        })
        .unwrap();
        assert_ne!(encrypted.nonce, next.nonce);
    }

    #[test]
    fn borrowed_sealed_reader_rejects_invalid_or_tampered_input() {
        let key = generate_key();
        let encrypted = encrypt_aes_gcm(b"immutable object", &key, b"header").unwrap();
        let bytes = sealed(&encrypted);
        for length in [0, NONCE_SIZE - 1, NONCE_SIZE + 1] {
            assert!(matches!(
                decrypt_aes_gcm_sealed(&bytes, &vec![0; length], &key, b"header"),
                Err(Error::InvalidNonceLength { .. })
            ));
        }
        for length in 0..TAG_SIZE {
            assert!(matches!(
                decrypt_aes_gcm_sealed(&bytes[..length], &encrypted.nonce, &key, b"header"),
                Err(Error::AuthenticationFailed)
            ));
        }
        for offset in [0, bytes.len() - 1] {
            let mut tampered = bytes.clone();
            tampered[offset] ^= 1;
            assert!(matches!(
                decrypt_aes_gcm_sealed(&tampered, &encrypted.nonce, &key, b"header"),
                Err(Error::AuthenticationFailed)
            ));
        }
        let mut nonce = encrypted.nonce.clone();
        nonce[0] ^= 1;
        assert!(matches!(
            decrypt_aes_gcm_sealed(&bytes, &nonce, &key, b"header"),
            Err(Error::AuthenticationFailed)
        ));
        assert!(matches!(
            decrypt_aes_gcm_sealed(&bytes, &encrypted.nonce, &generate_key(), b"header"),
            Err(Error::AuthenticationFailed)
        ));
    }

    #[test]
    fn borrowed_and_owned_readers_interoperate_for_empty_payloads() {
        let key = generate_key();
        for plaintext in [b"".as_slice(), b"message"] {
            for aad in [b"".as_slice(), b"header"] {
                let encrypted = encrypt_aes_gcm(plaintext, &key, aad).unwrap();
                let callback =
                    encrypt_aes_gcm_with_nonce_aad(plaintext, &key, |_| aad.to_vec()).unwrap();
                assert_eq!(
                    decrypt_aes_gcm_sealed(&sealed(&encrypted), &encrypted.nonce, &key, aad)
                        .unwrap(),
                    plaintext
                );
                assert_eq!(decrypt_aes_gcm(&callback, &key, aad).unwrap(), plaintext);
            }
        }
    }

    #[test]
    fn borrowed_reader_opens_fixed_aes256_gcm_vector() {
        let key = Key::from_bytes(&[0; 32]).unwrap();
        let bytes =
            hex_literal::hex!("cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919");
        assert_eq!(
            decrypt_aes_gcm_sealed(&bytes, &[0; NONCE_SIZE], &key, &[]).unwrap(),
            [0; 16]
        );
    }

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
