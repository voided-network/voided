//! Comprehensive cryptographic tests with detailed logging.
//!
//! These tests cover edge cases, error conditions, and provide detailed
//! output to help diagnose issues across targets.

use voided_core::encryption::{
    decrypt, derive_key_hkdf, derive_key_pbkdf2, encrypt, generate_key, Algorithm, EncryptOptions,
};
use voided_core::formats::{base64_decode, base64_encode, hex_decode, hex_encode};
use voided_core::hash::{
    compare_hashes, generate_fingerprint, generate_hmac_hex, generate_safety_numbers, hash_hex,
    hash_with_pbkdf2, hash_with_salt_hex, verify_hmac, verify_pbkdf2, HashAlgorithm,
};
use voided_core::util::{random_bytes, secure_wipe};

#[cfg(feature = "compression")]
use voided_core::compression::{compress, decompress, CompressionAlgorithm, CompressionOptions};

#[cfg(feature = "compression")]
use voided_core::shell::{
    inspect_artifact, open, protect, repack_artifact, FusedPreset, ProtectOptions,
};

/// Test logging macro for detailed output
macro_rules! log_test {
    ($name:expr, $($arg:tt)*) => {
        eprintln!("[TEST:{}] {}", $name, format!($($arg)*));
    };
}

macro_rules! log_success {
    ($name:expr, $($arg:tt)*) => {
        eprintln!("[✓ {}] {}", $name, format!($($arg)*));
    };
}

macro_rules! log_info {
    ($name:expr, $($arg:tt)*) => {
        eprintln!("[INFO:{}] {}", $name, format!($($arg)*));
    };
}

// =============================================================================
// ENCRYPTION TESTS
// =============================================================================

#[test]
fn test_encryption_empty_input() {
    const TEST: &str = "encryption_empty_input";
    log_test!(TEST, "Testing encryption of empty input");

    let key = generate_key();
    log_info!(TEST, "Generated key: {} bytes", key.as_bytes().len());

    let plaintext = b"";
    log_info!(TEST, "Plaintext length: {} bytes", plaintext.len());

    let encrypted = encrypt(plaintext, &key, None).expect("Encryption failed");
    log_info!(
        TEST,
        "Encrypted - algorithm: {}, ciphertext: {} bytes, nonce: {} bytes, tag: {} bytes",
        encrypted.algorithm.name(),
        encrypted.ciphertext.len(),
        encrypted.nonce.len(),
        encrypted.tag.len()
    );

    let decrypted = decrypt(&encrypted, &key).expect("Decryption failed");
    log_info!(TEST, "Decrypted: {} bytes", decrypted.len());

    assert_eq!(decrypted.len(), 0);
    log_success!(TEST, "Empty input encryption/decryption works correctly");
}

#[test]
fn test_encryption_large_input() {
    const TEST: &str = "encryption_large_input";
    log_test!(TEST, "Testing encryption of large input (1MB)");

    let key = generate_key();
    let plaintext: Vec<u8> = (0..1_000_000).map(|i| (i % 256) as u8).collect();
    log_info!(
        TEST,
        "Plaintext size: {} bytes ({:.2} MB)",
        plaintext.len(),
        plaintext.len() as f64 / 1_000_000.0
    );

    let start = std::time::Instant::now();
    let encrypted = encrypt(&plaintext, &key, None).expect("Encryption failed");
    let encrypt_time = start.elapsed();
    log_info!(TEST, "Encryption time: {:?}", encrypt_time);
    log_info!(
        TEST,
        "Ciphertext size: {} bytes",
        encrypted.ciphertext.len()
    );

    let start = std::time::Instant::now();
    let decrypted = decrypt(&encrypted, &key).expect("Decryption failed");
    let decrypt_time = start.elapsed();
    log_info!(TEST, "Decryption time: {:?}", decrypt_time);

    assert_eq!(decrypted, plaintext);
    log_success!(TEST, "Large input roundtrip successful");
}

