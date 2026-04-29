use crate::{Error, Result};
use alloc::vec::Vec;

use super::CompressionAlgorithm;

const FOUNDATION_V2_MAGIC: &[u8; 4] = b"ILF2";
const FOUNDATION_V2_VERSION: u8 = 0x01;
const FOUNDATION_V2_HEADER_LEN: usize = 22;

// Keep the protected artifact lane portable: both native and WASM bindings can
// emit and open the same Iliad-profiled inner frame.
const BROTLI_FAST_LEVEL: u8 = 4;
const BROTLI_MID_LEVEL: u8 = 6;
const BROTLI_STRONG_LEVEL: u8 = 9;

#[derive(Debug, Clone, Copy)]
struct IliadPayloadProfile {
    ascii_ratio: f64,
    newline_ratio: f64,
    likely_json: bool,
    has_blocks: bool,
    has_manifest: bool,
    has_bundle_type: bool,
    project_type_screenplay: bool,
    project_type_story_text: bool,
    likely_iliad_export: bool,
    likely_iliad_backup_bundle: bool,
    likely_native_iliad: bool,
    likely_typed_native_iliad: bool,
    likely_derived_native_iliad: bool,
}

/// Compress using the promoted Iliad Foundation v2 routing profile.
pub(super) fn compress_foundation_v2(data: &[u8]) -> Result<(Vec<u8>, CompressionAlgorithm)> {
    let profile = profile_payload(data);
    let level = select_foundation_v2_level(data, &profile);
    let payload = compress_brotli(data, level)?;

    let mut output = Vec::with_capacity(FOUNDATION_V2_HEADER_LEN + payload.len());
    output.extend_from_slice(FOUNDATION_V2_MAGIC);
    output.push(FOUNDATION_V2_VERSION);
    output.push(level);
    output.extend_from_slice(&(data.len() as u64).to_be_bytes());
    output.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    output.extend_from_slice(&payload);

    Ok((output, CompressionAlgorithm::IliadFoundationV2))
}

/// Decompress an Iliad Foundation v2 inner frame.
pub(super) fn decompress_foundation_v2(data: &[u8]) -> Result<Vec<u8>> {
    if data.len() < FOUNDATION_V2_HEADER_LEN {
        return Err(Error::TruncatedPayload {
            expected: FOUNDATION_V2_HEADER_LEN,
            actual: data.len(),
        });
    }
    if &data[..FOUNDATION_V2_MAGIC.len()] != FOUNDATION_V2_MAGIC {
        return Err(Error::InvalidFormat);
    }
    let version = data[4];
    if version != FOUNDATION_V2_VERSION {
        return Err(Error::UnsupportedVersion(version));
    }

    let level = data[5];
    if !(1..=11).contains(&level) {
        return Err(Error::DecompressionFailed(format!(
            "invalid Iliad Foundation v2 Brotli lane: {level}"
        )));
    }

    let original_size = read_u64(&data[6..14])?;
    let payload_size = read_u64(&data[14..22])?;
    let original_size = usize::try_from(original_size).map_err(|_| {
        Error::DecompressionFailed("Iliad Foundation v2 original size overflows usize".to_string())
    })?;
    let payload_size = usize::try_from(payload_size).map_err(|_| {
        Error::DecompressionFailed("Iliad Foundation v2 payload size overflows usize".to_string())
    })?;
    let payload = &data[FOUNDATION_V2_HEADER_LEN..];
    if payload.len() != payload_size {
        return Err(Error::SizeMismatch {
            expected: payload_size,
            actual: payload.len(),
        });
    }

    let output = decompress_brotli(payload)?;
    if output.len() != original_size {
        return Err(Error::SizeMismatch {
            expected: original_size,
            actual: output.len(),
        });
    }

    Ok(output)
}

fn compress_brotli(data: &[u8], level: u8) -> Result<Vec<u8>> {
    use brotli::enc::BrotliEncoderParams;

    let mut output = Vec::new();
    let mut params = BrotliEncoderParams::default();
    params.quality = level as i32;

    brotli::BrotliCompress(&mut std::io::Cursor::new(data), &mut output, &params)
        .map_err(|e| Error::CompressionFailed(e.to_string()))?;

    Ok(output)
}

