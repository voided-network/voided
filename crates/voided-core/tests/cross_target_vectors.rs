//! Cross-target test vectors for ensuring consistency across Rust, Node, and WASM builds.

use voided_core::formats::{base64_decode, base64_encode, hex_decode, hex_encode};
use voided_core::hash::{hash_hex, HashAlgorithm};

/// Test SHA-256 against known vectors
#[test]
fn test_sha256_vectors() {
    let vectors = [
        // Empty input
        (
            "",
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ),
        // "hello world"
        (
            "hello world",
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        ),
        // "The quick brown fox jumps over the lazy dog"
        (
            "The quick brown fox jumps over the lazy dog",
            "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
        ),
    ];

    for (input, expected) in vectors {
        let result = hash_hex(input.as_bytes(), HashAlgorithm::Sha256);
        assert_eq!(result, expected, "SHA-256 mismatch for: {}", input);
    }
}

/// Test SHA-512 against known vectors
#[test]
fn test_sha512_vectors() {
    let vectors = [
        // Empty input
        ("", "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"),
        // "hello world"
        ("hello world", "309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f"),
    ];

    for (input, expected) in vectors {
        let result = hash_hex(input.as_bytes(), HashAlgorithm::Sha512);
        assert_eq!(result, expected, "SHA-512 mismatch for: {}", input);
    }
}

/// Test Base64 encoding against known vectors
#[test]
fn test_base64_vectors() {
    let vectors = [
        (b"".as_slice(), ""),
        (b"f".as_slice(), "Zg=="),
        (b"fo".as_slice(), "Zm8="),
        (b"foo".as_slice(), "Zm9v"),
        (b"Hello, World!".as_slice(), "SGVsbG8sIFdvcmxkIQ=="),
    ];

    for (input, expected) in vectors {
        let encoded = base64_encode(input);
        assert_eq!(encoded, expected, "Base64 encode mismatch for: {:?}", input);

        let decoded = base64_decode(expected).expect("Base64 decode failed");
        assert_eq!(decoded, input, "Base64 decode mismatch for: {}", expected);
    }
}

/// Test Hex encoding against known vectors
#[test]
fn test_hex_vectors() {
    let vectors = [
        (vec![0u8, 1, 2, 255, 254, 253], "000102fffefd"),
        (b"hello".to_vec(), "68656c6c6f"),
    ];

    for (input, expected) in vectors {
        let encoded = hex_encode(&input);
        assert_eq!(encoded, expected, "Hex encode mismatch for: {:?}", input);

        let decoded = hex_decode(expected).expect("Hex decode failed");
        assert_eq!(decoded, input, "Hex decode mismatch for: {}", expected);
    }
}

/// Test encryption roundtrip
#[test]
fn test_encryption_roundtrip() {
    use voided_core::encryption::{decrypt, encrypt, generate_key};

    let key = generate_key();
    let plaintext = b"Hello, World! This is a test message for encryption.";

    let encrypted = encrypt(plaintext, &key, None).expect("Encryption failed");
    let decrypted = decrypt(&encrypted, &key).expect("Decryption failed");

    assert_eq!(decrypted, plaintext);
}

/// Test AES-256-GCM encryption/decryption
#[test]
fn test_aes_256_gcm() {
    use voided_core::encryption::{decrypt, encrypt, Algorithm, EncryptOptions, Key};

    let key_bytes = hex_decode("0000000000000000000000000000000000000000000000000000000000000001")
        .expect("Invalid key hex");
    let key = Key::from_bytes(&key_bytes).expect("Invalid key");

    let plaintext = b"Hello, World!";

    let opts = EncryptOptions {
        algorithm: Some(Algorithm::Aes256Gcm),
        aad: None,
    };

    let encrypted = encrypt(plaintext, &key, Some(opts)).expect("Encryption failed");
    assert_eq!(encrypted.algorithm, Algorithm::Aes256Gcm);

    let decrypted = decrypt(&encrypted, &key).expect("Decryption failed");
    assert_eq!(decrypted, plaintext);
}

