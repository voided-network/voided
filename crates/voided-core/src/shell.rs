//! Fuse primitives and whole-monolith protect/open flows for Voided 1.0.

use alloc::{format, string::String, vec, vec::Vec};

use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::{
    encryption::{
        derive_key_hkdf, derive_key_hkdf_raw, Algorithm as EncryptionAlgorithm, EncryptionResult,
        Key,
    },
    hash::{compare_hashes, generate_hmac_sha256, generate_hmac_sha256_parts},
    Error, Result,
};

#[cfg(feature = "compression")]
use crate::compression::{self, CompressionAlgorithm, CompressionOptions};

/// Truncated outer shell tag size in bytes.
pub const SHELL_TAG_SIZE: usize = 16;

/// Fused shell envelope magic bytes.
pub const FUSED_SHELL_MAGIC: [u8; 4] = *b"VFS2";

/// Fused shell envelope version.
pub const FUSED_SHELL_VERSION: u8 = 0x02;
const FUSED_SHELL_V1_VERSION: u8 = 0x01;

/// Protected artifact magic bytes.
pub const PROTECTED_ARTIFACT_MAGIC: [u8; 4] = *b"VOF2";

/// Protected artifact version.
pub const PROTECTED_ARTIFACT_VERSION: u8 = 0x03;
const PROTECTED_ARTIFACT_V2_VERSION: u8 = 0x02;
const PROTECTED_ARTIFACT_V1_VERSION: u8 = 0x01;

/// Shell nonce size in bytes.
pub const SHELL_NONCE_SIZE: usize = 12;

/// Default fused shell chunk size in bytes.
pub const DEFAULT_CHUNK_SIZE: usize = 16 * 1024;

const MAX_CHUNK_SIZE: usize = 1024 * 1024;
const FUSED_SHELL_HEADER_LEN: usize = 4 + 1 + 1 + 4 + SHELL_NONCE_SIZE;
const PROTECTED_ARTIFACT_HEADER_LEN: usize = 4 + 1 + 1 + 1 + 1 + 4 + 8 + 8 + SHELL_NONCE_SIZE;
const FIELD_MONOLITH_STATE_PURPOSE: &str = "field-monolith.state.v0";
const FIELD_MONOLITH_PLAN_PURPOSE: &str = "field-monolith.plan.v0";
#[cfg(feature = "compression")]
const PROTECTED_MONOLITH_STATE_PURPOSE: &str = "protected-monolith.state.v0";
const FIELD_MONOLITH_AUTO_CHUNK_SIZE: usize = 0;
const FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT: usize = 4;
const FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE: usize = 8;
const FIELD_MONOLITH_MIN_CELL_BYTES: usize = 24;
const FIELD_MONOLITH_EXPERIMENTAL_MIN_CELL_BYTES: usize = 8;
const FIELD_MONOLITH_MAX_CELL_BYTES: usize = 512;
#[cfg(feature = "compression")]
const PROTECTED_MONOLITH_MAX_CELL_BYTES: usize = 1024;
#[cfg(feature = "compression")]
const FIELD_MONOLITH_DENSE_ANCHOR_MAX_CELL_BYTES: usize = PROTECTED_MONOLITH_MAX_CELL_BYTES;
#[cfg(not(feature = "compression"))]
const FIELD_MONOLITH_DENSE_ANCHOR_MAX_CELL_BYTES: usize = FIELD_MONOLITH_MAX_CELL_BYTES;
const FIELD_MONOLITH_AUTO_TINY_CELL_BYTES: usize = 96;
const FIELD_MONOLITH_CURRENT_AUTO_TINY_MAX: usize = 224;
const FIELD_MONOLITH_CURRENT_AUTO_DENSE_SMALL_CELL_BYTES: usize = 96;
const FIELD_MONOLITH_CURRENT_AUTO_DENSE_SMALL_MAX: usize =
    FIELD_MONOLITH_CURRENT_AUTO_DENSE_SMALL_CELL_BYTES * FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE;
const FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_SMALL_CELL_BYTES: usize = 128;
const FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_SMALL_MAX: usize = 1120;
const FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_UPPER_SMALL_CELL_BYTES: usize = 128;
const FIELD_MONOLITH_AUTO_SMALL_MAX: usize = 1536;
const FIELD_MONOLITH_AUTO_MID_CELL_BYTES: usize = 256;
const FIELD_MONOLITH_AUTO_MID_MAX: usize = 16 * 1024;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES: usize = 2;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN: usize = 34;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_MIN_ARTIFACT_LEN: usize =
    WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES + WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN + SHELL_TAG_SIZE;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_CLOAK_HEAD_BYTES: usize = 512;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_MATERIAL_DOMAIN: &str = "whole-monolith-v0-material";

fn domain_info(domain_label: &str) -> String {
    format!("voided:shell:{domain_label}")
}

/// Stable fused preset ids.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[repr(u8)]
pub enum FusedPreset {
    /// Cheapest fused shell lane.
    Compact = 0x01,
    /// Default fused shell lane.
    #[default]
    Balanced = 0x02,
    /// Highest-variation fused shell lane.
    Concealed = 0x03,
}

impl FusedPreset {
    /// Parse a preset from its serialized byte.
    pub fn from_byte(byte: u8) -> Result<Self> {
        match byte {
            0x01 => Ok(Self::Compact),
            0x02 => Ok(Self::Balanced),
            0x03 => Ok(Self::Concealed),
            other => Err(Error::UnsupportedPreset(other)),
        }
    }

    /// Parse a preset from its stable user-facing label.
    pub fn from_name(name: &str) -> Result<Self> {
        match name {
            "compact" => Ok(Self::Compact),
            "balanced" => Ok(Self::Balanced),
            "concealed" => Ok(Self::Concealed),
            other => Err(Error::InvalidConfiguration(format!(
                "unsupported fused preset `{other}`"
            ))),
        }
    }

    /// Get the stable user-facing label for this preset.
    pub fn name(self) -> &'static str {
        match self {
            Self::Compact => "compact",
            Self::Balanced => "balanced",
            Self::Concealed => "concealed",
        }
    }
}

/// Fused shell primitive options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusedShellOptions {
    /// Fused preset to use.
    pub preset: FusedPreset,
    /// Override the default chunk size.
    pub chunk_size: Option<usize>,
    /// Optional deterministic shell nonce.
    pub shell_nonce: Option<[u8; SHELL_NONCE_SIZE]>,
}

impl Default for FusedShellOptions {
    fn default() -> Self {
        Self {
            preset: FusedPreset::Balanced,
            chunk_size: None,
            shell_nonce: None,
        }
    }
}

/// Lightweight fused shell metadata available without a key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusedShellInfo {
    /// Envelope version.
    pub version: u8,
    /// Selected fused preset.
    pub preset: FusedPreset,
    /// Stable preset label.
    pub preset_label: String,
    /// Effective chunk size.
    pub chunk_size: u32,
    /// Chunk count implied by the payload length.
    pub chunk_count: usize,
    /// Shaped payload bytes.
    pub payload_size: usize,
    /// Total envelope bytes.
    pub shell_size: usize,
    /// Header bytes.
    pub metadata_size: usize,
    /// Tag bytes.
    pub tag_size: usize,
}

/// Serialized fused shell envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FusedShellEnvelope {
    /// Envelope version.
    pub version: u8,
    /// Fused preset id.
    pub preset: FusedPreset,
    /// Effective chunk size.
    pub chunk_size: u32,
    /// Shell nonce.
    pub nonce: [u8; SHELL_NONCE_SIZE],
    /// Shell-transformed bytes.
    pub payload: Vec<u8>,
    /// Truncated authentication tag.
    pub tag: [u8; SHELL_TAG_SIZE],
}

#[derive(Debug, Clone, Copy)]
struct ParsedFusedShellHeader {
    version: u8,
    preset: FusedPreset,
    chunk_size: u32,
    nonce: [u8; SHELL_NONCE_SIZE],
    payload_end: usize,
    geometry: Option<FieldMonolithGeometry>,
}

impl ParsedFusedShellHeader {
    fn payload_len(self) -> usize {
        self.payload_end - FUSED_SHELL_HEADER_LEN
    }

    fn info(self, shell_size: usize) -> FusedShellInfo {
        let payload_len = self.payload_len();
        let chunk_count = self
            .geometry
            .map(|geometry| geometry.chunk_count)
            .unwrap_or_else(|| chunk_count(payload_len, self.chunk_size as usize));
        FusedShellInfo {
            version: self.version,
            preset: self.preset,
            preset_label: self.preset.name().to_string(),
            chunk_size: self.chunk_size,
            chunk_count,
            payload_size: payload_len,
            shell_size,
            metadata_size: FUSED_SHELL_HEADER_LEN,
            tag_size: SHELL_TAG_SIZE,
        }
    }
}

fn parse_fused_shell_header(data: &[u8]) -> Result<ParsedFusedShellHeader> {
    if data.len() < FUSED_SHELL_HEADER_LEN + SHELL_TAG_SIZE {
        return Err(Error::TruncatedPayload {
            expected: FUSED_SHELL_HEADER_LEN + SHELL_TAG_SIZE,
            actual: data.len(),
        });
    }
    if data[..4] != FUSED_SHELL_MAGIC {
        return Err(Error::InvalidFormat);
    }

    let version = data[4];
    if !is_supported_fused_shell_version(version) {
        return Err(Error::UnsupportedVersion(version));
    }
    let preset = FusedPreset::from_byte(data[5])?;
    let chunk_size = u32::from_be_bytes([data[6], data[7], data[8], data[9]]);
    let mut nonce = [0u8; SHELL_NONCE_SIZE];
    nonce.copy_from_slice(&data[10..10 + SHELL_NONCE_SIZE]);
    let payload_end = data.len() - SHELL_TAG_SIZE;
    let payload_len = payload_end - FUSED_SHELL_HEADER_LEN;

    let geometry = if version == FUSED_SHELL_VERSION {
        Some(validate_current_field_monolith_geometry(
            payload_len,
            chunk_size as usize,
            FIELD_MONOLITH_MAX_CELL_BYTES,
            "fused shell",
        )?)
    } else {
        validate_legacy_shell_chunk_size(chunk_size as usize, "legacy fused shell")?;
        None
    };

    Ok(ParsedFusedShellHeader {
        version,
        preset,
        chunk_size,
        nonce,
        payload_end,
        geometry,
    })
}

impl FusedShellEnvelope {
    /// Serialize the envelope to bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = self.to_unsigned_bytes();
        bytes.extend_from_slice(&self.tag);
        bytes
    }

    /// Serialize the envelope without the trailing tag.
    pub fn to_unsigned_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(FUSED_SHELL_HEADER_LEN + self.payload.len());
        bytes.extend_from_slice(&FUSED_SHELL_MAGIC);
        bytes.push(self.version);
        bytes.push(self.preset as u8);
        bytes.extend_from_slice(&self.chunk_size.to_be_bytes());
        bytes.extend_from_slice(&self.nonce);
        bytes.extend_from_slice(&self.payload);
        bytes
    }

    /// Parse a serialized fused shell envelope.
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        let parsed = parse_fused_shell_header(data)?;
        let payload = data[FUSED_SHELL_HEADER_LEN..parsed.payload_end].to_vec();
        let mut tag = [0u8; SHELL_TAG_SIZE];
        tag.copy_from_slice(&data[parsed.payload_end..]);

        Ok(Self {
            version: parsed.version,
            preset: parsed.preset,
            chunk_size: parsed.chunk_size,
            nonce: parsed.nonce,
            payload,
            tag,
        })
    }

    /// Return lightweight envelope metadata.
    pub fn info(&self) -> FusedShellInfo {
        let chunk_size = self.chunk_size.max(1) as usize;
        let chunk_count = if self.version == FUSED_SHELL_VERSION {
            field_monolith_infer_geometry(self.payload.len(), chunk_size)
                .map(|geometry| geometry.chunk_count)
                .unwrap_or_else(|| chunk_count(self.payload.len(), chunk_size))
        } else {
            chunk_count(self.payload.len(), chunk_size)
        };
        FusedShellInfo {
            version: self.version,
            preset: self.preset,
            preset_label: self.preset.name().to_string(),
            chunk_size: self.chunk_size,
            chunk_count,
            payload_size: self.payload.len(),
            shell_size: self.payload.len() + FUSED_SHELL_HEADER_LEN + SHELL_TAG_SIZE,
            metadata_size: FUSED_SHELL_HEADER_LEN,
            tag_size: SHELL_TAG_SIZE,
        }
    }
}

#[cfg(feature = "compression")]
/// Protect/open pipeline options.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectOptions {
    /// Fused preset for the outer shell.
    pub preset: FusedPreset,
    /// Compression algorithm preference.
    pub compression_algorithm: CompressionAlgorithm,
    /// Compression level.
    pub compression_level: u32,
    /// Minimum size before compression is attempted.
    pub compression_min_size_threshold: usize,
    /// Preferred encryption algorithm.
    pub encryption_algorithm: Option<EncryptionAlgorithm>,
    /// Optional override for shell chunk size.
    pub shell_chunk_size: Option<usize>,
    /// Optional deterministic shell nonce.
    pub shell_nonce: Option<[u8; SHELL_NONCE_SIZE]>,
}

#[cfg(feature = "compression")]
impl Default for ProtectOptions {
    fn default() -> Self {
        Self {
            preset: FusedPreset::Balanced,
            compression_algorithm: CompressionAlgorithm::Brotli,
            compression_level: 6,
            compression_min_size_threshold: 100,
            encryption_algorithm: None,
            shell_chunk_size: None,
            shell_nonce: None,
        }
    }
}

#[cfg(feature = "compression")]
/// Keyless metadata for a current VOF3 monolith protected artifact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectedArtifactInfo {
    /// Artifact version.
    pub version: u8,
    /// Fused preset id.
    pub preset: FusedPreset,
    /// Stable preset label.
    pub preset_label: String,
    /// Compression algorithm stored in the artifact.
    pub compression_algorithm: CompressionAlgorithm,
    /// Encryption algorithm used for the sealed payload.
    pub encryption_algorithm: EncryptionAlgorithm,
    /// Original plaintext size.
    pub original_size: usize,
    /// Size after compression and before encryption.
    pub compressed_size: usize,
    /// Size of the encrypted bytes before shell transformation.
    pub encrypted_size: usize,
    /// Total artifact bytes.
    pub protected_size: usize,
    /// Effective shell chunk size.
    pub shell_chunk_size: u32,
    /// Shell chunk count.
    pub shell_chunk_count: usize,
    /// Shell nonce.
    pub shell_nonce: [u8; SHELL_NONCE_SIZE],
}

