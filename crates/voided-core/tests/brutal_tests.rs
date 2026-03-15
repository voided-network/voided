//! Production Realistic Test Suite
//!
//! What this suite does (real workloads, not parameter sweeps):
//! 1) Realtime small-message path (chat, events): 512B with AAD, high ops, verifies tamper rejection.
//! 2) Document workflow (typical payloads): 4KB to 256KB mixed sizes, base64/hex field transport, verify roundtrip.
//! 3) File sync chunking (large payloads): 1MB and 8MB chunks, parallel sessions, sustained throughput.
//! 4) Multi-tenant concurrency: N sessions, each with its own key, mixed operations, no cross-key decrypt.
//! 5) Failure mode realism: corrupted packets, swapped fields, wrong AAD, wrong algo, must fail cleanly.
//!
//! Run (recommended):
//!   cargo test -p voided-core --features backend --test prod_realistic_tests --release -- --nocapture --test-threads=1
//!
//! Optional env (to scale work without changing code):
//!   PROD_SEED=1
//!   PROD_SESSIONS=64
//!   PROD_SECONDS=2
//!   PROD_FILE_MB=256

use std::env;
use std::panic;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

use voided_core::encryption::{
    decrypt, decrypt_with_aad, encrypt, generate_key, Algorithm, EncryptOptions, EncryptionResult,
};
use voided_core::formats::{base64_decode, base64_encode, hex_decode, hex_encode};
use voided_core::util::random_bytes;

