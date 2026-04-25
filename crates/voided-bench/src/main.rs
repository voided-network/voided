use std::{
    env, fs,
    hint::black_box,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process,
    time::{Duration, Instant},
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce as AesNonce,
};
use brotli::{CompressorWriter, Decompressor};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::Serialize;
use voided_core::{
    compression::{self, CompressionAlgorithm, CompressionOptions},
    encryption::{self, Algorithm as EncryptionAlgorithm, EncryptOptions, EncryptionResult, Key},
    shell::{self, FusedPreset, FusedShellOptions, ProtectOptions},
    MAGIC_ENCRYPTED,
};

const KEY: [u8; 32] = [0x42; 32];
const WRONG_KEY: [u8; 32] = [0x24; 32];
const MIB: f64 = 1024.0 * 1024.0;

fn main() {
    if let Err(err) = run() {
        eprintln!("error: {err}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let config = Config::parse(env::args().skip(1))?;
    let fixtures = load_fixtures(&config)?;
    let fixture_summary = FixtureSummary::from_fixtures(&fixtures);
    let candidates = Candidate::all()
        .iter()
        .map(|candidate| run_candidate(*candidate, &fixtures, config.samples, config.details))
        .collect::<Result<Vec<_>, String>>()?;
    let report = Report {
        benchmark: "voided raw artifact benchmark".to_string(),
        notes: vec![
            "No capped security score is emitted.".to_string(),
            "Security gates are counts: failures and accepts are bugs, not points.".to_string(),
            "Artifact statistics are raw measured values and are not cryptographic proofs."
                .to_string(),
        ],
        config: ConfigReport {
            corpus: config
                .corpus_dir
                .as_ref()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "synthetic".to_string()),
            samples: config.samples,
            include_details: config.details,
        },
        fixtures: fixture_summary,
        candidates,
    };

    match config.format {
        OutputFormat::Markdown => print_markdown(&report),
        OutputFormat::Json => print_json(&report)?,
        OutputFormat::Csv => print_csv(&report),
    }

    Ok(())
}

#[derive(Debug, Clone)]
struct Config {
    corpus_dir: Option<PathBuf>,
    format: OutputFormat,
    samples: usize,
    details: bool,
}

impl Config {
    fn parse(args: impl Iterator<Item = String>) -> Result<Self, String> {
        let mut corpus_dir = None;
        let mut format = OutputFormat::Markdown;
        let mut samples = 5usize;
        let mut details = false;
        let mut args = args.peekable();

        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--corpus" => {
                    let path = args
                        .next()
                        .ok_or_else(|| "--corpus requires a directory".to_string())?;
                    corpus_dir = Some(PathBuf::from(path));
                }
                "--format" => {
                    let value = args
                        .next()
                        .ok_or_else(|| "--format requires markdown, json, or csv".to_string())?;
                    format = OutputFormat::parse(&value)?;
                }
                "--samples" => {
                    let value = args
                        .next()
                        .ok_or_else(|| "--samples requires a positive integer".to_string())?;
                    samples = value
                        .parse::<usize>()
                        .map_err(|_| "--samples must be a positive integer".to_string())?
                        .clamp(1, 25);
                }
                "--details" => details = true,
                "--help" | "-h" => {
                    print_help();
                    process::exit(0);
                }
                other => return Err(format!("unknown argument `{other}`")),
            }
        }

        Ok(Self {
            corpus_dir,
            format,
            samples,
            details,
        })
    }
}

#[derive(Debug, Clone, Copy)]
enum OutputFormat {
    Markdown,
    Json,
    Csv,
}

impl OutputFormat {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "markdown" | "md" => Ok(Self::Markdown),
            "json" => Ok(Self::Json),
            "csv" => Ok(Self::Csv),
            other => Err(format!("unsupported format `{other}`")),
        }
    }
}

