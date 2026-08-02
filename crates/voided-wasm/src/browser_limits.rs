use base64::{engine::general_purpose::STANDARD, Engine};

pub const PLAINTEXT_MAX_BYTES: usize = 100 * 1024 * 1024;
pub const ARTIFACT_MAX_BYTES: usize = 140 * 1024 * 1024;
pub const RAW_MAX_BYTES: usize = 16 * 1024 * 1024;
pub const KDF_INPUT_MAX_BYTES: usize = 1024 * 1024;
pub const CONTEXT_MAX_BYTES: usize = 1024;
pub const CHUNK_MAX_BYTES: usize = 1024 * 1024;
pub const HKDF_MAX_OUTPUT_BYTES: usize = 255 * 32;
pub const SALTED_HASH_TRANSCRIPT_RESERVE_BYTES: usize = 64;

pub fn validate_len(
    len: usize,
    min: usize,
    max: usize,
    label: &'static str,
) -> Result<(), &'static str> {
    if len < min || len > max {
        Err(label)
    } else {
        Ok(())
    }
}

pub fn validate_exact_len(
    len: usize,
    expected: usize,
    label: &'static str,
) -> Result<(), &'static str> {
    validate_len(len, expected, expected, label)
}

pub fn validate_aggregate_len(
    lengths: &[usize],
    max: usize,
    label: &'static str,
) -> Result<(), &'static str> {
    let total = lengths
        .iter()
        .try_fold(0usize, |total, length| total.checked_add(*length))
        .ok_or(label)?;
    if total <= max {
        Ok(())
    } else {
        Err(label)
    }
}

pub fn validate_context(value: &str, label: &'static str) -> Result<(), &'static str> {
    validate_len(value.len(), 1, CONTEXT_MAX_BYTES, label)
}

pub fn decode_canonical_base64(
    value: &str,
    max_decoded_bytes: usize,
    label: &'static str,
) -> Result<Vec<u8>, &'static str> {
    let max_encoded_bytes = max_decoded_bytes
        .checked_add(2)
        .and_then(|value| value.checked_div(3))
        .and_then(|value| value.checked_mul(4))
        .ok_or(label)?;
    if value.len() > max_encoded_bytes || (!value.is_empty() && !value.len().is_multiple_of(4)) {
        return Err(label);
    }
    if !canonical_base64_text(value) {
        return Err(label);
    }
    let decoded = STANDARD.decode(value).map_err(|_| label)?;
    if decoded.len() > max_decoded_bytes {
        return Err(label);
    }
    Ok(decoded)
}

fn canonical_base64_text(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    if !value.len().is_multiple_of(4) {
        return false;
    }
    let bytes = value.as_bytes();
    let padding = if value.ends_with("==") {
        2
    } else if value.ends_with('=') {
        1
    } else {
        0
    };
    let data_len = bytes.len() - padding;
    if bytes[..data_len]
        .iter()
        .any(|byte| base64_sextet(*byte).is_none())
        || bytes[data_len..].iter().any(|byte| *byte != b'=')
    {
        return false;
    }
    match padding {
        2 => base64_sextet(bytes[bytes.len() - 3]).is_some_and(|value| value & 0x0f == 0),
        1 => base64_sextet(bytes[bytes.len() - 2]).is_some_and(|value| value & 0x03 == 0),
        _ => true,
    }
}

fn base64_sextet(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

pub fn decode_canonical_base64_exact(
    value: &str,
    expected_bytes: usize,
    label: &'static str,
) -> Result<Vec<u8>, &'static str> {
    let decoded = decode_canonical_base64(value, expected_bytes, label)?;
    validate_exact_len(decoded.len(), expected_bytes, label)?;
    Ok(decoded)
}

