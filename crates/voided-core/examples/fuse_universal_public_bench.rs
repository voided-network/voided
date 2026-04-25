use std::{
    env, fs,
    hint::black_box,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use voided_core::{
    encryption::Key,
    shell::{fuse_bytes, inspect_fused, unfuse_bytes, FusedPreset, FusedShellOptions},
};

const RANDOM_PRINTABLE_RATIO: f64 = 95.0 / 256.0;

#[derive(Debug, Serialize)]
struct BenchReport {
    candidate: String,
    package_surface: String,
    preset: String,
    commit: Option<String>,
    corpus_dir: String,
    generated_unix_ms: u128,
    aggregate: Aggregate,
    fixtures: Vec<FixtureResult>,
}

#[derive(Debug, Default, Serialize)]
struct Aggregate {
    fixture_count: usize,
    total_input_bytes: usize,
    total_output_bytes: usize,
    average_encode_mib_s: f64,
    average_decode_mib_s: f64,
    weighted_encode_mib_s: f64,
    weighted_decode_mib_s: f64,
    average_overhead_bytes: f64,
    average_overhead_pct: f64,
    average_entropy_bits: f64,
    average_chi_square_z_abs: f64,
    average_bit_one_ratio: f64,
    average_serial_correlation_abs: f64,
    average_avalanche_ratio: f64,
    average_security_score: f64,
    average_efficiency_score: f64,
    average_size_score: f64,
    average_universal_value_score: f64,
}

#[derive(Debug, Serialize)]
struct FixtureResult {
    name: String,
    extension: String,
    input_bytes: usize,
    output_bytes: usize,
    overhead_bytes: isize,
    overhead_pct: f64,
    shell_version: u8,
    shell_chunk_size: u32,
    shell_chunk_count: usize,
    encode_iterations: usize,
    decode_iterations: usize,
    encode_mib_s: f64,
    decode_mib_s: f64,
    encode_seconds_per_iter: f64,
    decode_seconds_per_iter: f64,
    roundtrip_ok: bool,
    entropy_bits_per_byte: f64,
    chi_square: f64,
    chi_square_z: f64,
    bit_one_ratio: f64,
    printable_ratio: f64,
    serial_correlation: f64,
    avalanche_ratio: f64,
    security_score: f64,
    efficiency_score: f64,
    size_score: f64,
    universal_value_score: f64,
    flags: Vec<String>,
}

#[derive(Debug)]
struct Args {
    corpus_dir: PathBuf,
    candidate: String,
    commit: Option<String>,
    json_out: Option<PathBuf>,
    markdown_out: Option<PathBuf>,
    iterations: Option<usize>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_args()?;
    let files = collect_files(&args.corpus_dir)?;
    if files.is_empty() {
        return Err(format!(
            "no benchmark corpus files found in {}",
            args.corpus_dir.display()
        )
        .into());
    }

    let key = Key::from_bytes(&[0x42; 32])?;
    let mut fixtures = Vec::with_capacity(files.len());

    for path in files {
        let data = fs::read(&path)?;
        let fixture_name = path
            .strip_prefix(&args.corpus_dir)
            .unwrap_or(&path)
            .display()
            .to_string();
        let iterations = args
            .iterations
            .unwrap_or_else(|| iterations_for_len(data.len()));
        fixtures.push(run_fixture(&fixture_name, &path, &data, &key, iterations)?);
    }

    let report = BenchReport {
        candidate: args.candidate,
        package_surface: "voided_core::shell::fuse_bytes/unfuse_bytes".to_string(),
        preset: "balanced".to_string(),
        commit: args.commit,
        corpus_dir: args.corpus_dir.display().to_string(),
        generated_unix_ms: SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis(),
        aggregate: aggregate(&fixtures),
        fixtures,
    };

    let json = serde_json::to_string_pretty(&report)?;
    if let Some(path) = &args.json_out {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, &json)?;
    }

    let markdown = render_markdown(&report);
    if let Some(path) = &args.markdown_out {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, &markdown)?;
    }

    println!("{markdown}");
    Ok(())
}

