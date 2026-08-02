//! Hashing module providing SHA-256, SHA-512, HMAC, and PBKDF2.

use crate::{Error, Result};
use alloc::{format, string::String, vec, vec::Vec};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256, Sha512};

const SALTED_HASH_DOMAIN: &[u8] = b"voided:hash-with-salt:v2";

/// Largest useful SHA-256 fingerprint truncation in bytes.
pub const MAX_FINGERPRINT_BYTES: usize = 32;

/// Largest accepted grouping for the human-readable fingerprint formatter.
pub const MAX_FINGERPRINT_GROUP_SIZE: usize = 32;

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

enum StreamingHasherState {
    Sha256(Sha256),
    Sha512(Sha512),
}

/// Incremental SHA-256 or SHA-512 hasher.
///
/// This keeps hashing state inside Voided so callers can process large inputs
/// without first assembling them into one contiguous allocation.
pub struct StreamingHasher {
    state: StreamingHasherState,
    bytes_hashed: u128,
}

impl StreamingHasher {
    /// Create an incremental hasher for `algorithm`.
    pub fn new(algorithm: HashAlgorithm) -> Self {
        let state = match algorithm {
            HashAlgorithm::Sha256 => StreamingHasherState::Sha256(Sha256::new()),
            HashAlgorithm::Sha512 => StreamingHasherState::Sha512(Sha512::new()),
        };

        Self {
            state,
            bytes_hashed: 0,
        }
    }

    /// Add the next contiguous chunk of bytes to the hash.
    pub fn update(&mut self, data: &[u8]) {
        match &mut self.state {
            StreamingHasherState::Sha256(hasher) => hasher.update(data),
            StreamingHasherState::Sha512(hasher) => hasher.update(data),
        }
        self.bytes_hashed += data.len() as u128;
    }

    /// Return the total number of bytes supplied through [`Self::update`].
    pub fn bytes_hashed(&self) -> u128 {
        self.bytes_hashed
    }

    /// Consume the hasher and return the digest bytes.
    pub fn finalize_bytes(self) -> Vec<u8> {
        match self.state {
            StreamingHasherState::Sha256(hasher) => hasher.finalize().to_vec(),
            StreamingHasherState::Sha512(hasher) => hasher.finalize().to_vec(),
        }
    }

    /// Consume the hasher and return the lowercase hexadecimal digest.
    pub fn finalize_hex(self) -> String {
        hex::encode(self.finalize_bytes())
    }
}

/// Generate a hash using the specified algorithm
pub fn hash(data: &[u8], algorithm: HashAlgorithm) -> Vec<u8> {
    let mut hasher = StreamingHasher::new(algorithm);
    hasher.update(data);
    hasher.finalize_bytes()
}

/// Generate a hash and return as hex string
pub fn hash_hex(data: &[u8], algorithm: HashAlgorithm) -> String {
    hex::encode(hash(data, algorithm))
}