#[test]
fn test_encryption_unicode_content() {
    const TEST: &str = "encryption_unicode";
    log_test!(TEST, "Testing encryption with Unicode content");

    let key = generate_key();
    let plaintexts = [
        "Hello, 世界! 🌍",
        "Привет мир! 🇷🇺",
        "مرحبا بالعالم! 🌙",
        "שלום עולם! ✡️",
        "こんにちは世界! 🇯🇵",
        "🎉🎊🎁🎄🎅🎆🎇✨",
    ];

    for plaintext in plaintexts {
        let bytes = plaintext.as_bytes();
        log_info!(
            TEST,
            "Testing: '{}' ({} bytes, {} chars)",
            plaintext,
            bytes.len(),
            plaintext.chars().count()
        );

        let encrypted = encrypt(bytes, &key, None).expect("Encryption failed");
        let decrypted = decrypt(&encrypted, &key).expect("Decryption failed");
        let recovered = String::from_utf8(decrypted).expect("Invalid UTF-8");

        assert_eq!(recovered, plaintext);
        log_success!(TEST, "Unicode roundtrip OK: '{}'", plaintext);
    }
}

#[test]
fn test_encryption_wrong_key_fails() {
    const TEST: &str = "encryption_wrong_key";
    log_test!(TEST, "Testing that wrong key fails decryption");

    let key1 = generate_key();
    let key2 = generate_key();
    log_info!(TEST, "Key1 (first 8 bytes): {:?}", &key1.as_bytes()[..8]);
    log_info!(TEST, "Key2 (first 8 bytes): {:?}", &key2.as_bytes()[..8]);

    let plaintext = b"Secret message";
    let encrypted = encrypt(plaintext, &key1, None).expect("Encryption failed");

    let result = decrypt(&encrypted, &key2);
    log_info!(
        TEST,
        "Decryption with wrong key result: {:?}",
        result.as_ref().map(|_| "OK").unwrap_or("ERROR")
    );

    assert!(result.is_err(), "Decryption with wrong key should fail");
    log_success!(TEST, "Wrong key correctly rejected");
}

#[test]
fn test_encryption_tampered_ciphertext_fails() {
    const TEST: &str = "encryption_tampered";
    log_test!(TEST, "Testing that tampered ciphertext fails");

    let key = generate_key();
    let plaintext = b"Important data that must not be tampered with";

    let mut encrypted = encrypt(plaintext, &key, None).expect("Encryption failed");
    log_info!(
        TEST,
        "Original ciphertext (first 16 bytes): {:?}",
        &encrypted.ciphertext[..16.min(encrypted.ciphertext.len())]
    );

    // Tamper with the ciphertext
    if !encrypted.ciphertext.is_empty() {
        encrypted.ciphertext[0] ^= 0xFF;
        log_info!(
            TEST,
            "Tampered ciphertext (first 16 bytes): {:?}",
            &encrypted.ciphertext[..16.min(encrypted.ciphertext.len())]
        );
    }

    let result = decrypt(&encrypted, &key);
    assert!(
        result.is_err(),
        "Decryption of tampered ciphertext should fail"
    );
    log_success!(TEST, "Tampered ciphertext correctly rejected");
}

#[test]
fn test_encryption_both_algorithms() {
    const TEST: &str = "encryption_algorithms";
    log_test!(TEST, "Testing both AES-256-GCM and XChaCha20-Poly1305");

    let key = generate_key();
    let plaintext = b"Test message for algorithm comparison";

    let algorithms = [
        (Algorithm::Aes256Gcm, "AES-256-GCM"),
        (Algorithm::XChaCha20Poly1305, "XChaCha20-Poly1305"),
    ];

    for (algo, name) in algorithms {
        log_info!(TEST, "Testing {}", name);

        let opts = EncryptOptions {
            algorithm: Some(algo),
            aad: None,
        };

        let encrypted = encrypt(plaintext, &key, Some(opts)).expect("Encryption failed");
        log_info!(TEST, "  Nonce size: {} bytes", encrypted.nonce.len());
        log_info!(TEST, "  Tag size: {} bytes", encrypted.tag.len());
        log_info!(
            TEST,
            "  Ciphertext size: {} bytes",
            encrypted.ciphertext.len()
        );

        let decrypted = decrypt(&encrypted, &key).expect("Decryption failed");
        assert_eq!(decrypted, plaintext);
        log_success!(TEST, "  {} roundtrip OK", name);
    }
}