fn parse_args() -> Result<Args, Box<dyn std::error::Error>> {
    let mut corpus_dir = None;
    let mut candidate = None;
    let mut commit = None;
    let mut json_out = None;
    let mut markdown_out = None;
    let mut iterations = None;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--corpus-dir" => {
                corpus_dir = Some(PathBuf::from(next_arg(&mut args, "--corpus-dir")?))
            }
            "--candidate" => candidate = Some(next_arg(&mut args, "--candidate")?),
            "--commit" => commit = Some(next_arg(&mut args, "--commit")?),
            "--json-out" => json_out = Some(PathBuf::from(next_arg(&mut args, "--json-out")?)),
            "--markdown-out" => {
                markdown_out = Some(PathBuf::from(next_arg(&mut args, "--markdown-out")?))
            }
            "--iterations" => {
                iterations = Some(next_arg(&mut args, "--iterations")?.parse::<usize>()?)
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument `{other}`").into()),
        }
    }

    Ok(Args {
        corpus_dir: corpus_dir.ok_or("--corpus-dir is required")?,
        candidate: candidate.unwrap_or_else(|| "voided-fuse".to_string()),
        commit,
        json_out,
        markdown_out,
        iterations,
    })
}

fn next_arg(args: &mut impl Iterator<Item = String>, name: &str) -> Result<String, String> {
    args.next()
        .ok_or_else(|| format!("{name} requires a value"))
}

fn print_usage() {
    eprintln!(
        "usage: cargo run -p voided-core --example fuse_universal_public_bench --features backend --release -- \\
  --corpus-dir /path/to/public-corpus \\
  --candidate voided-fuse-v2-current \\
  --commit 73f2f8f \\
  --json-out reports/fuse-v2.json \\
  --markdown-out reports/fuse-v2.md"
    );
}

