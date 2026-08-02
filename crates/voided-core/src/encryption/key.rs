//! Key generation and derivation

use crate::{Error, Result};
use alloc::vec::Vec;
use rand::RngCore;
use x25519_dalek::{x25519, X25519_BASEPOINT_BYTES};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// 256-bit encryption key
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Key([u8; 32]);

impl Key {
    /// Key size in bytes
    pub const SIZE: usize = 32;

    /// Create a key from raw bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != Self::SIZE {
            return Err(Error::InvalidKeyLength {
                expected: Self::SIZE,
                actual: bytes.len(),
            });
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(bytes);
        Ok(Key(key))
    }

    /// Get the raw key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Export key as Base64 string
    pub fn to_base64(&self) -> String {
        use base64::{engine::general_purpose::STANDARD, Engine};
        STANDARD.encode(self.0)
    }

    /// Import key from Base64 string
    pub fn from_base64(encoded: &str) -> Result<Self> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        // A 32-byte key has exactly 44 padded Base64 characters. Reject before
        // decoding so an attacker-controlled string cannot drive a large
        // temporary allocation merely to fail the key-length check.
        if encoded.len() != 44 || !encoded.ends_with('=') {
            return Err(Error::InvalidKeyFormat(
                "AES-256 key must use canonical padded Base64".to_string(),
            ));
        }
        let mut bytes = STANDARD.decode(encoded)?;
        let result = if STANDARD.encode(&bytes) != encoded {
            Err(Error::InvalidKeyFormat(
                "AES-256 key must use canonical padded Base64".to_string(),
            ))
        } else {
            Self::from_bytes(&bytes)
        };
        bytes.zeroize();
        result
    }
}

impl AsRef<[u8]> for Key {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl core::fmt::Debug for Key {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Key")
            .field("length", &Self::SIZE)
            .finish_non_exhaustive()
    }
}

/// X25519 key size in bytes.
pub const X25519_KEY_SIZE: usize = 32;

/// Maximum HKDF-SHA256 output permitted by RFC 5869 (255 * HashLen).
pub const HKDF_SHA256_MAX_OUTPUT: usize = 255 * 32;

/// Minimum PBKDF2-HMAC-SHA256 work factor accepted by the high-level API.
pub const PBKDF2_MIN_ITERATIONS: u32 = 100_000;

/// Maximum synchronous PBKDF2 work factor accepted by Voided.
///
/// Higher work factors should run in an application-owned worker so untrusted
/// input cannot monopolize a native/WASM execution thread.
pub const PBKDF2_MAX_ITERATIONS: u32 = 1_000_000;

/// Minimum salt size accepted by password-based derivation.
pub const PBKDF2_MIN_SALT_SIZE: usize = 16;

/// Maximum salt size accepted by password-based derivation.
pub const PBKDF2_MAX_SALT_SIZE: usize = 1024;

/// X25519 key pair used for Diffie-Hellman key exchange.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct X25519KeyPair {
    /// Public key (safe to share).
    pub public_key: [u8; X25519_KEY_SIZE],
    /// Private key material (keep secret).
    pub private_key: [u8; X25519_KEY_SIZE],
}

/// Generate a random 256-bit encryption key
pub fn generate_key() -> Key {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    Key(key)
}

/// Derive a key using HKDF-SHA256
///
/// # Arguments
///
/// * `input_key_material` - Input key material (IKM)
/// * `salt` - Optional salt (can be empty)
/// * `info` - Context and application specific information
///
/// # Returns
///
/// Derived 256-bit key
pub fn derive_key_hkdf(input_key_material: &[u8], salt: Option<&[u8]>, info: &[u8]) -> Result<Key> {
    let mut okm = derive_key_hkdf_raw(input_key_material, salt, info, Key::SIZE)?;
    let key = Key::from_bytes(&okm);
    okm.zeroize();
    key
}

/// Derive raw bytes using HKDF-SHA256.
///
/// # Arguments
///
/// * `input_key_material` - Input key material (IKM)
/// * `salt` - Optional salt (can be empty)
/// * `info` - Context and application specific information
/// * `length` - Output length in bytes
pub fn derive_key_hkdf_raw(
    input_key_material: &[u8],
    salt: Option<&[u8]>,
    info: &[u8],
    length: usize,
) -> Result<Vec<u8>> {
    use hkdf::Hkdf;
    use sha2::Sha256;

    if length == 0 {
        return Err(Error::KeyDerivationFailed(
            "HKDF output length must be > 0".to_string(),
        ));
    }
    if length > HKDF_SHA256_MAX_OUTPUT {
        return Err(Error::KeyDerivationFailed(format!(
            "HKDF-SHA256 output length must be at most {HKDF_SHA256_MAX_OUTPUT} bytes"
        )));
    }

    let hk = Hkdf::<Sha256>::new(salt, input_key_material);
    let mut okm = vec![0u8; length];

    hk.expand(info, &mut okm)
        .map_err(|e| Error::KeyDerivationFailed(e.to_string()))?;

    Ok(okm)
}