fn print_help() {
    println!("Usage: cargo run -p voided-bench --release -- [options]");
    println!();
    println!("Options:");
    println!("  --corpus <dir>       Recursively benchmark files from a corpus directory");
    println!("  --format <format>    markdown, json, or csv (default: markdown)");
    println!("  --samples <n>        Median timing samples per fixture (default: 5)");
    println!("  --details            Include per-fixture rows in markdown/json output");
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Candidate {
    VoidedProtectCurrent,
    VoidedC1eCurrent,
    VoidedFuseShellCurrent,
    XChaCha20Poly1305Raw,
    Aes256GcmRaw,
    GzipXChaCha20Poly1305,
    BrotliXChaCha20Poly1305,
}

impl Candidate {
    fn all() -> &'static [Candidate] {
        &[
            Candidate::VoidedProtectCurrent,
            Candidate::VoidedC1eCurrent,
            Candidate::VoidedFuseShellCurrent,
            Candidate::XChaCha20Poly1305Raw,
            Candidate::Aes256GcmRaw,
            Candidate::GzipXChaCha20Poly1305,
            Candidate::BrotliXChaCha20Poly1305,
        ]
    }

    fn name(self) -> &'static str {
        match self {
            Candidate::VoidedProtectCurrent => "voided-protect-current",
            Candidate::VoidedC1eCurrent => "voided-c1e-current",
            Candidate::VoidedFuseShellCurrent => "voided-fuse-shell-current",
            Candidate::XChaCha20Poly1305Raw => "xchacha20-poly1305-raw",
            Candidate::Aes256GcmRaw => "aes-256-gcm-raw",
            Candidate::GzipXChaCha20Poly1305 => "gzip+xchacha20-poly1305",
            Candidate::BrotliXChaCha20Poly1305 => "brotli+xchacha20-poly1305",
        }
    }

    fn encode(self, input: &[u8], key: &[u8; 32], nonce_seed: u8) -> Result<Vec<u8>, String> {
        match self {
            Candidate::VoidedProtectCurrent => {
                let key = Key::from_bytes(key).map_err(to_string)?;
                shell::protect(
                    input,
                    &key,
                    Some(ProtectOptions {
                        preset: FusedPreset::Balanced,
                        compression_algorithm: CompressionAlgorithm::Brotli,
                        compression_level: 6,
                        compression_min_size_threshold: 100,
                        encryption_algorithm: Some(EncryptionAlgorithm::XChaCha20Poly1305),
                        shell_chunk_size: None,
                        shell_nonce: Some(nonce12(nonce_seed)),
                    }),
                )
                .map(|result| result.artifact)
                .map_err(to_string)
            }
            Candidate::VoidedC1eCurrent => {
                let key = Key::from_bytes(key).map_err(to_string)?;
                let compressed = compression::compress(
                    input,
                    Some(CompressionOptions {
                        algorithm: CompressionAlgorithm::Brotli,
                        min_size_threshold: 100,
                        level: 6,
                    }),
                )
                .map_err(to_string)?;
                let serialized = compression::serialize_with_header(&compressed);
                encryption::encrypt(
                    &serialized,
                    &key,
                    Some(EncryptOptions {
                        algorithm: Some(EncryptionAlgorithm::XChaCha20Poly1305),
                        aad: None,
                    }),
                )
                .map(|result| result.to_bytes())
                .map_err(to_string)
            }
            Candidate::VoidedFuseShellCurrent => {
                let key = Key::from_bytes(key).map_err(to_string)?;
                shell::fuse_bytes(
                    input,
                    &key,
                    Some(FusedShellOptions {
                        preset: FusedPreset::Balanced,
                        chunk_size: None,
                        shell_nonce: Some(nonce12(nonce_seed)),
                    }),
                )
                .map_err(to_string)
            }
            Candidate::XChaCha20Poly1305Raw => xchacha_encrypt(input, key, nonce_seed),
            Candidate::Aes256GcmRaw => aes_encrypt(input, key, nonce_seed),
            Candidate::GzipXChaCha20Poly1305 => {
                let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
                encoder.write_all(input).map_err(to_string)?;
                let compressed = encoder.finish().map_err(to_string)?;
                xchacha_encrypt(&compressed, key, nonce_seed)
            }
            Candidate::BrotliXChaCha20Poly1305 => {
                let mut compressed = Vec::new();
                {
                    let mut writer = CompressorWriter::new(&mut compressed, 4096, 6, 22);
                    writer.write_all(input).map_err(to_string)?;
                }
                xchacha_encrypt(&compressed, key, nonce_seed)
            }
        }
    }

    fn decode(self, artifact: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
        match self {
            Candidate::VoidedProtectCurrent => {
                let key = Key::from_bytes(key).map_err(to_string)?;
                shell::open(artifact, &key).map_err(to_string)
            }
            Candidate::VoidedC1eCurrent => {
                let key = Key::from_bytes(key).map_err(to_string)?;
                let encrypted = EncryptionResult::from_bytes(artifact).map_err(to_string)?;
                let serialized = encryption::decrypt(&encrypted, &key).map_err(to_string)?;
                let (compressed, algorithm, _) =
                    compression::deserialize_with_header(&serialized).map_err(to_string)?;
                compression::decompress(&compressed, algorithm).map_err(to_string)
            }
            Candidate::VoidedFuseShellCurrent => {
                let key = Key::from_bytes(key).map_err(to_string)?;
                shell::unfuse_bytes(artifact, &key).map_err(to_string)
            }
            Candidate::XChaCha20Poly1305Raw => xchacha_decrypt(artifact, key),
            Candidate::Aes256GcmRaw => aes_decrypt(artifact, key),
            Candidate::GzipXChaCha20Poly1305 => {
                let compressed = xchacha_decrypt(artifact, key)?;
                let mut decoder = GzDecoder::new(&compressed[..]);
                let mut output = Vec::new();
                decoder.read_to_end(&mut output).map_err(to_string)?;
                Ok(output)
            }
            Candidate::BrotliXChaCha20Poly1305 => {
                let compressed = xchacha_decrypt(artifact, key)?;
                let mut decoder = Decompressor::new(Cursor::new(compressed), 4096);
                let mut output = Vec::new();
                decoder.read_to_end(&mut output).map_err(to_string)?;
                Ok(output)
            }
        }
    }
}

fn xchacha_encrypt(input: &[u8], key: &[u8; 32], nonce_seed: u8) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(to_string)?;
    let nonce = nonce24(nonce_seed);
    let mut output = nonce.to_vec();
    output.extend(
        cipher
            .encrypt(XNonce::from_slice(&nonce), input)
            .map_err(to_string)?,
    );
    Ok(output)
}