#[test]
fn test_encryption_with_aad() {
    const TEST: &str = "encryption_aad";
    log_test!(
        TEST,
        "Testing encryption with Additional Authenticated Data"
    );

    use voided_core::encryption::decrypt_with_aad;

    let key = generate_key();
    let plaintext = b"Encrypted payload";
    let aad = b"Additional authenticated data - not encrypted but verified";

    log_info!(TEST, "Plaintext: {} bytes", plaintext.len());
    log_info!(TEST, "AAD: {} bytes", aad.len());

    let opts = EncryptOptions {
        algorithm: Some(Algorithm::Aes256Gcm),
        aad: Some(aad.to_vec()),
    };

    let encrypted = encrypt(plaintext, &key, Some(opts)).expect("Encryption failed");
    log_info!(TEST, "Encrypted successfully");

    // Decrypt with correct AAD (must use same AAD as encryption)
    let decrypted = decrypt_with_aad(&encrypted, &key, aad).expect("Decryption failed");
    assert_eq!(decrypted, plaintext);
    log_success!(TEST, "AAD encryption/decryption works correctly");

    // Verify that wrong AAD fails
    let wrong_aad_result = decrypt_with_aad(&encrypted, &key, b"wrong aad");
    assert!(
        wrong_aad_result.is_err(),
        "Wrong AAD should fail decryption"
    );
    log_success!(TEST, "Wrong AAD correctly rejected");

    // Verify that no AAD fails
    let no_aad_result = decrypt(&encrypted, &key);
    assert!(
        no_aad_result.is_err(),
        "No AAD should fail when AAD was used"
    );
    log_success!(TEST, "Missing AAD correctly rejected");
}

// =============================================================================
// KEY DERIVATION TESTS
// =============================================================================

#[test]
fn test_key_derivation_hkdf() {
    const TEST: &str = "key_derivation_hkdf";
    log_test!(TEST, "Testing HKDF key derivation");

    let ikm = random_bytes(32);
    let salt = random_bytes(16);
    let info = b"voided-test-context";

    log_info!(TEST, "IKM: {} bytes", ikm.len());
    log_info!(TEST, "Salt: {} bytes", salt.len());
    log_info!(TEST, "Info: {:?}", String::from_utf8_lossy(info));

    let key1 = derive_key_hkdf(&ikm, Some(&salt), info).expect("HKDF failed");
    let key2 = derive_key_hkdf(&ikm, Some(&salt), info).expect("HKDF failed");

    log_info!(TEST, "Derived key size: {} bytes", key1.as_bytes().len());
    log_info!(TEST, "Key (first 16 bytes): {:?}", &key1.as_bytes()[..16]);

    assert_eq!(
        key1.as_bytes(),
        key2.as_bytes(),
        "HKDF should be deterministic"
    );
    log_success!(TEST, "HKDF derivation is deterministic");

    // Different info should produce different key
    let key3 = derive_key_hkdf(&ikm, Some(&salt), b"different-info").expect("HKDF failed");
    assert_ne!(
        key1.as_bytes(),
        key3.as_bytes(),
        "Different info should produce different key"
    );
    log_success!(TEST, "Different info produces different key");
}

#[test]
fn test_key_derivation_pbkdf2() {
    const TEST: &str = "key_derivation_pbkdf2";
    log_test!(TEST, "Testing PBKDF2 key derivation");

    let password = b"correct horse battery staple";
    let salt = random_bytes(16);
    let iterations = 10000u32;

    log_info!(TEST, "Password: {:?}", String::from_utf8_lossy(password));
    log_info!(TEST, "Salt: {} bytes", salt.len());
    log_info!(TEST, "Iterations: {}", iterations);

    let start = std::time::Instant::now();
    let key1 = derive_key_pbkdf2(password, &salt, iterations).expect("PBKDF2 failed");
    let elapsed = start.elapsed();

    log_info!(TEST, "Derivation time: {:?}", elapsed);
    log_info!(TEST, "Derived key size: {} bytes", key1.as_bytes().len());

    let key2 = derive_key_pbkdf2(password, &salt, iterations).expect("PBKDF2 failed");
    assert_eq!(
        key1.as_bytes(),
        key2.as_bytes(),
        "PBKDF2 should be deterministic"
    );
    log_success!(TEST, "PBKDF2 derivation is deterministic");

    // Different password should produce different key
    let key3 = derive_key_pbkdf2(b"wrong password", &salt, iterations).expect("PBKDF2 failed");
    assert_ne!(key1.as_bytes(), key3.as_bytes());
    log_success!(TEST, "Different password produces different key");
}

