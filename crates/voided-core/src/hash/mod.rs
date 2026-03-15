//! Hashing module providing SHA-256, SHA-512, HMAC, and PBKDF2.

use crate::{Error, Result};
use alloc::{string::String, vec::Vec};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256, Sha512};

/// Supported hash algorithms
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HashAlgorithm {
    /// SHA-256 (32 bytes output)
    Sha256,
    /// SHA-512 (64 bytes output)
    Sha512,
}

impl HashAlgorithm {
    /// Get output length in bytes
    pub fn output_len(&self) -> usize {
        match self {
            HashAlgorithm::Sha256 => 32,
            HashAlgorithm::Sha512 => 64,
        }
    }
}

/// Generate a hash using the specified algorithm
pub fn hash(data: &[u8], algorithm: HashAlgorithm) -> Vec<u8> {
    match algorithm {
        HashAlgorithm::Sha256 => {
            let mut hasher = Sha256::new();
            hasher.update(data);
            hasher.finalize().to_vec()
        }
        HashAlgorithm::Sha512 => {
            let mut hasher = Sha512::new();
            hasher.update(data);
            hasher.finalize().to_vec()
        }
    }
}

/// Generate a hash and return as hex string
pub fn hash_hex(data: &[u8], algorithm: HashAlgorithm) -> String {
    hex::encode(hash(data, algorithm))
}

/// Generate a hash with salt
pub fn hash_with_salt(data: &[u8], salt: &[u8], algorithm: HashAlgorithm) -> Vec<u8> {
    let mut combined = Vec::with_capacity(data.len() + salt.len());
    combined.extend_from_slice(data);
    combined.extend_from_slice(salt);
    hash(&combined, algorithm)
}

/// Generate a hash with salt and return as hex string
pub fn hash_with_salt_hex(data: &[u8], salt: &[u8], algorithm: HashAlgorithm) -> String {
    hex::encode(hash_with_salt(data, salt, algorithm))
}

/// Compare two hashes in constant time to prevent timing attacks
pub fn compare_hashes(a: &[u8], b: &[u8]) -> bool {
    constant_time_eq::constant_time_eq(a, b)
}

/// Generate HMAC using the specified algorithm
pub fn generate_hmac(data: &[u8], key: &[u8], algorithm: HashAlgorithm) -> Result<Vec<u8>> {
    match algorithm {
        HashAlgorithm::Sha256 => {
            let mut mac = Hmac::<Sha256>::new_from_slice(key)
                .map_err(|e| Error::HashFailed(e.to_string()))?;
            mac.update(data);
            Ok(mac.finalize().into_bytes().to_vec())
        }
        HashAlgorithm::Sha512 => {
            let mut mac = Hmac::<Sha512>::new_from_slice(key)
                .map_err(|e| Error::HashFailed(e.to_string()))?;
            mac.update(data);
            Ok(mac.finalize().into_bytes().to_vec())
        }
    }
}

/// Generate HMAC and return as hex string
pub fn generate_hmac_hex(data: &[u8], key: &[u8], algorithm: HashAlgorithm) -> Result<String> {
    Ok(hex::encode(generate_hmac(data, key, algorithm)?))
}

/// Verify HMAC in constant time
pub fn verify_hmac(
    data: &[u8],
    expected_mac: &[u8],
    key: &[u8],
    algorithm: HashAlgorithm,
) -> Result<bool> {
    let actual_mac = generate_hmac(data, key, algorithm)?;
    Ok(compare_hashes(&actual_mac, expected_mac))
}

/// Hash data using PBKDF2-HMAC-SHA256 with high iterations
pub fn hash_with_pbkdf2(data: &[u8], salt: &[u8], iterations: u32) -> Vec<u8> {
    use pbkdf2::pbkdf2_hmac;

    let mut output = [0u8; 32];
    pbkdf2_hmac::<Sha256>(data, salt, iterations, &mut output);
    output.to_vec()
}

/// Verify data against a PBKDF2 hash
pub fn verify_pbkdf2(data: &[u8], expected_hash: &[u8], salt: &[u8], iterations: u32) -> bool {
    let actual_hash = hash_with_pbkdf2(data, salt, iterations);
    compare_hashes(&actual_hash, expected_hash)
}