fn xchacha_decrypt(artifact: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if artifact.len() < 24 {
        return Err("truncated xchacha artifact".to_string());
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(to_string)?;
    cipher
        .decrypt(XNonce::from_slice(&artifact[..24]), &artifact[24..])
        .map_err(to_string)
}

fn aes_encrypt(input: &[u8], key: &[u8; 32], nonce_seed: u8) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(to_string)?;
    let nonce = nonce12(nonce_seed);
    let mut output = nonce.to_vec();
    output.extend(
        cipher
            .encrypt(AesNonce::from_slice(&nonce), input)
            .map_err(to_string)?,
    );
    Ok(output)
}

fn aes_decrypt(artifact: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if artifact.len() < 12 {
        return Err("truncated aes artifact".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(to_string)?;
    cipher
        .decrypt(AesNonce::from_slice(&artifact[..12]), &artifact[12..])
        .map_err(to_string)
}

#[derive(Debug, Clone, Serialize)]
struct InputFixture {
    name: String,
    bytes: Vec<u8>,
}

fn load_fixtures(config: &Config) -> Result<Vec<InputFixture>, String> {
    if let Some(dir) = &config.corpus_dir {
        if !dir.is_dir() {
            return Err(format!("corpus path is not a directory: {}", dir.display()));
        }
        let mut files = Vec::new();
        collect_files(dir, &mut files)?;
        files.sort();
        let fixtures = files
            .into_iter()
            .map(|path| {
                let bytes = fs::read(&path).map_err(to_string)?;
                let name = path
                    .strip_prefix(dir)
                    .unwrap_or(&path)
                    .display()
                    .to_string();
                Ok(InputFixture { name, bytes })
            })
            .collect::<Result<Vec<_>, String>>()?;
        if fixtures.is_empty() {
            return Err(format!("corpus directory is empty: {}", dir.display()));
        }
        Ok(fixtures)
    } else {
        Ok(synthetic_fixtures())
    }
}

fn collect_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(to_string)? {
        let entry = entry.map_err(to_string)?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

fn synthetic_fixtures() -> Vec<InputFixture> {
    vec![
        fixture("empty", Vec::new()),
        fixture(
            "tiny-text-43b",
            b"The quick brown fox jumps over the lazy dog".to_vec(),
        ),
        fixture("small-json-1k", repeated_json(1024)),
        fixture("english-prose-16k", english_like(16 * 1024)),
        fixture("source-like-32k", source_like(32 * 1024)),
        fixture("csv-64k", csv_like(64 * 1024)),
        fixture("repeating-64k", repeating_pattern(64 * 1024)),
        fixture("gradient-binary-128k", gradient_binary(128 * 1024)),
        fixture("mixed-structured-256k", mixed_structured(256 * 1024)),
        fixture("random-256k", deterministic_noise(256 * 1024, 0xC0DE)),
        fixture("random-1m", deterministic_noise(1024 * 1024, 0xFEED)),
    ]
}

fn fixture(name: &str, bytes: Vec<u8>) -> InputFixture {
    InputFixture {
        name: name.to_string(),
        bytes,
    }
}

fn repeated_json(target: usize) -> Vec<u8> {
    let line = br#"{"id":42,"kind":"fixture","ok":true,"tags":["voided","bench","raw"]}"#;
    repeat_to_len(line, target)
}

fn english_like(target: usize) -> Vec<u8> {
    let words = [
        "voided",
        "protects",
        "the",
        "artifact",
        "without",
        "pretending",
        "a",
        "score",
        "is",
        "proof",
        "compression",
        "changes",
        "shape",
        "encryption",
        "changes",
        "meaning",
        "shell",
        "changes",
        "surface",
    ];
    let mut out = Vec::with_capacity(target);
    let mut index = 0usize;
    while out.len() < target {
        let sentence_len = 8 + (index % 9);
        for offset in 0..sentence_len {
            if offset > 0 {
                out.push(b' ');
            }
            out.extend_from_slice(words[(index + offset) % words.len()].as_bytes());
        }
        out.extend_from_slice(b". ");
        index += 3;
    }
    out.truncate(target);
    out
}

fn source_like(target: usize) -> Vec<u8> {
    let block = br#"
pub fn protect(input: &[u8], key: &Key) -> Result<Vec<u8>> {
    let compressed = compress(input)?;
    let encrypted = encrypt(&compressed, key)?;
    shell(encrypted)
}
"#;
    repeat_to_len(block, target)
}

fn csv_like(target: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(target);
    out.extend_from_slice(b"id,group,value,label\n");
    let mut row = 0usize;
    while out.len() < target {
        out.extend_from_slice(
            format!(
                "{row},{},{:.4},fixture-{row}\n",
                row % 17,
                (row * 37) as f64 / 19.0
            )
            .as_bytes(),
        );
        row += 1;
    }
    out.truncate(target);
    out
}

fn repeating_pattern(target: usize) -> Vec<u8> {
    repeat_to_len(b"ABCD-0000-voided-", target)
}

fn gradient_binary(target: usize) -> Vec<u8> {
    (0..target).map(|index| (index & 0xFF) as u8).collect()
}

fn mixed_structured(target: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(target);
    let mut noise = Prng::new(0xBAD5EED);
    while out.len() < target {
        out.extend_from_slice(b"<record>");
        out.extend_from_slice(&noise.next_u64().to_le_bytes());
        out.extend_from_slice(b":voided:");
        out.extend_from_slice(&[0u8; 12]);
        out.extend_from_slice(b"</record>\n");
    }
    out.truncate(target);
    out
}

fn deterministic_noise(target: usize, seed: u64) -> Vec<u8> {
    let mut out = vec![0u8; target];
    let mut rng = Prng::new(seed);
    rng.fill_bytes(&mut out);
    out
}

fn repeat_to_len(pattern: &[u8], target: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(target);
    while out.len() < target {
        out.extend_from_slice(pattern);
    }
    out.truncate(target);
    out
}

#[derive(Debug, Serialize)]
struct Report {
    benchmark: String,
    notes: Vec<String>,
    config: ConfigReport,
    fixtures: FixtureSummary,
    candidates: Vec<CandidateReport>,
}

#[derive(Debug, Serialize)]
struct ConfigReport {
    corpus: String,
    samples: usize,
    include_details: bool,
}

#[derive(Debug, Serialize)]
struct FixtureSummary {
    count: usize,
    total_input_bytes: usize,
    min_input_bytes: usize,
    max_input_bytes: usize,
    names: Vec<String>,
}

impl FixtureSummary {
    fn from_fixtures(fixtures: &[InputFixture]) -> Self {
        Self {
            count: fixtures.len(),
            total_input_bytes: fixtures.iter().map(|fixture| fixture.bytes.len()).sum(),
            min_input_bytes: fixtures
                .iter()
                .map(|fixture| fixture.bytes.len())
                .min()
                .unwrap_or(0),
            max_input_bytes: fixtures
                .iter()
                .map(|fixture| fixture.bytes.len())
                .max()
                .unwrap_or(0),
            names: fixtures
                .iter()
                .map(|fixture| fixture.name.clone())
                .collect(),
        }
    }
}

#[derive(Debug, Serialize)]
struct CandidateReport {
    candidate: String,
    aggregate: AggregateReport,
    details: Vec<FixtureReport>,
}

#[derive(Debug, Default, Serialize)]
struct AggregateReport {
    fixture_count: usize,
    input_bytes: usize,
    output_bytes: usize,
    byte_delta: i128,
    output_to_input_ratio: f64,
    overhead_pct: f64,
    median_encode_mib_s: f64,
    median_decode_mib_s: f64,
    weighted_encode_mib_s: f64,
    weighted_decode_mib_s: f64,
    roundtrip_failures: usize,
    tamper_accepts: usize,
    tamper_trials: usize,
    wrong_key_accepts: usize,
    wrong_key_trials: usize,
    known_magic_prefix_hits: usize,
    known_magic_prefix_trials: usize,
    entropy_bits_per_byte: f64,
    entropy_gap_bits_per_byte: f64,
    chi_square_per_df: f64,
    serial_correlation: f64,
    mean_abs_bit_bias_pct: f64,
    max_byte_frequency_pct: f64,
    same_input_drift_pct: f64,
    input_bit_flip_delta_pct: f64,
    input_delta_minus_drift_pct: f64,
    input_delta_len_delta_mean_bytes: f64,
}

#[derive(Debug, Serialize)]
struct FixtureReport {
    fixture: String,
    input_bytes: usize,
    output_bytes: usize,
    byte_delta: i128,
    output_to_input_ratio: f64,
    overhead_pct: f64,
    encode_mib_s: f64,
    decode_mib_s: f64,
    roundtrip_ok: bool,
    tamper_accepts: usize,
    tamper_trials: usize,
    wrong_key_accepts: usize,
    known_magic_prefix: bool,
    entropy_bits_per_byte: f64,
    chi_square_per_df: f64,
    serial_correlation: f64,
    mean_abs_bit_bias_pct: f64,
    max_byte_frequency_pct: f64,
    same_input_drift_pct: f64,
    input_bit_flip_delta_pct: f64,
    input_delta_minus_drift_pct: f64,
    input_delta_len_delta_bytes: isize,
}

fn run_candidate(
    candidate: Candidate,
    fixtures: &[InputFixture],
    samples: usize,
    include_details: bool,
) -> Result<CandidateReport, String> {
    let mut details = Vec::with_capacity(fixtures.len());
    let mut all_outputs = Vec::new();
    let mut encode_rates = Vec::with_capacity(fixtures.len());
    let mut decode_rates = Vec::with_capacity(fixtures.len());
    let mut weighted_encode_time = Duration::ZERO;
    let mut weighted_decode_time = Duration::ZERO;
    let mut input_bytes = 0usize;
    let mut output_bytes = 0usize;
    let mut roundtrip_failures = 0usize;
    let mut tamper_accepts = 0usize;
    let mut tamper_trials = 0usize;
    let mut wrong_key_accepts = 0usize;
    let mut wrong_key_trials = 0usize;
    let mut known_magic_prefix_hits = 0usize;
    let mut known_magic_prefix_trials = 0usize;
    let mut same_input_drift_sum = 0.0;
    let mut input_bit_flip_delta_sum = 0.0;
    let mut input_delta_len_delta_sum = 0isize;

    for fixture in fixtures {
        let report = run_fixture(candidate, fixture, samples)?;
        all_outputs.extend_from_slice(&candidate.encode(&fixture.bytes, &KEY, 0)?);
        encode_rates.push(report.encode_mib_s);
        decode_rates.push(report.decode_mib_s);
        weighted_encode_time += duration_for_rate(fixture.bytes.len(), report.encode_mib_s);
        weighted_decode_time += duration_for_rate(report.output_bytes, report.decode_mib_s);
        input_bytes += report.input_bytes;
        output_bytes += report.output_bytes;
        if !report.roundtrip_ok {
            roundtrip_failures += 1;
        }
        tamper_accepts += report.tamper_accepts;
        tamper_trials += report.tamper_trials;
        wrong_key_accepts += report.wrong_key_accepts;
        wrong_key_trials += 1;
        known_magic_prefix_hits += usize::from(report.known_magic_prefix);
        known_magic_prefix_trials += 1;
        same_input_drift_sum += report.same_input_drift_pct;
        input_bit_flip_delta_sum += report.input_bit_flip_delta_pct;
        input_delta_len_delta_sum += report.input_delta_len_delta_bytes;
        if include_details {
            details.push(report);
        }
    }

    let stats = ByteStats::from_bytes(&all_outputs);
    let aggregate = AggregateReport {
        fixture_count: fixtures.len(),
        input_bytes,
        output_bytes,
        byte_delta: output_bytes as i128 - input_bytes as i128,
        output_to_input_ratio: ratio(output_bytes, input_bytes),
        overhead_pct: overhead_pct(output_bytes, input_bytes),
        median_encode_mib_s: median(&mut encode_rates),
        median_decode_mib_s: median(&mut decode_rates),
        weighted_encode_mib_s: throughput(input_bytes, weighted_encode_time),
        weighted_decode_mib_s: throughput(output_bytes, weighted_decode_time),
        roundtrip_failures,
        tamper_accepts,
        tamper_trials,
        wrong_key_accepts,
        wrong_key_trials,
        known_magic_prefix_hits,
        known_magic_prefix_trials,
        entropy_bits_per_byte: stats.entropy_bits_per_byte,
        entropy_gap_bits_per_byte: 8.0 - stats.entropy_bits_per_byte,
        chi_square_per_df: stats.chi_square_per_df,
        serial_correlation: stats.serial_correlation,
        mean_abs_bit_bias_pct: stats.mean_abs_bit_bias * 100.0,
        max_byte_frequency_pct: stats.max_byte_frequency * 100.0,
        same_input_drift_pct: safe_mean(same_input_drift_sum, fixtures.len()),
        input_bit_flip_delta_pct: safe_mean(input_bit_flip_delta_sum, fixtures.len()),
        input_delta_minus_drift_pct: safe_mean(input_bit_flip_delta_sum, fixtures.len())
            - safe_mean(same_input_drift_sum, fixtures.len()),
        input_delta_len_delta_mean_bytes: safe_mean(
            input_delta_len_delta_sum as f64,
            fixtures.len(),
        ),
    };

    Ok(CandidateReport {
        candidate: candidate.name().to_string(),
        aggregate,
        details,
    })
}

fn run_fixture(
    candidate: Candidate,
    fixture: &InputFixture,
    samples: usize,
) -> Result<FixtureReport, String> {
    let input = &fixture.bytes;
    let output = candidate.encode(input, &KEY, 0)?;
    let decoded = candidate.decode(&output, &KEY);
    let roundtrip_ok = decoded.as_deref() == Ok(input.as_slice());
    let (tamper_accepts, tamper_trials) = tamper_result(candidate, input, &output)?;
    let wrong_key_accepts = usize::from(candidate.decode(&output, &WRONG_KEY).is_ok());
    let stats = ByteStats::from_bytes(&output);
    let artifact_delta = artifact_delta_result(candidate, input)?;
    let iterations = iterations_for_len(input.len().max(output.len()));
    let encode_mib_s = median_timing(samples, iterations, input.len(), || {
        candidate.encode(input, &KEY, 3)
    })?;
    let decode_mib_s = median_timing(samples, iterations, output.len(), || {
        candidate.decode(&output, &KEY)
    })?;

    Ok(FixtureReport {
        fixture: fixture.name.clone(),
        input_bytes: input.len(),
        output_bytes: output.len(),
        byte_delta: output.len() as i128 - input.len() as i128,
        output_to_input_ratio: ratio(output.len(), input.len()),
        overhead_pct: overhead_pct(output.len(), input.len()),
        encode_mib_s,
        decode_mib_s,
        roundtrip_ok,
        tamper_accepts,
        tamper_trials,
        wrong_key_accepts,
        known_magic_prefix: has_known_magic_prefix(&output),
        entropy_bits_per_byte: stats.entropy_bits_per_byte,
        chi_square_per_df: stats.chi_square_per_df,
        serial_correlation: stats.serial_correlation,
        mean_abs_bit_bias_pct: stats.mean_abs_bit_bias * 100.0,
        max_byte_frequency_pct: stats.max_byte_frequency * 100.0,
        same_input_drift_pct: artifact_delta.same_input_drift_ratio * 100.0,
        input_bit_flip_delta_pct: artifact_delta.input_bit_flip_ratio * 100.0,
        input_delta_minus_drift_pct: (artifact_delta.input_bit_flip_ratio
            - artifact_delta.same_input_drift_ratio)
            * 100.0,
        input_delta_len_delta_bytes: artifact_delta.input_delta_len_delta,
    })
}

fn tamper_result(
    candidate: Candidate,
    original: &[u8],
    output: &[u8],
) -> Result<(usize, usize), String> {
    if output.is_empty() {
        return Ok((0, 0));
    }
    let mut accepts = 0usize;
    let mut trials = 0usize;
    let positions = [0usize, output.len() / 2, output.len().saturating_sub(1)];
    for position in positions {
        let mut tampered = output.to_vec();
        tampered[position] ^= 0x80;
        trials += 1;
        if let Ok(decoded) = candidate.decode(&tampered, &KEY) {
            if decoded == original {
                accepts += 1;
            } else {
                accepts += 1;
            }
        }
    }
    Ok((accepts, trials))
}

#[derive(Debug)]
struct ArtifactDeltaResult {
    same_input_drift_ratio: f64,
    input_bit_flip_ratio: f64,
    input_delta_len_delta: isize,
}

fn artifact_delta_result(
    candidate: Candidate,
    input: &[u8],
) -> Result<ArtifactDeltaResult, String> {
    let left = candidate.encode(input, &KEY, 9)?;
    let same = candidate.encode(input, &KEY, 9)?;
    let mut mutated = input.to_vec();
    if mutated.is_empty() {
        mutated.push(1);
    } else {
        let index = mutated.len() / 2;
        mutated[index] ^= 0x01;
    }
    let right = candidate.encode(&mutated, &KEY, 9)?;
    Ok(ArtifactDeltaResult {
        same_input_drift_ratio: normalized_hamming(&left, &same),
        input_bit_flip_ratio: normalized_hamming(&left, &right),
        input_delta_len_delta: right.len() as isize - left.len() as isize,
    })
}

fn median_timing<T>(
    samples: usize,
    iterations: usize,
    byte_len: usize,
    mut operation: impl FnMut() -> Result<T, String>,
) -> Result<f64, String> {
    let _ = operation()?;
    let mut rates = Vec::with_capacity(samples);
    for _ in 0..samples {
        let start = Instant::now();
        for _ in 0..iterations {
            black_box(operation()?);
        }
        let elapsed = start.elapsed();
        rates.push(throughput(byte_len.saturating_mul(iterations), elapsed));
    }
    Ok(median(&mut rates))
}

fn iterations_for_len(len: usize) -> usize {
    let target = 2 * 1024 * 1024usize;
    (target / len.max(1)).clamp(1, 128)
}

fn duration_for_rate(bytes: usize, mib_s: f64) -> Duration {
    if mib_s <= 0.0 {
        return Duration::ZERO;
    }
    Duration::from_secs_f64(bytes as f64 / MIB / mib_s)
}

fn throughput(bytes: usize, elapsed: Duration) -> f64 {
    let seconds = elapsed.as_secs_f64();
    if seconds == 0.0 {
        0.0
    } else {
        bytes as f64 / MIB / seconds
    }
}

fn median(values: &mut [f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|left, right| left.total_cmp(right));
    let middle = values.len() / 2;
    if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    }
}

#[derive(Debug)]
struct ByteStats {
    entropy_bits_per_byte: f64,
    chi_square_per_df: f64,
    serial_correlation: f64,
    mean_abs_bit_bias: f64,
    max_byte_frequency: f64,
}

impl ByteStats {
    fn from_bytes(bytes: &[u8]) -> Self {
        if bytes.is_empty() {
            return Self {
                entropy_bits_per_byte: 0.0,
                chi_square_per_df: 0.0,
                serial_correlation: 0.0,
                mean_abs_bit_bias: 0.0,
                max_byte_frequency: 0.0,
            };
        }

        let mut counts = [0usize; 256];
        let mut bit_counts = [0usize; 8];
        for &byte in bytes {
            counts[byte as usize] += 1;
            for bit in 0..8 {
                bit_counts[bit] += ((byte >> bit) & 1) as usize;
            }
        }

        let len = bytes.len() as f64;
        let entropy_bits_per_byte = counts
            .iter()
            .filter(|&&count| count > 0)
            .map(|&count| {
                let probability = count as f64 / len;
                -probability * probability.log2()
            })
            .sum::<f64>();
        let expected = len / 256.0;
        let chi_square = if expected == 0.0 {
            0.0
        } else {
            counts
                .iter()
                .map(|&count| {
                    let delta = count as f64 - expected;
                    delta * delta / expected
                })
                .sum::<f64>()
        };
        let mean_abs_bit_bias = bit_counts
            .iter()
            .map(|&count| (count as f64 / len - 0.5).abs())
            .sum::<f64>()
            / 8.0;
        let max_byte_frequency = counts.iter().copied().max().unwrap_or(0) as f64 / len;

        Self {
            entropy_bits_per_byte,
            chi_square_per_df: chi_square / 255.0,
            serial_correlation: serial_correlation(bytes),
            mean_abs_bit_bias,
            max_byte_frequency,
        }
    }
}

fn serial_correlation(bytes: &[u8]) -> f64 {
    if bytes.len() < 2 {
        return 0.0;
    }
    let n = (bytes.len() - 1) as f64;
    let mean_x = bytes[..bytes.len() - 1]
        .iter()
        .map(|&byte| byte as f64)
        .sum::<f64>()
        / n;
    let mean_y = bytes[1..].iter().map(|&byte| byte as f64).sum::<f64>() / n;
    let mut covariance = 0.0;
    let mut variance_x = 0.0;
    let mut variance_y = 0.0;
    for pair in bytes.windows(2) {
        let x = pair[0] as f64 - mean_x;
        let y = pair[1] as f64 - mean_y;
        covariance += x * y;
        variance_x += x * x;
        variance_y += y * y;
    }
    let denominator = variance_x.sqrt() * variance_y.sqrt();
    if denominator == 0.0 {
        0.0
    } else {
        covariance / denominator
    }
}

fn normalized_hamming(left: &[u8], right: &[u8]) -> f64 {
    let max_len = left.len().max(right.len());
    if max_len == 0 {
        return 0.0;
    }
    let common = left.len().min(right.len());
    let common_bits = left[..common]
        .iter()
        .zip(&right[..common])
        .map(|(&a, &b)| (a ^ b).count_ones() as usize)
        .sum::<usize>();
    let extra_bits = max_len.saturating_sub(common) * 8;
    (common_bits + extra_bits) as f64 / (max_len * 8) as f64
}

fn has_known_magic_prefix(bytes: &[u8]) -> bool {
    bytes.starts_with(&shell::PROTECTED_ARTIFACT_MAGIC)
        || bytes.starts_with(&shell::FUSED_SHELL_MAGIC)
        || bytes.starts_with(MAGIC_ENCRYPTED)
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        if numerator == 0 {
            1.0
        } else {
            f64::INFINITY
        }
    } else {
        numerator as f64 / denominator as f64
    }
}

fn overhead_pct(output: usize, input: usize) -> f64 {
    if input == 0 {
        if output == 0 {
            0.0
        } else {
            f64::INFINITY
        }
    } else {
        ((output as f64 - input as f64) / input as f64) * 100.0
    }
}

fn safe_mean(sum: f64, count: usize) -> f64 {
    if count == 0 {
        0.0
    } else {
        sum / count as f64
    }
}

fn nonce12(seed: u8) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    for (index, byte) in nonce.iter_mut().enumerate() {
        *byte = seed.wrapping_add((index as u8).wrapping_mul(17));
    }
    nonce
}

