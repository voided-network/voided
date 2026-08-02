//! Compression module providing Brotli and Gzip compression.

use crate::{Error, Result, MAGIC_COMPRESSED};
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// Maximum output produced by one in-memory decompression operation.
pub const MAX_DECOMPRESSED_SIZE: usize = 512 * 1024 * 1024;

/// Maximum expansion accepted by the default in-memory decompressor.
pub const MAX_COMPRESSION_RATIO: usize = 256;

/// Supported compression algorithms
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum CompressionAlgorithm {
    /// No compression
    None = 0x00,
    /// Gzip compression
    Gzip = 0x01,
    /// Brotli compression
    Brotli = 0x02,
}

impl CompressionAlgorithm {
    /// Get algorithm from byte identifier
    pub fn from_byte(byte: u8) -> Result<Self> {
        match byte {
            0x00 => Ok(CompressionAlgorithm::None),
            0x01 => Ok(CompressionAlgorithm::Gzip),
            0x02 => Ok(CompressionAlgorithm::Brotli),
            _ => Err(Error::UnsupportedAlgorithm(byte)),
        }
    }

    /// Get algorithm name as string
    pub fn name(&self) -> &'static str {
        match self {
            CompressionAlgorithm::None => "none",
            CompressionAlgorithm::Gzip => "gzip",
            CompressionAlgorithm::Brotli => "brotli",
        }
    }

    /// Parse from string name
    pub fn from_name(name: &str) -> Result<Self> {
        match name.to_lowercase().as_str() {
            "none" => Ok(CompressionAlgorithm::None),
            "gzip" => Ok(CompressionAlgorithm::Gzip),
            "brotli" => Ok(CompressionAlgorithm::Brotli),
            _ => Err(Error::UnsupportedAlgorithm(0)),
        }
    }
}

/// Result of a compression operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionResult {
    /// Compressed data
    pub compressed: Vec<u8>,
    /// Algorithm used
    pub algorithm: CompressionAlgorithm,
    /// Original size in bytes
    pub original_size: usize,
    /// Compressed size in bytes
    pub compressed_size: usize,
    /// Compression ratio (compressed / original)
    pub compression_ratio: f64,
}

/// Compression options
#[derive(Debug, Clone)]
pub struct CompressionOptions {
    /// Preferred algorithm (auto selects best)
    pub algorithm: CompressionAlgorithm,
    /// Minimum size threshold for compression (skip for smaller data)
    pub min_size_threshold: usize,
    /// Compression level (1-9 for gzip, 1-11 for brotli)
    pub level: u32,
}

impl Default for CompressionOptions {
    fn default() -> Self {
        Self {
            algorithm: CompressionAlgorithm::Brotli,
            min_size_threshold: 100,
            level: 6,
        }
    }
}

/// Compress data using the specified algorithm
pub fn compress(data: &[u8], options: Option<CompressionOptions>) -> Result<CompressionResult> {
    let opts = options.unwrap_or_default();
    validate_compression_level(opts.algorithm, opts.level)?;
    let original_size = data.len();

    // Skip compression for small data
    if original_size < opts.min_size_threshold {
        return Ok(CompressionResult {
            compressed: data.to_vec(),
            algorithm: CompressionAlgorithm::None,
            original_size,
            compressed_size: original_size,
            compression_ratio: 1.0,
        });
    }

    // Skip if explicitly set to none
    if opts.algorithm == CompressionAlgorithm::None {
        return Ok(CompressionResult {
            compressed: data.to_vec(),
            algorithm: CompressionAlgorithm::None,
            original_size,
            compressed_size: original_size,
            compression_ratio: 1.0,
        });
    }

    let (compressed, algorithm) = match opts.algorithm {
        CompressionAlgorithm::Brotli => compress_brotli(data, opts.level)?,
        CompressionAlgorithm::Gzip => compress_gzip(data, opts.level)?,
        CompressionAlgorithm::None => (data.to_vec(), CompressionAlgorithm::None),
    };

    let compressed_size = compressed.len();
    let compression_ratio = compressed_size as f64 / original_size as f64;

    // Only use compression if it saves at least 10% and remains within the
    // expansion policy enforced by the matching decompressor.
    let within_expansion_policy = compressed_size > 0
        && original_size <= compressed_size.saturating_mul(MAX_COMPRESSION_RATIO);
    if compression_ratio < 0.9 && within_expansion_policy {
        Ok(CompressionResult {
            compressed,
            algorithm,
            original_size,
            compressed_size,
            compression_ratio,
        })
    } else {
        Ok(CompressionResult {
            compressed: data.to_vec(),
            algorithm: CompressionAlgorithm::None,
            original_size,
            compressed_size: original_size,
            compression_ratio: 1.0,
        })
    }
}