#[cfg(feature = "compression")]
/// Result of a protect or repack operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectResult {
    /// Serialized protected artifact bytes.
    pub artifact: Vec<u8>,
    /// Parsed keyless metadata for the returned artifact.
    pub info: ProtectedArtifactInfo,
}

#[cfg(feature = "compression")]
#[derive(Debug, Clone)]
struct ProtectedArtifactEnvelope {
    version: u8,
    preset: FusedPreset,
    compression_algorithm: CompressionAlgorithm,
    encryption_algorithm: EncryptionAlgorithm,
    chunk_size: u32,
    original_size: u64,
    compressed_size: u64,
    nonce: [u8; SHELL_NONCE_SIZE],
    payload: Vec<u8>,
    tag: [u8; SHELL_TAG_SIZE],
}

#[cfg(feature = "compression")]
#[derive(Debug, Clone, Copy)]
struct ParsedProtectedArtifactHeader {
    version: u8,
    preset: FusedPreset,
    compression_algorithm: CompressionAlgorithm,
    encryption_algorithm: EncryptionAlgorithm,
    chunk_size: u32,
    original_size: u64,
    compressed_size: u64,
    nonce: [u8; SHELL_NONCE_SIZE],
    payload_end: usize,
    geometry: Option<FieldMonolithGeometry>,
}

#[cfg(feature = "compression")]
impl ParsedProtectedArtifactHeader {
    fn payload_len(self) -> usize {
        self.payload_end - PROTECTED_ARTIFACT_HEADER_LEN
    }

    fn info(self, protected_size: usize) -> Result<ProtectedArtifactInfo> {
        let payload_len = self.payload_len();
        let original_size = protected_artifact_size(self.original_size, "original size")?;
        let compressed_size = protected_artifact_size(self.compressed_size, "compressed size")?;
        let encrypted_size = self
            .geometry
            .map(|geometry| geometry.original_len)
            .unwrap_or(payload_len);
        let shell_chunk_count = self
            .geometry
            .map(|geometry| geometry.chunk_count)
            .unwrap_or_else(|| chunk_count(payload_len, self.chunk_size as usize));

        Ok(ProtectedArtifactInfo {
            version: self.version,
            preset: self.preset,
            preset_label: self.preset.name().to_string(),
            compression_algorithm: self.compression_algorithm,
            encryption_algorithm: self.encryption_algorithm,
            original_size,
            compressed_size,
            encrypted_size,
            protected_size,
            shell_chunk_size: self.chunk_size,
            shell_chunk_count,
            shell_nonce: self.nonce,
        })
    }
}

#[cfg(feature = "compression")]
fn parse_protected_artifact_header(data: &[u8]) -> Result<ParsedProtectedArtifactHeader> {
    if data.len() < PROTECTED_ARTIFACT_HEADER_LEN + SHELL_TAG_SIZE {
        return Err(Error::TruncatedPayload {
            expected: PROTECTED_ARTIFACT_HEADER_LEN + SHELL_TAG_SIZE,
            actual: data.len(),
        });
    }
    if data[..4] != PROTECTED_ARTIFACT_MAGIC {
        return Err(Error::InvalidFormat);
    }

    let version = data[4];
    if !is_supported_protected_artifact_version(version) {
        return Err(Error::UnsupportedVersion(version));
    }
    let preset = FusedPreset::from_byte(data[5])?;
    let compression_algorithm = CompressionAlgorithm::from_byte(data[6])?;
    let encryption_algorithm = EncryptionAlgorithm::from_byte(data[7])?;
    let chunk_size = u32::from_be_bytes([data[8], data[9], data[10], data[11]]);
    let original_size = u64::from_be_bytes([
        data[12], data[13], data[14], data[15], data[16], data[17], data[18], data[19],
    ]);
    let compressed_size = u64::from_be_bytes([
        data[20], data[21], data[22], data[23], data[24], data[25], data[26], data[27],
    ]);
    let mut nonce = [0u8; SHELL_NONCE_SIZE];
    nonce.copy_from_slice(&data[28..28 + SHELL_NONCE_SIZE]);
    let payload_end = data.len() - SHELL_TAG_SIZE;
    let payload_len = payload_end - PROTECTED_ARTIFACT_HEADER_LEN;

    let geometry = match version {
        PROTECTED_ARTIFACT_VERSION => Some(validate_current_field_monolith_geometry(
            payload_len,
            chunk_size as usize,
            PROTECTED_MONOLITH_MAX_CELL_BYTES,
            "legacy protected monolith",
        )?),
        PROTECTED_ARTIFACT_V2_VERSION => Some(validate_current_field_monolith_geometry(
            payload_len,
            chunk_size as usize,
            FIELD_MONOLITH_MAX_CELL_BYTES,
            "legacy protected shell",
        )?),
        PROTECTED_ARTIFACT_V1_VERSION => {
            validate_legacy_shell_chunk_size(chunk_size as usize, "legacy protected artifact")?;
            None
        }
        other => return Err(Error::UnsupportedVersion(other)),
    };

    Ok(ParsedProtectedArtifactHeader {
        version,
        preset,
        compression_algorithm,
        encryption_algorithm,
        chunk_size,
        original_size,
        compressed_size,
        nonce,
        payload_end,
        geometry,
    })
}

#[cfg(feature = "compression")]
impl ProtectedArtifactEnvelope {
    #[cfg(test)]
    fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = self.to_unsigned_bytes();
        bytes.extend_from_slice(&self.tag);
        bytes
    }

    fn to_unsigned_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(PROTECTED_ARTIFACT_HEADER_LEN + self.payload.len());
        bytes.extend_from_slice(&PROTECTED_ARTIFACT_MAGIC);
        bytes.push(self.version);
        bytes.push(self.preset as u8);
        bytes.push(self.compression_algorithm as u8);
        bytes.push(self.encryption_algorithm as u8);
        bytes.extend_from_slice(&self.chunk_size.to_be_bytes());
        bytes.extend_from_slice(&self.original_size.to_be_bytes());
        bytes.extend_from_slice(&self.compressed_size.to_be_bytes());
        bytes.extend_from_slice(&self.nonce);
        bytes.extend_from_slice(&self.payload);
        bytes
    }

    fn from_bytes(data: &[u8]) -> Result<Self> {
        let parsed = parse_protected_artifact_header(data)?;
        let payload = data[PROTECTED_ARTIFACT_HEADER_LEN..parsed.payload_end].to_vec();
        let mut tag = [0u8; SHELL_TAG_SIZE];
        tag.copy_from_slice(&data[parsed.payload_end..]);

        Ok(Self {
            version: parsed.version,
            preset: parsed.preset,
            compression_algorithm: parsed.compression_algorithm,
            encryption_algorithm: parsed.encryption_algorithm,
            chunk_size: parsed.chunk_size,
            original_size: parsed.original_size,
            compressed_size: parsed.compressed_size,
            nonce: parsed.nonce,
            payload,
            tag,
        })
    }
}

fn protected_artifact_size(value: u64, label: &str) -> Result<usize> {
    usize::try_from(value)
        .map_err(|_| Error::InvalidConfiguration(format!("artifact {label} exceeds this platform")))
}

/// Derive a 256-bit domain key for shell-related operations.
pub fn derive_domain_key(master: &Key, salt: Option<&[u8]>, domain_label: &str) -> Result<Key> {
    derive_key_hkdf(
        master.as_bytes(),
        salt,
        domain_info(domain_label).as_bytes(),
    )
}

/// Derive arbitrary bytes for a shell-related domain.
pub fn derive_domain_bytes(
    master: &Key,
    salt: Option<&[u8]>,
    domain_label: &str,
    len: usize,
) -> Result<Vec<u8>> {
    derive_key_hkdf_raw(
        master.as_bytes(),
        salt,
        domain_info(domain_label).as_bytes(),
        len,
    )
}

/// Derive a per-chunk shell seed from the shell key, nonce, chunk index, and purpose.
pub fn derive_chunk_seed(
    shell_key: &Key,
    nonce: &[u8],
    chunk_index: u32,
    purpose: &str,
    len: usize,
) -> Result<Vec<u8>> {
    let mut info = Vec::new();
    info.extend_from_slice(b"voided:shell:chunk:");
    info.extend_from_slice(purpose.as_bytes());
    info.extend_from_slice(b":");
    info.extend_from_slice(&chunk_index.to_be_bytes());
    derive_key_hkdf_raw(shell_key.as_bytes(), Some(nonce), &info, len)
}

/// Compute a truncated outer tag for shell payloads.
pub fn compute_shell_tag(data: &[u8], tag_key: &Key) -> Result<[u8; SHELL_TAG_SIZE]> {
    let mac = generate_hmac_sha256(data, tag_key.as_bytes())?;
    let mut tag = [0u8; SHELL_TAG_SIZE];
    tag.copy_from_slice(&mac[..SHELL_TAG_SIZE]);
    Ok(tag)
}

fn compute_shell_tag_parts(parts: &[&[u8]], tag_key: &Key) -> Result<[u8; SHELL_TAG_SIZE]> {
    let mac = generate_hmac_sha256_parts(parts, tag_key.as_bytes())?;
    let mut tag = [0u8; SHELL_TAG_SIZE];
    tag.copy_from_slice(&mac[..SHELL_TAG_SIZE]);
    Ok(tag)
}

/// Verify a truncated shell tag in constant time.
pub fn verify_shell_tag(data: &[u8], tag: &[u8], tag_key: &Key) -> Result<bool> {
    if tag.len() != SHELL_TAG_SIZE {
        return Ok(false);
    }
    let expected = compute_shell_tag(data, tag_key)?;
    Ok(compare_hashes(&expected, tag))
}

/// Apply the fused shell primitive to arbitrary bytes.
pub fn fuse(
    data: &[u8],
    master_key: &Key,
    options: Option<FusedShellOptions>,
) -> Result<FusedShellEnvelope> {
    let opts = options.unwrap_or_default();
    let nonce = opts.shell_nonce.unwrap_or_else(random_nonce);
    let (shell_key, tag_key) = derive_shell_keys(master_key, &nonce)?;
    let (payload, chunk_size) =
        field_monolith_encode_payload(data, &shell_key, &nonce, opts.chunk_size)?;

    let mut envelope = FusedShellEnvelope {
        version: FUSED_SHELL_VERSION,
        preset: opts.preset,
        chunk_size: chunk_size as u32,
        nonce,
        payload,
        tag: [0u8; SHELL_TAG_SIZE],
    };
    envelope.tag = compute_shell_tag(&envelope.to_unsigned_bytes(), &tag_key)?;
    Ok(envelope)
}

/// Invert the fused shell primitive.
pub fn unfuse(envelope: &FusedShellEnvelope, master_key: &Key) -> Result<Vec<u8>> {
    let (shell_key, tag_key) = derive_shell_keys(master_key, &envelope.nonce)?;
    if !verify_shell_tag(&envelope.to_unsigned_bytes(), &envelope.tag, &tag_key)? {
        return Err(Error::AuthenticationFailed);
    }

    match envelope.version {
        FUSED_SHELL_VERSION => field_monolith_decode_payload(
            &envelope.payload,
            &shell_key,
            &envelope.nonce,
            envelope.chunk_size.max(1) as usize,
        ),
        FUSED_SHELL_V1_VERSION => transform_payload_v1(
            &envelope.payload,
            &shell_key,
            &envelope.nonce,
            envelope.preset,
            envelope.chunk_size.max(1) as usize,
            false,
        ),
        version => Err(Error::UnsupportedVersion(version)),
    }
}

/// Serialize a fused shell envelope directly.
pub fn fuse_bytes(
    data: &[u8],
    master_key: &Key,
    options: Option<FusedShellOptions>,
) -> Result<Vec<u8>> {
    Ok(fuse(data, master_key, options)?.to_bytes())
}

/// Parse and invert a serialized fused shell envelope.
pub fn unfuse_bytes(data: &[u8], master_key: &Key) -> Result<Vec<u8>> {
    unfuse(&FusedShellEnvelope::from_bytes(data)?, master_key)
}

/// Inspect a serialized fused shell envelope without a key.
pub fn inspect_fused(data: &[u8]) -> Result<FusedShellInfo> {
    Ok(parse_fused_shell_header(data)?.info(data.len()))
}

#[cfg(feature = "compression")]
/// Run the Voided 1.0 whole-monolith full flow.
pub fn protect(
    plaintext: &[u8],
    master_key: &Key,
    options: Option<ProtectOptions>,
) -> Result<ProtectResult> {
    let opts = options.unwrap_or_default();
    whole_monolith_v0_protect(plaintext, master_key, opts)
}

#[cfg(feature = "compression")]
/// Open a serialized current VOF3 whole-monolith artifact.
pub fn open(artifact: &[u8], master_key: &Key) -> Result<Vec<u8>> {
    whole_monolith_v0_open(artifact, master_key)
}

#[cfg(feature = "compression")]
/// Open either the current VOF3 artifact or an explicit legacy VOF2 rotation artifact.
pub fn open_rotation_artifact(artifact: &[u8], master_key: &Key) -> Result<Vec<u8>> {
    if artifact_starts_with_protected_magic(artifact) {
        open_legacy_protected_artifact(artifact, master_key)
    } else {
        open(artifact, master_key)
    }
}

#[cfg(feature = "compression")]
fn open_legacy_protected_artifact(artifact: &[u8], master_key: &Key) -> Result<Vec<u8>> {
    let envelope = ProtectedArtifactEnvelope::from_bytes(artifact)?;
    let (shell_key, tag_key) = derive_shell_keys(master_key, &envelope.nonce)?;
    if !verify_shell_tag(&envelope.to_unsigned_bytes(), &envelope.tag, &tag_key)? {
        return Err(Error::AuthenticationFailed);
    }

    let original_size = protected_artifact_size(envelope.original_size, "original size")?;
    let compressed_size = protected_artifact_size(envelope.compressed_size, "compressed size")?;

    let encrypted_bytes = match envelope.version {
        PROTECTED_ARTIFACT_VERSION => protected_monolith_decode_payload(
            &envelope.payload,
            &shell_key,
            &envelope.nonce,
            envelope.chunk_size.max(1) as usize,
            ProtectedMonolithContext {
                preset: envelope.preset,
                compression_algorithm: envelope.compression_algorithm,
                encryption_algorithm: envelope.encryption_algorithm,
                original_len: original_size,
                compressed_len: compressed_size,
            },
        )?,
        PROTECTED_ARTIFACT_V2_VERSION => field_monolith_decode_payload(
            &envelope.payload,
            &shell_key,
            &envelope.nonce,
            envelope.chunk_size.max(1) as usize,
        )?,
        PROTECTED_ARTIFACT_V1_VERSION => transform_payload_v1(
            &envelope.payload,
            &shell_key,
            &envelope.nonce,
            envelope.preset,
            envelope.chunk_size.max(1) as usize,
            false,
        )?,
        version => return Err(Error::UnsupportedVersion(version)),
    };
    let encrypted = EncryptionResult::from_bytes(&encrypted_bytes)?;
    if encrypted.algorithm != envelope.encryption_algorithm {
        return Err(Error::InvalidFormat);
    }

    let compressed = crate::encryption::decrypt(&encrypted, master_key)?;
    if compressed.len() != compressed_size {
        return Err(Error::SizeMismatch {
            expected: compressed_size,
            actual: compressed.len(),
        });
    }

    let plaintext =
        compression::decompress_exact(&compressed, envelope.compression_algorithm, original_size)?;

    Ok(plaintext)
}

