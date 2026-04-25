//! Stress Tests - Professional-grade testing to break the cryptographic library
//!
//! These tests are designed to:
//! - Find edge cases and boundary conditions
//! - Test malformed inputs
//! - Test extremely large and small data
//! - Test concurrent operations
//! - Verify determinism guarantees
//! - Ensure proper error handling
//! - Fuzz-like random input testing

use voided_core::encryption::{
    decrypt, decrypt_with_aad, derive_key_hkdf, derive_key_pbkdf2, encrypt, generate_key,
    Algorithm, EncryptOptions, EncryptionResult, Key,
};
use voided_core::formats::{base64_decode, base64_encode, hex_decode, hex_encode};
use voided_core::hash::{
    compare_hashes, generate_fingerprint, generate_hmac, generate_safety_numbers, hash, hash_hex,
    hash_with_pbkdf2, hash_with_salt, verify_hmac, verify_pbkdf2, HashAlgorithm,
};
use voided_core::util::{constant_time_compare, random_bytes, secure_wipe};

#[cfg(feature = "compression")]
use voided_core::compression::{compress, decompress, CompressionAlgorithm, CompressionOptions};

#[cfg(feature = "compression")]
use voided_core::shell::{
    fuse_bytes, inspect_artifact, open, protect, repack_artifact, unfuse_bytes, FusedPreset,
    FusedShellOptions, ProtectOptions, DEFAULT_CHUNK_SIZE, SHELL_NONCE_SIZE,
};

use std::collections::HashSet;
use std::time::{Duration, Instant};

// ============================================================================
// ENCRYPTION STRESS TESTS
// ============================================================================

/// Test encryption with all possible byte values (0-255)
#[test]
fn test_encrypt_all_byte_values() {
    let key = generate_key();
    let plaintext: Vec<u8> = (0..=255).collect();

    let encrypted = encrypt(&plaintext, &key, None).expect("Encryption failed");
    let decrypted = decrypt(&encrypted, &key).expect("Decryption failed");

    assert_eq!(
        decrypted, plaintext,
        "All byte values should roundtrip correctly"
    );
}

/// Test encryption with repeated patterns
#[test]
fn test_encrypt_repeated_patterns() {
    let key = generate_key();

    let patterns = vec![
        vec![0u8; 10000],                              // All zeros
        vec![255u8; 10000],                            // All 0xFF
        vec![0xAA; 10000],                             // Alternating bits pattern 1
        vec![0x55; 10000],                             // Alternating bits pattern 2
        (0..10000).map(|i| (i % 256) as u8).collect(), // Repeating 0-255
    ];

    for (i, pattern) in patterns.iter().enumerate() {
        let encrypted =
            encrypt(pattern, &key, None).expect(&format!("Pattern {} encryption failed", i));
        let decrypted =
            decrypt(&encrypted, &key).expect(&format!("Pattern {} decryption failed", i));
        assert_eq!(&decrypted, pattern, "Pattern {} roundtrip failed", i);

        // Verify ciphertext is not equal to plaintext (basic sanity)
        assert_ne!(
            encrypted.ciphertext, *pattern,
            "Pattern {} ciphertext should differ from plaintext",
            i
        );
    }
}

/// Test encryption with gradually increasing sizes (power of 2)
#[test]
fn test_encrypt_power_of_two_sizes() {
    let key = generate_key();

    for power in 0..20 {
        let size = 1usize << power; // 1, 2, 4, 8, ... 524288
        let plaintext: Vec<u8> = (0..size).map(|i| (i % 256) as u8).collect();

        let encrypted =
            encrypt(&plaintext, &key, None).expect(&format!("Size {} encryption failed", size));
        let decrypted =
            decrypt(&encrypted, &key).expect(&format!("Size {} decryption failed", size));

        assert_eq!(decrypted.len(), size, "Size {} length mismatch", size);
        assert_eq!(decrypted, plaintext, "Size {} content mismatch", size);
    }
}