fn validate_compression_level(algorithm: CompressionAlgorithm, level: u32) -> Result<()> {
    let valid = match algorithm {
        CompressionAlgorithm::None => level == 0 || level == CompressionOptions::default().level,
        CompressionAlgorithm::Gzip => level <= 9,
        CompressionAlgorithm::Brotli => level <= 11,
    };
    if valid {
        Ok(())
    } else {
        Err(Error::InvalidConfiguration(format!(
            "invalid compression level {level} for {}",
            algorithm.name()
        )))
    }
}

/// Decompress data using the specified algorithm
pub fn decompress(data: &[u8], algorithm: CompressionAlgorithm) -> Result<Vec<u8>> {
    decompress_with_limits(
        data,
        algorithm,
        MAX_DECOMPRESSED_SIZE,
        MAX_COMPRESSION_RATIO,
    )
}

/// Decompress with an explicit absolute output bound.
///
/// Unlike [`decompress_with_limits`], this function deliberately does not
/// apply a compression-ratio heuristic. Callers that authenticate or otherwise
/// trust an expected output size can therefore accept highly compressible data
/// without giving the decoder an unbounded allocation path.
pub fn decompress_bounded(
    data: &[u8],
    algorithm: CompressionAlgorithm,
    max_output_size: usize,
) -> Result<Vec<u8>> {
    if max_output_size > MAX_DECOMPRESSED_SIZE {
        return Err(Error::PayloadTooLarge {
            size: max_output_size,
            limit: MAX_DECOMPRESSED_SIZE,
        });
    }

    decompress_with_absolute_limit(data, algorithm, max_output_size)
}

fn decompress_with_absolute_limit(
    data: &[u8],
    algorithm: CompressionAlgorithm,
    max_output_size: usize,
) -> Result<Vec<u8>> {
    match algorithm {
        CompressionAlgorithm::None => {
            if data.len() > max_output_size {
                return Err(Error::PayloadTooLarge {
                    size: data.len(),
                    limit: max_output_size,
                });
            }
            Ok(data.to_vec())
        }
        CompressionAlgorithm::Gzip => decompress_gzip(data, max_output_size),
        CompressionAlgorithm::Brotli => decompress_brotli(data, max_output_size),
    }
}

/// Decompress with explicit output and expansion bounds.
pub fn decompress_with_limits(
    data: &[u8],
    algorithm: CompressionAlgorithm,
    max_output_size: usize,
    max_ratio: usize,
) -> Result<Vec<u8>> {
    if max_ratio == 0 {
        return Err(Error::InvalidConfiguration(
            "decompression ratio limit must be greater than zero".to_string(),
        ));
    }

    let ratio_limit = data.len().saturating_mul(max_ratio);
    let effective_limit = max_output_size.min(ratio_limit);
    decompress_with_absolute_limit(data, algorithm, effective_limit)
}

/// Decompress into an authenticated expected size while retaining global and
/// ratio bounds. The expected size is checked before any output allocation.
pub fn decompress_exact(
    data: &[u8],
    algorithm: CompressionAlgorithm,
    expected_size: usize,
) -> Result<Vec<u8>> {
    if expected_size > MAX_DECOMPRESSED_SIZE {
        return Err(Error::PayloadTooLarge {
            size: expected_size,
            limit: MAX_DECOMPRESSED_SIZE,
        });
    }
    let output = decompress_with_limits(data, algorithm, expected_size, MAX_COMPRESSION_RATIO)?;
    if output.len() != expected_size {
        return Err(Error::SizeMismatch {
            expected: expected_size,
            actual: output.len(),
        });
    }
    Ok(output)
}

fn read_decompressed_with_limit<R: std::io::Read>(
    mut reader: R,
    max_output_size: usize,
) -> Result<Vec<u8>> {
    let mut output = Vec::with_capacity(max_output_size.min(64 * 1024));
    let mut buffer = vec![0u8; max_output_size.clamp(1, 64 * 1024)];

    loop {
        let remaining = max_output_size.saturating_sub(output.len());
        if remaining == 0 {
            let mut probe = [0u8; 1];
            let read = reader
                .read(&mut probe)
                .map_err(|e| Error::DecompressionFailed(e.to_string()))?;
            if read == 0 {
                return Ok(output);
            }
            return Err(Error::PayloadTooLarge {
                size: max_output_size.saturating_add(1),
                limit: max_output_size,
            });
        }

        let read_capacity = remaining.min(buffer.len());
        let read = reader
            .read(&mut buffer[..read_capacity])
            .map_err(|e| Error::DecompressionFailed(e.to_string()))?;
        if read == 0 {
            return Ok(output);
        }

        let required_capacity = output.len().saturating_add(read);
        if required_capacity > output.capacity() {
            let target_capacity = output
                .capacity()
                .saturating_mul(2)
                .max(required_capacity)
                .min(max_output_size);
            output.reserve_exact(target_capacity.saturating_sub(output.len()));
        }
        output.extend_from_slice(&buffer[..read]);
    }
}