/// Generate a hash with salt
pub fn hash_with_salt(data: &[u8], salt: &[u8], algorithm: HashAlgorithm) -> Vec<u8> {
    // Length-prefix and domain-separate both fields. Concatenating data || salt
    // makes distinct tuples such as ("a", "bc") and ("ab", "c") collide.
    let mut combined =
        Vec::with_capacity(SALTED_HASH_DOMAIN.len() + 16 + data.len().saturating_add(salt.len()));
    combined.extend_from_slice(SALTED_HASH_DOMAIN);
    combined.extend_from_slice(&(data.len() as u64).to_be_bytes());
    combined.extend_from_slice(data);
    combined.extend_from_slice(&(salt.len() as u64).to_be_bytes());
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

/// Generate a SHA-256 HMAC without heap-allocating the digest.
pub fn generate_hmac_sha256(data: &[u8], key: &[u8]) -> Result<[u8; 32]> {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(key).map_err(|e| Error::HashFailed(e.to_string()))?;
    mac.update(data);
    let mut output = [0u8; 32];
    output.copy_from_slice(&mac.finalize().into_bytes());
    Ok(output)
}

/// Generate HMAC over multiple contiguous logical parts without copying them first.
pub fn generate_hmac_parts(
    parts: &[&[u8]],
    key: &[u8],
    algorithm: HashAlgorithm,
) -> Result<Vec<u8>> {
    match algorithm {
        HashAlgorithm::Sha256 => {
            let mut mac = Hmac::<Sha256>::new_from_slice(key)
                .map_err(|e| Error::HashFailed(e.to_string()))?;
            for part in parts {
                mac.update(part);
            }
            Ok(mac.finalize().into_bytes().to_vec())
        }
        HashAlgorithm::Sha512 => {
            let mut mac = Hmac::<Sha512>::new_from_slice(key)
                .map_err(|e| Error::HashFailed(e.to_string()))?;
            for part in parts {
                mac.update(part);
            }
            Ok(mac.finalize().into_bytes().to_vec())
        }
    }
}

/// Generate a SHA-256 HMAC over multiple logical parts without heap-allocating the digest.
pub fn generate_hmac_sha256_parts(parts: &[&[u8]], key: &[u8]) -> Result<[u8; 32]> {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(key).map_err(|e| Error::HashFailed(e.to_string()))?;
    for part in parts {
        mac.update(part);
    }
    let mut output = [0u8; 32];
    output.copy_from_slice(&mac.finalize().into_bytes());
    Ok(output)
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
pub fn hash_with_pbkdf2(data: &[u8], salt: &[u8], iterations: u32) -> Result<Vec<u8>> {
    use pbkdf2::pbkdf2_hmac;

    crate::encryption::validate_pbkdf2_parameters(salt, iterations)?;
    let mut output = [0u8; 32];
    pbkdf2_hmac::<Sha256>(data, salt, iterations, &mut output);
    Ok(output.to_vec())
}

/// Verify data against a PBKDF2 hash
pub fn verify_pbkdf2(
    data: &[u8],
    expected_hash: &[u8],
    salt: &[u8],
    iterations: u32,
) -> Result<bool> {
    let actual_hash = hash_with_pbkdf2(data, salt, iterations)?;
    Ok(compare_hashes(&actual_hash, expected_hash))
}

/// Generate a fingerprint (truncated hash)
/// Returns `length` bytes as hex (so 2*length hex characters)
pub fn generate_fingerprint(data: &[u8], length: usize) -> String {
    let hash = hash_hex(data, HashAlgorithm::Sha256);
    // Each byte is 2 hex chars, so we take length*2 hex chars
    let hex_len = length.min(MAX_FINGERPRINT_BYTES) * 2;
    hash[..hex_len].to_string()
}

/// Format a SHA-256 fingerprint for human comparison.
///
/// This is not the Signal Safety Number protocol and does not bind identities,
/// devices, key order, or a session transcript.
pub fn generate_safety_numbers(data: &[u8], group_size: usize) -> Result<String> {
    if !(1..=MAX_FINGERPRINT_GROUP_SIZE).contains(&group_size) {
        return Err(Error::InvalidConfiguration(format!(
            "fingerprint group size must be between 1 and {MAX_FINGERPRINT_GROUP_SIZE}"
        )));
    }
    let hash_bytes = hash(data, HashAlgorithm::Sha256);
    Ok(format_safety_numbers(&hash_bytes, group_size))
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

    fn assert_streaming_matches_one_shot(
        data: &[u8],
        algorithm: HashAlgorithm,
        chunk_sizes: &[usize],
    ) {
        let expected_bytes = hash(data, algorithm);
        let expected_hex = hash_hex(data, algorithm);

        let mut bytes_hasher = StreamingHasher::new(algorithm);
        let mut offset = 0;
        let mut chunk_index = 0;
        while offset < data.len() {
            let chunk_size = chunk_sizes[chunk_index % chunk_sizes.len()];
            let end = (offset + chunk_size).min(data.len());
            bytes_hasher.update(&data[offset..end]);
            offset = end;
            chunk_index += 1;
        }
        assert_eq!(bytes_hasher.bytes_hashed(), data.len() as u128);
        assert_eq!(bytes_hasher.finalize_bytes(), expected_bytes);

        let mut hex_hasher = StreamingHasher::new(algorithm);
        for chunk in data.chunks(113) {
            hex_hasher.update(chunk);
        }
        assert_eq!(hex_hasher.bytes_hashed(), data.len() as u128);
        assert_eq!(hex_hasher.finalize_hex(), expected_hex);
    }

    #[test]
    fn streaming_hash_matches_one_shot_for_sha256_and_sha512() {
        let short = b"incremental hashing across uneven chunks";
        let multi_megabyte: Vec<u8> = (0..(3 * 1024 * 1024 + 257))
            .map(|index| ((index * 31 + index / 251) % 256) as u8)
            .collect();

        for (algorithm, block_size) in [
            (HashAlgorithm::Sha256, 64usize),
            (HashAlgorithm::Sha512, 128usize),
        ] {
            assert_streaming_matches_one_shot(&[], algorithm, &[1]);
            assert_streaming_matches_one_shot(short, algorithm, &[1, 2, 7, 19]);

            for length in [block_size - 1, block_size, block_size + 1, block_size * 2] {
                let block_boundary: Vec<u8> = (0..length)
                    .map(|index| ((index * 17 + 11) % 256) as u8)
                    .collect();
                assert_streaming_matches_one_shot(
                    &block_boundary,
                    algorithm,
                    &[1, block_size - 1, block_size + 3],
                );
            }

            assert_streaming_matches_one_shot(&multi_megabyte, algorithm, &[1, 31, 4_096, 65_537]);
        }
    }

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

        assert_ne!(
            hash_with_salt(b"a", b"bc", HashAlgorithm::Sha256),
            hash_with_salt(b"ab", b"c", HashAlgorithm::Sha256)
        );
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
        let salt = b"16-byte-test-salt";
        let iterations = crate::encryption::PBKDF2_MIN_ITERATIONS;

        let hash1 = hash_with_pbkdf2(password, salt, iterations).unwrap();
        let hash2 = hash_with_pbkdf2(password, salt, iterations).unwrap();

        assert_eq!(hash1, hash2);
        assert!(verify_pbkdf2(password, &hash1, salt, iterations).unwrap());
        assert!(!verify_pbkdf2(b"wrong_password", &hash1, salt, iterations).unwrap());
        assert!(hash_with_pbkdf2(password, salt, 0).is_err());
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
        let numbers = generate_safety_numbers(data, 5).unwrap();
        assert!(!numbers.is_empty());
        // Should contain groups of 3-digit numbers
        assert!(numbers.contains(' '));
        assert!(generate_safety_numbers(data, 0).is_err());
    }
}