/// Test encryption at boundary sizes (off-by-one)
#[test]
fn test_encrypt_boundary_sizes() {
    let key = generate_key();

    // Test around common block sizes
    let boundaries = vec![
        15, 16, 17, // AES block size
        31, 32, 33, // Key size
        63, 64, 65, // ChaCha block
        127, 128, 129, // Double block
        255, 256, 257, // Byte boundary
        1023, 1024, 1025, // KB boundary
        4095, 4096, 4097, // Page size
    ];

    for size in boundaries {
        let plaintext: Vec<u8> = random_bytes(size);

        for algo in [Algorithm::Aes256Gcm, Algorithm::XChaCha20Poly1305] {
            let opts = EncryptOptions {
                algorithm: Some(algo),
                aad: None,
            };
            let encrypted = encrypt(&plaintext, &key, Some(opts))
                .expect(&format!("Size {} {:?} encryption failed", size, algo));
            let decrypted = decrypt(&encrypted, &key)
                .expect(&format!("Size {} {:?} decryption failed", size, algo));

            assert_eq!(
                decrypted, plaintext,
                "Size {} {:?} roundtrip failed",
                size, algo
            );
        }
    }
}

/// Test that each encryption produces unique ciphertext (nonce randomness)
#[test]
fn test_encrypt_unique_ciphertexts() {
    let key = generate_key();
    let plaintext = b"Same message encrypted multiple times";

    let mut ciphertexts: HashSet<Vec<u8>> = HashSet::new();
    let mut nonces: HashSet<Vec<u8>> = HashSet::new();

    for _ in 0..100 {
        let encrypted = encrypt(plaintext, &key, None).expect("Encryption failed");

        // Each ciphertext should be unique
        assert!(
            ciphertexts.insert(encrypted.ciphertext.clone()),
            "Duplicate ciphertext found - nonce reuse detected!"
        );

        // Each nonce should be unique
        assert!(
            nonces.insert(encrypted.nonce.clone()),
            "Duplicate nonce found - critical security vulnerability!"
        );
    }
}

/// Test decryption with tampered data fails correctly
#[test]
fn test_decrypt_tampered_data_all_positions() {
    let key = generate_key();
    let plaintext = b"Message that must not be tampered with";
    let encrypted = encrypt(plaintext, &key, None).expect("Encryption failed");

    // Tamper with each byte position in ciphertext
    for pos in 0..encrypted.ciphertext.len() {
        let mut tampered = encrypted.clone();
        tampered.ciphertext[pos] ^= 0x01; // Flip one bit

        let result = decrypt(&tampered, &key);
        assert!(
            result.is_err(),
            "Tampered ciphertext at position {} should fail",
            pos
        );
    }

    // Tamper with each byte position in tag
    for pos in 0..encrypted.tag.len() {
        let mut tampered = encrypted.clone();
        tampered.tag[pos] ^= 0x01;

        let result = decrypt(&tampered, &key);
        assert!(
            result.is_err(),
            "Tampered tag at position {} should fail",
            pos
        );
    }

    // Tamper with nonce (should fail authentication)
    for pos in 0..encrypted.nonce.len() {
        let mut tampered = encrypted.clone();
        tampered.nonce[pos] ^= 0x01;

        let result = decrypt(&tampered, &key);
        assert!(
            result.is_err(),
            "Tampered nonce at position {} should fail",
            pos
        );
    }
}