// =============================================================================
// HASHING TESTS
// =============================================================================

#[test]
fn test_hash_consistency() {
    const TEST: &str = "hash_consistency";
    log_test!(TEST, "Testing hash consistency across multiple calls");

    let data = b"Test data for hashing";

    for algo in [HashAlgorithm::Sha256, HashAlgorithm::Sha512] {
        let algo_name = match algo {
            HashAlgorithm::Sha256 => "SHA-256",
            HashAlgorithm::Sha512 => "SHA-512",
        };

        let hash1 = hash_hex(data, algo);
        let hash2 = hash_hex(data, algo);
        let hash3 = hash_hex(data, algo);

        log_info!(TEST, "{}: {}", algo_name, hash1);

        assert_eq!(hash1, hash2);
        assert_eq!(hash2, hash3);
        log_success!(TEST, "{} is consistent", algo_name);
    }
}

#[test]
fn test_hash_salted() {
    const TEST: &str = "hash_salted";
    log_test!(TEST, "Testing salted hashing");

    let data = b"Password123";
    let salt1 = random_bytes(16);
    let salt2 = random_bytes(16);

    log_info!(TEST, "Data: {:?}", String::from_utf8_lossy(data));
    log_info!(TEST, "Salt1: {}", hex_encode(&salt1));
    log_info!(TEST, "Salt2: {}", hex_encode(&salt2));

    let hash1 = hash_with_salt_hex(data, &salt1, HashAlgorithm::Sha256);
    let hash2 = hash_with_salt_hex(data, &salt1, HashAlgorithm::Sha256);
    let hash3 = hash_with_salt_hex(data, &salt2, HashAlgorithm::Sha256);

    log_info!(TEST, "Hash with salt1: {}", hash1);
    log_info!(TEST, "Hash with salt2: {}", hash3);

    assert_eq!(hash1, hash2, "Same salt should produce same hash");
    assert_ne!(hash1, hash3, "Different salt should produce different hash");
    log_success!(TEST, "Salted hashing works correctly");
}

#[test]
fn test_hmac_generation_and_verification() {
    const TEST: &str = "hmac_verify";
    log_test!(TEST, "Testing HMAC generation and verification");

    let data = b"Message to authenticate";
    let key = random_bytes(32);

    log_info!(TEST, "Data: {:?}", String::from_utf8_lossy(data));
    log_info!(TEST, "Key size: {} bytes", key.len());

    let hmac = generate_hmac_hex(data, &key, HashAlgorithm::Sha256).expect("HMAC failed");
    log_info!(TEST, "HMAC: {}", hmac);

    let hmac_bytes = hex_decode(&hmac).expect("Hex decode failed");
    let verified =
        verify_hmac(data, &hmac_bytes, &key, HashAlgorithm::Sha256).expect("Verify failed");
    assert!(verified, "HMAC should verify");
    log_success!(TEST, "HMAC verification passed");

    // Tampered data should fail
    let tampered = b"Tampered message";
    let verified_tampered =
        verify_hmac(tampered, &hmac_bytes, &key, HashAlgorithm::Sha256).expect("Verify failed");
    assert!(
        !verified_tampered,
        "Tampered data should fail HMAC verification"
    );
    log_success!(TEST, "Tampered data correctly rejected");
}

#[test]
fn test_constant_time_comparison() {
    const TEST: &str = "constant_time";
    log_test!(TEST, "Testing constant-time hash comparison");

    let hash1 =
        hex_decode("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855").unwrap();
    let hash2 =
        hex_decode("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855").unwrap();
    let hash3 =
        hex_decode("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856").unwrap();

    log_info!(TEST, "Hash1 == Hash2: {}", compare_hashes(&hash1, &hash2));
    log_info!(TEST, "Hash1 == Hash3: {}", compare_hashes(&hash1, &hash3));

    assert!(compare_hashes(&hash1, &hash2));
    assert!(!compare_hashes(&hash1, &hash3));
    log_success!(TEST, "Constant-time comparison works correctly");
}