#[cfg(feature = "compression")]
/// Inspect a current VOF3 artifact without decrypting it.
pub fn inspect_artifact(artifact: &[u8]) -> Result<ProtectedArtifactInfo> {
    whole_monolith_v0_inspect_artifact(artifact)
}

#[cfg(feature = "compression")]
/// Inspect either the current VOF3 artifact or an explicit legacy VOF2 rotation artifact.
pub fn inspect_rotation_artifact(artifact: &[u8]) -> Result<ProtectedArtifactInfo> {
    if artifact_starts_with_protected_magic(artifact) {
        parse_protected_artifact_header(artifact)?.info(artifact.len())
    } else {
        inspect_artifact(artifact)
    }
}

#[cfg(feature = "compression")]
/// Repack a current VOF3 monolith artifact under a new full-flow configuration.
pub fn repack_artifact(
    artifact: &[u8],
    master_key: &Key,
    options: Option<ProtectOptions>,
) -> Result<ProtectResult> {
    let plaintext = open(artifact, master_key)?;
    protect(&plaintext, master_key, options)
}

fn derive_shell_keys(master_key: &Key, nonce: &[u8; SHELL_NONCE_SIZE]) -> Result<(Key, Key)> {
    let shell_key = derive_domain_key(master_key, Some(nonce), "fused-shell")?;
    let tag_key = derive_domain_key(master_key, Some(nonce), "fused-tag")?;
    Ok((shell_key, tag_key))
}

fn is_supported_fused_shell_version(version: u8) -> bool {
    matches!(version, FUSED_SHELL_V1_VERSION | FUSED_SHELL_VERSION)
}