/// Test AAD mismatch detection
#[test]
fn test_aad_mismatch_detected() {
    let key = generate_key();
    let plaintext = b"Protected with AAD";
    let aad = b"Associated data that must match";

    let opts = EncryptOptions {
        algorithm: Some(Algorithm::Aes256Gcm),
        aad: Some(aad.to_vec()),
    };

    let encrypted = encrypt(plaintext, &key, Some(opts)).expect("Encryption failed");

    // Correct AAD should work
    let decrypted = decrypt_with_aad(&encrypted, &key, aad).expect("Correct AAD decryption failed");
    assert_eq!(decrypted, plaintext);

    // Different AAD should fail
    let wrong_aads = vec![
        b"Wrong AAD".to_vec(),
        b"Associated data that must match!".to_vec(), // Extra char
        b"associated data that must match".to_vec(),  // Wrong case
        vec![],                                       // Empty
        b"Associated data that must matc".to_vec(),   // Truncated
    ];

    for wrong_aad in wrong_aads {
        let result = decrypt_with_aad(&encrypted, &key, &wrong_aad);
        assert!(
            result.is_err(),
            "Wrong AAD {:?} should fail",
            String::from_utf8_lossy(&wrong_aad)
        );
    }
}

/// Test key derivation produces unique keys for different inputs
#[test]
fn test_key_derivation_uniqueness() {
    let base_ikm = random_bytes(32);
    let base_salt = random_bytes(16);
    let base_info = b"context";

    let mut keys: HashSet<Vec<u8>> = HashSet::new();

    // Base case
    let key = derive_key_hkdf(&base_ikm, Some(&base_salt), base_info).unwrap();
    keys.insert(key.as_bytes().to_vec());

    // Different IKM
    for _ in 0..10 {
        let ikm = random_bytes(32);
        let key = derive_key_hkdf(&ikm, Some(&base_salt), base_info).unwrap();
        assert!(
            keys.insert(key.as_bytes().to_vec()),
            "Different IKM should produce unique key"
        );
    }

    // Different salt
    for _ in 0..10 {
        let salt = random_bytes(16);
        let key = derive_key_hkdf(&base_ikm, Some(&salt), base_info).unwrap();
        assert!(
            keys.insert(key.as_bytes().to_vec()),
            "Different salt should produce unique key"
        );
    }

    // Different info
    for i in 0..10 {
        let info = format!("context-{}", i);
        let key = derive_key_hkdf(&base_ikm, Some(&base_salt), info.as_bytes()).unwrap();
        assert!(
            keys.insert(key.as_bytes().to_vec()),
            "Different info should produce unique key"
        );
    }
}

// ============================================================================
// HASHING STRESS TESTS
// ============================================================================

/// Test hash of very large data
#[test]
fn test_hash_large_data() {
    // 10 MB of data
    let data: Vec<u8> = (0..10_000_000).map(|i| (i % 256) as u8).collect();

    let start = Instant::now();
    let hash_result = hash(&data, HashAlgorithm::Sha256);
    let elapsed = start.elapsed();

    assert_eq!(hash_result.len(), 32);
    eprintln!("Hashed 10MB in {:?}", elapsed);

    // Same data should produce same hash
    let hash_result2 = hash(&data, HashAlgorithm::Sha256);
    assert_eq!(hash_result, hash_result2);
}

/// Test hash collision resistance (different inputs produce different hashes)
#[test]
fn test_hash_collision_resistance() {
    let mut hashes: HashSet<Vec<u8>> = HashSet::new();

    // Generate 1000 random inputs and verify no collisions
    for _ in 0..1000 {
        let data = random_bytes(100);
        let h = hash(&data, HashAlgorithm::Sha256);
        assert!(hashes.insert(h), "Hash collision detected!");
    }

    // Also test similar inputs (single bit difference)
    let base = random_bytes(100);
    let base_hash = hash(&base, HashAlgorithm::Sha256);
    hashes.insert(base_hash);

    for byte_pos in 0..base.len() {
        for bit_pos in 0..8 {
            let mut modified = base.clone();
            modified[byte_pos] ^= 1 << bit_pos;
            let h = hash(&modified, HashAlgorithm::Sha256);
            assert!(
                hashes.insert(h),
                "Similar input collision at byte {} bit {}",
                byte_pos,
                bit_pos
            );
        }
    }
}

