//! Compression module providing Brotli and Gzip compression.

use crate::{Error, Result, MAGIC_COMPRESSED};
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

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

    // Only use compression if it saves at least 10%
    if compression_ratio < 0.9 {
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

/// Decompress data using the specified algorithm
pub fn decompress(data: &[u8], algorithm: CompressionAlgorithm) -> Result<Vec<u8>> {
    match algorithm {
        CompressionAlgorithm::None => Ok(data.to_vec()),
        CompressionAlgorithm::Gzip => decompress_gzip(data),
        CompressionAlgorithm::Brotli => decompress_brotli(data),
    }
}

/// Compress data with Brotli
fn compress_brotli(data: &[u8], level: u32) -> Result<(Vec<u8>, CompressionAlgorithm)> {
    use brotli::enc::BrotliEncoderParams;

    let mut output = Vec::new();
    let mut params = BrotliEncoderParams::default();
    params.quality = level as i32;

    brotli::BrotliCompress(&mut std::io::Cursor::new(data), &mut output, &params)
        .map_err(|e| Error::CompressionFailed(e.to_string()))?;

    Ok((output, CompressionAlgorithm::Brotli))
}

/// Decompress Brotli data
fn decompress_brotli(data: &[u8]) -> Result<Vec<u8>> {
    let mut output = Vec::new();

    brotli::BrotliDecompress(&mut std::io::Cursor::new(data), &mut output)
        .map_err(|e| Error::DecompressionFailed(e.to_string()))?;

    Ok(output)
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
fn decompress_gzip(data: &[u8]) -> Result<Vec<u8>> {
    use flate2::read::GzDecoder;
    use std::io::Read;

    let mut decoder = GzDecoder::new(data);
    let mut output = Vec::new();

    decoder
        .read_to_end(&mut output)
        .map_err(|e| Error::DecompressionFailed(e.to_string()))?;

    Ok(output)
}

/// Serialize compression result with header
pub fn serialize_with_header(result: &CompressionResult) -> Vec<u8> {
    let original_size = result.original_size as u32;
    let mut output = Vec::with_capacity(7 + result.compressed.len());

    // Magic bytes "VC"
    output.extend_from_slice(MAGIC_COMPRESSED);
    // Algorithm
    output.push(result.algorithm as u8);
    // Original size (big-endian)
    output.extend_from_slice(&original_size.to_be_bytes());
    // Compressed data
    output.extend_from_slice(&result.compressed);

    output
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

        let serialized = serialize_with_header(&result);
        let (compressed, algorithm, original_size) = deserialize_with_header(&serialized).unwrap();

        assert_eq!(algorithm, result.algorithm);
        assert_eq!(original_size, result.original_size);
        assert_eq!(compressed, result.compressed);
    }
}