/// Derive a key using PBKDF2-HMAC-SHA256
///
/// # Arguments
///
/// * `password` - Password to derive from
/// * `salt` - Salt bytes (should be at least 16 bytes)
/// * `iterations` - Number of iterations (minimum 100,000 recommended)
///
/// # Returns
///
/// Derived 256-bit key
pub fn derive_key_pbkdf2(password: &[u8], salt: &[u8], iterations: u32) -> Result<Key> {
    use pbkdf2::pbkdf2_hmac;
    use sha2::Sha256;

    validate_pbkdf2_parameters(salt, iterations)?;

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password, salt, iterations, &mut key);

    Ok(Key(key))
}

/// Validate the bounded policy used by Voided's synchronous PBKDF2 APIs.
pub fn validate_pbkdf2_parameters(salt: &[u8], iterations: u32) -> Result<()> {
    if !(PBKDF2_MIN_SALT_SIZE..=PBKDF2_MAX_SALT_SIZE).contains(&salt.len()) {
        return Err(Error::InvalidConfiguration(format!(
            "PBKDF2 salt must be between {PBKDF2_MIN_SALT_SIZE} and {PBKDF2_MAX_SALT_SIZE} bytes"
        )));
    }
    if !(PBKDF2_MIN_ITERATIONS..=PBKDF2_MAX_ITERATIONS).contains(&iterations) {
        return Err(Error::InvalidConfiguration(format!(
            "PBKDF2 iterations must be between {PBKDF2_MIN_ITERATIONS} and {PBKDF2_MAX_ITERATIONS}"
        )));
    }
    Ok(())
}

/// Generate an X25519 key pair.
///
/// If `seed` is provided, generation is deterministic.
pub fn generate_x25519_key_pair(seed: Option<&[u8]>) -> Result<X25519KeyPair> {
    let mut private_key = [0u8; X25519_KEY_SIZE];

    if let Some(seed_bytes) = seed {
        if seed_bytes.len() != X25519_KEY_SIZE {
            return Err(Error::InvalidKeyLength {
                expected: X25519_KEY_SIZE,
                actual: seed_bytes.len(),
            });
        }
        private_key.copy_from_slice(seed_bytes);
    } else {
        rand::thread_rng().fill_bytes(&mut private_key);
    }

    let public_key = x25519(private_key, X25519_BASEPOINT_BYTES);
    Ok(X25519KeyPair {
        public_key,
        private_key,
    })
}

/// Compute X25519 shared secret.
pub fn x25519_shared_secret(
    our_private_key: &[u8],
    their_public_key: &[u8],
) -> Result<[u8; X25519_KEY_SIZE]> {
    if our_private_key.len() != X25519_KEY_SIZE {
        return Err(Error::InvalidKeyLength {
            expected: X25519_KEY_SIZE,
            actual: our_private_key.len(),
        });
    }
    if their_public_key.len() != X25519_KEY_SIZE {
        return Err(Error::InvalidKeyLength {
            expected: X25519_KEY_SIZE,
            actual: their_public_key.len(),
        });
    }

    let mut private_key = [0u8; X25519_KEY_SIZE];
    private_key.copy_from_slice(our_private_key);

    let mut public_key = [0u8; X25519_KEY_SIZE];
    public_key.copy_from_slice(their_public_key);

    let mut shared_secret = x25519(private_key, public_key);
    private_key.zeroize();

    let shared_secret_or = shared_secret.iter().fold(0u8, |acc, byte| acc | byte);
    if shared_secret_or == 0 {
        shared_secret.zeroize();
        return Err(Error::KeyDerivationFailed(
            "X25519 agreement rejected an all-zero shared secret from a low-order or invalid public key"
                .to_string(),
        ));
    }

    Ok(shared_secret)
}

/// Derive a 256-bit AEAD key from a raw X25519 shared secret.
pub fn derive_key_from_shared_secret(shared_secret: &[u8], salt: &str, info: &str) -> Result<Key> {
    if shared_secret.len() != X25519_KEY_SIZE {
        return Err(Error::InvalidKeyLength {
            expected: X25519_KEY_SIZE,
            actual: shared_secret.len(),
        });
    }
    if shared_secret.iter().fold(0u8, |acc, byte| acc | byte) == 0 {
        return Err(Error::KeyDerivationFailed(
            "shared secret must not be all zero".to_string(),
        ));
    }
    derive_key_hkdf(shared_secret, Some(salt.as_bytes()), info.as_bytes())
}

