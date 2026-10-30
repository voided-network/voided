#![cfg(not(feature = "std"))]

use voided_core::{
    encryption::{self, Algorithm, EncryptOptions, EncryptionResult},
    formats,
    hash::{self, HashAlgorithm},
    shell, Error,
};

#[test]
fn errors_implement_core_error_and_preserve_messages() {
    fn require_core_error<T: core::error::Error>() {}
    require_core_error::<Error>();
    assert_eq!(
        Error::UnsupportedVersion(9).to_string(),
        "Unsupported version: 9"
    );
    assert_eq!(
        Error::InvalidKeyLength {
            expected: 32,
            actual: 7
        }
        .to_string(),
        "Invalid key length: expected 32, got 7"
    );
    assert_eq!(
        Error::EncryptionFailed("failure".into()).to_string(),
        "Encryption failed: failure"
    );
}

#[test]
fn hashing_and_alloc_backed_encodings_keep_their_vectors() {
    assert_eq!(
        hash::hash_hex(b"abc", HashAlgorithm::Sha256),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        formats::base64_decode(&formats::base64_encode(b"abc")).unwrap(),
        b"abc"
    );
    assert_eq!(
        formats::hex_decode(&formats::hex_encode(b"abc")).unwrap(),
        b"abc"
    );
}

#[test]
fn both_aeads_use_platform_entropy_and_preserve_authenticated_serialization() {
    let key = encryption::generate_key();
    let restored_key = encryption::Key::from_base64(&key.to_base64()).unwrap();
    for algorithm in [Algorithm::Aes256Gcm, Algorithm::XChaCha20Poly1305] {
        let encrypted = encryption::encrypt(
            b"no_std payload",
            &key,
            Some(EncryptOptions {
                algorithm: Some(algorithm),
                aad: Some(b"context".to_vec()),
            }),
        )
        .unwrap();
        let decoded = EncryptionResult::from_json(&encrypted.to_json().unwrap()).unwrap();
        assert_eq!(
            encryption::decrypt_with_aad(&decoded, &restored_key, b"context").unwrap(),
            b"no_std payload"
        );
        assert!(encryption::decrypt_with_aad(&decoded, &restored_key, b"wrong context").is_err());
        let mut corrupted = EncryptionResult::from_bytes(&encrypted.to_bytes()).unwrap();
        corrupted.tag[0] ^= 1;
        assert!(encryption::decrypt_with_aad(&corrupted, &key, b"context").is_err());
    }
}

#[test]
fn deterministic_x25519_derivation_stays_symmetric() {
    let first = encryption::generate_x25519_key_pair(Some(&[1; 32])).unwrap();
    let second = encryption::generate_x25519_key_pair(Some(&[2; 32])).unwrap();
    let forward = encryption::x25519_shared_secret(&first.private_key, &second.public_key).unwrap();
    let reverse = encryption::x25519_shared_secret(&second.private_key, &first.public_key).unwrap();
    assert_eq!(forward, reverse);
}

#[test]
fn fused_shell_roundtrip_does_not_require_compression_or_std() {
    let key = encryption::generate_key();
    let bytes = shell::fuse_bytes(b"prepared payload", &key, None).unwrap();
    assert_eq!(
        shell::unfuse_bytes(&bytes, &key).unwrap(),
        b"prepared payload"
    );
}