#[cfg(feature = "compression")]
fn is_supported_protected_artifact_version(version: u8) -> bool {
    matches!(
        version,
        PROTECTED_ARTIFACT_V1_VERSION | PROTECTED_ARTIFACT_V2_VERSION | PROTECTED_ARTIFACT_VERSION
    )
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum FieldMonolithMutationMode {
    Direct = 0,
    StrideSwap = 1,
    SplitWeave = 2,
    MirrorWeave = 3,
}

impl FieldMonolithMutationMode {
    fn from_bits(bits: u8) -> Self {
        match bits & 0x03 {
            0 => Self::Direct,
            1 => Self::StrideSwap,
            2 => Self::SplitWeave,
            _ => Self::MirrorWeave,
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum FieldMonolithWeaveMode {
    LeadPad = 0,
    TrailPad = 1,
    Alternating = 2,
    Clustered = 3,
}

impl FieldMonolithWeaveMode {
    fn from_bits(bits: u8) -> Self {
        match bits & 0x03 {
            0 => Self::LeadPad,
            1 => Self::TrailPad,
            2 => Self::Alternating,
            _ => Self::Clustered,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct FieldMonolithState {
    phase: u8,
    tension: u8,
    curvature: u8,
    drift: u8,
    echo: u8,
    reserve: u8,
    stride: u8,
    parity: u8,
}

#[derive(Debug, Clone, Copy)]
struct FieldMonolithCellPlan {
    mutation: FieldMonolithMutationMode,
    weave: FieldMonolithWeaveMode,
    stride: usize,
    pad_len: usize,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
struct FieldMonolithSurfaceSummary {
    digest: u8,
    front: u8,
    back: u8,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
struct FieldMonolithGeometry {
    original_len: usize,
    chunk_count: usize,
    block_cells: usize,
}

fn field_monolith_encode_payload(
    data: &[u8],
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    requested_chunk_size: Option<usize>,
) -> Result<(Vec<u8>, usize)> {
    let target_cell_size =
        resolve_field_monolith_current_cell_size(requested_chunk_size, data.len())?;
    let state = field_monolith_initial_state(shell_key, nonce, data.len())?;
    let rng = field_monolith_plan_rng(shell_key, nonce, data.len())?;
    let payload = field_monolith_encode_payload_with_state(data, target_cell_size, state, rng);

    Ok((payload, target_cell_size))
}

fn field_monolith_encode_payload_with_state(
    data: &[u8],
    target_cell_size: usize,
    mut state: FieldMonolithState,
    mut rng: DeterministicRng,
) -> Vec<u8> {
    let chunk_count = chunk_count(data.len(), target_cell_size.max(1));
    let block_cells = field_monolith_current_anchor_block_cells(target_cell_size, chunk_count);
    let block_count = field_monolith_block_count_for_cells(chunk_count, block_cells);
    let mut payload = Vec::with_capacity(data.len().saturating_add(block_count));
    let mut cursor = 0usize;
    let mut cell_index = 0u32;
    let mut block_index = 0u32;
    let mut surface = Vec::with_capacity(target_cell_size);
    let mut mutation_scratch = Vec::with_capacity(target_cell_size);

    while cursor < data.len() {
        let anchor = field_monolith_current_anchor_for_block(
            &state,
            block_index,
            &mut rng,
            target_cell_size,
        );
        payload.push(anchor);

        for ordinal_in_block in 0..block_cells {
            if cursor >= data.len() {
                break;
            }
            let remaining = data.len() - cursor;
            let cell_len = remaining.min(target_cell_size.max(1));
            let next_cursor = cursor + cell_len;
            let plaintext = &data[cursor..next_cursor];
            let plan =
                field_monolith_plan_for_anchor_cell(anchor, cell_index, cell_len, ordinal_in_block);
            let descriptor = field_monolith_descriptor(plan);
            let mask_lanes = field_monolith_mask_lanes(&state, cell_index, plan.stride);
            surface.clear();
            surface.extend_from_slice(plaintext);
            field_monolith_xor_masked_bytes_in_place(&mut surface, &mask_lanes);
            field_monolith_apply_mutation_in_place(
                &mut surface,
                plan.mutation,
                plan.stride,
                &mut mutation_scratch,
            );
            field_monolith_apply_virtual_permutation(&mut surface, &state, plan, cell_index);
            let summary = field_monolith_apply_virtual_mix_with_summary(
                &mut surface,
                &state,
                plan,
                cell_index,
                descriptor,
            );

            payload.extend_from_slice(&surface);
            field_monolith_update_state_with_summary(
                &mut state, descriptor, summary, cell_index, cell_len,
            );
            cursor = next_cursor;
            cell_index = cell_index.wrapping_add(1);
        }

        block_index = block_index.wrapping_add(1);
    }

    payload
}

fn field_monolith_decode_payload(
    payload: &[u8],
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    target_cell_size: usize,
) -> Result<Vec<u8>> {
    let geometry = validate_current_field_monolith_geometry(
        payload.len(),
        target_cell_size,
        FIELD_MONOLITH_MAX_CELL_BYTES,
        "field monolith",
    )?;
    let state = field_monolith_initial_state(shell_key, nonce, geometry.original_len)?;
    field_monolith_decode_payload_with_state_and_geometry(
        payload,
        target_cell_size,
        state,
        geometry,
    )
}

fn field_monolith_decode_payload_with_state_and_geometry(
    payload: &[u8],
    target_cell_size: usize,
    mut state: FieldMonolithState,
    geometry: FieldMonolithGeometry,
) -> Result<Vec<u8>> {
    let target_cell_size = target_cell_size.max(1);
    let mut output = Vec::with_capacity(geometry.original_len);
    let mut cursor = 0usize;
    let mut cell_index = 0usize;
    let mut mutation_scratch = Vec::with_capacity(target_cell_size);

    while cell_index < geometry.chunk_count {
        if cursor + 1 > payload.len() {
            return Err(Error::TruncatedPayload {
                expected: cursor + 1,
                actual: payload.len(),
            });
        }
        let anchor = payload[cursor];
        cursor += 1;

        for ordinal_in_block in 0..geometry.block_cells {
            if cell_index >= geometry.chunk_count {
                break;
            }
            let original_len = if cell_index + 1 < geometry.chunk_count {
                target_cell_size
            } else {
                let consumed_before_last = target_cell_size
                    .checked_mul(geometry.chunk_count.saturating_sub(1))
                    .ok_or_else(|| {
                        Error::InvalidConfiguration(
                            "field monolith current consumed length overflowed".to_string(),
                        )
                    })?;
                geometry
                    .original_len
                    .checked_sub(consumed_before_last)
                    .ok_or_else(|| {
                        Error::InvalidConfiguration(
                            "field monolith current last cell underflowed".to_string(),
                        )
                    })?
            };
            let next_cursor = cursor.checked_add(original_len).ok_or_else(|| {
                Error::InvalidConfiguration("field monolith current cursor overflowed".to_string())
            })?;
            if next_cursor > payload.len() {
                return Err(Error::TruncatedPayload {
                    expected: next_cursor,
                    actual: payload.len(),
                });
            }
            let surface = &payload[cursor..next_cursor];
            let plan = field_monolith_plan_for_anchor_cell(
                anchor,
                cell_index as u32,
                original_len,
                ordinal_in_block,
            );
            let descriptor = field_monolith_descriptor(plan);
            let summary = field_monolith_decode_surface_with_summary_append(
                surface,
                &state,
                plan,
                cell_index as u32,
                descriptor,
                &mut output,
                &mut mutation_scratch,
            );
            field_monolith_update_state_with_summary(
                &mut state,
                descriptor,
                summary,
                cell_index as u32,
                original_len,
            );
            cursor = next_cursor;
            cell_index += 1;
        }
    }

    if cursor != payload.len() {
        return Err(Error::InvalidConfiguration(
            "payload cursor did not end on field monolith current block boundary".to_string(),
        ));
    }

    Ok(output)
}

#[cfg(feature = "compression")]
#[derive(Debug, Clone, Copy)]
struct ProtectedMonolithPlan {
    preset: FusedPreset,
    compression_algorithm: CompressionAlgorithm,
    encryption_algorithm: EncryptionAlgorithm,
    original_len: usize,
    compressed_len: usize,
    encrypted_len: usize,
    target_cell_size: usize,
}

#[cfg(feature = "compression")]
#[derive(Debug, Clone, Copy)]
struct ProtectedMonolithContext {
    preset: FusedPreset,
    compression_algorithm: CompressionAlgorithm,
    encryption_algorithm: EncryptionAlgorithm,
    original_len: usize,
    compressed_len: usize,
}

#[cfg(feature = "compression")]
fn protected_monolith_encode_payload(
    encrypted_bytes: &[u8],
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    requested_chunk_size: Option<usize>,
    context: ProtectedMonolithContext,
) -> Result<(Vec<u8>, usize)> {
    let target_cell_size =
        resolve_protected_monolith_cell_size(requested_chunk_size, encrypted_bytes.len())?;
    let plan = ProtectedMonolithPlan {
        preset: context.preset,
        compression_algorithm: context.compression_algorithm,
        encryption_algorithm: context.encryption_algorithm,
        original_len: context.original_len,
        compressed_len: context.compressed_len,
        encrypted_len: encrypted_bytes.len(),
        target_cell_size,
    };
    let state = protected_monolith_initial_state(shell_key, nonce, plan)?;
    let rng = field_monolith_plan_rng(shell_key, nonce, encrypted_bytes.len())?;
    let payload =
        field_monolith_encode_payload_with_state(encrypted_bytes, target_cell_size, state, rng);

    Ok((payload, target_cell_size))
}

#[cfg(feature = "compression")]
fn protected_monolith_decode_payload(
    payload: &[u8],
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    target_cell_size: usize,
    context: ProtectedMonolithContext,
) -> Result<Vec<u8>> {
    let geometry = validate_current_field_monolith_geometry(
        payload.len(),
        target_cell_size,
        PROTECTED_MONOLITH_MAX_CELL_BYTES,
        "protected monolith",
    )?;
    let plan = ProtectedMonolithPlan {
        preset: context.preset,
        compression_algorithm: context.compression_algorithm,
        encryption_algorithm: context.encryption_algorithm,
        original_len: context.original_len,
        compressed_len: context.compressed_len,
        encrypted_len: geometry.original_len,
        target_cell_size,
    };
    let state = protected_monolith_initial_state(shell_key, nonce, plan)?;
    let decoded = field_monolith_decode_payload_with_state_and_geometry(
        payload,
        target_cell_size,
        state,
        geometry,
    )?;
    if decoded.len() != geometry.original_len {
        return Err(Error::SizeMismatch {
            expected: geometry.original_len,
            actual: decoded.len(),
        });
    }
    Ok(decoded)
}

#[cfg(feature = "compression")]
fn resolve_protected_monolith_cell_size(
    requested: Option<usize>,
    encrypted_len: usize,
) -> Result<usize> {
    if requested.is_some() {
        return resolve_field_monolith_current_cell_size(requested, encrypted_len);
    }

    let target = if encrypted_len <= FIELD_MONOLITH_CURRENT_AUTO_TINY_MAX {
        FIELD_MONOLITH_AUTO_TINY_CELL_BYTES
    } else if encrypted_len <= FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_SMALL_MAX {
        FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_SMALL_CELL_BYTES
    } else {
        PROTECTED_MONOLITH_MAX_CELL_BYTES
    };

    Ok(if encrypted_len == 0 {
        target
    } else {
        target.min(encrypted_len)
    })
}

#[cfg(feature = "compression")]
fn protected_monolith_ratio_bucket(numerator: usize, denominator: usize) -> u8 {
    if denominator == 0 {
        return 0;
    }
    numerator
        .saturating_mul(u8::MAX as usize)
        .checked_div(denominator)
        .unwrap_or(0)
        .min(u8::MAX as usize) as u8
}

#[cfg(feature = "compression")]
fn protected_monolith_initial_state(
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    plan: ProtectedMonolithPlan,
) -> Result<FieldMonolithState> {
    let mut state = field_monolith_initial_state(shell_key, nonce, plan.encrypted_len)?;
    let seed = derive_chunk_seed(shell_key, nonce, 0, PROTECTED_MONOLITH_STATE_PURPOSE, 32)?;
    let target_cell_size = (plan.target_cell_size as u16).to_le_bytes();
    let compressed_ratio = protected_monolith_ratio_bucket(plan.compressed_len, plan.original_len);
    let encrypted_overhead_ratio = protected_monolith_ratio_bucket(
        plan.encrypted_len.saturating_sub(plan.compressed_len),
        plan.compressed_len.max(1),
    );

    state.phase = (state.phase ^ seed[0] ^ (plan.preset as u8).rotate_left(1)) | 1;
    state.tension ^= seed[1].rotate_right(1) ^ plan.compression_algorithm as u8;
    state.curvature ^= seed[2].rotate_left(2) ^ plan.encryption_algorithm as u8;
    state.drift ^= seed[3].rotate_right(2) ^ target_cell_size[0];
    state.echo ^= seed[4].rotate_left(3) ^ compressed_ratio;
    state.reserve ^= seed[5].rotate_right(3) ^ encrypted_overhead_ratio;
    state.stride = (state.stride ^ ((seed[6] ^ target_cell_size[0]) & 0x0F)).max(1);
    state.parity ^= seed[7] ^ target_cell_size[1];

    Ok(state)
}

#[cfg(feature = "compression")]
#[derive(Debug, Clone, Copy)]
struct WholeMonolithV0Header {
    preset: FusedPreset,
    compression_algorithm: CompressionAlgorithm,
    encryption_algorithm: EncryptionAlgorithm,
    shell_cell_size: usize,
    original_size: usize,
    compressed_size: usize,
    shell_nonce: [u8; SHELL_NONCE_SIZE],
}

#[cfg(feature = "compression")]
impl WholeMonolithV0Header {
    fn to_bytes(self) -> [u8; WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN] {
        let mut bytes = [0u8; WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN];
        bytes[0] = PROTECTED_ARTIFACT_VERSION;
        bytes[1] = self.preset as u8;
        bytes[2] = self.compression_algorithm as u8;
        bytes[3] = self.encryption_algorithm as u8;
        bytes[4..6].copy_from_slice(&(self.shell_cell_size as u16).to_be_bytes());
        bytes[6..14].copy_from_slice(&(self.original_size as u64).to_be_bytes());
        bytes[14..22].copy_from_slice(&(self.compressed_size as u64).to_be_bytes());
        bytes[22..34].copy_from_slice(&self.shell_nonce);
        bytes
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN {
            return Err(Error::TruncatedPayload {
                expected: WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN,
                actual: bytes.len(),
            });
        }

        if bytes[0] != PROTECTED_ARTIFACT_VERSION {
            return Err(Error::UnsupportedVersion(bytes[0]));
        }

        let preset = FusedPreset::from_byte(bytes[1])?;
        let compression_algorithm = CompressionAlgorithm::from_byte(bytes[2])?;
        let encryption_algorithm = EncryptionAlgorithm::from_byte(bytes[3])?;
        let shell_cell_size = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
        let original_size = whole_monolith_v0_read_u64_usize(&bytes[6..14], "original size")?;
        let compressed_size = whole_monolith_v0_read_u64_usize(&bytes[14..22], "compressed size")?;
        let mut shell_nonce = [0u8; SHELL_NONCE_SIZE];
        shell_nonce.copy_from_slice(&bytes[22..34]);

        Ok(Self {
            preset,
            compression_algorithm,
            encryption_algorithm,
            shell_cell_size,
            original_size,
            compressed_size,
            shell_nonce,
        })
    }

    fn info(self, protected_size: usize) -> Result<ProtectedArtifactInfo> {
        let geometry = whole_monolith_v0_geometry(&self, protected_size)?;
        let encrypted_size = geometry.original_len;
        let shell_chunk_count = geometry.chunk_count;
        Ok(ProtectedArtifactInfo {
            version: PROTECTED_ARTIFACT_VERSION,
            preset: self.preset,
            preset_label: self.preset.name().to_string(),
            compression_algorithm: self.compression_algorithm,
            encryption_algorithm: self.encryption_algorithm,
            original_size: self.original_size,
            compressed_size: self.compressed_size,
            encrypted_size,
            protected_size,
            shell_chunk_size: self.shell_cell_size as u32,
            shell_chunk_count,
            shell_nonce: self.shell_nonce,
        })
    }
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_geometry(
    header: &WholeMonolithV0Header,
    protected_size: usize,
) -> Result<FieldMonolithGeometry> {
    let payload_len = protected_size
        .saturating_sub(WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES)
        .saturating_sub(WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN)
        .saturating_sub(SHELL_TAG_SIZE);
    validate_current_field_monolith_geometry(
        payload_len,
        header.shell_cell_size,
        PROTECTED_MONOLITH_MAX_CELL_BYTES,
        "whole monolith",
    )
}

#[cfg(feature = "compression")]
fn artifact_starts_with_protected_magic(artifact: &[u8]) -> bool {
    artifact.len() >= PROTECTED_ARTIFACT_MAGIC.len()
        && artifact[..PROTECTED_ARTIFACT_MAGIC.len()] == PROTECTED_ARTIFACT_MAGIC
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_protect(
    plaintext: &[u8],
    master_key: &Key,
    opts: ProtectOptions,
) -> Result<ProtectResult> {
    let shell_nonce = opts.shell_nonce.unwrap_or_else(random_nonce);
    let public_seed = [shell_nonce[0], shell_nonce[1]];
    let (shell_key, tag_key) = derive_shell_keys(master_key, &shell_nonce)?;
    let cloak = whole_monolith_v0_initial_material(master_key, &shell_nonce)?;
    let encryption_algorithm = opts
        .encryption_algorithm
        .unwrap_or(EncryptionAlgorithm::XChaCha20Poly1305);
    if opts.shell_chunk_size.unwrap_or(0) > MAX_CHUNK_SIZE {
        return Err(Error::InvalidConfiguration(format!(
            "shell chunk size must be at most {MAX_CHUNK_SIZE} bytes"
        )));
    }

    let compressed = compression::compress(
        plaintext,
        Some(CompressionOptions {
            algorithm: opts.compression_algorithm,
            min_size_threshold: opts.compression_min_size_threshold,
            level: opts.compression_level,
        }),
    )?;
    let encrypted = crate::encryption::encrypt(
        &compressed.compressed,
        master_key,
        Some(crate::encryption::EncryptOptions {
            algorithm: Some(encryption_algorithm),
            aad: None,
        }),
    )?;
    let encrypted_bytes = encrypted.to_bytes();
    let (mut body, shell_cell_size) = protected_monolith_encode_payload(
        &encrypted_bytes,
        &shell_key,
        &shell_nonce,
        opts.shell_chunk_size,
        ProtectedMonolithContext {
            preset: opts.preset,
            compression_algorithm: compressed.algorithm,
            encryption_algorithm: encrypted.algorithm,
            original_len: plaintext.len(),
            compressed_len: compressed.compressed.len(),
        },
    )?;

    let header = WholeMonolithV0Header {
        preset: opts.preset,
        compression_algorithm: compressed.algorithm,
        encryption_algorithm: encrypted.algorithm,
        shell_cell_size,
        original_size: plaintext.len(),
        compressed_size: compressed.compressed.len(),
        shell_nonce,
    };
    let header_bytes = header.to_bytes();
    let tag = compute_shell_tag_parts(&[&header_bytes[..], body.as_slice()], &tag_key)?;

    body.extend_from_slice(&tag);
    whole_monolith_v0_apply_cloak(&mut body, &cloak);

    let mut masked_header = header_bytes;
    whole_monolith_v0_mask_public_header(&public_seed, &mut masked_header);

    let mut artifact =
        Vec::with_capacity(WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES + masked_header.len() + body.len());
    artifact.extend_from_slice(&public_seed);
    artifact.extend_from_slice(&masked_header);
    artifact.extend_from_slice(&body);

    let info = header.info(artifact.len())?;
    Ok(ProtectResult { artifact, info })
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_open(artifact: &[u8], master_key: &Key) -> Result<Vec<u8>> {
    let (header, header_bytes, body_and_tag) = whole_monolith_v0_split_artifact(artifact)?;
    let (shell_key, tag_key) = derive_shell_keys(master_key, &header.shell_nonce)?;
    let cloak = whole_monolith_v0_initial_material(master_key, &header.shell_nonce)?;
    let mut uncloaked = body_and_tag.to_vec();
    whole_monolith_v0_apply_cloak(&mut uncloaked, &cloak);

    if uncloaked.len() < SHELL_TAG_SIZE {
        return Err(Error::TruncatedPayload {
            expected: SHELL_TAG_SIZE,
            actual: uncloaked.len(),
        });
    }
    let tag_start = uncloaked.len() - SHELL_TAG_SIZE;
    let (body, tag) = uncloaked.split_at(tag_start);
    let expected_tag = compute_shell_tag_parts(&[&header_bytes[..], body], &tag_key)?;
    if !compare_hashes(&expected_tag, tag) {
        return Err(Error::AuthenticationFailed);
    }

    let encrypted_bytes = protected_monolith_decode_payload(
        body,
        &shell_key,
        &header.shell_nonce,
        header.shell_cell_size.max(1),
        ProtectedMonolithContext {
            preset: header.preset,
            compression_algorithm: header.compression_algorithm,
            encryption_algorithm: header.encryption_algorithm,
            original_len: header.original_size,
            compressed_len: header.compressed_size,
        },
    )?;
    let encrypted = EncryptionResult::from_bytes(&encrypted_bytes)?;
    if encrypted.algorithm != header.encryption_algorithm {
        return Err(Error::InvalidFormat);
    }
    let compressed = crate::encryption::decrypt(&encrypted, master_key)?;
    if compressed.len() != header.compressed_size {
        return Err(Error::SizeMismatch {
            expected: header.compressed_size,
            actual: compressed.len(),
        });
    }
    let output = compression::decompress_exact(
        &compressed,
        header.compression_algorithm,
        header.original_size,
    )?;

    Ok(output)
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_inspect_artifact(artifact: &[u8]) -> Result<ProtectedArtifactInfo> {
    let (header, _, _) = whole_monolith_v0_split_artifact(artifact)?;
    header.info(artifact.len())
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_split_artifact(
    artifact: &[u8],
) -> Result<(
    WholeMonolithV0Header,
    [u8; WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN],
    &[u8],
)> {
    if artifact.len() < WHOLE_MONOLITH_V0_MIN_ARTIFACT_LEN {
        return Err(Error::TruncatedPayload {
            expected: WHOLE_MONOLITH_V0_MIN_ARTIFACT_LEN,
            actual: artifact.len(),
        });
    }

    let mut public_seed = [0u8; WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES];
    public_seed.copy_from_slice(&artifact[..WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES]);
    let header_start = WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES;
    let header_end = header_start + WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN;
    let mut header_bytes = [0u8; WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN];
    header_bytes.copy_from_slice(&artifact[header_start..header_end]);
    whole_monolith_v0_mask_public_header(&public_seed, &mut header_bytes);
    let header = WholeMonolithV0Header::from_bytes(&header_bytes)?;
    // Validate attacker-controlled geometry before any caller clones or decodes
    // the body. The inversion is constant work even for one-byte cell headers.
    whole_monolith_v0_geometry(&header, artifact.len())?;

    Ok((header, header_bytes, &artifact[header_end..]))
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_read_u64_usize(bytes: &[u8], label: &str) -> Result<usize> {
    let value = u64::from_be_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]);
    if value > usize::MAX as u64 {
        return Err(Error::InvalidConfiguration(format!(
            "whole monolith {label} exceeds usize range"
        )));
    }
    Ok(value as usize)
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_mask_public_header(
    seed: &[u8; WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES],
    header: &mut [u8],
) {
    for (index, byte) in header.iter_mut().enumerate() {
        *byte ^= whole_monolith_v0_public_mask_byte(seed, index);
    }
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_public_mask_byte(
    seed: &[u8; WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES],
    index: usize,
) -> u8 {
    let mut value = 0x9E37_79B9_7F4A_7C15u64
        ^ u16::from_le_bytes(*seed) as u64
        ^ ((index as u64) << 17)
        ^ ((index as u64).rotate_left(23));
    value ^= value >> 30;
    value = value.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94D0_49BB_1331_11EB);
    (value ^ (value >> 31)) as u8
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_initial_material(
    master_key: &Key,
    artifact_nonce: &[u8; SHELL_NONCE_SIZE],
) -> Result<[u8; 32]> {
    let bytes = derive_domain_bytes(
        master_key,
        Some(artifact_nonce),
        WHOLE_MONOLITH_V0_MATERIAL_DOMAIN,
        64,
    )?;
    let mut cloak = [0u8; 32];
    cloak.copy_from_slice(&bytes[32..]);
    Ok(cloak)
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_apply_cloak(bytes: &mut [u8], cloak: &[u8; 32]) {
    let mut lanes = [0u64; 4];
    for (lane, chunk) in lanes.iter_mut().zip(cloak.chunks_exact(8)) {
        let mut word = [0u8; 8];
        word.copy_from_slice(chunk);
        *lane = u64::from_le_bytes(word);
    }
    if lanes.iter().all(|&lane| lane == 0) {
        lanes = [
            0x6A09_E667_F3BC_C909,
            0xBB67_AE85_84CA_A73B,
            0x3C6E_F372_FE94_F82B,
            0xA54F_F53A_5F1D_36F1,
        ];
    }
    let mut mask_word = 0u64;
    let mut mask_left = 0usize;
    let cloak_len = bytes.len().min(WHOLE_MONOLITH_V0_CLOAK_HEAD_BYTES);
    for byte in &mut bytes[..cloak_len] {
        if mask_left == 0 {
            mask_word = whole_monolith_v0_cloak_next(&mut lanes);
            mask_left = 8;
        }
        *byte ^= mask_word as u8;
        mask_word >>= 8;
        mask_left -= 1;
    }
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_cloak_next(state: &mut [u64; 4]) -> u64 {
    let result = state[0].wrapping_add(state[3]);
    let t = state[1] << 17;
    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= t;
    state[3] = state[3].rotate_left(45);
    result
}

fn resolve_field_monolith_current_cell_size(
    requested: Option<usize>,
    payload_len: usize,
) -> Result<usize> {
    let requested = requested.unwrap_or(FIELD_MONOLITH_AUTO_CHUNK_SIZE);
    let target = if requested == FIELD_MONOLITH_AUTO_CHUNK_SIZE {
        field_monolith_current_auto_target_cell_size(payload_len)
    } else {
        if requested > MAX_CHUNK_SIZE {
            return Err(Error::InvalidConfiguration(format!(
                "shell chunk size must be at most {MAX_CHUNK_SIZE} bytes"
            )));
        }
        let min_cell_size = if requested < FIELD_MONOLITH_MIN_CELL_BYTES {
            FIELD_MONOLITH_EXPERIMENTAL_MIN_CELL_BYTES
        } else {
            FIELD_MONOLITH_MIN_CELL_BYTES
        };
        requested.clamp(min_cell_size, FIELD_MONOLITH_MAX_CELL_BYTES)
    };

    Ok(if payload_len == 0 {
        target
    } else {
        target.min(payload_len)
    })
}

fn field_monolith_current_auto_target_cell_size(payload_len: usize) -> usize {
    if payload_len <= FIELD_MONOLITH_CURRENT_AUTO_TINY_MAX {
        FIELD_MONOLITH_AUTO_TINY_CELL_BYTES
    } else if payload_len <= FIELD_MONOLITH_CURRENT_AUTO_DENSE_SMALL_MAX {
        FIELD_MONOLITH_CURRENT_AUTO_DENSE_SMALL_CELL_BYTES
    } else if payload_len <= FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_SMALL_MAX {
        FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_SMALL_CELL_BYTES
    } else if payload_len <= FIELD_MONOLITH_AUTO_SMALL_MAX {
        FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_UPPER_SMALL_CELL_BYTES
    } else if payload_len <= FIELD_MONOLITH_AUTO_MID_MAX {
        FIELD_MONOLITH_AUTO_MID_CELL_BYTES
    } else {
        FIELD_MONOLITH_MAX_CELL_BYTES
    }
}

fn field_monolith_infer_geometry(
    payload_len: usize,
    target_cell_size: usize,
) -> Option<FieldMonolithGeometry> {
    if target_cell_size == 0 {
        return None;
    }
    if payload_len == 0 {
        return Some(FieldMonolithGeometry {
            original_len: 0,
            chunk_count: 0,
            block_cells: field_monolith_current_anchor_block_cells(target_cell_size, 0),
        });
    }

    // A block contains at most `target_cell_size * block_cells` original bytes
    // plus one anchor byte. Therefore, for a valid payload, its anchor count is
    // exactly ceil(payload_len / (target_cell_size * block_cells + 1)). Once
    // that count is known, both the original length and cell count are direct.
    // Trying the only two possible block widths keeps inversion O(1), including
    // the special 256-byte geometry whose width changes after four cells.
    [
        FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE,
        FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT,
    ]
    .into_iter()
    .find_map(|block_cells| {
        field_monolith_geometry_for_block_cells(payload_len, target_cell_size, block_cells)
    })
}

fn field_monolith_geometry_for_block_cells(
    payload_len: usize,
    target_cell_size: usize,
    block_cells: usize,
) -> Option<FieldMonolithGeometry> {
    let encoded_block_span = target_cell_size.checked_mul(block_cells)?.checked_add(1)?;
    let block_count = payload_len.div_ceil(encoded_block_span);
    let original_len = payload_len.checked_sub(block_count)?;
    if original_len == 0 {
        return None;
    }

    let chunk_count = original_len.div_ceil(target_cell_size);
    if field_monolith_current_anchor_block_cells(target_cell_size, chunk_count) != block_cells
        || field_monolith_block_count_for_cells(chunk_count, block_cells) != block_count
    {
        return None;
    }

    Some(FieldMonolithGeometry {
        original_len,
        chunk_count,
        block_cells,
    })
}

fn validate_current_field_monolith_geometry(
    payload_len: usize,
    target_cell_size: usize,
    max_cell_size: usize,
    label: &str,
) -> Result<FieldMonolithGeometry> {
    let geometry =
        field_monolith_infer_geometry(payload_len, target_cell_size).ok_or_else(|| {
            Error::InvalidConfiguration(format!("{label} payload geometry is invalid"))
        })?;

    // Current encoders clamp cells below eight bytes to eight, except when the
    // entire non-empty input is itself shorter. They also store the shortened
    // input length rather than a cell size larger than the input. Enforcing the
    // same canonical form rejects attacker-selected one-byte cells over large
    // payloads while preserving every geometry the encoder can emit.
    let canonical = if geometry.original_len == 0 {
        (FIELD_MONOLITH_EXPERIMENTAL_MIN_CELL_BYTES..=max_cell_size).contains(&target_cell_size)
    } else if geometry.original_len < FIELD_MONOLITH_EXPERIMENTAL_MIN_CELL_BYTES {
        target_cell_size == geometry.original_len
    } else {
        (FIELD_MONOLITH_EXPERIMENTAL_MIN_CELL_BYTES..=max_cell_size).contains(&target_cell_size)
            && target_cell_size <= geometry.original_len
    };
    if !canonical {
        return Err(Error::InvalidConfiguration(format!(
            "{label} cell size {target_cell_size} is noncanonical for {} decoded bytes",
            geometry.original_len
        )));
    }

    Ok(geometry)
}

fn validate_legacy_shell_chunk_size(chunk_size: usize, label: &str) -> Result<()> {
    if !(1..=MAX_CHUNK_SIZE).contains(&chunk_size) {
        return Err(Error::InvalidConfiguration(format!(
            "{label} chunk size must be between 1 and {MAX_CHUNK_SIZE} bytes"
        )));
    }
    Ok(())
}

fn field_monolith_block_count_for_cells(chunk_count: usize, block_cells: usize) -> usize {
    if chunk_count == 0 {
        0
    } else {
        1 + (chunk_count - 1) / block_cells.max(1)
    }
}

fn field_monolith_anchor_block_cells(target_cell_size: usize) -> usize {
    if target_cell_size.max(1) <= FIELD_MONOLITH_DENSE_ANCHOR_MAX_CELL_BYTES {
        FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE
    } else {
        FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT
    }
}

fn field_monolith_current_anchor_block_cells(target_cell_size: usize, chunk_count: usize) -> usize {
    if target_cell_size == FIELD_MONOLITH_AUTO_MID_CELL_BYTES
        && chunk_count > FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT
    {
        FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT
    } else {
        field_monolith_anchor_block_cells(target_cell_size)
    }
}

fn field_monolith_initial_state(
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    total_len: usize,
) -> Result<FieldMonolithState> {
    let seed = derive_chunk_seed(shell_key, nonce, 0, FIELD_MONOLITH_STATE_PURPOSE, 32)?;
    let len_mix = (total_len as u64).to_le_bytes();
    Ok(FieldMonolithState {
        phase: (seed[0] ^ seed[8].rotate_left(1) ^ len_mix[0]) | 1,
        tension: seed[1] ^ seed[9].rotate_right(1) ^ len_mix[1],
        curvature: seed[2] ^ seed[10].rotate_left(2) ^ len_mix[2],
        drift: seed[3] ^ seed[11].rotate_right(2) ^ len_mix[3],
        echo: seed[4] ^ seed[12].rotate_left(3) ^ len_mix[4],
        reserve: seed[5] ^ seed[13].rotate_right(3) ^ len_mix[5],
        stride: ((seed[6] ^ seed[14] ^ len_mix[6]) & 0x0F).max(1),
        parity: seed[7] ^ seed[15] ^ len_mix[7],
    })
}

fn field_monolith_plan_rng(
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    total_len: usize,
) -> Result<DeterministicRng> {
    let seed = derive_chunk_seed(shell_key, nonce, 0, FIELD_MONOLITH_PLAN_PURPOSE, 32)?;
    let mut seed_bytes = [0u8; 32];
    seed_bytes.copy_from_slice(&seed[..32]);
    for (index, byte) in (total_len as u64).to_le_bytes().iter().enumerate() {
        seed_bytes[24 + index] ^= *byte;
    }
    Ok(DeterministicRng::from_seed(&seed_bytes))
}

fn field_monolith_cell_band(cell_len: usize) -> usize {
    match cell_len {
        0..=64 => 0,
        65..=96 => 1,
        97..=160 => 2,
        _ => 3,
    }
}

fn field_monolith_anchor_stride_limit(cell_len: usize) -> usize {
    match field_monolith_cell_band(cell_len) {
        0 => 2,
        1 => 3,
        _ => 4,
    }
}

fn field_monolith_anchor_intensity_limit(cell_len: usize) -> usize {
    match field_monolith_cell_band(cell_len) {
        0 => 2,
        1 => 3,
        2 => 4,
        _ => 4,
    }
}

fn field_monolith_anchor_diffused_pad_len(
    anchor: u8,
    cell_index: u32,
    cell_len: usize,
    ordinal_in_block: usize,
) -> usize {
    let regime = (anchor & 0x03) as usize;
    let cadence = ((anchor >> 2) & 0x03) as usize;
    let intensity = ((anchor >> 4) & 0x03) as usize;
    let stride_seed = ((anchor >> 6) & 0x03) as usize;
    let band = field_monolith_cell_band(cell_len);
    let block_cells = field_monolith_anchor_block_cells(cell_len);
    let block_phase = (cell_index as usize / block_cells) + band;
    let selector = regime * 3 + cadence * 5 + intensity * 7 + stride_seed * 11 + block_phase;
    let phase_ordinal = ordinal_in_block % block_cells;

    match field_monolith_anchor_intensity_limit(cell_len) {
        0 | 1 => 0,
        2 => {
            if block_cells > FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT {
                const PATTERNS: [[usize; FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE]; 4] = [
                    [0, 1, 0, 1, 1, 0, 1, 0],
                    [1, 0, 1, 0, 0, 1, 0, 1],
                    [0, 1, 1, 0, 1, 0, 0, 1],
                    [1, 0, 0, 1, 0, 1, 1, 0],
                ];
                PATTERNS[selector % PATTERNS.len()][phase_ordinal]
            } else {
                const PATTERNS: [[usize; FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT]; 2] =
                    [[0, 1, 0, 1], [1, 0, 1, 0]];
                PATTERNS[selector % PATTERNS.len()][phase_ordinal]
            }
        }
        3 => {
            if block_cells > FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT {
                const PATTERNS: [[usize; FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE]; 4] = [
                    [0, 1, 2, 1, 2, 1, 0, 1],
                    [1, 2, 1, 0, 1, 0, 1, 2],
                    [2, 1, 0, 1, 0, 1, 2, 1],
                    [1, 0, 1, 2, 1, 2, 1, 0],
                ];
                PATTERNS[selector % PATTERNS.len()][phase_ordinal]
            } else {
                const PATTERNS: [[usize; FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT]; 4] =
                    [[0, 1, 2, 1], [1, 2, 1, 0], [2, 1, 0, 1], [1, 0, 1, 2]];
                PATTERNS[selector % PATTERNS.len()][phase_ordinal]
            }
        }
        _ => {
            if block_cells > FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT {
                const PATTERNS: [[usize; FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE]; 8] = [
                    [0, 1, 2, 3, 3, 2, 1, 0],
                    [1, 2, 3, 0, 0, 3, 2, 1],
                    [2, 3, 0, 1, 1, 0, 3, 2],
                    [3, 0, 1, 2, 2, 1, 0, 3],
                    [3, 2, 1, 0, 0, 1, 2, 3],
                    [2, 1, 0, 3, 3, 0, 1, 2],
                    [1, 0, 3, 2, 2, 3, 0, 1],
                    [0, 3, 2, 1, 1, 2, 3, 0],
                ];
                PATTERNS[selector % PATTERNS.len()][phase_ordinal]
            } else {
                const PATTERNS: [[usize; FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT]; 8] = [
                    [0, 1, 2, 3],
                    [1, 2, 3, 0],
                    [2, 3, 0, 1],
                    [3, 0, 1, 2],
                    [3, 2, 1, 0],
                    [2, 1, 0, 3],
                    [1, 0, 3, 2],
                    [0, 3, 2, 1],
                ];
                PATTERNS[selector % PATTERNS.len()][phase_ordinal]
            }
        }
    }
}

fn field_monolith_current_anchor_for_block(
    state: &FieldMonolithState,
    block_index: u32,
    rng: &mut DeterministicRng,
    base_cell_size: usize,
) -> u8 {
    let baseline = base_cell_size >= FIELD_MONOLITH_AUTO_MID_CELL_BYTES;
    let block0 = block_index as u8;
    let block1 = (block_index >> 8) as u8;
    let block2 = (block_index >> 16) as u8;
    let block3 = (block_index >> 24) as u8;
    let size0 = base_cell_size as u8;
    let size1 = (base_cell_size >> 8) as u8;
    let regime = (rng.next_u32() as u8 ^ state.phase ^ state.curvature ^ block0 ^ size0) & 0x03;
    let mut cadence = (rng.next_u32() as u8 ^ state.echo ^ state.reserve ^ block1 ^ size1) & 0x03;
    let mut intensity =
        (rng.next_u32() as u8 ^ state.parity ^ state.tension ^ block2 ^ size0.rotate_left(1))
            & 0x03;
    let mut stride_seed =
        (rng.next_u32() as u8 ^ state.stride ^ state.drift ^ block3 ^ size1.rotate_right(1)) & 0x03;

    if !baseline {
        let counter_orbit = block0
            ^ state.phase.rotate_left(1)
            ^ state.echo.rotate_right(1)
            ^ size0.rotate_left(2)
            ^ size1.rotate_right(1);
        cadence = (cadence.wrapping_add(counter_orbit) ^ intensity.rotate_left(1)) & 0x03;
        intensity = (intensity.wrapping_add(counter_orbit.rotate_right(1))
            ^ stride_seed.rotate_left(1))
            & 0x03;
        stride_seed = (stride_seed.wrapping_add(counter_orbit.rotate_left(1))
            ^ regime.rotate_right(1))
            & 0x03;
    }

    regime | (cadence << 2) | (intensity << 4) | (stride_seed << 6)
}

fn field_monolith_plan_for_anchor_cell(
    anchor: u8,
    cell_index: u32,
    cell_len: usize,
    ordinal_in_block: usize,
) -> FieldMonolithCellPlan {
    let baseline = cell_len >= FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_SMALL_CELL_BYTES;
    let regime = anchor & 0x03;
    let cadence = (anchor >> 2) & 0x03;
    let intensity = (anchor >> 4) & 0x03;
    let stride_seed = (anchor >> 6) & 0x03;
    let band = field_monolith_cell_band(cell_len) as u8;
    let ordinal = ordinal_in_block as u8;
    let cell_phase = (cell_index as u8)
        .wrapping_add(ordinal.wrapping_mul(3))
        .wrapping_add(band.rotate_left(1));
    let lane_orbit = if !baseline && band >= 2 {
        intensity.wrapping_add(regime.rotate_left((ordinal_in_block % 2) as u32))
            ^ cadence.rotate_right(((cell_index as usize + ordinal_in_block) % 2) as u32)
            ^ (cell_index as u8).rotate_left(((ordinal_in_block + band as usize) % 3) as u32)
    } else {
        0
    };
    let mutation = FieldMonolithMutationMode::from_bits(
        regime.wrapping_add(cell_phase)
            ^ cadence.rotate_left((ordinal_in_block % 2) as u32)
            ^ lane_orbit,
    );
    let weave = FieldMonolithWeaveMode::from_bits(
        cadence
            .wrapping_add(ordinal)
            .wrapping_add((cell_index as u8).rotate_left(1))
            .wrapping_add(band)
            .wrapping_add(lane_orbit.rotate_left(1)),
    );
    let stride_limit = field_monolith_anchor_stride_limit(cell_len);
    let stride = ((stride_seed as usize
        + ordinal_in_block
        + ((cell_index as usize) & 0x01)
        + band as usize
        + if !baseline && band >= 2 {
            intensity as usize + (((cell_index as usize) >> 1) & 0x01)
        } else {
            0
        })
        % stride_limit)
        + 1;
    let pad_len = if baseline {
        let intensity_limit = match field_monolith_cell_band(cell_len) {
            0 => 2,
            1 | 2 => 3,
            _ => 4,
        };
        (intensity as usize
            + cadence as usize
            + ordinal_in_block
            + (((cell_index as usize) >> 1) & 0x01)
            + band as usize)
            % intensity_limit
    } else {
        field_monolith_anchor_diffused_pad_len(anchor, cell_index, cell_len, ordinal_in_block)
    };

    FieldMonolithCellPlan {
        mutation,
        weave,
        stride,
        pad_len,
    }
}

fn field_monolith_descriptor(plan: FieldMonolithCellPlan) -> u8 {
    (plan.mutation as u8)
        | ((plan.weave as u8) << 2)
        | (((plan.stride - 1) as u8) << 4)
        | ((plan.pad_len as u8) << 6)
}

fn field_monolith_surface_checksum_seed(
    surface_len: usize,
    state: &FieldMonolithState,
    cell_index: u32,
    descriptor: u8,
) -> u8 {
    descriptor.wrapping_add(state.phase.rotate_left(1))
        ^ state.echo
        ^ (cell_index as u8).wrapping_mul(17)
        ^ surface_len as u8
}

fn field_monolith_surface_checksum_step(
    acc: u8,
    state: &FieldMonolithState,
    offset: usize,
    byte: u8,
) -> u8 {
    let mix = byte.wrapping_add((offset as u8).wrapping_mul(19))
        ^ state.curvature.rotate_left((offset % 8) as u32);
    acc.rotate_left(1) ^ mix
}

#[derive(Clone, Copy)]
struct FieldMonolithMaskLanes {
    phase_lanes: [u8; 8],
    curvature_lanes: [u8; 8],
    reserve_lanes: [u8; 8],
    drift_mix: u8,
    echo_mix: u8,
    tension_base: u8,
    parity_base: u8,
}

fn field_monolith_left_rotation_lanes(byte: u8) -> [u8; 8] {
    [
        byte,
        byte.rotate_left(1),
        byte.rotate_left(2),
        byte.rotate_left(3),
        byte.rotate_left(4),
        byte.rotate_left(5),
        byte.rotate_left(6),
        byte.rotate_left(7),
    ]
}

fn field_monolith_right_rotation_lanes(byte: u8) -> [u8; 8] {
    [
        byte,
        byte.rotate_right(1),
        byte.rotate_right(2),
        byte.rotate_right(3),
        byte.rotate_right(4),
        byte.rotate_right(5),
        byte.rotate_right(6),
        byte.rotate_right(7),
    ]
}

fn field_monolith_mask_lanes(
    state: &FieldMonolithState,
    cell_index: u32,
    stride: usize,
) -> FieldMonolithMaskLanes {
    let phase_lanes = field_monolith_left_rotation_lanes(state.phase);
    let curvature_base = field_monolith_right_rotation_lanes(state.curvature);
    let reserve_base = field_monolith_left_rotation_lanes(state.reserve);

    let mut curvature_lanes = [0u8; 8];
    let curvature_offset = stride & 0x07;
    for (lane, value) in curvature_lanes.iter_mut().enumerate() {
        *value = curvature_base[(lane + curvature_offset) & 0x07];
    }

    let mut reserve_lanes = [0u8; 8];
    let reserve_offset = (cell_index as usize) & 0x07;
    for (lane, value) in reserve_lanes.iter_mut().enumerate() {
        *value = reserve_base[(lane + reserve_offset) & 0x07];
    }

    FieldMonolithMaskLanes {
        phase_lanes,
        curvature_lanes,
        reserve_lanes,
        drift_mix: state
            .drift
            .wrapping_add((cell_index as u8).wrapping_mul(17)),
        echo_mix: state.echo.wrapping_add((stride as u8).wrapping_mul(11)),
        tension_base: state.tension,
        parity_base: state.parity,
    }
}

fn field_monolith_xor_masked_bytes_in_place(bytes: &mut [u8], mask_lanes: &FieldMonolithMaskLanes) {
    let mut offset = 0usize;
    let mut tension_mix = mask_lanes.tension_base;
    let mut parity_mix = mask_lanes.parity_base;
    while offset < bytes.len() {
        bytes[offset] ^= mask_lanes.phase_lanes[offset & 0x07]
            ^ tension_mix
            ^ mask_lanes.curvature_lanes[offset & 0x07]
            ^ mask_lanes.drift_mix
            ^ mask_lanes.echo_mix
            ^ mask_lanes.reserve_lanes[offset & 0x07]
            ^ parity_mix;
        tension_mix = tension_mix.wrapping_add(3);
        parity_mix = parity_mix.wrapping_add(7);
        offset += 1;
    }
}

fn field_monolith_apply_mutation_in_place(
    bytes: &mut Vec<u8>,
    mutation: FieldMonolithMutationMode,
    stride: usize,
    scratch: &mut Vec<u8>,
) {
    match mutation {
        FieldMonolithMutationMode::Direct => {}
        FieldMonolithMutationMode::StrideSwap => {
            if !bytes.is_empty() {
                let shift = stride % bytes.len();
                bytes.rotate_left(shift);
            }
        }
        FieldMonolithMutationMode::SplitWeave => {
            scratch.clear();
            scratch.reserve(bytes.len());
            let even_count = bytes.len().div_ceil(2);
            let odd_count = bytes.len() / 2;
            let mut read_index = 0usize;
            while scratch.len() < even_count {
                scratch.push(bytes[read_index]);
                read_index += 2;
            }

            let mut odd_index = 0usize;
            let mut odd_read_index = 1usize;
            while odd_index < odd_count {
                scratch.push(bytes[odd_read_index]);
                odd_index += 1;
                odd_read_index += 2;
            }

            core::mem::swap(bytes, scratch);
        }
        FieldMonolithMutationMode::MirrorWeave => {
            bytes.reverse();
        }
    }
}

fn field_monolith_inverse_mutation_slice(
    bytes: &mut [u8],
    mutation: FieldMonolithMutationMode,
    stride: usize,
    scratch: &mut Vec<u8>,
) {
    match mutation {
        FieldMonolithMutationMode::Direct => {}
        FieldMonolithMutationMode::StrideSwap => {
            if !bytes.is_empty() {
                let shift = stride % bytes.len();
                bytes.rotate_right(shift);
            }
        }
        FieldMonolithMutationMode::SplitWeave => {
            scratch.clear();
            scratch.reserve(bytes.len());
            let even_count = bytes.len().div_ceil(2);
            let (evens, odds) = bytes.split_at(even_count);

            let mut even_index = 0usize;
            while even_index < evens.len() || even_index < odds.len() {
                if even_index < evens.len() {
                    scratch.push(evens[even_index]);
                }
                if even_index < odds.len() {
                    scratch.push(odds[even_index]);
                }
                even_index += 1;
            }

            bytes.copy_from_slice(&scratch[..bytes.len()]);
        }
        FieldMonolithMutationMode::MirrorWeave => {
            bytes.reverse();
        }
    }
}

fn field_monolith_virtual_shift(
    state: &FieldMonolithState,
    plan: FieldMonolithCellPlan,
    cell_index: u32,
    len: usize,
) -> usize {
    if len <= 1 {
        0
    } else {
        let seed = usize::from(
            state.phase
                ^ state.echo.rotate_left(1)
                ^ state.reserve.rotate_right(1)
                ^ (cell_index as u8).wrapping_mul(17),
        );
        1 + ((seed + plan.stride * 5 + plan.pad_len * 11) % (len - 1))
    }
}

fn field_monolith_virtual_block_len(
    state: &FieldMonolithState,
    plan: FieldMonolithCellPlan,
    cell_index: u32,
    len: usize,
) -> usize {
    let max_block = len.clamp(2, 8);
    if max_block <= 2 {
        2
    } else {
        2 + ((usize::from(state.parity ^ state.curvature ^ (cell_index as u8))
            + plan.stride
            + plan.pad_len)
            % (max_block - 1))
    }
}

fn field_monolith_apply_virtual_pair_swaps(bytes: &mut [u8], step: usize, start: usize) {
    if bytes.len() < 2 {
        return;
    }
    let mut index = start.min(bytes.len() - 2);
    let jump = step.max(2);
    while index + 1 < bytes.len() {
        bytes.swap(index, index + 1);
        index += jump;
    }
}

fn field_monolith_apply_virtual_window_reversal(bytes: &mut [u8], window_len: usize) {
    if window_len <= 1 {
        return;
    }
    for chunk in bytes.chunks_mut(window_len) {
        chunk.reverse();
    }
}

fn field_monolith_apply_virtual_permutation(
    bytes: &mut [u8],
    state: &FieldMonolithState,
    plan: FieldMonolithCellPlan,
    cell_index: u32,
) {
    if bytes.len() <= 1 {
        return;
    }
    let shift = field_monolith_virtual_shift(state, plan, cell_index, bytes.len());
    match plan.weave {
        FieldMonolithWeaveMode::LeadPad => bytes.rotate_left(shift),
        FieldMonolithWeaveMode::TrailPad => bytes.rotate_right(shift),
        FieldMonolithWeaveMode::Alternating => {
            field_monolith_apply_virtual_pair_swaps(bytes, plan.pad_len + 2, shift % 2)
        }
        FieldMonolithWeaveMode::Clustered => field_monolith_apply_virtual_window_reversal(
            bytes,
            field_monolith_virtual_block_len(state, plan, cell_index, bytes.len()),
        ),
    }
}

fn field_monolith_remove_virtual_permutation(
    bytes: &mut [u8],
    state: &FieldMonolithState,
    plan: FieldMonolithCellPlan,
    cell_index: u32,
) {
    if bytes.len() <= 1 {
        return;
    }
    let shift = field_monolith_virtual_shift(state, plan, cell_index, bytes.len());
    match plan.weave {
        FieldMonolithWeaveMode::LeadPad => bytes.rotate_right(shift),
        FieldMonolithWeaveMode::TrailPad => bytes.rotate_left(shift),
        FieldMonolithWeaveMode::Alternating => {
            field_monolith_apply_virtual_pair_swaps(bytes, plan.pad_len + 2, shift % 2)
        }
        FieldMonolithWeaveMode::Clustered => field_monolith_apply_virtual_window_reversal(
            bytes,
            field_monolith_virtual_block_len(state, plan, cell_index, bytes.len()),
        ),
    }
}

#[derive(Clone, Copy)]
struct FieldMonolithVirtualMixContext {
    cell_mix: u8,
    weave_mix: u8,
    pad_mix: u8,
    echo_lanes: [u8; 8],
    parity_lanes: [u8; 8],
    reserve_stride: u8,
}

impl FieldMonolithVirtualMixContext {
    fn new(state: &FieldMonolithState, plan: FieldMonolithCellPlan, cell_index: u32) -> Self {
        Self {
            cell_mix: (cell_index as u8).wrapping_mul(19),
            weave_mix: (plan.weave as u8).wrapping_add(3),
            pad_mix: (plan.pad_len as u8).wrapping_mul(29),
            echo_lanes: field_monolith_left_rotation_lanes(state.echo),
            parity_lanes: field_monolith_right_rotation_lanes(state.parity),
            reserve_stride: state
                .reserve
                .wrapping_add((plan.stride as u8).wrapping_mul(13)),
        }
    }

    fn round_mix(self, cell_index: u32, plan: FieldMonolithCellPlan, round: usize) -> u8 {
        self.reserve_stride
            ^ self.parity_lanes[(cell_index as usize + plan.pad_len + round) & 7]
            ^ self.cell_mix
            ^ self.pad_mix
            ^ (round as u8).wrapping_mul(7)
    }

    fn byte_mask(self, offset: usize, round: usize, round_mix: u8, offset_mix: u8) -> u8 {
        self.echo_lanes[((offset & 7) + round) & 7] ^ offset_mix ^ round_mix
    }
}

fn field_monolith_apply_virtual_mix_rounds(
    bytes: &mut [u8],
    plan: FieldMonolithCellPlan,
    cell_index: u32,
    mix: FieldMonolithVirtualMixContext,
) {
    let len = bytes.len();
    let mut round = 0usize;
    while round < plan.pad_len {
        let round_mix = mix.round_mix(cell_index, plan, round);
        let mut offset = 0usize;
        let mut offset_mix = 0u8;
        while offset < len {
            bytes[offset] ^= mix.byte_mask(offset, round, round_mix, offset_mix);
            offset_mix = offset_mix.wrapping_add(mix.weave_mix);
            offset += 1;
        }
        round += 1;
    }
}

fn field_monolith_apply_virtual_mix_with_summary(
    bytes: &mut [u8],
    state: &FieldMonolithState,
    plan: FieldMonolithCellPlan,
    cell_index: u32,
    descriptor: u8,
) -> FieldMonolithSurfaceSummary {
    let mix = FieldMonolithVirtualMixContext::new(state, plan, cell_index);
    let len = bytes.len();
    field_monolith_apply_virtual_mix_rounds(bytes, plan, cell_index, mix);

    let mut digest =
        field_monolith_surface_checksum_seed(bytes.len(), state, cell_index, descriptor);
    let mut front = 0u8;
    let mut back = 0u8;
    let mut offset = 0usize;
    let final_mix = mix.round_mix(cell_index, plan, plan.pad_len);
    let mut offset_mix = 0u8;
    while offset < len {
        bytes[offset] ^= mix.byte_mask(offset, plan.pad_len, final_mix, offset_mix);
        let byte = bytes[offset];
        if offset == 0 {
            front = byte;
        }
        back = byte;
        digest = field_monolith_surface_checksum_step(digest, state, offset, byte);
        offset_mix = offset_mix.wrapping_add(mix.weave_mix);
        offset += 1;
    }

    FieldMonolithSurfaceSummary {
        digest,
        front,
        back,
    }
}

fn field_monolith_decode_surface_with_summary_append(
    surface: &[u8],
    state: &FieldMonolithState,
    plan: FieldMonolithCellPlan,
    cell_index: u32,
    descriptor: u8,
    output: &mut Vec<u8>,
    mutation_scratch: &mut Vec<u8>,
) -> FieldMonolithSurfaceSummary {
    let mix = FieldMonolithVirtualMixContext::new(state, plan, cell_index);
    let final_mix = mix.round_mix(cell_index, plan, plan.pad_len);
    let mut digest =
        field_monolith_surface_checksum_seed(surface.len(), state, cell_index, descriptor);
    let mut front = 0u8;
    let mut back = 0u8;
    let mut offset_mix = 0u8;
    let output_start = output.len();
    for (offset, &byte) in surface.iter().enumerate() {
        if offset == 0 {
            front = byte;
        }
        back = byte;
        digest = field_monolith_surface_checksum_step(digest, state, offset, byte);
        output.push(byte ^ mix.byte_mask(offset, plan.pad_len, final_mix, offset_mix));
        offset_mix = offset_mix.wrapping_add(mix.weave_mix);
    }
    let summary = FieldMonolithSurfaceSummary {
        digest,
        front,
        back,
    };
    let decoded = &mut output[output_start..];
    field_monolith_apply_virtual_mix_rounds(decoded, plan, cell_index, mix);
    field_monolith_remove_virtual_permutation(decoded, state, plan, cell_index);
    field_monolith_inverse_mutation_slice(decoded, plan.mutation, plan.stride, mutation_scratch);
    let mask_lanes = field_monolith_mask_lanes(state, cell_index, plan.stride);
    field_monolith_xor_masked_bytes_in_place(decoded, &mask_lanes);

    summary
}

fn field_monolith_update_state_with_summary(
    state: &mut FieldMonolithState,
    descriptor: u8,
    summary: FieldMonolithSurfaceSummary,
    cell_index: u32,
    cell_len: usize,
) {
    let control_a = state.phase.wrapping_add(state.tension).rotate_left(1) ^ cell_len as u8;
    let control_b = state.drift.wrapping_add(state.reserve).rotate_right(1) ^ cell_index as u8;

    state.phase = state.phase.wrapping_add(3).rotate_left(1) ^ summary.digest;
    state.tension = state.tension.wrapping_add(control_a).rotate_left(1) ^ cell_len as u8;
    state.curvature = state.curvature.wrapping_add(summary.digest.rotate_left(1));
    state.drift = state.drift.wrapping_add(summary.front).rotate_right(1) ^ descriptor;
    state.echo = state.echo.wrapping_add(summary.back) ^ summary.digest.rotate_right(1);
    state.reserve = state.reserve.wrapping_add(control_b) ^ summary.digest.rotate_left(1);
    state.stride = state
        .stride
        .wrapping_add(((descriptor >> 4) & 0x03) + 1)
        .max(1);
    state.parity ^= summary.digest ^ summary.front ^ summary.back;
}

fn transform_payload_v1(
    data: &[u8],
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    preset: FusedPreset,
    chunk_size: usize,
    encode: bool,
) -> Result<Vec<u8>> {
    let mut output = Vec::with_capacity(data.len());
    for (chunk_index, chunk) in data.chunks(chunk_size.max(1)).enumerate() {
        let chunk_index = chunk_index as u32;
        let segment_lengths = segment_lengths(preset, chunk.len(), chunk_index);
        let mut offset = 0usize;
        for (segment_index, segment_len) in segment_lengths.into_iter().enumerate() {
            let next_offset = offset + segment_len;
            let purpose = segment_purpose(preset, segment_index);
            let transformed = if encode {
                encode_segment(
                    &chunk[offset..next_offset],
                    shell_key,
                    nonce,
                    chunk_index * 8 + segment_index as u32,
                    &purpose,
                )?
            } else {
                decode_segment(
                    &chunk[offset..next_offset],
                    shell_key,
                    nonce,
                    chunk_index * 8 + segment_index as u32,
                    &purpose,
                )?
            };
            output.extend_from_slice(&transformed);
            offset = next_offset;
        }
    }
    Ok(output)
}

fn encode_segment(
    segment: &[u8],
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    chunk_index: u32,
    purpose: &str,
) -> Result<Vec<u8>> {
    let seed = derive_chunk_seed(shell_key, nonce, chunk_index, purpose, 32)?;
    let mut rng = DeterministicRng::from_seed(&seed);
    let permutation = build_permutation(segment.len(), &mut rng);
    let mut mask = vec![0u8; segment.len()];
    rng.fill_bytes(&mut mask);
    let mut encoded = vec![0u8; segment.len()];

    for (source_index, &target_index) in permutation.iter().enumerate() {
        encoded[target_index] = segment[source_index] ^ mask[source_index];
    }

    Ok(encoded)
}

fn decode_segment(
    segment: &[u8],
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    chunk_index: u32,
    purpose: &str,
) -> Result<Vec<u8>> {
    let seed = derive_chunk_seed(shell_key, nonce, chunk_index, purpose, 32)?;
    let mut rng = DeterministicRng::from_seed(&seed);
    let permutation = build_permutation(segment.len(), &mut rng);
    let mut mask = vec![0u8; segment.len()];
    rng.fill_bytes(&mut mask);
    let mut decoded = vec![0u8; segment.len()];

    for (source_index, &target_index) in permutation.iter().enumerate() {
        decoded[source_index] = segment[target_index] ^ mask[source_index];
    }

    Ok(decoded)
}

fn chunk_count(payload_len: usize, chunk_size: usize) -> usize {
    if payload_len == 0 {
        0
    } else {
        1 + (payload_len - 1) / chunk_size.max(1)
    }
}

fn segment_lengths(preset: FusedPreset, chunk_len: usize, chunk_index: u32) -> Vec<usize> {
    if chunk_len <= 1 {
        return vec![chunk_len];
    }

    let weights: &[u8] = match preset {
        FusedPreset::Compact => &[1],
        FusedPreset::Balanced => match chunk_index % 3 {
            0 => &[3, 2, 1],
            1 => &[2, 1, 3],
            _ => &[1, 3, 2],
        },
        FusedPreset::Concealed => match chunk_index % 4 {
            0 => &[4, 2, 1, 1],
            1 => &[1, 4, 2, 1],
            2 => &[1, 1, 4, 2],
            _ => &[2, 1, 1, 4],
        },
    };

    if weights.len() == 1 || chunk_len < weights.len() {
        return vec![chunk_len];
    }

    split_len_by_weights(chunk_len, weights)
}

fn split_len_by_weights(total_len: usize, weights: &[u8]) -> Vec<usize> {
    if total_len == 0 {
        return vec![0];
    }

    let total_weight: usize = weights.iter().map(|&weight| weight as usize).sum();
    let mut lengths = Vec::with_capacity(weights.len());
    let mut consumed = 0usize;
    let mut remaining_weight = total_weight;

    for (index, &weight) in weights.iter().enumerate() {
        let remaining_segments = weights.len() - index;
        let remaining_len = total_len - consumed;

        let segment_len = if remaining_segments == 1 {
            remaining_len
        } else {
            let proportional = remaining_len.saturating_mul(weight as usize) / remaining_weight;
            proportional.max(1)
        };

        lengths.push(segment_len);
        consumed += segment_len;
        remaining_weight = remaining_weight.saturating_sub(weight as usize);
    }

    let mut overflow = consumed.saturating_sub(total_len);
    let mut cursor = lengths.len();
    while overflow > 0 && cursor > 0 {
        cursor -= 1;
        if lengths[cursor] > 1 {
            lengths[cursor] -= 1;
            overflow -= 1;
        }
    }

    if consumed < total_len {
        if let Some(last) = lengths.last_mut() {
            *last += total_len - consumed;
        }
    }

    lengths
}

fn segment_purpose(preset: FusedPreset, segment_index: usize) -> String {
    format!("{}-segment-{}", preset.name(), segment_index)
}

fn random_nonce() -> [u8; SHELL_NONCE_SIZE] {
    let mut nonce = [0u8; SHELL_NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

fn build_permutation(len: usize, rng: &mut DeterministicRng) -> Vec<usize> {
    let mut permutation: Vec<usize> = (0..len).collect();
    if len <= 1 {
        return permutation;
    }
    for index in (1..len).rev() {
        let swap_index = rng.next_index(index + 1);
        permutation.swap(index, swap_index);
    }
    permutation
}

#[derive(Debug, Clone, Copy)]
struct DeterministicRng {
    state: u64,
}

impl DeterministicRng {
    fn from_seed(seed: &[u8]) -> Self {
        let mut state = 0x9E37_79B9_7F4A_7C15u64;
        for chunk in seed.chunks(8) {
            let mut word = [0u8; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            state ^= u64::from_le_bytes(word);
            state = state.rotate_left(17).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        }
        Self { state }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn next_u32(&mut self) -> u32 {
        self.next_u64() as u32
    }

    fn next_index(&mut self, upper: usize) -> usize {
        if upper <= 1 {
            0
        } else {
            (self.next_u64() as usize) % upper
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encryption::EncryptOptions;

    fn fixed_key() -> Key {
        Key::from_bytes(&[0x42; 32]).expect("valid fixed key")
    }

    #[test]
    fn derive_domain_key_is_deterministic() {
        let master = fixed_key();
        let salt = b"shell-salt";
        let first = derive_domain_key(&master, Some(salt), "shell").unwrap();
        let second = derive_domain_key(&master, Some(salt), "shell").unwrap();
        let different = derive_domain_key(&master, Some(salt), "shell-tag").unwrap();

        assert_eq!(first.as_bytes(), second.as_bytes());
        assert_ne!(first.as_bytes(), different.as_bytes());
    }

    #[test]
    fn derive_chunk_seed_varies_by_chunk_and_purpose() {
        let shell_key = fixed_key();
        let nonce = [7u8; SHELL_NONCE_SIZE];

        let first = derive_chunk_seed(&shell_key, &nonce, 0, "fused-prefix", 32).unwrap();
        let second = derive_chunk_seed(&shell_key, &nonce, 0, "fused-prefix", 32).unwrap();
        let next_chunk = derive_chunk_seed(&shell_key, &nonce, 1, "fused-prefix", 32).unwrap();
        let next_purpose = derive_chunk_seed(&shell_key, &nonce, 0, "compare", 32).unwrap();

        assert_eq!(first, second);
        assert_ne!(first, next_chunk);
        assert_ne!(first, next_purpose);
    }

    #[test]
    fn shell_tag_roundtrip_detects_wrong_key_and_tamper() {
        let payload = b"outer shell payload";
        let tag_key = fixed_key();
        let wrong_key = Key::from_bytes(&[0x24; 32]).unwrap();

        let tag = compute_shell_tag(payload, &tag_key).unwrap();

        assert!(verify_shell_tag(payload, &tag, &tag_key).unwrap());
        assert!(!verify_shell_tag(payload, &tag, &wrong_key).unwrap());
        assert!(!verify_shell_tag(b"tampered", &tag, &tag_key).unwrap());
    }

    #[test]
    fn fused_shell_roundtrip_for_all_presets() {
        let master = fixed_key();
        let payload = vec![0xA5u8; DEFAULT_CHUNK_SIZE + 257];

        for preset in [
            FusedPreset::Compact,
            FusedPreset::Balanced,
            FusedPreset::Concealed,
        ] {
            let envelope = fuse(
                &payload,
                &master,
                Some(FusedShellOptions {
                    preset,
                    chunk_size: None,
                    shell_nonce: Some([9u8; SHELL_NONCE_SIZE]),
                }),
            )
            .unwrap();

            let restored = unfuse(&envelope, &master).unwrap();
            assert_eq!(restored, payload);
            assert_eq!(envelope.info().preset, preset);
        }
    }

    #[test]
    fn fused_shell_emits_field_monolith_v2_geometry() {
        let master = fixed_key();
        let payload = b"field monolith current is the shipped fuse v2 body".repeat(128);

        let envelope = fuse(
            &payload,
            &master,
            Some(FusedShellOptions {
                preset: FusedPreset::Balanced,
                chunk_size: None,
                shell_nonce: Some([3u8; SHELL_NONCE_SIZE]),
            }),
        )
        .unwrap();

        assert_eq!(envelope.version, FUSED_SHELL_VERSION);
        assert!(envelope.payload.len() > payload.len());

        let geometry =
            field_monolith_infer_geometry(envelope.payload.len(), envelope.chunk_size as usize)
                .expect("valid monolith geometry");
        assert_eq!(geometry.original_len, payload.len());
        let block_count =
            field_monolith_block_count_for_cells(geometry.chunk_count, geometry.block_cells);
        assert_eq!(envelope.payload.len(), payload.len() + block_count);

        let restored = unfuse(&envelope, &master).unwrap();
        assert_eq!(restored, payload);
    }

    #[test]
    fn field_monolith_constant_time_inversion_preserves_valid_geometries() {
        for target_cell_size in [1usize, 7, 8, 24, 96, 128, 256, 512, 1024, 2048, 65_535] {
            for original_len in 0usize..=10_000 {
                let chunk_count = if original_len == 0 {
                    0
                } else {
                    original_len.div_ceil(target_cell_size)
                };
                let block_cells =
                    field_monolith_current_anchor_block_cells(target_cell_size, chunk_count);
                let block_count = field_monolith_block_count_for_cells(chunk_count, block_cells);
                let payload_len = original_len + block_count;

                assert_eq!(
                    field_monolith_infer_geometry(payload_len, target_cell_size),
                    Some(FieldMonolithGeometry {
                        original_len,
                        chunk_count,
                        block_cells,
                    }),
                    "target={target_cell_size}, original={original_len}"
                );
            }
        }

        let original_len = 2_000_000usize;
        let target_cell_size = 1usize;
        let chunk_count = original_len;
        let block_cells = FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE;
        let payload_len =
            original_len + field_monolith_block_count_for_cells(chunk_count, block_cells);
        assert_eq!(
            field_monolith_infer_geometry(payload_len, target_cell_size),
            Some(FieldMonolithGeometry {
                original_len,
                chunk_count,
                block_cells,
            })
        );
    }

    #[test]
    fn keyless_inspect_rejects_million_cell_noncanonical_fused_geometry() {
        let original_len = 2_000_000usize;
        let block_count = field_monolith_block_count_for_cells(
            original_len,
            FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE,
        );
        let payload_len = original_len + block_count;
        let mut artifact = vec![0u8; FUSED_SHELL_HEADER_LEN + payload_len + SHELL_TAG_SIZE];
        artifact[..4].copy_from_slice(&FUSED_SHELL_MAGIC);
        artifact[4] = FUSED_SHELL_VERSION;
        artifact[5] = FusedPreset::Balanced as u8;
        artifact[6..10].copy_from_slice(&1u32.to_be_bytes());

        let error = inspect_fused(&artifact).unwrap_err();
        assert!(matches!(error, Error::InvalidConfiguration(_)));
        assert!(error.to_string().contains("noncanonical"));
    }

    #[test]
    fn fused_keyless_inspect_and_roundtrip_accept_valid_edge_geometries() {
        let master = fixed_key();
        for (len, requested_chunk_size) in [
            (0usize, None),
            (1, None),
            (7, Some(1)),
            (8, Some(8)),
            (257, Some(24)),
            (1_025, Some(256)),
            (5_000, Some(512)),
        ] {
            let payload = vec![0x5Au8; len];
            let artifact = fuse_bytes(
                &payload,
                &master,
                Some(FusedShellOptions {
                    chunk_size: requested_chunk_size,
                    ..FusedShellOptions::default()
                }),
            )
            .unwrap();
            let inspected = inspect_fused(&artifact).unwrap();
            assert_eq!(inspected.shell_size, artifact.len());
            assert_eq!(unfuse_bytes(&artifact, &master).unwrap(), payload);
        }
    }

    #[cfg(feature = "compression")]
    #[test]
    fn keyless_inspect_rejects_million_cell_masked_whole_monolith_geometry() {
        let original_len = 2_000_000usize;
        let block_count = field_monolith_block_count_for_cells(
            original_len,
            FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_DENSE,
        );
        let payload_len = original_len + block_count;
        let seed = [0x12, 0x34];
        let header = WholeMonolithV0Header {
            preset: FusedPreset::Balanced,
            compression_algorithm: CompressionAlgorithm::None,
            encryption_algorithm: EncryptionAlgorithm::XChaCha20Poly1305,
            shell_cell_size: 1,
            original_size: 1,
            compressed_size: 1,
            shell_nonce: [0u8; SHELL_NONCE_SIZE],
        };
        let mut masked_header = header.to_bytes();
        whole_monolith_v0_mask_public_header(&seed, &mut masked_header);
        let mut artifact = Vec::with_capacity(
            WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES
                + WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN
                + payload_len
                + SHELL_TAG_SIZE,
        );
        artifact.extend_from_slice(&seed);
        artifact.extend_from_slice(&masked_header);
        artifact.resize(artifact.len() + payload_len + SHELL_TAG_SIZE, 0);

        let error = inspect_artifact(&artifact).unwrap_err();
        assert!(matches!(error, Error::InvalidConfiguration(_)));
        assert!(error.to_string().contains("noncanonical"));
    }

    #[test]
    fn fused_shell_still_decodes_v1_segment_envelopes() {
        let master = fixed_key();
        let payload = b"legacy fused shell payload that must remain openable".repeat(64);
        let preset = FusedPreset::Balanced;
        let chunk_size = DEFAULT_CHUNK_SIZE;
        let nonce = [4u8; SHELL_NONCE_SIZE];
        let (shell_key, tag_key) = derive_shell_keys(&master, &nonce).unwrap();
        let shell_payload =
            transform_payload_v1(&payload, &shell_key, &nonce, preset, chunk_size, true).unwrap();
        let mut envelope = FusedShellEnvelope {
            version: FUSED_SHELL_V1_VERSION,
            preset,
            chunk_size: chunk_size as u32,
            nonce,
            payload: shell_payload,
            tag: [0u8; SHELL_TAG_SIZE],
        };
        envelope.tag = compute_shell_tag(&envelope.to_unsigned_bytes(), &tag_key).unwrap();

        let restored = unfuse_bytes(&envelope.to_bytes(), &master).unwrap();
        assert_eq!(restored, payload);
    }

    #[test]
    fn fused_shell_detects_tamper() {
        let master = fixed_key();
        let mut bytes = fuse_bytes(b"hello fused world", &master, None).unwrap();
        let payload_offset = FUSED_SHELL_HEADER_LEN;
        bytes[payload_offset] ^= 0xFF;

        let err = unfuse_bytes(&bytes, &master).unwrap_err();
        assert_eq!(err, Error::AuthenticationFailed);
    }

    #[cfg(feature = "compression")]
    #[test]
    fn protect_open_roundtrip_for_all_presets() {
        let master = fixed_key();
        let payload = b"voided 1.0 Fuse flow protects this payload cleanly".repeat(1024);

        for preset in [
            FusedPreset::Compact,
            FusedPreset::Balanced,
            FusedPreset::Concealed,
        ] {
            let protected = protect(
                &payload,
                &master,
                Some(ProtectOptions {
                    preset,
                    ..ProtectOptions::default()
                }),
            )
            .unwrap();

            let restored = open(&protected.artifact, &master).unwrap();
            assert_eq!(restored, payload);

            let inspected = inspect_artifact(&protected.artifact).unwrap();
            assert_eq!(inspected.preset, preset);
            assert_eq!(inspected.original_size, payload.len());
            assert_eq!(inspected.version, PROTECTED_ARTIFACT_VERSION);
        }
    }

    #[cfg(feature = "compression")]
    #[test]
    fn protect_reports_v3_whole_monolith_metadata() {
        let master = fixed_key();
        let payload = b"protect should expose full-flow monolith geometry".repeat(512);

        let protected = protect(&payload, &master, None).unwrap();
        let inspected = inspect_artifact(&protected.artifact).unwrap();

        assert!(!artifact_starts_with_protected_magic(&protected.artifact));
        assert_eq!(inspected.version, PROTECTED_ARTIFACT_VERSION);
        assert_eq!(inspected.protected_size, protected.artifact.len());
        assert_eq!(inspected.original_size, payload.len());
        assert_eq!(inspected.encrypted_size, protected.info.encrypted_size);
        assert!(inspected.encrypted_size >= inspected.compressed_size);
        assert!(inspected.shell_chunk_count >= 1);
        assert_eq!(open(&protected.artifact, &master).unwrap(), payload);
    }

    #[cfg(feature = "compression")]
    #[test]
    fn protect_v3_uses_one_full_flow_compression_pass() {
        let master = fixed_key();
        let payload =
            b"full flow monolith compression should not reset per macro chunk ".repeat(4096);
        let expected_compression = compression::compress(
            &payload,
            Some(CompressionOptions {
                algorithm: CompressionAlgorithm::Brotli,
                min_size_threshold: 100,
                level: 6,
            }),
        )
        .unwrap();

        let protected = protect(
            &payload,
            &master,
            Some(ProtectOptions {
                shell_nonce: Some([0x33; SHELL_NONCE_SIZE]),
                ..ProtectOptions::default()
            }),
        )
        .unwrap();
        let inspected = inspect_artifact(&protected.artifact).unwrap();

        assert_eq!(
            inspected.compressed_size,
            expected_compression.compressed.len()
        );
        assert_eq!(open(&protected.artifact, &master).unwrap(), payload);
    }

    #[cfg(feature = "compression")]
    #[test]
    fn protected_v3_whole_monolith_rejects_legacy_parser_wrong_key_and_tamper() {
        let master = fixed_key();
        let wrong = Key::from_bytes(&[0x24; 32]).unwrap();
        let payload = b"v3 should be a masked whole monolith artifact".repeat(256);
        let protected = protect(
            &payload,
            &master,
            Some(ProtectOptions {
                shell_nonce: Some([8u8; SHELL_NONCE_SIZE]),
                ..ProtectOptions::default()
            }),
        )
        .unwrap();

        assert!(ProtectedArtifactEnvelope::from_bytes(&protected.artifact).is_err());
        assert!(open(&protected.artifact, &wrong).is_err());

        let mut tampered = protected.artifact.clone();
        let pivot = tampered.len() / 2;
        tampered[pivot] ^= 0xA5;
        assert!(open(&tampered, &master).is_err());

        assert_eq!(open(&protected.artifact, &master).unwrap(), payload);
    }

    #[cfg(feature = "compression")]
    #[test]
    fn rotation_helper_decodes_v2_shell_monolith_protected_artifacts() {
        let master = fixed_key();
        let payload = b"v2 shell-monolith protected artifacts must stay openable".repeat(256);
        let opts = ProtectOptions {
            shell_nonce: Some([6u8; SHELL_NONCE_SIZE]),
            ..ProtectOptions::default()
        };
        let nonce = opts.shell_nonce.unwrap();
        let compression_result = compression::compress(
            &payload,
            Some(CompressionOptions {
                algorithm: opts.compression_algorithm,
                min_size_threshold: opts.compression_min_size_threshold,
                level: opts.compression_level,
            }),
        )
        .unwrap();
        let encrypted = crate::encryption::encrypt(
            &compression_result.compressed,
            &master,
            Some(EncryptOptions {
                algorithm: opts.encryption_algorithm,
                aad: None,
            }),
        )
        .unwrap();
        let encrypted_bytes = encrypted.to_bytes();
        let (shell_key, tag_key) = derive_shell_keys(&master, &nonce).unwrap();
        let (shell_payload, chunk_size) =
            field_monolith_encode_payload(&encrypted_bytes, &shell_key, &nonce, None).unwrap();
        let mut envelope = ProtectedArtifactEnvelope {
            version: PROTECTED_ARTIFACT_V2_VERSION,
            preset: opts.preset,
            compression_algorithm: compression_result.algorithm,
            encryption_algorithm: encrypted.algorithm,
            chunk_size: chunk_size as u32,
            original_size: payload.len() as u64,
            compressed_size: compression_result.compressed.len() as u64,
            nonce,
            payload: shell_payload,
            tag: [0u8; SHELL_TAG_SIZE],
        };
        envelope.tag = compute_shell_tag(&envelope.to_unsigned_bytes(), &tag_key).unwrap();

        assert!(open(&envelope.to_bytes(), &master).is_err());
        let restored = open_rotation_artifact(&envelope.to_bytes(), &master).unwrap();
        assert_eq!(restored, payload);
        assert_eq!(
            inspect_rotation_artifact(&envelope.to_bytes())
                .unwrap()
                .version,
            PROTECTED_ARTIFACT_V2_VERSION
        );
    }

    #[cfg(feature = "compression")]
    #[test]
    fn rotation_helper_decodes_legacy_v3_protected_monolith_artifacts() {
        let master = fixed_key();
        let payload =
            b"legacy v3 protected-monolith artifacts stay explicit rotation only".repeat(256);
        let opts = ProtectOptions {
            shell_nonce: Some([7u8; SHELL_NONCE_SIZE]),
            ..ProtectOptions::default()
        };
        let nonce = opts.shell_nonce.unwrap();
        let compression_result = compression::compress(
            &payload,
            Some(CompressionOptions {
                algorithm: opts.compression_algorithm,
                min_size_threshold: opts.compression_min_size_threshold,
                level: opts.compression_level,
            }),
        )
        .unwrap();
        let encrypted = crate::encryption::encrypt(
            &compression_result.compressed,
            &master,
            Some(EncryptOptions {
                algorithm: opts.encryption_algorithm,
                aad: None,
            }),
        )
        .unwrap();
        let encrypted_bytes = encrypted.to_bytes();
        let (shell_key, tag_key) = derive_shell_keys(&master, &nonce).unwrap();
        let (shell_payload, chunk_size) = protected_monolith_encode_payload(
            &encrypted_bytes,
            &shell_key,
            &nonce,
            None,
            ProtectedMonolithContext {
                preset: opts.preset,
                compression_algorithm: compression_result.algorithm,
                encryption_algorithm: encrypted.algorithm,
                original_len: payload.len(),
                compressed_len: compression_result.compressed.len(),
            },
        )
        .unwrap();
        let mut envelope = ProtectedArtifactEnvelope {
            version: PROTECTED_ARTIFACT_VERSION,
            preset: opts.preset,
            compression_algorithm: compression_result.algorithm,
            encryption_algorithm: encrypted.algorithm,
            chunk_size: chunk_size as u32,
            original_size: payload.len() as u64,
            compressed_size: compression_result.compressed.len() as u64,
            nonce,
            payload: shell_payload,
            tag: [0u8; SHELL_TAG_SIZE],
        };
        envelope.tag = compute_shell_tag(&envelope.to_unsigned_bytes(), &tag_key).unwrap();

        assert!(open(&envelope.to_bytes(), &master).is_err());
        let restored = open_rotation_artifact(&envelope.to_bytes(), &master).unwrap();
        assert_eq!(restored, payload);
        assert_eq!(
            inspect_rotation_artifact(&envelope.to_bytes())
                .unwrap()
                .version,
            PROTECTED_ARTIFACT_VERSION
        );
    }

    #[cfg(feature = "compression")]
    #[test]
    fn rotation_helper_decodes_v1_protected_artifacts() {
        let master = fixed_key();
        let payload = b"legacy protected artifacts must stay openable".repeat(256);
        let opts = ProtectOptions {
            shell_nonce: Some([5u8; SHELL_NONCE_SIZE]),
            ..ProtectOptions::default()
        };
        let nonce = opts.shell_nonce.unwrap();
        let chunk_size = DEFAULT_CHUNK_SIZE;
        let compression_result = compression::compress(
            &payload,
            Some(CompressionOptions {
                algorithm: opts.compression_algorithm,
                min_size_threshold: opts.compression_min_size_threshold,
                level: opts.compression_level,
            }),
        )
        .unwrap();
        let encrypted = crate::encryption::encrypt(
            &compression_result.compressed,
            &master,
            Some(EncryptOptions {
                algorithm: opts.encryption_algorithm,
                aad: None,
            }),
        )
        .unwrap();
        let encrypted_bytes = encrypted.to_bytes();
        let (shell_key, tag_key) = derive_shell_keys(&master, &nonce).unwrap();
        let shell_payload = transform_payload_v1(
            &encrypted_bytes,
            &shell_key,
            &nonce,
            opts.preset,
            chunk_size,
            true,
        )
        .unwrap();
        let mut envelope = ProtectedArtifactEnvelope {
            version: PROTECTED_ARTIFACT_V1_VERSION,
            preset: opts.preset,
            compression_algorithm: compression_result.algorithm,
            encryption_algorithm: encrypted.algorithm,
            chunk_size: chunk_size as u32,
            original_size: payload.len() as u64,
            compressed_size: compression_result.compressed.len() as u64,
            nonce,
            payload: shell_payload,
            tag: [0u8; SHELL_TAG_SIZE],
        };
        envelope.tag = compute_shell_tag(&envelope.to_unsigned_bytes(), &tag_key).unwrap();

        assert!(open(&envelope.to_bytes(), &master).is_err());
        let restored = open_rotation_artifact(&envelope.to_bytes(), &master).unwrap();
        assert_eq!(restored, payload);
        assert_eq!(
            inspect_rotation_artifact(&envelope.to_bytes())
                .unwrap()
                .version,
            PROTECTED_ARTIFACT_V1_VERSION
        );
    }

    #[cfg(feature = "compression")]
    #[test]
    fn repack_changes_preset_and_keeps_plaintext() {
        let master = fixed_key();
        let payload = vec![0x6Du8; 65_537];
        let protected = protect(&payload, &master, None).unwrap();

        let repacked = repack_artifact(
            &protected.artifact,
            &master,
            Some(ProtectOptions {
                preset: FusedPreset::Concealed,
                ..ProtectOptions::default()
            }),
        )
        .unwrap();

        assert_eq!(repacked.info.preset, FusedPreset::Concealed);
        assert_eq!(open(&repacked.artifact, &master).unwrap(), payload);
    }
}