#[test]
fn test_fingerprint_and_safety_numbers() {
    const TEST: &str = "fingerprint";
    log_test!(TEST, "Testing fingerprint and safety number generation");

    let key_bytes = random_bytes(32);

    let fingerprint = generate_fingerprint(&key_bytes, 8);
    log_info!(TEST, "Fingerprint: {}", fingerprint);
    assert_eq!(
        fingerprint.len(),
        16,
        "Fingerprint should be 16 hex chars for 8 bytes"
    );

    let safety = generate_safety_numbers(&key_bytes, 5);
    log_info!(TEST, "Safety numbers: {}", safety);
    assert!(!safety.is_empty());

    // Same input should produce same output
    let fingerprint2 = generate_fingerprint(&key_bytes, 8);
    let safety2 = generate_safety_numbers(&key_bytes, 5);
    assert_eq!(fingerprint, fingerprint2);
    assert_eq!(safety, safety2);
    log_success!(TEST, "Fingerprints and safety numbers are deterministic");
}

#[test]
fn test_pbkdf2_hash_and_verify() {
    const TEST: &str = "pbkdf2_hash";
    log_test!(TEST, "Testing PBKDF2 password hashing");

    let password = b"MySecurePassword123!";
    let salt = random_bytes(16);
    let iterations = 10000u32;

    log_info!(TEST, "Password length: {} bytes", password.len());
    log_info!(TEST, "Salt: {}", hex_encode(&salt));
    log_info!(TEST, "Iterations: {}", iterations);

    let hash = hash_with_pbkdf2(password, &salt, iterations);
    log_info!(TEST, "Hash: {}", hex_encode(&hash));

    let verified = verify_pbkdf2(password, &hash, &salt, iterations);
    assert!(verified, "Correct password should verify");
    log_success!(TEST, "PBKDF2 verification passed");

    let wrong_verified = verify_pbkdf2(b"WrongPassword", &hash, &salt, iterations);
    assert!(!wrong_verified, "Wrong password should fail");
    log_success!(TEST, "Wrong password correctly rejected");
}

// =============================================================================
// ENCODING TESTS
// =============================================================================

#[test]
fn test_encoding_edge_cases() {
    const TEST: &str = "encoding_edge";
    log_test!(TEST, "Testing encoding edge cases");

    // Empty
    let empty = base64_encode(b"");
    log_info!(TEST, "Empty base64: '{}'", empty);
    assert_eq!(empty, "");
    assert_eq!(base64_decode("").unwrap(), b"");

    // Padding variations
    let test_cases = [
        (b"a".as_slice(), "YQ=="),
        (b"ab".as_slice(), "YWI="),
        (b"abc".as_slice(), "YWJj"),
        (b"abcd".as_slice(), "YWJjZA=="),
    ];

    for (input, expected) in test_cases {
        let encoded = base64_encode(input);
        log_info!(
            TEST,
            "Input: {:?}, Encoded: {}, Expected: {}",
            String::from_utf8_lossy(input),
            encoded,
            expected
        );
        assert_eq!(encoded, expected);

        let decoded = base64_decode(expected).unwrap();
        assert_eq!(decoded, input);
    }
    log_success!(TEST, "Base64 padding edge cases pass");

    // Binary data
    let binary: Vec<u8> = (0..=255).collect();
    let encoded = base64_encode(&binary);
    let decoded = base64_decode(&encoded).unwrap();
    assert_eq!(decoded, binary);
    log_success!(TEST, "Binary data roundtrip OK");

    // Invalid base64
    let invalid_result = base64_decode("not valid base64!!!");
    log_info!(TEST, "Invalid base64 result: {:?}", invalid_result.is_err());
    assert!(invalid_result.is_err());
    log_success!(TEST, "Invalid base64 correctly rejected");
}