/// Compress data with Brotli
fn compress_brotli(data: &[u8], level: u32) -> Result<(Vec<u8>, CompressionAlgorithm)> {
    use brotli::enc::BrotliEncoderParams;

    let mut output = Vec::new();
    let params = BrotliEncoderParams {
        quality: level as i32,
        ..Default::default()
    };

    brotli::BrotliCompress(&mut std::io::Cursor::new(data), &mut output, &params)
        .map_err(|e| Error::CompressionFailed(e.to_string()))?;

    Ok((output, CompressionAlgorithm::Brotli))
}

/// Decompress Brotli data
fn decompress_brotli(data: &[u8], max_output_size: usize) -> Result<Vec<u8>> {
    let decoder = brotli::Decompressor::new(std::io::Cursor::new(data), 4096);
    read_decompressed_with_limit(decoder, max_output_size)
}

/// Compress data with Gzip
fn compress_gzip(data: &[u8], level: u32) -> Result<(Vec<u8>, CompressionAlgorithm)> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    let mut encoder = GzEncoder::new(Vec::new(), Compression::new(level));
    encoder
        .write_all(data)
        .map_err(|e| Error::CompressionFailed(e.to_string()))?;

    let output = encoder
        .finish()
        .map_err(|e| Error::CompressionFailed(e.to_string()))?;

    Ok((output, CompressionAlgorithm::Gzip))
}

/// Decompress Gzip data
fn decompress_gzip(data: &[u8], max_output_size: usize) -> Result<Vec<u8>> {
    use flate2::read::GzDecoder;

    read_decompressed_with_limit(GzDecoder::new(data), max_output_size)
}

/// Serialize compression result with header
pub fn serialize_with_header(result: &CompressionResult) -> Result<Vec<u8>> {
    let original_size =
        u32::try_from(result.original_size).map_err(|_| Error::PayloadTooLarge {
            size: result.original_size,
            limit: u32::MAX as usize,
        })?;
    let mut output = Vec::with_capacity(7 + result.compressed.len());

    // Magic bytes "VC"
    output.extend_from_slice(MAGIC_COMPRESSED);
    // Algorithm
    output.push(result.algorithm as u8);
    // Original size (big-endian)
    output.extend_from_slice(&original_size.to_be_bytes());
    // Compressed data
    output.extend_from_slice(&result.compressed);

    Ok(output)
}