fn env_u64(name: &str, default: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}
fn env_usize(name: &str, default: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

#[derive(Clone)]
struct XorShift64 {
    s: u64,
}
impl XorShift64 {
    fn new(seed: u64) -> Self {
        Self {
            s: if seed == 0 { 0x9E3779B97F4A7C15 } else { seed },
        }
    }
    fn next_u64(&mut self) -> u64 {
        let mut x = self.s;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.s = x;
        x
    }
    fn fill_bytes(&mut self, out: &mut [u8]) {
        for b in out {
            *b = (self.next_u64() & 0xFF) as u8;
        }
    }
}

macro_rules! logj {
    ($test:expr, $msg:expr) => {
        eprintln!(r#"{{"tag":"PROD","test":"{}","msg":"{}"}}"#, $test, $msg);
    };
    ($test:expr, $msg:expr, $extra:expr) => {
        eprintln!(
            r#"{{"tag":"PROD","test":"{}","msg":"{}","extra":"{}"}}"#,
            $test, $msg, $extra
        );
    };
}

fn no_panic<T, F: FnOnce() -> T>(f: F) -> Result<T, &'static str> {
    let r = panic::catch_unwind(panic::AssertUnwindSafe(f));
    match r {
        Ok(v) => Ok(v),
        Err(_) => Err("panic"),
    }
}

fn corrupt_one_bit(mut e: EncryptionResult) -> EncryptionResult {
    if !e.ciphertext.is_empty() {
        e.ciphertext[0] ^= 0x01;
        return e;
    }
    if !e.tag.is_empty() {
        e.tag[0] ^= 0x01;
        return e;
    }
    if !e.nonce.is_empty() {
        e.nonce[0] ^= 0x01;
        return e;
    }
    e
}

#[test]
fn prod_realtime_small_messages() {
    let test = "prod_realtime_small_messages";

    let seed = env_u64("PROD_SEED", 1);
    let seconds = env_usize("PROD_SECONDS", 2).max(1);

    let key = generate_key();
    let aad = b"tenant=prod|route=realtime|v=1";
    let algo = Algorithm::XChaCha20Poly1305;

    // Simulate realtime: lots of small messages, AAD always present, some corrupted packets.
    let mut rng = XorShift64::new(seed);
    let start = Instant::now();

    let mut ok_ops = 0usize;
    let mut rejected = 0usize;

    while start.elapsed() < Duration::from_secs(seconds as u64) {
        let mut pt = vec![0u8; 512];
        rng.fill_bytes(&mut pt);

        let enc = encrypt(
            &pt,
            &key,
            Some(EncryptOptions {
                algorithm: Some(algo),
                aad: Some(aad.to_vec()),
            }),
        )
        .expect("encrypt");

        // 1 out of 20 packets get corrupted "in transit"
        let should_corrupt = (rng.next_u64() % 20) == 0;
        let packet = if should_corrupt {
            corrupt_one_bit(enc.clone())
        } else {
            enc
        };

        let dec = decrypt_with_aad(&packet, &key, aad);

        if should_corrupt {
            assert!(dec.is_err(), "corruption must be rejected");
            rejected += 1;
        } else {
            let out = dec.expect("decrypt");
            assert_eq!(out, pt);
            ok_ops += 1;
        }
    }

    let elapsed = start.elapsed().as_secs_f64().max(1e-9);
    let ops_sec = (ok_ops as f64) / elapsed;

    logj!(
        test,
        "result",
        format!(
            "seconds={} ok_ops={} rejected={} ops_per_sec={:.0}",
            seconds, ok_ops, rejected, ops_sec
        )
    );
}

#[test]
fn prod_document_workflow_with_transport_encoding() {
    let test = "prod_document_workflow_with_transport_encoding";

    let key = generate_key();
    let aad = b"tenant=prod|route=document|v=1";

    // Realistic doc sizes: 4KB, 16KB, 64KB, 256KB
    let sizes = [4 * 1024, 16 * 1024, 64 * 1024, 256 * 1024];
    let algos = [Algorithm::Aes256Gcm, Algorithm::XChaCha20Poly1305];

    // Each doc: encrypt with AAD, serialize fields like an API payload, rebuild, decrypt.
    for &algo in &algos {
        for &sz in &sizes {
            let pt = random_bytes(sz);

            let enc = encrypt(
                &pt,
                &key,
                Some(EncryptOptions {
                    algorithm: Some(algo),
                    aad: Some(aad.to_vec()),
                }),
            )
            .expect("encrypt");

            let ct_b64 = base64_encode(&enc.ciphertext);
            let nonce_hex = hex_encode(&enc.nonce);
            let tag_b64 = base64_encode(&enc.tag);

            let rebuilt = EncryptionResult {
                ciphertext: base64_decode(&ct_b64).expect("ct b64"),
                algorithm: enc.algorithm,
                nonce: hex_decode(&nonce_hex).expect("nonce hex"),
                tag: base64_decode(&tag_b64).expect("tag b64"),
            };

            let out = decrypt_with_aad(&rebuilt, &key, aad).expect("decrypt");
            assert_eq!(out, pt);

            // Wrong AAD must fail
            assert!(decrypt_with_aad(&rebuilt, &key, b"tenant=prod|route=document|v=2").is_err());

            // Algorithm confusion must fail
            let mut confused = rebuilt.clone();
            confused.algorithm = match confused.algorithm {
                Algorithm::Aes256Gcm => Algorithm::XChaCha20Poly1305,
                Algorithm::XChaCha20Poly1305 => Algorithm::Aes256Gcm,
            };
            assert!(decrypt_with_aad(&confused, &key, aad).is_err());

            logj!(
                test,
                "case_ok",
                format!("algo={:?} size_kb={}", algo, sz / 1024)
            );
        }
    }

    logj!(test, "done");
}

#[test]
fn prod_file_sync_chunking_parallel_sessions() {
    let test = "prod_file_sync_chunking_parallel_sessions";

    let seed = env_u64("PROD_SEED", 1);
    let default_sessions = if cfg!(debug_assertions) { 1 } else { 16 };
    let default_file_mb = if cfg!(debug_assertions) { 8 } else { 256 };
    let default_max_seconds = if cfg!(debug_assertions) { 120 } else { 0 };

    let sessions = env_usize("PROD_SESSIONS", default_sessions).max(1);
    let file_mb = env_usize("PROD_FILE_MB", default_file_mb).max(8);
    let max_seconds = env_usize("PROD_MAX_SECONDS", default_max_seconds);

    logj!(
        test,
        "start",
        format!(
            "profile={} sessions={} file_mb_per_session={} max_seconds={}",
            if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            },
            sessions,
            file_mb,
            max_seconds
        )
    );

    let mut keys = Vec::with_capacity(sessions);
    for _ in 0..sessions {
        keys.push(generate_key());
    }
    let keys = Arc::new(keys);

    let total_bytes = file_mb * 1024 * 1024;
    let chunk_sizes = [1 * 1024 * 1024, 8 * 1024 * 1024];
    let max_chunk = *chunk_sizes.iter().max().unwrap();

    let barrier = Arc::new(Barrier::new(sessions));
    let start = Instant::now();

    use std::sync::atomic::{AtomicU64, Ordering};
    let total_done = Arc::new(AtomicU64::new(0));

    let mut handles = Vec::with_capacity(sessions);

    for sid in 0..sessions {
        let keys = Arc::clone(&keys);
        let barrier = Arc::clone(&barrier);
        let total_done = Arc::clone(&total_done);
        let start = start;

        handles.push(thread::spawn(move || {
            barrier.wait();

            let key = keys[sid].clone();
            let aad = format!("tenant=prod|route=filesync|sid={}|v=1", sid).into_bytes();

            let mut rng =
                XorShift64::new(seed ^ ((sid as u64 + 1).wrapping_mul(0x9E3779B97F4A7C15)));

            let algo = Algorithm::Aes256Gcm;

            let mut pt = vec![0u8; max_chunk];
            rng.fill_bytes(&mut pt);

            let mut processed = 0usize;
            let mut chunk_index = 0usize;
            let progress_step = (total_bytes / 4).max(1 * 1024 * 1024);
            let mut next_progress = progress_step;

            while processed < total_bytes {
                if max_seconds > 0 && start.elapsed() > Duration::from_secs(max_seconds as u64) {
                    panic!(
                        "filesync scenario exceeded max seconds (sid={} elapsed={:.2}s limit={}s)",
                        sid,
                        start.elapsed().as_secs_f64(),
                        max_seconds
                    );
                }

                let sz = chunk_sizes[chunk_index % chunk_sizes.len()].min(total_bytes - processed);
                chunk_index += 1;

                // mutate small portion to avoid identical blocks
                for i in 0..32.min(sz) {
                    pt[i] ^= (rng.next_u64() & 0xFF) as u8;
                }

                let slice = &pt[..sz];

                let enc = encrypt(
                    slice,
                    &key,
                    Some(EncryptOptions {
                        algorithm: Some(algo),
                        aad: Some(aad.clone()),
                    }),
                )
                .expect("encrypt");

                let dec = decrypt_with_aad(&enc, &key, &aad).expect("decrypt");
                assert_eq!(dec, slice);

                processed += sz;
                total_done.fetch_add(sz as u64, Ordering::Relaxed);

                if processed >= next_progress {
                    logj!(
                        test,
                        "progress",
                        format!(
                            "sid={} processed_mb={:.1}/{:.1}",
                            sid,
                            processed as f64 / (1024.0 * 1024.0),
                            total_bytes as f64 / (1024.0 * 1024.0)
                        )
                    );
                    next_progress = next_progress.saturating_add(progress_step);
                }
            }

            processed
        }));
    }

    let mut total_processed = 0usize;
    for h in handles {
        total_processed += h.join().expect("thread");
    }

    let elapsed = start.elapsed().as_secs_f64().max(1e-9);
    let mb = (total_processed as f64) / (1024.0 * 1024.0);
    let throughput = mb / elapsed;

    logj!(
        test,
        "result",
        format!(
            "sessions={} file_mb_per_session={} total_mb={:.1} time={:.2}s throughput={:.1}MB/s",
            sessions, file_mb, mb, elapsed, throughput
        )
    );
}