#[test]
fn test_hex_edge_cases() {
    const TEST: &str = "hex_edge";
    log_test!(TEST, "Testing hex encoding edge cases");

    // Empty
    assert_eq!(hex_encode(b""), "");
    assert_eq!(hex_decode("").unwrap(), b"");

    // All byte values
    let all_bytes: Vec<u8> = (0..=255).collect();
    let hex = hex_encode(&all_bytes);
    log_info!(TEST, "All bytes hex length: {} chars", hex.len());
    assert_eq!(hex.len(), 512); // 256 bytes * 2 hex chars

    let decoded = hex_decode(&hex).unwrap();
    assert_eq!(decoded, all_bytes);
    log_success!(TEST, "All byte values roundtrip OK");

    // Invalid hex
    let invalid_cases = ["g", "0g", "00000g", "0"];
    for invalid in invalid_cases {
        let result = hex_decode(invalid);
        log_info!(TEST, "Invalid hex '{}': {:?}", invalid, result.is_err());
        assert!(result.is_err(), "Invalid hex '{}' should fail", invalid);
    }
    log_success!(TEST, "Invalid hex correctly rejected");
}

// =============================================================================
// UTILITY TESTS
// =============================================================================

#[test]
fn test_random_bytes_quality() {
    const TEST: &str = "random_quality";
    log_test!(TEST, "Testing random byte generation quality");

    // Test different lengths
    for len in [0, 1, 16, 32, 64, 1024] {
        let bytes = random_bytes(len);
        assert_eq!(bytes.len(), len);
        log_info!(TEST, "Generated {} random bytes", len);
    }

    // Test uniqueness (10 samples)
    let samples: Vec<Vec<u8>> = (0..10).map(|_| random_bytes(32)).collect();
    for (i, a) in samples.iter().enumerate() {
        for (j, b) in samples.iter().enumerate() {
            if i != j {
                assert_ne!(a, b, "Random bytes should be unique");
            }
        }
    }
    log_success!(TEST, "Random bytes are unique across samples");

    // Basic entropy check - at least some variation in bytes
    let large_sample = random_bytes(1000);
    let unique_bytes: std::collections::HashSet<u8> = large_sample.iter().cloned().collect();
    log_info!(
        TEST,
        "Unique byte values in 1000-byte sample: {}",
        unique_bytes.len()
    );
    assert!(
        unique_bytes.len() > 200,
        "Should have good byte distribution"
    );
    log_success!(TEST, "Random bytes have good distribution");
}

#[test]
fn test_secure_wipe() {
    const TEST: &str = "secure_wipe";
    log_test!(TEST, "Testing secure memory wiping");

    let mut buffer = vec![0xAA; 64];
    log_info!(TEST, "Before wipe (first 8 bytes): {:?}", &buffer[..8]);

    secure_wipe(&mut buffer);
    log_info!(TEST, "After wipe (first 8 bytes): {:?}", &buffer[..8]);

    assert!(buffer.iter().all(|&b| b == 0), "Buffer should be zeroed");
    log_success!(TEST, "Secure wipe zeros buffer");
}

// =============================================================================
// COMPRESSION TESTS
// =============================================================================

#[cfg(feature = "compression")]
#[test]
fn test_compression_algorithms() {
    const TEST: &str = "compression_algos";
    log_test!(TEST, "Testing compression algorithms");

    let data = b"Hello, World! ".repeat(100);
    log_info!(TEST, "Original size: {} bytes", data.len());

    for algo in [CompressionAlgorithm::Gzip, CompressionAlgorithm::Brotli] {
        let algo_name = algo.name();
        log_info!(TEST, "Testing {}", algo_name);

        let opts = CompressionOptions {
            algorithm: algo,
            min_size_threshold: 0,
            level: 6,
        };

        let result = compress(&data, Some(opts)).expect("Compression failed");
        log_info!(TEST, "  Compressed size: {} bytes", result.compressed_size);
        log_info!(
            TEST,
            "  Compression ratio: {:.2}x",
            result.compression_ratio
        );

        let decompressed = decompress(&result.compressed, algo).expect("Decompression failed");
        assert_eq!(decompressed, data);
        log_success!(TEST, "  {} roundtrip OK", algo_name);
    }
}