/// Deserialize compression result with header
pub fn deserialize_with_header(data: &[u8]) -> Result<(Vec<u8>, CompressionAlgorithm, usize)> {
    if data.len() < 7 {
        return Err(Error::TruncatedPayload {
            expected: 7,
            actual: data.len(),
        });
    }

    // Check magic
    if &data[0..2] != MAGIC_COMPRESSED {
        return Err(Error::InvalidFormat);
    }

    // Parse algorithm
    let algorithm = CompressionAlgorithm::from_byte(data[2])?;

    // Parse original size
    let original_size = u32::from_be_bytes([data[3], data[4], data[5], data[6]]) as usize;

    // Extract compressed data
    let compressed = data[7..].to_vec();

    Ok((compressed, algorithm, original_size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gzip_roundtrip() {
        let data = b"Hello, World! This is a test message that should be compressed.";

        let result = compress(
            data,
            Some(CompressionOptions {
                algorithm: CompressionAlgorithm::Gzip,
                min_size_threshold: 10,
                level: 6,
            }),
        )
        .unwrap();

        let decompressed = decompress(&result.compressed, result.algorithm).unwrap();
        assert_eq!(data, &decompressed[..]);
    }

    #[test]
    fn test_brotli_roundtrip() {
        let data = b"Hello, World! This is a test message that should be compressed with Brotli.";

        let result = compress(
            data,
            Some(CompressionOptions {
                algorithm: CompressionAlgorithm::Brotli,
                min_size_threshold: 10,
                level: 6,
            }),
        )
        .unwrap();

        let decompressed = decompress(&result.compressed, result.algorithm).unwrap();
        assert_eq!(data, &decompressed[..]);
    }

    #[test]
    fn test_skip_small_data() {
        let data = b"tiny";

        let result = compress(
            data,
            Some(CompressionOptions {
                algorithm: CompressionAlgorithm::Brotli,
                min_size_threshold: 100, // Data is smaller than threshold
                level: 6,
            }),
        )
        .unwrap();

        assert_eq!(result.algorithm, CompressionAlgorithm::None);
        assert_eq!(result.compressed, data);
    }

    #[test]
    fn test_header_serialization() {
        let data = b"Test data for header serialization test with enough content.";

        let result = compress(
            data,
            Some(CompressionOptions {
                algorithm: CompressionAlgorithm::Gzip,
                min_size_threshold: 10,
                level: 6,
            }),
        )
        .unwrap();

        let serialized = serialize_with_header(&result).unwrap();
        let (compressed, algorithm, original_size) = deserialize_with_header(&serialized).unwrap();

        assert_eq!(algorithm, result.algorithm);
        assert_eq!(original_size, result.original_size);
        assert_eq!(compressed, result.compressed);
    }

    #[test]
    fn test_decompression_rejects_bomb_before_full_expansion() {
        let plaintext = vec![0u8; 2 * 1024 * 1024];
        let (compressed, _) = compress_gzip(&plaintext, 6).unwrap();
        assert!(compressed.len().saturating_mul(MAX_COMPRESSION_RATIO) < plaintext.len());
        assert!(matches!(
            decompress(&compressed, CompressionAlgorithm::Gzip),
            Err(Error::PayloadTooLarge { .. })
        ));
    }

    #[test]
    fn test_decompression_exact_enforces_expected_size() {
        let plaintext = b"bounded decompression".repeat(64);
        let (compressed, _) = compress_gzip(&plaintext, 6).unwrap();
        assert_eq!(
            decompress_exact(&compressed, CompressionAlgorithm::Gzip, plaintext.len()).unwrap(),
            plaintext
        );
        assert!(matches!(
            decompress_exact(&compressed, CompressionAlgorithm::Gzip, plaintext.len() - 1),
            Err(Error::PayloadTooLarge { .. }) | Err(Error::SizeMismatch { .. })
        ));
    }

    #[test]
    fn test_bounded_decompression_accepts_high_ratio_data_and_enforces_absolute_cap() {
        let plaintext =
            b"<section class=\"oathdoc-clause\">auditable terms</section>\n".repeat(40_000);
        let streams = [
            (
                compress_brotli(&plaintext, 6).unwrap().0,
                CompressionAlgorithm::Brotli,
            ),
            (
                compress_gzip(&plaintext, 6).unwrap().0,
                CompressionAlgorithm::Gzip,
            ),
        ];

        for (compressed, algorithm) in streams {
            assert!(compressed.len().saturating_mul(MAX_COMPRESSION_RATIO) < plaintext.len());
            assert_eq!(
                decompress_bounded(&compressed, algorithm, plaintext.len()).unwrap(),
                plaintext
            );
            assert!(matches!(
                decompress_bounded(&compressed, algorithm, plaintext.len() - 1,),
                Err(Error::PayloadTooLarge { .. })
            ));
        }
    }

    #[test]
    fn test_bounded_decompression_rejects_a_cap_above_the_global_ceiling() {
        assert!(matches!(
            decompress_bounded(
                &[],
                CompressionAlgorithm::None,
                MAX_DECOMPRESSED_SIZE + 1,
            ),
            Err(Error::PayloadTooLarge {
                size,
                limit: MAX_DECOMPRESSED_SIZE,
            }) if size == MAX_DECOMPRESSED_SIZE + 1
        ));
    }

    #[test]
    fn test_none_decompression_obeys_output_bound() {
        assert!(matches!(
            decompress_with_limits(&[0u8; 9], CompressionAlgorithm::None, 8, 256),
            Err(Error::PayloadTooLarge { size: 9, limit: 8 })
        ));
    }

    #[test]
    fn test_compression_rejects_invalid_levels_before_processing() {
        assert!(matches!(
            compress(
                b"small",
                Some(CompressionOptions {
                    algorithm: CompressionAlgorithm::Gzip,
                    min_size_threshold: usize::MAX,
                    level: 10,
                })
            ),
            Err(Error::InvalidConfiguration(_))
        ));
        assert!(matches!(
            compress(
                b"small",
                Some(CompressionOptions {
                    algorithm: CompressionAlgorithm::Brotli,
                    min_size_threshold: usize::MAX,
                    level: 12,
                })
            ),
            Err(Error::InvalidConfiguration(_))
        ));
    }
}