pub fn decode_canonical_lower_hex(
    value: &str,
    max_decoded_bytes: usize,
    exact_decoded_bytes: Option<usize>,
    label: &'static str,
) -> Result<Vec<u8>, &'static str> {
    let max_encoded_bytes = max_decoded_bytes.checked_mul(2).ok_or(label)?;
    if value.len() > max_encoded_bytes || !value.len().is_multiple_of(2) {
        return Err(label);
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(label);
    }
    let decoded = hex::decode(value).map_err(|_| label)?;
    if exact_decoded_bytes.is_some_and(|expected| decoded.len() != expected) {
        return Err(label);
    }
    Ok(decoded)
}

pub fn validate_fused_info(
    info: &voided_core::shell::FusedShellInfo,
    shell_len: usize,
) -> Result<(), &'static str> {
    validate_len(
        shell_len,
        0,
        ARTIFACT_MAX_BYTES,
        "fused shell exceeds browser limit",
    )?;
    validate_len(
        info.payload_size,
        0,
        PLAINTEXT_MAX_BYTES,
        "fused shell declares an oversized payload",
    )?;
    if info.shell_size != shell_len {
        return Err("fused shell size metadata mismatch");
    }
    let accounted = info
        .payload_size
        .checked_add(info.metadata_size)
        .and_then(|value| value.checked_add(info.tag_size))
        .ok_or("fused shell size metadata overflow")?;
    if accounted != shell_len {
        return Err("fused shell size metadata mismatch");
    }
    Ok(())
}

pub fn validate_artifact_info(
    info: &voided_core::shell::ProtectedArtifactInfo,
    artifact_len: usize,
) -> Result<(), &'static str> {
    validate_len(
        artifact_len,
        0,
        ARTIFACT_MAX_BYTES,
        "protected artifact exceeds browser limit",
    )?;
    validate_len(
        info.original_size,
        0,
        PLAINTEXT_MAX_BYTES,
        "protected artifact declares an oversized plaintext",
    )?;
    validate_len(
        info.compressed_size,
        0,
        PLAINTEXT_MAX_BYTES,
        "protected artifact declares an oversized compressed payload",
    )?;
    validate_len(
        info.encrypted_size,
        0,
        ARTIFACT_MAX_BYTES,
        "protected artifact declares an oversized encrypted payload",
    )?;
    if info.protected_size != artifact_len {
        return Err("protected artifact size metadata mismatch");
    }
    validate_len(
        info.shell_chunk_size as usize,
        1,
        CHUNK_MAX_BYTES,
        "protected artifact chunk size is invalid",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_limits_reject_before_allocation() {
        assert!(validate_len(8, 0, 8, "too large").is_ok());
        assert_eq!(validate_len(9, 0, 8, "too large"), Err("too large"));
        assert!(validate_aggregate_len(&[2, 3, 3], 8, "too large").is_ok());
        assert_eq!(
            validate_aggregate_len(&[usize::MAX, 1], usize::MAX, "too large"),
            Err("too large")
        );
    }

    #[test]
    fn canonical_decoders_are_exact_and_bounded() {
        assert_eq!(
            decode_canonical_base64("", 0, "bad base64").unwrap(),
            Vec::<u8>::new()
        );
        assert_eq!(
            decode_canonical_base64_exact("AQID", 3, "bad base64").unwrap(),
            vec![1, 2, 3]
        );
        assert!(decode_canonical_base64("AR==", 1, "bad base64").is_err());
        assert!(decode_canonical_base64("A", 1, "bad base64").is_err());
        assert!(decode_canonical_base64("AA=A", 3, "bad base64").is_err());
        assert!(decode_canonical_base64("AAF=", 2, "bad base64").is_err());
        assert!(decode_canonical_base64("AQID", 2, "bad base64").is_err());
        assert_eq!(
            decode_canonical_lower_hex("00ff", 2, Some(2), "bad hex").unwrap(),
            vec![0, 255]
        );
        assert!(decode_canonical_lower_hex("00FF", 2, None, "bad hex").is_err());
        assert!(decode_canonical_lower_hex("0000", 1, None, "bad hex").is_err());
    }
}