fn nonce24(seed: u8) -> [u8; 24] {
    let mut nonce = [0u8; 24];
    for (index, byte) in nonce.iter_mut().enumerate() {
        *byte = seed.wrapping_add((index as u8).wrapping_mul(11));
    }
    nonce
}

fn print_markdown(report: &Report) {
    println!("# Voided Raw Artifact Benchmark");
    println!();
    for note in &report.notes {
        println!("- {note}");
    }
    println!();
    println!(
        "Corpus: `{}` | fixtures: {} | input bytes: {} | samples: {}",
        report.config.corpus,
        report.fixtures.count,
        report.fixtures.total_input_bytes,
        report.config.samples
    );
    println!();

    println!("## Security Gates");
    println!();
    println!(
        "| candidate | roundtrip failures | tamper accepts / trials | wrong-key accepts / trials |"
    );
    println!("|---|---:|---:|---:|");
    for candidate in &report.candidates {
        let a = &candidate.aggregate;
        println!(
            "| `{}` | {} | {} / {} | {} / {} |",
            candidate.candidate,
            a.roundtrip_failures,
            a.tamper_accepts,
            a.tamper_trials,
            a.wrong_key_accepts,
            a.wrong_key_trials
        );
    }
    println!();

    println!("## Misdirection Surface");
    println!();
    println!("| candidate | known Voided magic prefix hits / trials |");
    println!("|---|---:|");
    for candidate in &report.candidates {
        let a = &candidate.aggregate;
        println!(
            "| `{}` | {} / {} |",
            candidate.candidate, a.known_magic_prefix_hits, a.known_magic_prefix_trials
        );
    }
    println!();

    println!("## Size And Speed");
    println!();
    println!("| candidate | output bytes | byte delta | output/input | overhead % | median enc MiB/s | median dec MiB/s | weighted enc MiB/s | weighted dec MiB/s |");
    println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for candidate in &report.candidates {
        let a = &candidate.aggregate;
        println!(
            "| `{}` | {} | {} | {:.6} | {} | {:.3} | {:.3} | {:.3} | {:.3} |",
            candidate.candidate,
            a.output_bytes,
            a.byte_delta,
            a.output_to_input_ratio,
            fmt_float(a.overhead_pct),
            a.median_encode_mib_s,
            a.median_decode_mib_s,
            a.weighted_encode_mib_s,
            a.weighted_decode_mib_s
        );
    }
    println!();

    println!("## Artifact Statistics");
    println!();
    println!("| candidate | entropy bits/byte | entropy gap | chi-square/df | serial corr | mean bit bias % | max byte freq % | same-input drift % | input-bit delta % | delta minus drift % | input delta len mean |");
    println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for candidate in &report.candidates {
        let a = &candidate.aggregate;
        println!(
            "| `{}` | {:.6} | {:.6} | {:.6} | {:.6} | {:.6} | {:.6} | {:.6} | {:.6} | {:.6} | {:.3} |",
            candidate.candidate,
            a.entropy_bits_per_byte,
            a.entropy_gap_bits_per_byte,
            a.chi_square_per_df,
            a.serial_correlation,
            a.mean_abs_bit_bias_pct,
            a.max_byte_frequency_pct,
            a.same_input_drift_pct,
            a.input_bit_flip_delta_pct,
            a.input_delta_minus_drift_pct,
            a.input_delta_len_delta_mean_bytes
        );
    }

    if report.config.include_details {
        println!();
        println!("## Fixture Details");
        for candidate in &report.candidates {
            println!();
            println!("### {}", candidate.candidate);
            println!("| fixture | input bytes | output bytes | overhead % | magic prefix | enc MiB/s | dec MiB/s | entropy | chi-square/df | same-input drift % | input-bit delta % |");
            println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
            for detail in &candidate.details {
                println!(
                    "| `{}` | {} | {} | {} | {} | {:.3} | {:.3} | {:.6} | {:.6} | {:.6} | {:.6} |",
                    detail.fixture,
                    detail.input_bytes,
                    detail.output_bytes,
                    fmt_float(detail.overhead_pct),
                    detail.known_magic_prefix,
                    detail.encode_mib_s,
                    detail.decode_mib_s,
                    detail.entropy_bits_per_byte,
                    detail.chi_square_per_df,
                    detail.same_input_drift_pct,
                    detail.input_bit_flip_delta_pct
                );
            }
        }
    }
}