/// Test XChaCha20-Poly1305 encryption/decryption
#[test]
fn test_xchacha20_poly1305() {
    use voided_core::encryption::{decrypt, encrypt, Algorithm, EncryptOptions, Key};

    let key_bytes = hex_decode("0000000000000000000000000000000000000000000000000000000000000001")
        .expect("Invalid key hex");
    let key = Key::from_bytes(&key_bytes).expect("Invalid key");

    let plaintext = b"Hello, World!";

    let opts = EncryptOptions {
        algorithm: Some(Algorithm::XChaCha20Poly1305),
        aad: None,
    };

    let encrypted = encrypt(plaintext, &key, Some(opts)).expect("Encryption failed");
    assert_eq!(encrypted.algorithm, Algorithm::XChaCha20Poly1305);

    let decrypted = decrypt(&encrypted, &key).expect("Decryption failed");
    assert_eq!(decrypted, plaintext);
}

/// Test compression roundtrip
#[test]
#[cfg(feature = "compression")]
fn test_compression_roundtrip() {
    use voided_core::compression::{
        compress, decompress, CompressionAlgorithm, CompressionOptions,
    };

    let data = b"Hello, World! This is a test string for compression. ".repeat(100);

    // Test gzip
    let gzip_opts = CompressionOptions {
        algorithm: CompressionAlgorithm::Gzip,
        min_size_threshold: 0,
        level: 6,
    };
    let compressed = compress(&data, Some(gzip_opts)).expect("Gzip compression failed");
    let decompressed = decompress(&compressed.compressed, CompressionAlgorithm::Gzip)
        .expect("Gzip decompression failed");
    assert_eq!(decompressed, data);

    // Test brotli
    let brotli_opts = CompressionOptions {
        algorithm: CompressionAlgorithm::Brotli,
        min_size_threshold: 0,
        level: 6,
    };
    let compressed = compress(&data, Some(brotli_opts)).expect("Brotli compression failed");
    let decompressed = decompress(&compressed.compressed, CompressionAlgorithm::Brotli)
        .expect("Brotli decompression failed");
    assert_eq!(decompressed, data);
}

/// Test HMAC generation
#[test]
fn test_hmac_vectors() {
    use voided_core::hash::{generate_hmac_hex, HashAlgorithm};

    // "hello" with key "secret"
    let data = b"hello";
    let key = b"secret";
    let expected = "88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b";

    let result =
        generate_hmac_hex(data, key, HashAlgorithm::Sha256).expect("HMAC generation failed");

    assert_eq!(result, expected);
}

/// Test key derivation (HKDF)
#[test]
fn test_hkdf_vectors() {
    use voided_core::encryption::derive_key_hkdf;

    // RFC 5869 Test Case 1 (simplified)
    let ikm = hex_decode("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b").expect("Invalid IKM");
    let salt = hex_decode("000102030405060708090a0b0c").expect("Invalid salt");
    let info = hex_decode("f0f1f2f3f4f5f6f7f8f9").expect("Invalid info");

    let key = derive_key_hkdf(&ikm, Some(&salt), &info).expect("HKDF derivation failed");

    // Key should be 32 bytes
    assert_eq!(key.as_bytes().len(), 32);

    // Verify it's deterministic
    let key2 = derive_key_hkdf(&ikm, Some(&salt), &info).expect("HKDF derivation failed");
    assert_eq!(key.as_bytes(), key2.as_bytes());
}

/// Test obfuscation determinism
#[test]
#[cfg(feature = "obfuscation")]
fn test_obfuscation_determinism() {
    use voided_core::obfuscation::{
        deobfuscate, generate_map, obfuscate, GenerateMapOptions, ObfuscationOptions,
        SelectionStrategy,
    };

    let opts = GenerateMapOptions {
        temperature: 0.5,
        seed: Some("test-seed-123".to_string()),
        charset: Some("abc".to_string()),
    };

    let map1 = generate_map(Some(opts.clone()));
    let map2 = generate_map(Some(opts));

    // Maps should be identical with same seed
    assert_eq!(map1, map2);

    // Obfuscation should be deterministic with same seed
    let text = "abc";
    let obf_opts = ObfuscationOptions {
        seed: "obf-seed".to_string(),
        strategy: SelectionStrategy::Random,
    };

    let result1 = obfuscate(text, &map1, Some(obf_opts.clone()));
    let result2 = obfuscate(text, &map2, Some(obf_opts));

    assert_eq!(result1.obfuscated, result2.obfuscated);

    // Deobfuscation should recover original
    let recovered = deobfuscate(&result1.obfuscated, &map1);
    assert_eq!(recovered, text);
}