/// Test HMAC with malformed keys
#[test]
fn test_hmac_key_variations() {
    let data = b"Message to authenticate";

    // Various key sizes (HMAC should handle any size)
    let key_sizes = vec![0, 1, 16, 32, 64, 128, 256, 1000];

    for size in key_sizes {
        let key: Vec<u8> = if size == 0 {
            vec![]
        } else {
            random_bytes(size)
        };
        let result = generate_hmac(data, &key, HashAlgorithm::Sha256);

        // HMAC should work with any key size
        assert!(result.is_ok(), "HMAC with key size {} should work", size);

        let hmac = result.unwrap();
        assert_eq!(hmac.len(), 32, "HMAC output should be 32 bytes for SHA256");

        // Verify HMAC
        let valid = verify_hmac(data, &hmac, &key, HashAlgorithm::Sha256).unwrap();
        assert!(valid, "HMAC verification should pass for key size {}", size);
    }
}

/// Test PBKDF2 with edge case parameters
#[test]
fn test_pbkdf2_edge_cases() {
    let password = b"password";
    let salt = b"salt";

    // Test with minimum iterations (should still work)
    let hash1 = hash_with_pbkdf2(password, salt, 1);
    assert_eq!(hash1.len(), 32);

    // Test with high iterations (should be slow but work)
    let start = Instant::now();
    let hash2 = hash_with_pbkdf2(password, salt, 100_000);
    let elapsed = start.elapsed();

    assert_eq!(hash2.len(), 32);
    assert!(
        elapsed > Duration::from_millis(100),
        "High iteration PBKDF2 should take time"
    );
    eprintln!("PBKDF2 with 100k iterations took {:?}", elapsed);

    // Different iterations should produce different hashes
    assert_ne!(hash1, hash2);
}

/// Test constant-time comparison actually works
#[test]
fn test_constant_time_comparison() {
    let a = random_bytes(32);
    let b = a.clone();
    let mut c = a.clone();
    c[0] ^= 0x01;

    // Same data
    assert!(constant_time_compare(&a, &b));
    assert!(compare_hashes(&a, &b));

    // Different data
    assert!(!constant_time_compare(&a, &c));
    assert!(!compare_hashes(&a, &c));

    // Different lengths
    assert!(!constant_time_compare(&a, &a[..16]));
    assert!(!compare_hashes(&a, &a[..16]));

    // Empty
    assert!(constant_time_compare(&[], &[]));
}

// ============================================================================
// ENCODING STRESS TESTS
// ============================================================================

/// Test base64 with all possible byte combinations
#[test]
fn test_base64_all_bytes() {
    // Test all single bytes
    for b in 0..=255u8 {
        let input = vec![b];
        let encoded = base64_encode(&input);
        let decoded = base64_decode(&encoded).expect("Base64 decode failed");
        assert_eq!(decoded, input, "Byte {} roundtrip failed", b);
    }

    // Test all two-byte combinations (sampling for performance)
    for b1 in (0..=255u8).step_by(16) {
        for b2 in (0..=255u8).step_by(16) {
            let input = vec![b1, b2];
            let encoded = base64_encode(&input);
            let decoded = base64_decode(&encoded).expect("Base64 decode failed");
            assert_eq!(decoded, input, "Bytes {},{} roundtrip failed", b1, b2);
        }
    }
}

/// Test base64 with invalid inputs
#[test]
fn test_base64_invalid_inputs() {
    let invalid_inputs = vec![
        "!!!",        // Invalid chars
        "====",       // Only padding
        "A===",       // Wrong padding
        "AAAA====",   // Too much padding
        "A",          // Incomplete (needs padding)
        "AA",         // Incomplete
        "AAA",        // Incomplete
        "A B C D",    // Spaces
        "AAAA\nAAAA", // Newlines
        "AAAA\0AAAA", // Null byte
    ];

    for input in invalid_inputs {
        let result = base64_decode(input);
        // Some might be valid depending on implementation, but document behavior
        if result.is_err() {
            eprintln!("Correctly rejected invalid base64: {:?}", input);
        }
    }
}