/// Generate a random salt for key derivation
#[allow(dead_code)]
pub fn generate_salt(length: usize) -> Vec<u8> {
    let mut salt = vec![0u8; length];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_generation() {
        let key1 = generate_key();
        let key2 = generate_key();

        // Keys should be different
        assert_ne!(key1.as_bytes(), key2.as_bytes());

        // Key should be correct size
        assert_eq!(key1.as_bytes().len(), 32);
    }

    #[test]
    fn test_key_base64_roundtrip() {
        let key = generate_key();
        let encoded = key.to_base64();
        let decoded = Key::from_base64(&encoded).unwrap();

        assert_eq!(key.as_bytes(), decoded.as_bytes());
    }

    #[test]
    fn test_key_base64_rejects_noncanonical_and_wrong_length_encodings() {
        assert!(Key::from_base64("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB=").is_err());
        assert!(Key::from_base64("AA==").is_err());
        assert!(Key::from_base64("not base64").is_err());
        assert!(Key::from_base64(&"A".repeat(1024 * 1024)).is_err());
    }

    #[test]
    fn test_pbkdf2_derivation() {
        let password = b"test password";
        let salt = b"random salt here";
        let iterations = PBKDF2_MIN_ITERATIONS;

        let key1 = derive_key_pbkdf2(password, salt, iterations).unwrap();
        let key2 = derive_key_pbkdf2(password, salt, iterations).unwrap();

        // Same inputs should produce same key
        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_hkdf_derivation() {
        let ikm = b"input key material";
        let salt = b"optional salt";
        let info = b"context info";

        let key1 = derive_key_hkdf(ikm, Some(salt), info).unwrap();
        let key2 = derive_key_hkdf(ikm, Some(salt), info).unwrap();

        // Same inputs should produce same key
        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_hkdf_raw_rfc5869_case_1() {
        let ikm = [0x0b_u8; 22];
        let salt = [
            0x00_u8, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
        ];
        let info = [
            0xf0_u8, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
        ];
        let okm = derive_key_hkdf_raw(&ikm, Some(&salt), &info, 42).unwrap();

        let expected = hex::decode(
            "3cb25f25faacd57a90434f64d0362f2a\
             2d2d0a90cf1a5a4c5db02d56ecc4c5bf\
             34007208d5b887185865",
        )
        .unwrap();

        assert_eq!(okm, expected);
    }

    #[test]
    fn test_hkdf_rejects_oversized_output_before_allocation() {
        let error =
            derive_key_hkdf_raw(b"ikm", None, b"info", HKDF_SHA256_MAX_OUTPUT + 1).unwrap_err();
        assert!(matches!(error, Error::KeyDerivationFailed(_)));
    }

    #[test]
    fn test_pbkdf2_rejects_unsafe_parameters() {
        assert!(derive_key_pbkdf2(b"password", &[0u8; 16], 0).is_err());
        assert!(derive_key_pbkdf2(b"password", &[0u8; 16], PBKDF2_MAX_ITERATIONS + 1).is_err());
        assert!(derive_key_pbkdf2(
            b"password",
            &[0u8; PBKDF2_MIN_SALT_SIZE - 1],
            PBKDF2_MIN_ITERATIONS
        )
        .is_err());
    }

    #[test]
    fn test_x25519_deterministic_generation_from_seed() {
        let seed = [7_u8; X25519_KEY_SIZE];
        let a = generate_x25519_key_pair(Some(&seed)).unwrap();
        let b = generate_x25519_key_pair(Some(&seed)).unwrap();

        assert_eq!(a.private_key, b.private_key);
        assert_eq!(a.public_key, b.public_key);
    }

    #[test]
    fn test_x25519_shared_secret_symmetry() {
        let alice = generate_x25519_key_pair(None).unwrap();
        let bob = generate_x25519_key_pair(None).unwrap();

        let s1 = x25519_shared_secret(&alice.private_key, &bob.public_key).unwrap();
        let s2 = x25519_shared_secret(&bob.private_key, &alice.public_key).unwrap();

        assert_eq!(s1, s2);
    }

    #[test]
    fn test_x25519_rejects_low_order_public_keys() {
        let private_key = [7_u8; X25519_KEY_SIZE];
        let mut one = [0_u8; X25519_KEY_SIZE];
        one[0] = 1;

        for public_key in [[0_u8; X25519_KEY_SIZE], one] {
            let error = x25519_shared_secret(&private_key, &public_key).unwrap_err();
            assert_eq!(
                error,
                Error::KeyDerivationFailed(
                    "X25519 agreement rejected an all-zero shared secret from a low-order or invalid public key"
                        .to_string()
                )
            );
        }
    }

    #[test]
    fn test_derive_key_from_shared_secret_is_deterministic() {
        let shared = [0x42_u8; X25519_KEY_SIZE];
        let key1 =
            derive_key_from_shared_secret(&shared, "voided-transfer-v1", "key-transfer").unwrap();
        let key2 =
            derive_key_from_shared_secret(&shared, "voided-transfer-v1", "key-transfer").unwrap();

        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_derive_key_from_shared_secret_rejects_invalid_material() {
        assert!(derive_key_from_shared_secret(&[0u8; 32], "salt", "info").is_err());
        assert!(derive_key_from_shared_secret(&[1u8; 31], "salt", "info").is_err());
        assert!(derive_key_from_shared_secret(&[1u8; 33], "salt", "info").is_err());
    }
}