fn decompress_brotli(data: &[u8]) -> Result<Vec<u8>> {
    let mut output = Vec::new();

    brotli::BrotliDecompress(&mut std::io::Cursor::new(data), &mut output)
        .map_err(|e| Error::DecompressionFailed(e.to_string()))?;

    Ok(output)
}

fn read_u64(bytes: &[u8]) -> Result<u64> {
    if bytes.len() != 8 {
        return Err(Error::TruncatedPayload {
            expected: 8,
            actual: bytes.len(),
        });
    }
    Ok(u64::from_be_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]))
}

fn select_foundation_v2_level(data: &[u8], profile: &IliadPayloadProfile) -> u8 {
    if data.len() <= 2_048 && profile.likely_json && !profile.likely_iliad_export {
        return BROTLI_FAST_LEVEL;
    }

    if profile.project_type_story_text
        && profile.likely_iliad_export
        && data.len() <= 160 * 1024
        && profile.newline_ratio >= 0.020
    {
        return BROTLI_FAST_LEVEL;
    }

    if profile.likely_iliad_backup_bundle && data.len() <= 131_072 {
        return BROTLI_MID_LEVEL;
    }

    if profile.likely_derived_native_iliad
        || profile.likely_typed_native_iliad
        || profile.likely_native_iliad
        || profile.likely_iliad_export
    {
        return BROTLI_STRONG_LEVEL;
    }

    if profile.likely_json
        && data.len() >= 65_536
        && (profile.has_blocks || profile.has_manifest || profile.has_bundle_type)
    {
        return BROTLI_STRONG_LEVEL;
    }

    if is_large_plaintext_authoring_payload(data, profile) {
        if data.len() >= 600_000 && profile.newline_ratio <= 0.020 {
            return BROTLI_MID_LEVEL;
        }
        return BROTLI_STRONG_LEVEL;
    }

    if profile.likely_json && profile.ascii_ratio >= 0.80 {
        return BROTLI_STRONG_LEVEL;
    }

    BROTLI_FAST_LEVEL
}

fn is_large_plaintext_authoring_payload(data: &[u8], profile: &IliadPayloadProfile) -> bool {
    data.len() >= 24 * 1024
        && !profile.likely_json
        && !profile.has_blocks
        && !profile.has_manifest
        && !profile.has_bundle_type
        && !profile.project_type_screenplay
        && !profile.project_type_story_text
        && profile.ascii_ratio >= 0.90
        && profile.newline_ratio >= 0.002
}