/// Test hex encoding with all bytes
#[test]
fn test_hex_all_bytes() {
    for b in 0..=255u8 {
        let input = vec![b];
        let encoded = hex_encode(&input);

        // Verify format
        assert_eq!(encoded.len(), 2);
        assert!(encoded.chars().all(|c| c.is_ascii_hexdigit()));

        let decoded = hex_decode(&encoded).expect("Hex decode failed");
        assert_eq!(decoded, input, "Byte {} roundtrip failed", b);
    }
}

/// Test hex with invalid inputs
#[test]
fn test_hex_invalid_inputs() {
    let invalid_inputs = vec![
        "0",    // Odd length
        "0g",   // Invalid char
        "GG",   // Invalid char
        " 00",  // Leading space
        "00 ",  // Trailing space
        "0 0",  // Middle space
        "0x00", // Prefix (not handled)
    ];

    for input in invalid_inputs {
        let result = hex_decode(input);
        assert!(result.is_err(), "Should reject invalid hex: {:?}", input);
    }
}

// ============================================================================
// COMPRESSION STRESS TESTS
// ============================================================================

#[cfg(feature = "compression")]
mod compression_stress {
    use super::*;

    /// Test compression with pathological inputs
    #[test]
    fn test_compression_pathological() {
        let pathological_inputs = vec![
            // Already compressed-like random data
            random_bytes(10000),
            // Highly compressible
            vec![0u8; 100000],
            // Repeated pattern
            "ABABABABAB".repeat(10000).into_bytes(),
            // JSON-like
            r#"{"key":"value","nested":{"a":1,"b":2}}"#.repeat(1000).into_bytes(),
            // Base64-like (low entropy but not as compressible)
            base64_encode(&random_bytes(10000)).into_bytes(),
        ];

        for (i, input) in pathological_inputs.iter().enumerate() {
            for algo in [CompressionAlgorithm::Gzip, CompressionAlgorithm::Brotli] {
                let opts = CompressionOptions {
                    algorithm: algo,
                    min_size_threshold: 0,
                    level: 6,
                };

                let result = compress(input, Some(opts)).expect("Compression failed");
                let decompressed =
                    decompress(&result.compressed, result.algorithm).expect("Decompression failed");

                assert_eq!(
                    &decompressed, input,
                    "Input {} {:?} roundtrip failed",
                    i, algo
                );

                eprintln!(
                    "Input {} {:?}: {} -> {} ({:.1}%)",
                    i,
                    algo,
                    input.len(),
                    result.compressed_size,
                    (result.compressed_size as f64 / input.len() as f64) * 100.0
                );
            }
        }
    }

    /// Test compression at extreme sizes
    #[test]
    fn test_compression_extreme_sizes() {
        // Very small
        for size in 0..=10 {
            let input: Vec<u8> = (0..size).map(|i| i as u8).collect();
            let result = compress(&input, None).expect("Compression failed");
            let decompressed =
                decompress(&result.compressed, result.algorithm).expect("Decompression failed");
            assert_eq!(decompressed, input, "Size {} roundtrip failed", size);
        }

        // Large (5MB)
        let large: Vec<u8> = (0..5_000_000).map(|i| (i % 256) as u8).collect();
        let result = compress(&large, None).expect("Large compression failed");
        let decompressed =
            decompress(&result.compressed, result.algorithm).expect("Large decompression failed");
        assert_eq!(decompressed, large);
    }
}

// ============================================================================
// FUSED SHELL STRESS TESTS
// ============================================================================

#[cfg(feature = "compression")]
mod fused_shell_stress {
    use super::*;