/// Generate a fingerprint (truncated hash)
/// Returns `length` bytes as hex (so 2*length hex characters)
pub fn generate_fingerprint(data: &[u8], length: usize) -> String {
    let hash = hash_hex(data, HashAlgorithm::Sha256);
    // Each byte is 2 hex chars, so we take length*2 hex chars
    let hex_len = (length * 2).min(hash.len());
    hash[..hex_len].to_string()
}

/// Generate safety numbers (Signal-style) for key verification
pub fn generate_safety_numbers(data: &[u8], group_size: usize) -> String {
    let hash_bytes = hash(data, HashAlgorithm::Sha256);
    format_safety_numbers(&hash_bytes, group_size)
}

fn format_safety_numbers(hash_bytes: &[u8], group_size: usize) -> String {
    let mut groups = Vec::new();

    for chunk in hash_bytes.chunks(group_size) {
        let group: Vec<String> = chunk.iter().map(|&byte| format!("{:03}", byte)).collect();
        groups.push(group.join(" "));
    }

    groups.join("  ")
}

/// Generate random bytes
pub fn generate_random_bytes(length: usize) -> Vec<u8> {
    use rand::RngCore;
    let mut bytes = vec![0u8; length];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}

/// Generate a random salt
pub fn generate_salt(length: usize) -> Vec<u8> {
    generate_random_bytes(length)
}

/// Securely wipe a buffer
pub fn secure_wipe(buffer: &mut [u8]) {
    use zeroize::Zeroize;
    buffer.zeroize();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256() {
        let data = b"hello world";
        let hash = hash_hex(data, HashAlgorithm::Sha256);
        // Known SHA-256 hash of "hello world"
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn test_sha512() {
        let data = b"hello world";
        let hash = hash_hex(data, HashAlgorithm::Sha512);
        assert_eq!(hash.len(), 128); // 64 bytes = 128 hex chars
    }

    #[test]
    fn test_hash_with_salt() {
        let data = b"password";
        let salt = b"random_salt";

        let hash1 = hash_with_salt_hex(data, salt, HashAlgorithm::Sha256);
        let hash2 = hash_with_salt_hex(data, salt, HashAlgorithm::Sha256);

        // Same inputs should produce same hash
        assert_eq!(hash1, hash2);

        // Different salt should produce different hash
        let hash3 = hash_with_salt_hex(data, b"different_salt", HashAlgorithm::Sha256);
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_hmac() {
        let data = b"message";
        let key = b"secret_key";

        let mac = generate_hmac_hex(data, key, HashAlgorithm::Sha256).unwrap();
        assert_eq!(mac.len(), 64); // 32 bytes = 64 hex chars

        // Verify should pass with correct data
        let mac_bytes = hex::decode(&mac).unwrap();
        assert!(verify_hmac(data, &mac_bytes, key, HashAlgorithm::Sha256).unwrap());

        // Verify should fail with wrong data
        assert!(!verify_hmac(b"wrong", &mac_bytes, key, HashAlgorithm::Sha256).unwrap());
    }

    #[test]
    fn test_pbkdf2() {
        let password = b"my_password";
        let salt = b"my_salt";
        let iterations = 1000;

        let hash1 = hash_with_pbkdf2(password, salt, iterations);
        let hash2 = hash_with_pbkdf2(password, salt, iterations);

        assert_eq!(hash1, hash2);
        assert!(verify_pbkdf2(password, &hash1, salt, iterations));
        assert!(!verify_pbkdf2(b"wrong_password", &hash1, salt, iterations));
    }

    #[test]
    fn test_compare_hashes_constant_time() {
        let hash1 = hash(b"test", HashAlgorithm::Sha256);
        let hash2 = hash(b"test", HashAlgorithm::Sha256);
        let hash3 = hash(b"different", HashAlgorithm::Sha256);

        assert!(compare_hashes(&hash1, &hash2));
        assert!(!compare_hashes(&hash1, &hash3));
    }

    #[test]
    fn test_fingerprint() {
        let data = b"some key material";
        // Request 8 bytes, get 16 hex characters (2 hex chars per byte)
        let fp = generate_fingerprint(data, 8);
        assert_eq!(fp.len(), 16);

        // Request 4 bytes, get 8 hex characters
        let fp2 = generate_fingerprint(data, 4);
        assert_eq!(fp2.len(), 8);
    }

    #[test]
    fn test_safety_numbers() {
        let data = b"public key data";
        let numbers = generate_safety_numbers(data, 5);
        assert!(!numbers.is_empty());
        // Should contain groups of 3-digit numbers
        assert!(numbers.contains(' '));
    }
}