fn collect_files(corpus_dir: &Path) -> Result<Vec<PathBuf>, Box<dyn std::error::Error>> {
    let mut files = Vec::new();
    collect_files_inner(corpus_dir, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_files_inner(
    dir: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_files_inner(&path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

fn iterations_for_len(len: usize) -> usize {
    match len {
        0..=4_095 => 600,
        4_096..=16_383 => 250,
        16_384..=65_535 => 100,
        65_536..=262_143 => 40,
        262_144..=1_048_575 => 12,
        _ => 5,
    }
}

fn run_fixture(
    name: &str,
    path: &Path,
    data: &[u8],
    key: &Key,
    iterations: usize,
) -> Result<FixtureResult, Box<dyn std::error::Error>> {
    let sample = fuse_with_nonce(data, key, 0)?;
    let shell_info = inspect_fused(&sample)?;
    let decoded = unfuse_bytes(&sample, key)?;
    let roundtrip_ok = decoded == data;

    let mut encoded_len_acc = 0usize;
    let encode_start = Instant::now();
    for iteration in 0..iterations {
        let encoded = fuse_with_nonce(data, key, iteration as u8)?;
        encoded_len_acc ^= encoded.len();
        black_box(&encoded);
    }
    let encode_elapsed = encode_start.elapsed();
    black_box(encoded_len_acc);

    let mut decoded_len_acc = 0usize;
    let decode_start = Instant::now();
    for _ in 0..iterations {
        let decoded = unfuse_bytes(&sample, key)?;
        decoded_len_acc ^= decoded.len();
        black_box(&decoded);
    }
    let decode_elapsed = decode_start.elapsed();
    black_box(decoded_len_acc);

    let output_stats = OutputStats::from_bytes(&sample);
    let avalanche_ratio = avalanche_ratio(data, key)?;
    let overhead_bytes = sample.len() as isize - data.len() as isize;
    let overhead_pct = if data.is_empty() {
        0.0
    } else {
        overhead_bytes as f64 * 100.0 / data.len() as f64
    };
    let encode_seconds_per_iter = seconds_per_iter(encode_elapsed, iterations);
    let decode_seconds_per_iter = seconds_per_iter(decode_elapsed, iterations);
    let encode_mib_s = throughput_mib_s(data.len(), encode_seconds_per_iter);
    let decode_mib_s = throughput_mib_s(data.len(), decode_seconds_per_iter);
    let security_score = security_score(&output_stats, avalanche_ratio);
    let efficiency_score = efficiency_score(encode_mib_s, decode_mib_s);
    let size_score = size_score(overhead_pct);
    let universal_value_score =
        universal_value_score(security_score, efficiency_score, size_score, roundtrip_ok);

    Ok(FixtureResult {
        name: name.to_string(),
        extension: path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_string(),
        input_bytes: data.len(),
        output_bytes: sample.len(),
        overhead_bytes,
        overhead_pct,
        shell_version: shell_info.version,
        shell_chunk_size: shell_info.chunk_size,
        shell_chunk_count: shell_info.chunk_count,
        encode_iterations: iterations,
        decode_iterations: iterations,
        encode_mib_s,
        decode_mib_s,
        encode_seconds_per_iter,
        decode_seconds_per_iter,
        roundtrip_ok,
        entropy_bits_per_byte: output_stats.entropy_bits_per_byte,
        chi_square: output_stats.chi_square,
        chi_square_z: output_stats.chi_square_z,
        bit_one_ratio: output_stats.bit_one_ratio,
        printable_ratio: output_stats.printable_ratio,
        serial_correlation: output_stats.serial_correlation,
        avalanche_ratio,
        security_score,
        efficiency_score,
        size_score,
        universal_value_score,
        flags: flags(
            roundtrip_ok,
            overhead_pct,
            &output_stats,
            avalanche_ratio,
            encode_mib_s,
        ),
    })
}

fn fuse_with_nonce(
    data: &[u8],
    key: &Key,
    nonce_seed: u8,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut nonce = [0u8; 12];
    for (index, byte) in nonce.iter_mut().enumerate() {
        *byte = nonce_seed.wrapping_add((index as u8).wrapping_mul(17));
    }

    Ok(fuse_bytes(
        data,
        key,
        Some(FusedShellOptions {
            preset: FusedPreset::Balanced,
            chunk_size: None,
            shell_nonce: Some(nonce),
        }),
    )?)
}

fn seconds_per_iter(duration: Duration, iterations: usize) -> f64 {
    duration.as_secs_f64() / iterations.max(1) as f64
}

fn throughput_mib_s(input_bytes: usize, seconds_per_iter: f64) -> f64 {
    if seconds_per_iter <= 0.0 {
        0.0
    } else {
        input_bytes as f64 / (1024.0 * 1024.0) / seconds_per_iter
    }
}

#[derive(Debug)]
struct OutputStats {
    entropy_bits_per_byte: f64,
    chi_square: f64,
    chi_square_z: f64,
    bit_one_ratio: f64,
    printable_ratio: f64,
    serial_correlation: f64,
}

impl OutputStats {
    fn from_bytes(bytes: &[u8]) -> Self {
        if bytes.is_empty() {
            return Self {
                entropy_bits_per_byte: 0.0,
                chi_square: 0.0,
                chi_square_z: 0.0,
                bit_one_ratio: 0.0,
                printable_ratio: 0.0,
                serial_correlation: 0.0,
            };
        }

        let mut freq = [0usize; 256];
        let mut ones = 0usize;
        let mut printable = 0usize;
        for &byte in bytes {
            freq[byte as usize] += 1;
            ones += byte.count_ones() as usize;
            if (32..=126).contains(&byte) {
                printable += 1;
            }
        }

        let len = bytes.len() as f64;
        let entropy_bits_per_byte = freq
            .iter()
            .filter(|&&count| count > 0)
            .map(|&count| {
                let p = count as f64 / len;
                -p * p.log2()
            })
            .sum();

        let expected = len / 256.0;
        let chi_square = if expected == 0.0 {
            0.0
        } else {
            freq.iter()
                .map(|&count| {
                    let diff = count as f64 - expected;
                    diff * diff / expected
                })
                .sum()
        };
        let chi_square_z = (chi_square - 255.0) / 510.0_f64.sqrt();
        let bit_one_ratio = ones as f64 / (bytes.len() as f64 * 8.0);
        let printable_ratio = printable as f64 / len;
        let serial_correlation = serial_correlation(bytes);

        Self {
            entropy_bits_per_byte,
            chi_square,
            chi_square_z,
            bit_one_ratio,
            printable_ratio,
            serial_correlation,
        }
    }
}

fn serial_correlation(bytes: &[u8]) -> f64 {
    if bytes.len() < 2 {
        return 0.0;
    }

    let n = bytes.len() - 1;
    let mean_x = bytes[..n].iter().map(|&b| b as f64).sum::<f64>() / n as f64;
    let mean_y = bytes[1..].iter().map(|&b| b as f64).sum::<f64>() / n as f64;
    let mut numerator = 0.0;
    let mut denom_x = 0.0;
    let mut denom_y = 0.0;

    for index in 0..n {
        let dx = bytes[index] as f64 - mean_x;
        let dy = bytes[index + 1] as f64 - mean_y;
        numerator += dx * dy;
        denom_x += dx * dx;
        denom_y += dy * dy;
    }

    if denom_x == 0.0 || denom_y == 0.0 {
        0.0
    } else {
        numerator / (denom_x.sqrt() * denom_y.sqrt())
    }
}

fn avalanche_ratio(data: &[u8], key: &Key) -> Result<f64, Box<dyn std::error::Error>> {
    if data.is_empty() {
        return Ok(0.0);
    }

    let mut mutated = data.to_vec();
    let index = mutated.len() / 2;
    mutated[index] ^= 0x01;

    let base = fuse_with_nonce(data, key, 191)?;
    let changed = fuse_with_nonce(&mutated, key, 191)?;
    Ok(hamming_distance_with_len_delta(&base, &changed) as f64
        / (base.len().max(changed.len()) * 8) as f64)
}

fn hamming_distance_with_len_delta(left: &[u8], right: &[u8]) -> usize {
    let shared = left
        .iter()
        .zip(right.iter())
        .map(|(&a, &b)| (a ^ b).count_ones() as usize)
        .sum::<usize>();
    shared + left.len().abs_diff(right.len()) * 8
}

fn security_score(stats: &OutputStats, avalanche_ratio: f64) -> f64 {
    let entropy = (100.0 - (8.0 - stats.entropy_bits_per_byte).abs() * 20.0).clamp(0.0, 100.0);
    let chi = (100.0 * (-stats.chi_square_z.abs() / 6.0).exp()).clamp(0.0, 100.0);
    let bits = (100.0 - (stats.bit_one_ratio - 0.5).abs() * 400.0).clamp(0.0, 100.0);
    let serial = (100.0 * (1.0 - stats.serial_correlation.abs().min(1.0))).clamp(0.0, 100.0);
    let printable =
        (100.0 - (stats.printable_ratio - RANDOM_PRINTABLE_RATIO).abs() * 200.0).clamp(0.0, 100.0);
    let avalanche = (100.0 - (avalanche_ratio - 0.5).abs() * 200.0).clamp(0.0, 100.0);

    entropy * 0.20 + chi * 0.15 + bits * 0.15 + serial * 0.15 + printable * 0.10 + avalanche * 0.25
}

fn efficiency_score(encode_mib_s: f64, decode_mib_s: f64) -> f64 {
    let encode = throughput_score(encode_mib_s);
    let decode = throughput_score(decode_mib_s);
    encode * 0.60 + decode * 0.40
}

fn throughput_score(mib_s: f64) -> f64 {
    (100.0 * (1.0 - (-mib_s / 75.0).exp())).clamp(0.0, 100.0)
}

fn size_score(overhead_pct: f64) -> f64 {
    (100.0 / (1.0 + overhead_pct.max(0.0) / 25.0)).clamp(0.0, 100.0)
}

fn universal_value_score(
    security_score: f64,
    efficiency_score: f64,
    size_score: f64,
    roundtrip_ok: bool,
) -> f64 {
    let roundtrip = if roundtrip_ok { 100.0 } else { 0.0 };
    security_score * 0.45 + efficiency_score * 0.25 + size_score * 0.25 + roundtrip * 0.05
}

fn flags(
    roundtrip_ok: bool,
    overhead_pct: f64,
    stats: &OutputStats,
    avalanche_ratio: f64,
    encode_mib_s: f64,
) -> Vec<String> {
    let mut flags = Vec::new();
    if !roundtrip_ok {
        flags.push("roundtrip-failed".to_string());
    }
    if overhead_pct > 25.0 {
        flags.push("high-overhead".to_string());
    }
    if stats.entropy_bits_per_byte < 7.75 {
        flags.push("low-entropy".to_string());
    }
    if stats.chi_square_z.abs() > 8.0 {
        flags.push("byte-uniformity-outlier".to_string());
    }
    if (stats.bit_one_ratio - 0.5).abs() > 0.03 {
        flags.push("bit-balance-outlier".to_string());
    }
    if stats.serial_correlation.abs() > 0.05 {
        flags.push("serial-correlation-outlier".to_string());
    }
    if (avalanche_ratio - 0.5).abs() > 0.08 {
        flags.push("avalanche-outlier".to_string());
    }
    if encode_mib_s < 5.0 {
        flags.push("slow-encode".to_string());
    }
    flags
}

fn aggregate(fixtures: &[FixtureResult]) -> Aggregate {
    if fixtures.is_empty() {
        return Aggregate::default();
    }

    let count = fixtures.len() as f64;
    let total_input_bytes = fixtures.iter().map(|f| f.input_bytes).sum::<usize>();
    let total_output_bytes = fixtures.iter().map(|f| f.output_bytes).sum::<usize>();
    let total_encode_seconds = fixtures
        .iter()
        .map(|f| f.encode_seconds_per_iter)
        .sum::<f64>();
    let total_decode_seconds = fixtures
        .iter()
        .map(|f| f.decode_seconds_per_iter)
        .sum::<f64>();

    Aggregate {
        fixture_count: fixtures.len(),
        total_input_bytes,
        total_output_bytes,
        average_encode_mib_s: avg(fixtures, |f| f.encode_mib_s),
        average_decode_mib_s: avg(fixtures, |f| f.decode_mib_s),
        weighted_encode_mib_s: throughput_mib_s(total_input_bytes, total_encode_seconds),
        weighted_decode_mib_s: throughput_mib_s(total_input_bytes, total_decode_seconds),
        average_overhead_bytes: fixtures
            .iter()
            .map(|f| f.overhead_bytes as f64)
            .sum::<f64>()
            / count,
        average_overhead_pct: avg(fixtures, |f| f.overhead_pct),
        average_entropy_bits: avg(fixtures, |f| f.entropy_bits_per_byte),
        average_chi_square_z_abs: avg(fixtures, |f| f.chi_square_z.abs()),
        average_bit_one_ratio: avg(fixtures, |f| f.bit_one_ratio),
        average_serial_correlation_abs: avg(fixtures, |f| f.serial_correlation.abs()),
        average_avalanche_ratio: avg(fixtures, |f| f.avalanche_ratio),
        average_security_score: avg(fixtures, |f| f.security_score),
        average_efficiency_score: avg(fixtures, |f| f.efficiency_score),
        average_size_score: avg(fixtures, |f| f.size_score),
        average_universal_value_score: avg(fixtures, |f| f.universal_value_score),
    }
}

fn avg(fixtures: &[FixtureResult], value: impl Fn(&FixtureResult) -> f64) -> f64 {
    fixtures.iter().map(value).sum::<f64>() / fixtures.len() as f64
}

fn render_markdown(report: &BenchReport) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "# Universal Fuse Benchmark: {}\n\n",
        report.candidate
    ));
    output.push_str(&format!(
        "- package_surface: `{}`\n- preset: `{}`\n- commit: `{}`\n- corpus_dir: `{}`\n\n",
        report.package_surface,
        report.preset,
        report.commit.as_deref().unwrap_or("unknown"),
        report.corpus_dir
    ));
    output.push_str("| fixture | bytes | out bytes | overhead | enc MiB/s | dec MiB/s | entropy | chi z | bit1 | serial | avalanche | security | efficiency | size | value | flags |\n");
    output.push_str(
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n",
    );
    for fixture in &report.fixtures {
        output.push_str(&format!(
            "| {} | {} | {} | {} ({:.2}%) | {:.2} | {:.2} | {:.4} | {:.2} | {:.4} | {:.4} | {:.4} | {:.2} | {:.2} | {:.2} | {:.2} | {} |\n",
            fixture.name,
            fixture.input_bytes,
            fixture.output_bytes,
            fixture.overhead_bytes,
            fixture.overhead_pct,
            fixture.encode_mib_s,
            fixture.decode_mib_s,
            fixture.entropy_bits_per_byte,
            fixture.chi_square_z,
            fixture.bit_one_ratio,
            fixture.serial_correlation,
            fixture.avalanche_ratio,
            fixture.security_score,
            fixture.efficiency_score,
            fixture.size_score,
            fixture.universal_value_score,
            if fixture.flags.is_empty() {
                "-".to_string()
            } else {
                fixture.flags.join(", ")
            }
        ));
    }
    output.push_str("\n## Aggregate\n\n");
    output.push_str("| fixtures | input bytes | output bytes | avg overhead | avg enc MiB/s | avg dec MiB/s | weighted enc MiB/s | weighted dec MiB/s | security | efficiency | size | value |\n");
    output.push_str("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n");
    output.push_str(&format!(
        "| {} | {} | {} | {:.2}% | {:.2} | {:.2} | {:.2} | {:.2} | {:.2} | {:.2} | {:.2} | {:.2} |\n",
        report.aggregate.fixture_count,
        report.aggregate.total_input_bytes,
        report.aggregate.total_output_bytes,
        report.aggregate.average_overhead_pct,
        report.aggregate.average_encode_mib_s,
        report.aggregate.average_decode_mib_s,
        report.aggregate.weighted_encode_mib_s,
        report.aggregate.weighted_decode_mib_s,
        report.aggregate.average_security_score,
        report.aggregate.average_efficiency_score,
        report.aggregate.average_size_score,
        report.aggregate.average_universal_value_score,
    ));
    output
}