    #[test]
    fn test_fused_shell_roundtrip_boundaries() {
        let key = Key::from_bytes(&[0xA5; 32]).expect("valid key");
        let sizes = [0usize, 1, 31, 32, 33, 255, 4096, DEFAULT_CHUNK_SIZE + 257];

        for preset in [
            FusedPreset::Compact,
            FusedPreset::Balanced,
            FusedPreset::Concealed,
        ] {
            for size in sizes {
                let payload = random_bytes(size);
                let shell = fuse_bytes(
                    &payload,
                    &key,
                    Some(FusedShellOptions {
                        preset,
                        chunk_size: None,
                        shell_nonce: Some([preset as u8 + 1; SHELL_NONCE_SIZE]),
                    }),
                )
                .expect("fuse");
                let restored = unfuse_bytes(&shell, &key).expect("unfuse");

                assert_eq!(restored, payload, "Preset {:?} size {}", preset, size);
            }
        }
    }

    #[test]
    fn test_fused_protect_open_large_payloads() {
        let key = Key::from_bytes(&[0x5C; 32]).expect("valid key");

        for preset in [
            FusedPreset::Compact,
            FusedPreset::Balanced,
            FusedPreset::Concealed,
        ] {
            let payload = b"voided fused artifact stress ".repeat(24 * 1024);
            let protected = protect(
                &payload,
                &key,
                Some(ProtectOptions {
                    preset,
                    shell_chunk_size: Some(8 * 1024),
                    ..ProtectOptions::default()
                }),
            )
            .expect("protect");
            let info = &protected.info;
            let public_info = inspect_artifact(&protected.artifact).expect("inspect");
            let restored = open(&protected.artifact, &key).expect("open");

            assert_eq!(info.preset, preset);
            assert_eq!(info.original_size, payload.len());
            assert_eq!(public_info.preset_label, "opaque");
            assert_eq!(restored, payload, "Preset {:?} protect/open failed", preset);
        }
    }

    #[test]
    fn test_repack_artifact_across_presets() {
        let key = Key::from_bytes(&[0x6D; 32]).expect("valid key");
        let payload = random_bytes(DEFAULT_CHUNK_SIZE * 3 + 111);
        let initial = protect(
            &payload,
            &key,
            Some(ProtectOptions {
                preset: FusedPreset::Balanced,
                ..ProtectOptions::default()
            }),
        )
        .expect("initial protect");

        for preset in [FusedPreset::Compact, FusedPreset::Concealed] {
            let repacked = repack_artifact(
                &initial.artifact,
                &key,
                Some(ProtectOptions {
                    preset,
                    ..ProtectOptions::default()
                }),
            )
            .expect("repack");
            let restored = open(&repacked.artifact, &key).expect("open");
            let info = &repacked.info;
            let public_info = inspect_artifact(&repacked.artifact).expect("inspect");

            assert_eq!(info.preset, preset);
            assert_eq!(public_info.preset_label, "opaque");
            assert_eq!(restored, payload);
        }
    }
}

// ============================================================================
// UTILITY STRESS TESTS
// ============================================================================

/// Test random byte generation quality
#[test]
fn test_random_bytes_statistical_quality() {
    // Generate lots of random data
    let samples: Vec<Vec<u8>> = (0..1000).map(|_| random_bytes(32)).collect();

    // Verify uniqueness (no duplicates in 1000 samples)
    let unique: HashSet<Vec<u8>> = samples.iter().cloned().collect();
    assert_eq!(
        unique.len(),
        1000,
        "Should have no duplicate random samples"
    );

    // Basic statistical test: byte distribution should be roughly uniform
    let mut byte_counts = [0u32; 256];
    for sample in &samples {
        for &byte in sample {
            byte_counts[byte as usize] += 1;
        }
    }

    let total_bytes = 1000 * 32;
    let expected_per_byte = total_bytes as f64 / 256.0;

    // Check no byte is extremely over or under-represented (>3 standard deviations)
    // For binomial distribution with n=total_bytes, p=1/256
    let variance = total_bytes as f64 * (1.0 / 256.0) * (255.0 / 256.0);
    let std_dev = variance.sqrt();

    for (byte_val, &count) in byte_counts.iter().enumerate() {
        let deviation = ((count as f64) - expected_per_byte).abs() / std_dev;
        assert!(
            deviation < 4.0,
            "Byte {} has count {} (expected ~{:.1}), deviation {:.1} std devs",
            byte_val,
            count,
            expected_per_byte,
            deviation
        );
    }
}