#[test]
fn prod_multi_tenant_isolation_and_failure_modes() {
    let test = "prod_multi_tenant_isolation_and_failure_modes";

    let tenants = 32usize;
    let mut tenant_keys = Vec::with_capacity(tenants);
    for _ in 0..tenants {
        tenant_keys.push(generate_key());
    }

    // Each tenant encrypts a message, then we ensure:
    // - only that tenant key decrypts
    // - swapped nonce/tag/ciphertext fails
    // - wrong aad fails
    // - corrupted packet fails
    let mut encrypted = Vec::with_capacity(tenants);

    for tid in 0..tenants {
        let aad = format!("tenant={}|route=api|v=1", tid).into_bytes();
        let pt = random_bytes(32 * 1024);

        let enc = encrypt(
            &pt,
            &tenant_keys[tid],
            Some(EncryptOptions {
                algorithm: Some(Algorithm::XChaCha20Poly1305),
                aad: Some(aad.clone()),
            }),
        )
        .expect("encrypt");

        let out = decrypt_with_aad(&enc, &tenant_keys[tid], &aad).expect("decrypt");
        assert_eq!(out, pt);

        encrypted.push((aad, pt, enc));
    }

    // Cross-tenant decrypt must fail
    for tid in 0..tenants {
        let (aad, _pt, enc) = &encrypted[tid];
        let wrong = (tid + 1) % tenants;
        assert!(decrypt_with_aad(enc, &tenant_keys[wrong], aad).is_err());
    }

    // Field swap failures
    {
        let (aad0, _pt0, e0) = &encrypted[0];
        let (aad1, _pt1, e1) = &encrypted[1];

        let mut swapped = e0.clone();
        swapped.nonce = e1.nonce.clone();
        assert!(decrypt_with_aad(&swapped, &tenant_keys[0], aad0).is_err());

        let mut swapped = e0.clone();
        swapped.tag = e1.tag.clone();
        assert!(decrypt_with_aad(&swapped, &tenant_keys[0], aad0).is_err());

        let mut swapped = e0.clone();
        swapped.ciphertext = e1.ciphertext.clone();
        assert!(decrypt_with_aad(&swapped, &tenant_keys[0], aad0).is_err());

        // Wrong AAD
        assert!(decrypt_with_aad(e0, &tenant_keys[0], aad1).is_err());

        // Corrupt bit
        let bad = corrupt_one_bit(e0.clone());
        assert!(decrypt_with_aad(&bad, &tenant_keys[0], aad0).is_err());
    }

    // Must not panic on garbage EncryptionResult
    let garbage = EncryptionResult {
        ciphertext: vec![],
        algorithm: Algorithm::Aes256Gcm,
        nonce: vec![],
        tag: vec![],
    };
    let r = no_panic(|| decrypt(&garbage, &tenant_keys[0]));
    assert!(r.is_ok(), "no panics on garbage");

    logj!(test, "done", format!("tenants={}", tenants));
}
