//! Utility functions and helpers.

use alloc::vec::Vec;
use rand::RngCore;
use zeroize::Zeroize;

/// Generate random bytes
pub fn random_bytes(length: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; length];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}

/// Securely wipe a buffer by overwriting with zeros
pub fn secure_wipe(buffer: &mut [u8]) {
    buffer.zeroize();
}

/// Constant-time comparison of two byte slices
pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    constant_time_eq::constant_time_eq(a, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_random_bytes() {
        let bytes1 = random_bytes(32);
        let bytes2 = random_bytes(32);

        assert_eq!(bytes1.len(), 32);
        assert_eq!(bytes2.len(), 32);
        assert_ne!(bytes1, bytes2); // Extremely unlikely to be equal
    }

    #[test]
    fn test_secure_wipe() {
        let mut buffer = vec![0xAA; 32];
        secure_wipe(&mut buffer);
        assert!(buffer.iter().all(|&b| b == 0));
    }

    #[test]
    fn test_constant_time_compare() {
        let a = [1, 2, 3, 4];
        let b = [1, 2, 3, 4];
        let c = [1, 2, 3, 5];

        assert!(constant_time_compare(&a, &b));
        assert!(!constant_time_compare(&a, &c));
    }
}
