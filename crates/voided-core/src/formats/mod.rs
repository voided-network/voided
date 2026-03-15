//! Wire format utilities for serialization and deserialization.

use alloc::{string::String, vec::Vec};
use base64::{engine::general_purpose::STANDARD, Engine};

/// Encode bytes to Base64
pub fn base64_encode(data: &[u8]) -> String {
    STANDARD.encode(data)
}

/// Decode Base64 to bytes
pub fn base64_decode(encoded: &str) -> crate::Result<Vec<u8>> {
    STANDARD
        .decode(encoded)
        .map_err(|e| crate::Error::InvalidBase64(e.to_string()))
}

/// Encode bytes to hex
pub fn hex_encode(data: &[u8]) -> String {
    hex::encode(data)
}

/// Decode hex to bytes
pub fn hex_decode(encoded: &str) -> crate::Result<Vec<u8>> {
    hex::decode(encoded).map_err(|e| crate::Error::InvalidHex(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base64_roundtrip() {
        let data = b"Hello, World!";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(data, &decoded[..]);
    }

    #[test]
    fn test_hex_roundtrip() {
        let data = b"Hello, World!";
        let encoded = hex_encode(data);
        let decoded = hex_decode(&encoded).unwrap();
        assert_eq!(data, &decoded[..]);
    }
}
