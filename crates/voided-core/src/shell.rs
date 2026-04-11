//! Shell-oriented key derivation and authentication helpers.

use alloc::{string::String, vec::Vec};

use crate::{
    encryption::{derive_key_hkdf, derive_key_hkdf_raw, Key},
    hash::{compare_hashes, generate_hmac, HashAlgorithm},
    Result,
};

/// Truncated outer shell tag size in bytes.
pub const SHELL_TAG_SIZE: usize = 16;

fn domain_info(domain_label: &str) -> String {
    format!("voided:shell:{domain_label}")
}

/// Derive a 256-bit domain key for shell-related operations.
pub fn derive_domain_key(master: &Key, salt: Option<&[u8]>, domain_label: &str) -> Result<Key> {
    derive_key_hkdf(
        master.as_bytes(),
        salt,
        domain_info(domain_label).as_bytes(),
    )
}

/// Derive arbitrary bytes for a shell-related domain.
pub fn derive_domain_bytes(
    master: &Key,
    salt: Option<&[u8]>,
    domain_label: &str,
    len: usize,
) -> Result<Vec<u8>> {
    derive_key_hkdf_raw(
        master.as_bytes(),
        salt,
        domain_info(domain_label).as_bytes(),
        len,
    )
}

/// Derive a per-chunk shell seed from the shell key, nonce, chunk index, and purpose.
pub fn derive_chunk_seed(
    shell_key: &Key,
    nonce: &[u8],
    chunk_index: u32,
    purpose: &str,
    len: usize,
) -> Result<Vec<u8>> {
    let mut info = Vec::new();
    info.extend_from_slice(b"voided:shell:chunk:");
    info.extend_from_slice(purpose.as_bytes());
    info.extend_from_slice(b":");
    info.extend_from_slice(&chunk_index.to_be_bytes());
    derive_key_hkdf_raw(shell_key.as_bytes(), Some(nonce), &info, len)
}

/// Compute a truncated outer tag for shell payloads.
pub fn compute_shell_tag(data: &[u8], tag_key: &Key) -> Result<[u8; SHELL_TAG_SIZE]> {
    let mac = generate_hmac(data, tag_key.as_bytes(), HashAlgorithm::Sha256)?;
    let mut tag = [0u8; SHELL_TAG_SIZE];
    tag.copy_from_slice(&mac[..SHELL_TAG_SIZE]);
    Ok(tag)
}

/// Verify a truncated shell tag in constant time.
pub fn verify_shell_tag(data: &[u8], tag: &[u8], tag_key: &Key) -> Result<bool> {
    if tag.len() != SHELL_TAG_SIZE {
        return Ok(false);
    }
    let expected = compute_shell_tag(data, tag_key)?;
    Ok(compare_hashes(&expected, tag))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_key() -> Key {
        Key::from_bytes(&[0x42; 32]).expect("valid fixed key")
    }

    #[test]
    fn derive_domain_key_is_deterministic() {
        let master = fixed_key();
        let salt = b"shell-salt";
        let first = derive_domain_key(&master, Some(salt), "shell").unwrap();
        let second = derive_domain_key(&master, Some(salt), "shell").unwrap();
        let different = derive_domain_key(&master, Some(salt), "shell-tag").unwrap();

        assert_eq!(first.as_bytes(), second.as_bytes());
        assert_ne!(first.as_bytes(), different.as_bytes());
    }

    #[test]
    fn derive_chunk_seed_varies_by_chunk_and_purpose() {
        let shell_key = fixed_key();
        let nonce = [7u8; 24];

        let first = derive_chunk_seed(&shell_key, &nonce, 0, "fused-prefix", 32).unwrap();
        let second = derive_chunk_seed(&shell_key, &nonce, 0, "fused-prefix", 32).unwrap();
        let next_chunk = derive_chunk_seed(&shell_key, &nonce, 1, "fused-prefix", 32).unwrap();
        let next_purpose = derive_chunk_seed(&shell_key, &nonce, 0, "compare", 32).unwrap();

        assert_eq!(first, second);
        assert_ne!(first, next_chunk);
        assert_ne!(first, next_purpose);
    }

    #[test]
    fn shell_tag_roundtrip_detects_wrong_key_and_tamper() {
        let payload = b"outer shell payload";
        let tag_key = fixed_key();
        let wrong_key = Key::from_bytes(&[0x24; 32]).unwrap();

        let tag = compute_shell_tag(payload, &tag_key).unwrap();

        assert!(verify_shell_tag(payload, &tag, &tag_key).unwrap());
        assert!(!verify_shell_tag(payload, &tag, &wrong_key).unwrap());
        assert!(!verify_shell_tag(b"tampered", &tag, &tag_key).unwrap());
    }
}