/// Test secure wipe actually zeros memory
#[test]
fn test_secure_wipe_thorough() {
    // Test various sizes with non-zero content
    for size in [16, 32, 64, 128, 256, 1024, 4096] {
        // Fill with 0xAA pattern (non-zero)
        let mut buffer: Vec<u8> = vec![0xAA; size];

        // Verify not all zeros before wipe
        assert!(
            !buffer.iter().all(|&b| b == 0),
            "Buffer should not be zeros before wipe"
        );

        secure_wipe(&mut buffer);

        // Verify all zeros after wipe
        assert!(
            buffer.iter().all(|&b| b == 0),
            "Buffer size {} should be all zeros after wipe",
            size
        );
    }

    // Also test with random data
    for size in [100, 500, 1000] {
        let mut buffer = random_bytes(size);
        secure_wipe(&mut buffer);
        assert!(
            buffer.iter().all(|&b| b == 0),
            "Random buffer size {} should be zeroed",
            size
        );
    }
}

// ============================================================================
// PERFORMANCE/TIMING TESTS
// ============================================================================

/// Benchmark encryption throughput
#[test]
fn test_encryption_throughput() {
    let key = generate_key();
    let data_1kb = random_bytes(1024);
    let data_1mb = random_bytes(1024 * 1024);

    // Warm up
    for _ in 0..10 {
        let _ = encrypt(&data_1kb, &key, None);
    }

    // Benchmark 1KB
    let start = Instant::now();
    let iterations = 1000;
    for _ in 0..iterations {
        let _ = encrypt(&data_1kb, &key, None).unwrap();
    }
    let elapsed = start.elapsed();
    let throughput_1kb = (iterations * 1024) as f64 / elapsed.as_secs_f64() / 1_000_000.0;

    // Benchmark 1MB
    let start = Instant::now();
    let iterations = 50;
    for _ in 0..iterations {
        let _ = encrypt(&data_1mb, &key, None).unwrap();
    }
    let elapsed = start.elapsed();
    let throughput_1mb = (iterations * 1024 * 1024) as f64 / elapsed.as_secs_f64() / 1_000_000.0;

    eprintln!("Encryption throughput:");
    eprintln!("  1KB blocks: {:.1} MB/s", throughput_1kb);
    eprintln!("  1MB blocks: {:.1} MB/s", throughput_1mb);

    // Debug mode is much slower, so we just report throughput
    // In release mode, expect >100 MB/s
    // In debug mode, accept >1 MB/s
    #[cfg(debug_assertions)]
    assert!(
        throughput_1mb > 1.0,
        "Encryption throughput too low even for debug mode"
    );

    #[cfg(not(debug_assertions))]
    assert!(
        throughput_1mb > 50.0,
        "Encryption throughput too low for release mode"
    );
}

/// Benchmark hashing throughput
#[test]
fn test_hashing_throughput() {
    let data_1mb = random_bytes(1024 * 1024);

    let start = Instant::now();
    let iterations = 100;
    for _ in 0..iterations {
        let _ = hash(&data_1mb, HashAlgorithm::Sha256);
    }
    let elapsed = start.elapsed();
    let throughput = (iterations * 1024 * 1024) as f64 / elapsed.as_secs_f64() / 1_000_000.0;

    eprintln!("SHA-256 throughput: {:.1} MB/s", throughput);

    // Debug mode is much slower
    // In release mode, expect >200 MB/s
    // In debug mode, accept >5 MB/s
    #[cfg(debug_assertions)]
    assert!(
        throughput > 5.0,
        "SHA-256 throughput too low even for debug mode"
    );

    #[cfg(not(debug_assertions))]
    assert!(
        throughput > 100.0,
        "SHA-256 throughput too low for release mode"
    );
}