fn profile_payload(input: &[u8]) -> IliadPayloadProfile {
    const PROFILE_SAMPLE_BYTES: usize = 16 * 1024;
    const BLOCKS: &[u8] = br#""blocks""#;
    const MANIFEST: &[u8] = br#""manifest""#;
    const BUNDLE_TYPE: &[u8] = br#""bundleType""#;
    const DRAFT: &[u8] = br#""draft""#;
    const RENDERS: &[u8] = br#""renders""#;
    const NATIVE_TYPE_ILIAD_COMPACT: &[u8] = br#""nativeType":"iliad-"#;
    const NATIVE_TYPE_ILIAD_SPACED: &[u8] = br#""nativeType": "iliad-"#;
    const TYPED_LANE_STYLE_COMPACT: &[u8] = br#""laneStyle":"typed-content-lanes""#;
    const TYPED_LANE_STYLE_SPACED: &[u8] = br#""laneStyle": "typed-content-lanes""#;
    const NATIVE_E_COMPACT: &[u8] = br#""nativeType":"iliad-authoring-portfolio-native-e""#;
    const NATIVE_E_SPACED: &[u8] = br#""nativeType": "iliad-authoring-portfolio-native-e""#;
    const DERIVED_TEXT_COMPACT: &[u8] =
        br#""readableExportStorage":"derive-from-draft-readable-export-v1""#;
    const DERIVED_TEXT_SPACED: &[u8] =
        br#""readableExportStorage": "derive-from-draft-readable-export-v1""#;
    const PROJECT_TYPE_SCREENPLAY_COMPACT: &[u8] = br#""projectType":"screenplay""#;
    const PROJECT_TYPE_SCREENPLAY_SPACED: &[u8] = br#""projectType": "screenplay""#;
    const PROJECT_TYPE_STORY_TEXT_COMPACT: &[u8] = br#""projectType":"story_text""#;
    const PROJECT_TYPE_STORY_TEXT_SPACED: &[u8] = br#""projectType": "story_text""#;

    if input.is_empty() {
        return IliadPayloadProfile {
            ascii_ratio: 1.0,
            newline_ratio: 0.0,
            likely_json: false,
            has_blocks: false,
            has_manifest: false,
            has_bundle_type: false,
            project_type_screenplay: false,
            project_type_story_text: false,
            likely_iliad_export: false,
            likely_iliad_backup_bundle: false,
            likely_native_iliad: false,
            likely_typed_native_iliad: false,
            likely_derived_native_iliad: false,
        };
    }

    let sample = &input[..input.len().min(PROFILE_SAMPLE_BYTES)];
    let len = sample.len() as f64;
    let mut ascii_count = 0usize;
    let mut json_punctuation_count = 0usize;
    let mut quoted_count = 0usize;
    let mut newline_count = 0usize;

    for &byte in sample {
        if byte.is_ascii() {
            ascii_count += 1;
        }
        if matches!(byte, b'{' | b'}' | b'[' | b']' | b':' | b',') {
            json_punctuation_count += 1;
        }
        if byte == b'"' {
            quoted_count += 1;
        }
        if byte == b'\n' {
            newline_count += 1;
        }
    }

    let has_blocks = contains_pattern(sample, BLOCKS);
    let has_manifest = contains_pattern(sample, MANIFEST);
    let has_bundle_type = contains_pattern(sample, BUNDLE_TYPE);
    let has_draft = contains_pattern(sample, DRAFT);
    let has_renders = contains_pattern(sample, RENDERS);
    let likely_native_iliad = contains_pattern(sample, NATIVE_TYPE_ILIAD_COMPACT)
        || contains_pattern(sample, NATIVE_TYPE_ILIAD_SPACED);
    let likely_typed_native_iliad = likely_native_iliad
        && (contains_pattern(sample, TYPED_LANE_STYLE_COMPACT)
            || contains_pattern(sample, TYPED_LANE_STYLE_SPACED));
    let likely_derived_native_iliad = likely_typed_native_iliad
        && (contains_pattern(sample, NATIVE_E_COMPACT)
            || contains_pattern(sample, NATIVE_E_SPACED)
            || contains_pattern(sample, DERIVED_TEXT_COMPACT)
            || contains_pattern(sample, DERIVED_TEXT_SPACED));
    let project_type_screenplay = contains_pattern(sample, PROJECT_TYPE_SCREENPLAY_COMPACT)
        || contains_pattern(sample, PROJECT_TYPE_SCREENPLAY_SPACED);
    let project_type_story_text = contains_pattern(sample, PROJECT_TYPE_STORY_TEXT_COMPACT)
        || contains_pattern(sample, PROJECT_TYPE_STORY_TEXT_SPACED);

    let ascii_ratio = ascii_count as f64 / len;
    let json_punctuation_ratio = json_punctuation_count as f64 / len;
    let quoted_ratio = quoted_count as f64 / len;
    let newline_ratio = newline_count as f64 / len;
    let has_schema_markers = has_blocks
        || has_manifest
        || has_bundle_type
        || likely_native_iliad
        || project_type_screenplay
        || project_type_story_text;
    let likely_json = ascii_ratio >= 0.8
        && ((json_punctuation_ratio + quoted_ratio) >= 0.08 || has_schema_markers);
    let likely_iliad_export = likely_json
        && has_blocks
        && (project_type_screenplay || project_type_story_text)
        && (has_manifest || has_bundle_type || has_draft || has_renders);
    let likely_iliad_backup_bundle =
        likely_iliad_export && has_bundle_type && (has_draft || has_renders);

    IliadPayloadProfile {
        ascii_ratio,
        newline_ratio,
        likely_json,
        has_blocks,
        has_manifest,
        has_bundle_type,
        project_type_screenplay,
        project_type_story_text,
        likely_iliad_export,
        likely_iliad_backup_bundle,
        likely_native_iliad,
        likely_typed_native_iliad,
        likely_derived_native_iliad,
    }
}

fn contains_pattern(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}