fn print_json(report: &Report) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(report).map_err(to_string)?
    );
    Ok(())
}

fn print_csv(report: &Report) {
    println!("candidate,fixture_count,input_bytes,output_bytes,byte_delta,output_to_input_ratio,overhead_pct,median_encode_mib_s,median_decode_mib_s,weighted_encode_mib_s,weighted_decode_mib_s,roundtrip_failures,tamper_accepts,tamper_trials,wrong_key_accepts,wrong_key_trials,known_magic_prefix_hits,known_magic_prefix_trials,entropy_bits_per_byte,entropy_gap_bits_per_byte,chi_square_per_df,serial_correlation,mean_abs_bit_bias_pct,max_byte_frequency_pct,same_input_drift_pct,input_bit_flip_delta_pct,input_delta_minus_drift_pct,input_delta_len_delta_mean_bytes");
    for candidate in &report.candidates {
        let a = &candidate.aggregate;
        println!(
            "{},{},{},{},{},{:.9},{},{:.9},{:.9},{:.9},{:.9},{},{},{},{},{},{},{},{:.9},{:.9},{:.9},{:.9},{:.9},{:.9},{:.9},{:.9},{:.9},{:.9}",
            candidate.candidate,
            a.fixture_count,
            a.input_bytes,
            a.output_bytes,
            a.byte_delta,
            a.output_to_input_ratio,
            fmt_float(a.overhead_pct),
            a.median_encode_mib_s,
            a.median_decode_mib_s,
            a.weighted_encode_mib_s,
            a.weighted_decode_mib_s,
            a.roundtrip_failures,
            a.tamper_accepts,
            a.tamper_trials,
            a.wrong_key_accepts,
            a.wrong_key_trials,
            a.known_magic_prefix_hits,
            a.known_magic_prefix_trials,
            a.entropy_bits_per_byte,
            a.entropy_gap_bits_per_byte,
            a.chi_square_per_df,
            a.serial_correlation,
            a.mean_abs_bit_bias_pct,
            a.max_byte_frequency_pct,
            a.same_input_drift_pct,
            a.input_bit_flip_delta_pct,
            a.input_delta_minus_drift_pct,
            a.input_delta_len_delta_mean_bytes
        );
    }
}

fn fmt_float(value: f64) -> String {
    if value.is_infinite() && value.is_sign_positive() {
        "inf".to_string()
    } else if value.is_infinite() && value.is_sign_negative() {
        "-inf".to_string()
    } else if value.is_nan() {
        "nan".to_string()
    } else {
        format!("{value:.6}")
    }
}

fn to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Debug, Clone, Copy)]
struct Prng {
    state: u64,
}

impl Prng {
    fn new(seed: u64) -> Self {
        Self {
            state: seed ^ 0x9E37_79B9_7F4A_7C15,
        }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        value ^ (value >> 31)
    }

    fn fill_bytes(&mut self, output: &mut [u8]) {
        let mut offset = 0usize;
        while offset < output.len() {
            let bytes = self.next_u64().to_le_bytes();
            let take = (output.len() - offset).min(bytes.len());
            output[offset..offset + take].copy_from_slice(&bytes[..take]);
            offset += take;
        }
    }
}