#[cfg(feature = "compression")]
#[test]
fn test_compression_incompressible() {
    const TEST: &str = "compression_incompressible";
    log_test!(TEST, "Testing compression of incompressible data");

    // Random data is generally incompressible
    let data = random_bytes(10000);
    log_info!(TEST, "Random data size: {} bytes", data.len());

    let opts = CompressionOptions {
        algorithm: CompressionAlgorithm::Gzip,
        min_size_threshold: 0,
        level: 6,
    };

    let result = compress(&data, Some(opts)).expect("Compression failed");
    log_info!(TEST, "Compressed size: {} bytes", result.compressed_size);
    log_info!(TEST, "Actual algorithm used: {}", result.algorithm.name());
    log_info!(
        TEST,
        "Ratio: {:.2}x ({})",
        result.compression_ratio,
        if result.compressed_size >= data.len() {
            "stored uncompressed"
        } else {
            "compressed"
        }
    );

    // Use the ACTUAL algorithm from the result, not the requested one
    // The compress function may fall back to "none" for incompressible data
    let decompressed =
        decompress(&result.compressed, result.algorithm).expect("Decompression failed");
    assert_eq!(decompressed, data);
    log_success!(
        TEST,
        "Incompressible data roundtrip OK (algorithm: {})",
        result.algorithm.name()
    );
}

// =============================================================================
// FUSED SHELL TESTS
// =============================================================================

#[cfg(feature = "compression")]
#[test]
fn test_fused_presets_roundtrip() {
    const TEST: &str = "fused_presets";
    log_test!(TEST, "Testing fused protect/open roundtrips across presets");

    let key = generate_key();
    let payload = b"Voided fused full-flow coverage ".repeat(4096);

    for preset in [
        FusedPreset::Compact,
        FusedPreset::Balanced,
        FusedPreset::Concealed,
    ] {
        let protected = protect(
            &payload,
            &key,
            Some(ProtectOptions {
                preset,
                ..ProtectOptions::default()
            }),
        )
        .expect("protect failed");
        let info = &protected.info;
        let public_info = inspect_artifact(&protected.artifact).expect("inspect failed");
        let restored = open(&protected.artifact, &key).expect("open failed");

        log_info!(
            TEST,
            "{:?}: protected={} compressed={} chunks={}",
            preset,
            info.protected_size,
            info.compressed_size,
            info.shell_chunk_count
        );

        assert_eq!(info.preset, preset);
        assert_eq!(public_info.preset_label, "opaque");
        assert_eq!(restored, payload);
        log_success!(TEST, "  {:?} preset roundtrip OK", preset);
    }
}

#[cfg(feature = "compression")]
#[test]
fn test_fused_tamper_detection() {
    const TEST: &str = "fused_tamper";
    log_test!(TEST, "Testing fused artifact tamper detection");

    let key = generate_key();
    let payload = b"tamper-me".repeat(2048);
    let protected = protect(&payload, &key, None).expect("protect failed");
    let mut tampered = protected.artifact.clone();
    let pivot = tampered.len() / 2;
    tampered[pivot] ^= 0x5A;

    assert!(open(&tampered, &key).is_err());
    log_success!(TEST, "Tampered artifact rejected");
}

#[cfg(feature = "compression")]
#[test]
fn test_fused_repack_preserves_plaintext() {
    const TEST: &str = "fused_repack";
    log_test!(TEST, "Testing fused repack behavior");

    let key = generate_key();
    let payload = random_bytes(96 * 1024);
    let initial = protect(
        &payload,
        &key,
        Some(ProtectOptions {
            preset: FusedPreset::Balanced,
            ..ProtectOptions::default()
        }),
    )
    .expect("initial protect failed");

    let repacked = repack_artifact(
        &initial.artifact,
        &key,
        Some(ProtectOptions {
            preset: FusedPreset::Concealed,
            ..ProtectOptions::default()
        }),
    )
    .expect("repack failed");
    let info = &repacked.info;
    let public_info = inspect_artifact(&repacked.artifact).expect("inspect failed");
    let restored = open(&repacked.artifact, &key).expect("open failed");

    assert_eq!(info.preset, FusedPreset::Concealed);
    assert_eq!(public_info.preset_label, "opaque");
    assert_eq!(restored, payload);
    log_success!(TEST, "Repacked artifact kept plaintext intact");
}
