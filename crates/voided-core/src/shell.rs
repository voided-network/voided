//! Fused shell primitives and whole-monolith protect/open flows for Voided v3.

use alloc::{format, string::String, vec, vec::Vec};

use aes_gcm::{Aes256Gcm, Nonce as AesGcmNonce};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::{
    encryption::{
        derive_key_hkdf, derive_key_hkdf_raw, Algorithm as EncryptionAlgorithm, EncryptionResult,
        Key,
    },
    hash::{compare_hashes, generate_hmac, HashAlgorithm},
    Error, Result, MAGIC_ENCRYPTED,
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
const WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN: usize = 52;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_MIN_ARTIFACT_LEN: usize =
    WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES + WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN + SHELL_TAG_SIZE;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_MIN_CHUNK_BYTES: usize = 32 * 1024;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_SINGLE_MACROCELL_MAX_BYTES: usize = 96 * 1024;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_SMALL_REMAINDER_BYTES: usize = 8 * 1024;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_MEDIUM_CHUNK_BYTES: usize = 64 * 1024;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_LARGE_CHUNK_BYTES: usize = 128 * 1024;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_CLOAK_HEAD_BYTES: usize = 512;
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_MATERIAL_DOMAIN: &str = "whole-monolith-v0-material";
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_STATE_DOMAIN: &str = "whole-monolith-v0-state";
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_CHUNK_AAD_PREFIX: &[u8] = b"voided:whole-monolith-v0:chunk";
#[cfg(feature = "compression")]
const WHOLE_MONOLITH_V0_STATE_SALT_BYTES: usize = 32 + 8 * 5 + 16;

fn domain_info(domain_label: &str) -> String {
    format!("voided:shell:{domain_label}")
}

/// Stable fused preset ids.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(u8)]
pub enum FusedPreset {
    /// Cheapest fused shell lane.
    Compact = 0x01,
    /// Default fused shell lane.
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

impl Default for FusedPreset {
    fn default() -> Self {
        Self::Balanced
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
    /// Obfuscated payload bytes.
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
        let payload = data[FUSED_SHELL_HEADER_LEN..payload_end].to_vec();
        let mut tag = [0u8; SHELL_TAG_SIZE];
        tag.copy_from_slice(&data[payload_end..]);

        Ok(Self {
            version,
            preset,
            chunk_size,
            nonce,
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
/// Keyless metadata for a fused protected artifact.
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
impl ProtectedArtifactEnvelope {
    #[allow(dead_code)]
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
        let payload = data[PROTECTED_ARTIFACT_HEADER_LEN..payload_end].to_vec();
        let mut tag = [0u8; SHELL_TAG_SIZE];
        tag.copy_from_slice(&data[payload_end..]);

        Ok(Self {
            version,
            preset,
            compression_algorithm,
            encryption_algorithm,
            chunk_size,
            original_size,
            compressed_size,
            nonce,
            payload,
            tag,
        })
    }

    fn info(&self) -> ProtectedArtifactInfo {
        let chunk_size = self.chunk_size.max(1) as usize;
        let field_monolith_geometry = if matches!(
            self.version,
            PROTECTED_ARTIFACT_VERSION | PROTECTED_ARTIFACT_V2_VERSION
        ) {
            field_monolith_infer_geometry(self.payload.len(), chunk_size)
        } else {
            None
        };
        let encrypted_size = field_monolith_geometry
            .map(|geometry| geometry.original_len)
            .unwrap_or(self.payload.len());
        let shell_chunk_count = field_monolith_geometry
            .map(|geometry| geometry.chunk_count)
            .unwrap_or_else(|| chunk_count(self.payload.len(), chunk_size));
        ProtectedArtifactInfo {
            version: self.version,
            preset: self.preset,
            preset_label: self.preset.name().to_string(),
            compression_algorithm: self.compression_algorithm,
            encryption_algorithm: self.encryption_algorithm,
            original_size: self.original_size as usize,
            compressed_size: self.compressed_size as usize,
            encrypted_size,
            protected_size: self.payload.len() + PROTECTED_ARTIFACT_HEADER_LEN + SHELL_TAG_SIZE,
            shell_chunk_size: self.chunk_size,
            shell_chunk_count,
            shell_nonce: self.nonce,
        }
    }
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
    let mac = generate_hmac(data, tag_key.as_bytes(), HashAlgorithm::Sha256)?;
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
    let nonce = canonicalize_nonce(opts.shell_nonce.unwrap_or_else(random_nonce));
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
    Ok(FusedShellEnvelope::from_bytes(data)?.info())
}

#[cfg(feature = "compression")]
/// Run the Voided v3 whole-monolith full flow.
pub fn protect(
    plaintext: &[u8],
    master_key: &Key,
    options: Option<ProtectOptions>,
) -> Result<ProtectResult> {
    let opts = options.unwrap_or_default();
    whole_monolith_v0_protect(plaintext, master_key, opts)
}

#[cfg(feature = "compression")]
/// Open a serialized Voided v3 whole-monolith artifact.
pub fn open(artifact: &[u8], master_key: &Key) -> Result<Vec<u8>> {
    whole_monolith_v0_open(artifact, master_key)
}

#[cfg(feature = "compression")]
/// Open either the current v3 artifact or an explicit legacy VOF2 rotation artifact.
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

    let encrypted_bytes = match envelope.version {
        PROTECTED_ARTIFACT_VERSION => protected_monolith_decode_payload(
            &envelope.payload,
            &shell_key,
            &envelope.nonce,
            envelope.chunk_size.max(1) as usize,
            envelope.original_size as usize,
            envelope.compressed_size as usize,
            envelope.compression_algorithm,
            envelope.encryption_algorithm,
            envelope.preset,
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
    if compressed.len() != envelope.compressed_size as usize {
        return Err(Error::SizeMismatch {
            expected: envelope.compressed_size as usize,
            actual: compressed.len(),
        });
    }

    let plaintext = compression::decompress(&compressed, envelope.compression_algorithm)?;
    if plaintext.len() != envelope.original_size as usize {
        return Err(Error::SizeMismatch {
            expected: envelope.original_size as usize,
            actual: plaintext.len(),
        });
    }

    Ok(plaintext)
}

#[cfg(feature = "compression")]
/// Inspect a current Voided v3 artifact without decrypting it.
pub fn inspect_artifact(artifact: &[u8]) -> Result<ProtectedArtifactInfo> {
    whole_monolith_v0_inspect_artifact(artifact)
}

#[cfg(feature = "compression")]
/// Inspect either the current v3 artifact or an explicit legacy VOF2 rotation artifact.
pub fn inspect_rotation_artifact(artifact: &[u8]) -> Result<ProtectedArtifactInfo> {
    if artifact_starts_with_protected_magic(artifact) {
        Ok(ProtectedArtifactEnvelope::from_bytes(artifact)?.info())
    } else {
        inspect_artifact(artifact)
    }
}

#[cfg(feature = "compression")]
/// Repack an artifact under a new preset or full-flow configuration.
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
    surface_len: usize,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
struct FieldMonolithGeometry {
    original_len: usize,
    target_cell_size: usize,
    chunk_count: usize,
    block_cells: usize,
    block_count: usize,
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
    let geometry = field_monolith_current_geometry_profile(data.len(), target_cell_size);
    let mut payload = Vec::with_capacity(data.len().saturating_add(geometry.block_count));
    let mut cursor = 0usize;
    let mut cell_index = 0u32;
    let mut block_index = 0u32;

    while cursor < data.len() {
        let anchor = field_monolith_current_anchor_for_block_with_chunk_count(
            &state,
            block_index,
            &mut rng,
            target_cell_size,
            geometry.chunk_count,
        );
        payload.push(anchor);

        for ordinal_in_block in 0..geometry.block_cells {
            if cursor >= data.len() {
                break;
            }
            let remaining = data.len() - cursor;
            let cell_len = field_monolith_next_cell_len(remaining, target_cell_size);
            let next_cursor = cursor + cell_len;
            let plaintext = &data[cursor..next_cursor];
            let plan =
                field_monolith_plan_for_anchor_cell(anchor, cell_index, cell_len, ordinal_in_block);
            let descriptor = field_monolith_descriptor(plan);
            let (surface, summary) = field_monolith_encode_surface_with_summary(
                plaintext, &state, plan, cell_index, descriptor,
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
    let geometry =
        field_monolith_infer_geometry(payload.len(), target_cell_size).ok_or_else(|| {
            Error::InvalidConfiguration("field monolith payload geometry was invalid".to_string())
        })?;
    let state = field_monolith_initial_state(shell_key, nonce, geometry.original_len)?;
    field_monolith_decode_payload_with_state(payload, target_cell_size, state)
}

fn field_monolith_decode_payload_with_state(
    payload: &[u8],
    target_cell_size: usize,
    mut state: FieldMonolithState,
) -> Result<Vec<u8>> {
    let geometry =
        field_monolith_infer_geometry(payload.len(), target_cell_size).ok_or_else(|| {
            Error::InvalidConfiguration("field monolith payload geometry was invalid".to_string())
        })?;
    let mut output = Vec::with_capacity(geometry.original_len);
    let mut cursor = 0usize;
    let mut cell_index = 0usize;

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
            let original_len = field_monolith_current_surface_len(
                payload,
                cursor,
                cell_index,
                geometry.chunk_count,
                target_cell_size,
            )?;
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
            let (decoded, summary) = field_monolith_decode_surface_with_summary(
                surface,
                &state,
                plan,
                cell_index as u32,
                original_len,
                descriptor,
            )?;
            output.extend_from_slice(&decoded);
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
impl ProtectedMonolithPlan {
    fn mix_bytes(self) -> [u8; 32] {
        let mut mix = [0u8; 32];
        mix[0] = self.preset as u8;
        mix[1] = self.compression_algorithm as u8;
        mix[2] = self.encryption_algorithm as u8;
        mix[3] = (self.target_cell_size as u16).to_le_bytes()[0];
        mix[4..12].copy_from_slice(&(self.original_len as u64).to_le_bytes());
        mix[12..20].copy_from_slice(&(self.compressed_len as u64).to_le_bytes());
        mix[20..28].copy_from_slice(&(self.encrypted_len as u64).to_le_bytes());
        mix[28..30].copy_from_slice(&(self.target_cell_size as u16).to_le_bytes());
        mix[30] = protected_monolith_ratio_bucket(self.compressed_len, self.original_len);
        mix[31] = protected_monolith_ratio_bucket(
            self.encrypted_len.saturating_sub(self.compressed_len),
            self.compressed_len.max(1),
        );
        mix
    }
}

#[cfg(feature = "compression")]
#[allow(dead_code)]
fn protected_monolith_encode_payload(
    encrypted_bytes: &[u8],
    shell_key: &Key,
    nonce: &[u8; SHELL_NONCE_SIZE],
    requested_chunk_size: Option<usize>,
    original_len: usize,
    compressed_len: usize,
    compression_algorithm: CompressionAlgorithm,
    encryption_algorithm: EncryptionAlgorithm,
    preset: FusedPreset,
) -> Result<(Vec<u8>, usize)> {
    let target_cell_size = resolve_protected_monolith_cell_size(
        requested_chunk_size,
        original_len,
        compressed_len,
        encrypted_bytes.len(),
        preset,
    )?;
    let plan = ProtectedMonolithPlan {
        preset,
        compression_algorithm,
        encryption_algorithm,
        original_len,
        compressed_len,
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
    original_len: usize,
    compressed_len: usize,
    compression_algorithm: CompressionAlgorithm,
    encryption_algorithm: EncryptionAlgorithm,
    preset: FusedPreset,
) -> Result<Vec<u8>> {
    let geometry =
        field_monolith_infer_geometry(payload.len(), target_cell_size).ok_or_else(|| {
            Error::InvalidConfiguration(
                "protected monolith payload geometry was invalid".to_string(),
            )
        })?;
    let plan = ProtectedMonolithPlan {
        preset,
        compression_algorithm,
        encryption_algorithm,
        original_len,
        compressed_len,
        encrypted_len: geometry.original_len,
        target_cell_size,
    };
    let state = protected_monolith_initial_state(shell_key, nonce, plan)?;
    field_monolith_decode_payload_with_state(payload, target_cell_size, state)
}

#[cfg(feature = "compression")]
#[allow(dead_code)]
fn resolve_protected_monolith_cell_size(
    requested: Option<usize>,
    _original_len: usize,
    _compressed_len: usize,
    encrypted_len: usize,
    _preset: FusedPreset,
) -> Result<usize> {
    resolve_field_monolith_current_cell_size(requested, encrypted_len)
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
    let mix = plan.mix_bytes();

    state.phase = (state.phase ^ seed[0] ^ mix[0].rotate_left(1)) | 1;
    state.tension ^= seed[1].rotate_right(1) ^ mix[1];
    state.curvature ^= seed[2].rotate_left(2) ^ mix[2];
    state.drift ^= seed[3].rotate_right(2) ^ mix[3];
    state.echo ^= seed[4].rotate_left(3) ^ mix[30];
    state.reserve ^= seed[5].rotate_right(3) ^ mix[31];
    state.stride = (state.stride ^ ((seed[6] ^ mix[28]) & 0x0F)).max(1);
    state.parity ^= seed[7] ^ mix[29];

    Ok(state)
}

#[cfg(feature = "compression")]
#[derive(Debug, Clone, Copy)]
struct WholeMonolithV0InitialMaterial {
    state: [u8; 32],
    cloak: [u8; 32],
}

#[cfg(feature = "compression")]
#[derive(Debug, Clone, Copy)]
struct WholeMonolithV0Header {
    version: u8,
    preset: FusedPreset,
    compression_algorithm: CompressionAlgorithm,
    encryption_algorithm: EncryptionAlgorithm,
    shell_cell_size_policy: usize,
    original_size: usize,
    compressed_size: usize,
    encrypted_size: usize,
    shell_chunk_count: usize,
    max_plain_chunk_size: usize,
    shell_nonce: [u8; SHELL_NONCE_SIZE],
}

#[cfg(feature = "compression")]
impl WholeMonolithV0Header {
    fn to_bytes(self) -> [u8; WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN] {
        let mut bytes = [0u8; WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN];
        bytes[0] = self.version;
        bytes[1] = self.preset as u8;
        bytes[2] = self.compression_algorithm as u8;
        bytes[3] = self.encryption_algorithm as u8;
        bytes[4..8].copy_from_slice(&(self.shell_cell_size_policy as u32).to_be_bytes());
        bytes[8..16].copy_from_slice(&(self.original_size as u64).to_be_bytes());
        bytes[16..24].copy_from_slice(&(self.compressed_size as u64).to_be_bytes());
        bytes[24..32].copy_from_slice(&(self.encrypted_size as u64).to_be_bytes());
        bytes[32..36].copy_from_slice(&(self.shell_chunk_count as u32).to_be_bytes());
        bytes[36..40].copy_from_slice(&(self.max_plain_chunk_size as u32).to_be_bytes());
        bytes[40..52].copy_from_slice(&self.shell_nonce);
        bytes
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN {
            return Err(Error::TruncatedPayload {
                expected: WHOLE_MONOLITH_V0_PUBLIC_HEADER_LEN,
                actual: bytes.len(),
            });
        }

        let version = bytes[0];
        if version != PROTECTED_ARTIFACT_VERSION {
            return Err(Error::UnsupportedVersion(version));
        }

        let preset = FusedPreset::from_byte(bytes[1])?;
        let compression_algorithm = CompressionAlgorithm::from_byte(bytes[2])?;
        let encryption_algorithm = EncryptionAlgorithm::from_byte(bytes[3])?;
        let shell_cell_size_policy =
            u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
        let original_size = whole_monolith_v0_read_u64_usize(&bytes[8..16], "original size")?;
        let compressed_size = whole_monolith_v0_read_u64_usize(&bytes[16..24], "compressed size")?;
        let encrypted_size = whole_monolith_v0_read_u64_usize(&bytes[24..32], "encrypted size")?;
        let shell_chunk_count =
            u32::from_be_bytes([bytes[32], bytes[33], bytes[34], bytes[35]]) as usize;
        let max_plain_chunk_size =
            u32::from_be_bytes([bytes[36], bytes[37], bytes[38], bytes[39]]) as usize;
        let mut shell_nonce = [0u8; SHELL_NONCE_SIZE];
        shell_nonce.copy_from_slice(&bytes[40..52]);

        Ok(Self {
            version,
            preset,
            compression_algorithm,
            encryption_algorithm,
            shell_cell_size_policy,
            original_size,
            compressed_size,
            encrypted_size,
            shell_chunk_count,
            max_plain_chunk_size,
            shell_nonce,
        })
    }

    fn info(self, protected_size: usize) -> ProtectedArtifactInfo {
        ProtectedArtifactInfo {
            version: self.version,
            preset: self.preset,
            preset_label: self.preset.name().to_string(),
            compression_algorithm: self.compression_algorithm,
            encryption_algorithm: self.encryption_algorithm,
            original_size: self.original_size,
            compressed_size: self.compressed_size,
            encrypted_size: self.encrypted_size,
            protected_size,
            shell_chunk_size: self.max_plain_chunk_size as u32,
            shell_chunk_count: self.shell_chunk_count,
            shell_nonce: self.shell_nonce,
        }
    }

    fn requested_shell_cell_size(self) -> Option<usize> {
        if self.shell_cell_size_policy == 0 {
            None
        } else {
            Some(self.shell_cell_size_policy)
        }
    }
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
    let shell_nonce = canonicalize_nonce(opts.shell_nonce.unwrap_or_else(random_nonce));
    let public_seed = [shell_nonce[0], shell_nonce[1]];
    let (shell_key, tag_key) = derive_shell_keys(master_key, &shell_nonce)?;
    let initial_material = whole_monolith_v0_initial_material(master_key, &shell_nonce)?;
    let encryption_algorithm = opts
        .encryption_algorithm
        .unwrap_or(EncryptionAlgorithm::XChaCha20Poly1305);
    let shell_cell_size_policy = opts.shell_chunk_size.unwrap_or(0);
    if shell_cell_size_policy > MAX_CHUNK_SIZE {
        return Err(Error::InvalidConfiguration(format!(
            "shell chunk size must be at most {MAX_CHUNK_SIZE} bytes"
        )));
    }

    let mut state = initial_material.state;
    let mut body = Vec::new();
    let mut cursor = 0usize;
    let mut chunk_index = 0usize;
    let mut compressed_total = 0usize;
    let mut encrypted_total = 0usize;
    let mut max_plain_chunk_size = 0usize;
    let mut reported_compression_algorithm = None;

    while cursor < plaintext.len() {
        let remaining = plaintext.len() - cursor;
        let plain_len = whole_monolith_v0_next_plain_chunk_len(&state, remaining);
        let plain_chunk = &plaintext[cursor..cursor + plain_len];
        max_plain_chunk_size = max_plain_chunk_size.max(plain_len);

        let compressed = compression::compress(
            plain_chunk,
            Some(CompressionOptions {
                algorithm: opts.compression_algorithm,
                min_size_threshold: opts.compression_min_size_threshold,
                level: opts.compression_level,
            }),
        )?;
        reported_compression_algorithm = Some(match reported_compression_algorithm {
            Some(previous) if previous == compressed.algorithm => previous,
            Some(_) => opts.compression_algorithm,
            None => compressed.algorithm,
        });

        let aad = whole_monolith_v0_chunk_aad(chunk_index, &state);
        let encryption_nonce = whole_monolith_v0_chunk_encryption_nonce(
            &state,
            chunk_index,
            plain_chunk.len(),
            compressed.compressed.len(),
            &compressed.compressed,
        );
        let encrypted = whole_monolith_v0_encrypt_chunk(
            &compressed.compressed,
            master_key,
            encryption_algorithm,
            &encryption_nonce,
            &aad,
        )?;
        let shell_cell_size =
            whole_monolith_v0_shell_cell_size(&state, plain_chunk.len(), opts.shell_chunk_size);
        let shell_nonce = whole_monolith_v0_shell_nonce(&state, chunk_index);
        let (shell_payload, _) = field_monolith_encode_payload(
            &encrypted,
            &shell_key,
            &shell_nonce,
            Some(shell_cell_size),
        )?;

        body.push(compressed.algorithm as u8);
        whole_monolith_v0_write_varint(shell_payload.len(), &mut body);
        body.extend_from_slice(&shell_payload);

        compressed_total += compressed.compressed.len();
        encrypted_total += encrypted.len();
        cursor += plain_len;
        if cursor < plaintext.len() {
            state = whole_monolith_v0_next_state(
                master_key,
                &state,
                chunk_index,
                plain_chunk.len(),
                compressed.compressed.len(),
                encrypted.len(),
                shell_payload.len(),
                &shell_payload,
            )?;
        }
        chunk_index += 1;
    }

    let header = WholeMonolithV0Header {
        version: PROTECTED_ARTIFACT_VERSION,
        preset: opts.preset,
        compression_algorithm: reported_compression_algorithm.unwrap_or(CompressionAlgorithm::None),
        encryption_algorithm,
        shell_cell_size_policy,
        original_size: plaintext.len(),
        compressed_size: compressed_total,
        encrypted_size: encrypted_total,
        shell_chunk_count: chunk_index,
        max_plain_chunk_size,
        shell_nonce,
    };
    let header_bytes = header.to_bytes();
    let mut tag_input = Vec::with_capacity(header_bytes.len() + body.len());
    tag_input.extend_from_slice(&header_bytes);
    tag_input.extend_from_slice(&body);
    let tag = compute_shell_tag(&tag_input, &tag_key)?;

    body.extend_from_slice(&tag);
    whole_monolith_v0_apply_cloak(&mut body, &initial_material.cloak);

    let mut masked_header = header_bytes;
    whole_monolith_v0_mask_public_header(&public_seed, &mut masked_header);

    let mut artifact =
        Vec::with_capacity(WHOLE_MONOLITH_V0_PUBLIC_SEED_BYTES + masked_header.len() + body.len());
    artifact.extend_from_slice(&public_seed);
    artifact.extend_from_slice(&masked_header);
    artifact.extend_from_slice(&body);

    let info = header.info(artifact.len());
    Ok(ProtectResult { artifact, info })
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_open(artifact: &[u8], master_key: &Key) -> Result<Vec<u8>> {
    let (header, header_bytes, body_and_tag) = whole_monolith_v0_split_artifact(artifact)?;
    let (shell_key, tag_key) = derive_shell_keys(master_key, &header.shell_nonce)?;
    let initial_material = whole_monolith_v0_initial_material(master_key, &header.shell_nonce)?;
    let mut uncloaked = body_and_tag.to_vec();
    whole_monolith_v0_apply_cloak(&mut uncloaked, &initial_material.cloak);

    if uncloaked.len() < SHELL_TAG_SIZE {
        return Err(Error::TruncatedPayload {
            expected: SHELL_TAG_SIZE,
            actual: uncloaked.len(),
        });
    }
    let tag_start = uncloaked.len() - SHELL_TAG_SIZE;
    let (body, tag) = uncloaked.split_at(tag_start);
    let mut tag_input = Vec::with_capacity(header_bytes.len() + body.len());
    tag_input.extend_from_slice(&header_bytes);
    tag_input.extend_from_slice(body);
    if !verify_shell_tag(&tag_input, tag, &tag_key)? {
        return Err(Error::AuthenticationFailed);
    }

    let mut output = Vec::with_capacity(header.original_size);
    let mut body_cursor = 0usize;
    let mut state = initial_material.state;
    let mut chunk_index = 0usize;
    let mut compressed_total = 0usize;
    let mut encrypted_total = 0usize;

    while output.len() < header.original_size {
        let compression_algorithm = *body.get(body_cursor).ok_or(Error::TruncatedPayload {
            expected: body_cursor + 1,
            actual: body.len(),
        })?;
        body_cursor += 1;
        let compression_algorithm = CompressionAlgorithm::from_byte(compression_algorithm)?;
        let shell_len = whole_monolith_v0_read_varint(body, &mut body_cursor)?;
        let shell_end = body_cursor.checked_add(shell_len).ok_or_else(|| {
            Error::InvalidConfiguration("whole monolith shell cursor overflowed".to_string())
        })?;
        if shell_end > body.len() {
            return Err(Error::TruncatedPayload {
                expected: shell_end,
                actual: body.len(),
            });
        }

        let remaining = header.original_size - output.len();
        let plain_len = whole_monolith_v0_next_plain_chunk_len(&state, remaining);
        let shell_cell_size = whole_monolith_v0_shell_cell_size(
            &state,
            plain_len,
            header.requested_shell_cell_size(),
        );
        let shell_nonce = whole_monolith_v0_shell_nonce(&state, chunk_index);
        let encrypted = field_monolith_decode_payload(
            &body[body_cursor..shell_end],
            &shell_key,
            &shell_nonce,
            shell_cell_size,
        )?;
        let aad = whole_monolith_v0_chunk_aad(chunk_index, &state);
        let compressed = whole_monolith_v0_decrypt_chunk(
            &encrypted,
            master_key,
            header.encryption_algorithm,
            &aad,
        )?;
        let decoded = compression::decompress(&compressed, compression_algorithm)?;
        if decoded.len() != plain_len {
            return Err(Error::SizeMismatch {
                expected: plain_len,
                actual: decoded.len(),
            });
        }

        compressed_total += compressed.len();
        encrypted_total += encrypted.len();
        output.extend_from_slice(&decoded);
        body_cursor = shell_end;

        if output.len() < header.original_size {
            state = whole_monolith_v0_next_state(
                master_key,
                &state,
                chunk_index,
                plain_len,
                compressed.len(),
                encrypted.len(),
                shell_len,
                &body[body_cursor - shell_len..body_cursor],
            )?;
        }
        chunk_index += 1;
    }

    if body_cursor != body.len() {
        return Err(Error::InvalidConfiguration(format!(
            "whole monolith artifact has {} trailing body bytes",
            body.len() - body_cursor
        )));
    }
    if chunk_index != header.shell_chunk_count {
        return Err(Error::SizeMismatch {
            expected: header.shell_chunk_count,
            actual: chunk_index,
        });
    }
    if compressed_total != header.compressed_size {
        return Err(Error::SizeMismatch {
            expected: header.compressed_size,
            actual: compressed_total,
        });
    }
    if encrypted_total != header.encrypted_size {
        return Err(Error::SizeMismatch {
            expected: header.encrypted_size,
            actual: encrypted_total,
        });
    }

    Ok(output)
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_inspect_artifact(artifact: &[u8]) -> Result<ProtectedArtifactInfo> {
    let (header, _, _) = whole_monolith_v0_split_artifact(artifact)?;
    Ok(header.info(artifact.len()))
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
fn whole_monolith_v0_write_varint(mut value: usize, output: &mut Vec<u8>) {
    while value >= 0x80 {
        output.push(((value & 0x7F) as u8) | 0x80);
        value >>= 7;
    }
    output.push(value as u8);
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_read_varint(input: &[u8], cursor: &mut usize) -> Result<usize> {
    let mut shift = 0usize;
    let mut value = 0usize;
    for _ in 0..10 {
        let byte = *input.get(*cursor).ok_or(Error::TruncatedPayload {
            expected: *cursor + 1,
            actual: input.len(),
        })?;
        *cursor += 1;
        value |= ((byte & 0x7F) as usize) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
        shift += 7;
    }
    Err(Error::InvalidConfiguration(
        "whole monolith varint exceeds usize range".to_string(),
    ))
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_derive_array(
    master_key: &Key,
    salt: Option<&[u8]>,
    domain: &str,
) -> Result<[u8; 32]> {
    let bytes = derive_domain_bytes(master_key, salt, domain, 32)?;
    let mut array = [0u8; 32];
    array.copy_from_slice(&bytes);
    Ok(array)
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_initial_material(
    master_key: &Key,
    artifact_nonce: &[u8; SHELL_NONCE_SIZE],
) -> Result<WholeMonolithV0InitialMaterial> {
    let bytes = derive_domain_bytes(
        master_key,
        Some(artifact_nonce),
        WHOLE_MONOLITH_V0_MATERIAL_DOMAIN,
        64,
    )?;
    let mut state = [0u8; 32];
    let mut cloak = [0u8; 32];
    state.copy_from_slice(&bytes[..32]);
    cloak.copy_from_slice(&bytes[32..]);
    Ok(WholeMonolithV0InitialMaterial { state, cloak })
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_shell_nonce(state: &[u8; 32], chunk_index: usize) -> [u8; SHELL_NONCE_SIZE] {
    let index = (chunk_index as u64).to_le_bytes();
    let mut nonce = [0u8; SHELL_NONCE_SIZE];
    for offset in 0..nonce.len() {
        nonce[offset] = state[offset]
            ^ state[16 + offset].rotate_left((offset as u32) + 1)
            ^ index[offset % index.len()].rotate_left((offset as u32) & 0x07)
            ^ (PROTECTED_ARTIFACT_VERSION.wrapping_mul(17)).rotate_left(offset as u32);
    }
    nonce
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_next_plain_chunk_len(state: &[u8; 32], remaining: usize) -> usize {
    if remaining <= WHOLE_MONOLITH_V0_SINGLE_MACROCELL_MAX_BYTES {
        return remaining;
    }
    let base = if remaining >= 768 * 1024 {
        WHOLE_MONOLITH_V0_LARGE_CHUNK_BYTES
    } else {
        WHOLE_MONOLITH_V0_MEDIUM_CHUNK_BYTES
    };
    let spread = (base / 4).max(1);
    let word = u16::from_le_bytes([state[0], state[1]]) as usize;
    let mut target = base - (spread / 2) + (word % spread);
    target = target.clamp(WHOLE_MONOLITH_V0_MIN_CHUNK_BYTES, remaining);
    if remaining > target && remaining - target < WHOLE_MONOLITH_V0_SMALL_REMAINDER_BYTES {
        remaining
    } else {
        target
    }
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_shell_cell_size(
    _state: &[u8; 32],
    plain_len: usize,
    requested: Option<usize>,
) -> usize {
    if let Some(requested) = requested {
        return requested.clamp(FIELD_MONOLITH_MIN_CELL_BYTES, FIELD_MONOLITH_MAX_CELL_BYTES);
    }
    if plain_len <= 384 {
        128
    } else if plain_len <= 16 * 1024 {
        256
    } else {
        512
    }
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_chunk_aad(chunk_index: usize, state: &[u8; 32]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(WHOLE_MONOLITH_V0_CHUNK_AAD_PREFIX.len() + 1 + 8 + 32);
    aad.extend_from_slice(WHOLE_MONOLITH_V0_CHUNK_AAD_PREFIX);
    aad.push(PROTECTED_ARTIFACT_VERSION);
    aad.extend_from_slice(&(chunk_index as u64).to_le_bytes());
    aad.extend_from_slice(state);
    aad
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_chunk_encryption_nonce(
    state: &[u8; 32],
    chunk_index: usize,
    plain_len: usize,
    compressed_len: usize,
    compressed_bytes: &[u8],
) -> [u8; 24] {
    let index = (chunk_index as u64).to_le_bytes();
    let plain = (plain_len as u64).to_le_bytes();
    let compressed = (compressed_len as u64).to_le_bytes();
    let digest = whole_monolith_v0_surface_digest(compressed_bytes);
    let mut nonce = [0u8; 24];
    for offset in 0..nonce.len() {
        let left = state[offset];
        let mid = state[(offset + 11) & 31].rotate_left(((offset + 1) & 0x07) as u32);
        let right = state[(offset + 23) & 31].rotate_right(((offset + 3) & 0x07) as u32);
        nonce[offset] = left
            ^ mid
            ^ right
            ^ index[offset & 0x07].rotate_left((offset & 0x07) as u32)
            ^ plain[(offset + 3) & 0x07].rotate_right((offset & 0x07) as u32)
            ^ compressed[(offset + 5) & 0x07]
            ^ digest[offset & 0x0F].rotate_left(((offset + 2) & 0x07) as u32)
            ^ PROTECTED_ARTIFACT_VERSION.wrapping_mul(29);
    }
    nonce
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_surface_digest(bytes: &[u8]) -> [u8; 16] {
    let mut digest = [0u8; 16];
    for (index, &byte) in bytes.iter().enumerate() {
        let lane = index & 0x0F;
        digest[lane] = digest[lane].wrapping_add(byte.rotate_left((index & 0x07) as u32))
            ^ (index as u8).wrapping_mul(31);
    }
    digest
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_next_state(
    master_key: &Key,
    state: &[u8; 32],
    chunk_index: usize,
    plain_len: usize,
    compressed_len: usize,
    encrypted_len: usize,
    shell_len: usize,
    shell_bytes: &[u8],
) -> Result<[u8; 32]> {
    let mut salt = [0u8; WHOLE_MONOLITH_V0_STATE_SALT_BYTES];
    let mut cursor = 0usize;
    salt[cursor..cursor + state.len()].copy_from_slice(state);
    cursor += state.len();
    salt[cursor..cursor + 8].copy_from_slice(&(chunk_index as u64).to_le_bytes());
    cursor += 8;
    salt[cursor..cursor + 8].copy_from_slice(&(plain_len as u64).to_le_bytes());
    cursor += 8;
    salt[cursor..cursor + 8].copy_from_slice(&(compressed_len as u64).to_le_bytes());
    cursor += 8;
    salt[cursor..cursor + 8].copy_from_slice(&(encrypted_len as u64).to_le_bytes());
    cursor += 8;
    salt[cursor..cursor + 8].copy_from_slice(&(shell_len as u64).to_le_bytes());
    cursor += 8;
    salt[cursor..cursor + 16].copy_from_slice(&whole_monolith_v0_surface_digest(shell_bytes));
    whole_monolith_v0_derive_array(master_key, Some(&salt), WHOLE_MONOLITH_V0_STATE_DOMAIN)
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

#[cfg(feature = "compression")]
fn whole_monolith_v0_encrypt_chunk(
    plaintext: &[u8],
    master_key: &Key,
    algorithm: EncryptionAlgorithm,
    nonce: &[u8; 24],
    aad: &[u8],
) -> Result<Vec<u8>> {
    let sealed = match algorithm {
        EncryptionAlgorithm::Aes256Gcm => {
            let cipher = Aes256Gcm::new_from_slice(master_key.as_bytes())
                .map_err(|error| Error::EncryptionFailed(error.to_string()))?;
            cipher
                .encrypt(
                    AesGcmNonce::from_slice(&nonce[..12]),
                    Payload {
                        msg: plaintext,
                        aad,
                    },
                )
                .map_err(|error| Error::EncryptionFailed(error.to_string()))
        }
        EncryptionAlgorithm::XChaCha20Poly1305 => {
            let cipher = XChaCha20Poly1305::new_from_slice(master_key.as_bytes())
                .map_err(|error| Error::EncryptionFailed(error.to_string()))?;
            cipher
                .encrypt(
                    XNonce::from_slice(nonce),
                    Payload {
                        msg: plaintext,
                        aad,
                    },
                )
                .map_err(|error| Error::EncryptionFailed(error.to_string()))
        }
    }?;

    let nonce_len = algorithm.nonce_len();
    let mut wire = Vec::with_capacity(8 + nonce_len + sealed.len());
    wire.extend_from_slice(MAGIC_ENCRYPTED);
    wire.push(crate::FORMAT_VERSION);
    wire.push(algorithm as u8);
    wire.push(nonce_len as u8);
    wire.push(0);
    wire.extend_from_slice(&nonce[..nonce_len]);
    wire.extend_from_slice(&sealed);
    Ok(wire)
}

#[cfg(feature = "compression")]
fn whole_monolith_v0_decrypt_chunk(
    encrypted: &[u8],
    master_key: &Key,
    algorithm: EncryptionAlgorithm,
    aad: &[u8],
) -> Result<Vec<u8>> {
    if encrypted.len() < 8 + algorithm.nonce_len() + SHELL_TAG_SIZE {
        return Err(Error::TruncatedPayload {
            expected: 8 + algorithm.nonce_len() + SHELL_TAG_SIZE,
            actual: encrypted.len(),
        });
    }
    if &encrypted[..MAGIC_ENCRYPTED.len()] != MAGIC_ENCRYPTED {
        return Err(Error::InvalidFormat);
    }
    let version = encrypted[4];
    if version != crate::FORMAT_VERSION {
        return Err(Error::UnsupportedVersion(version));
    }
    let encoded_algorithm = EncryptionAlgorithm::from_byte(encrypted[5])?;
    if encoded_algorithm != algorithm {
        return Err(Error::InvalidFormat);
    }
    let nonce_len = encrypted[6] as usize;
    if nonce_len != algorithm.nonce_len() {
        return Err(Error::InvalidNonceLength {
            expected: algorithm.nonce_len(),
            actual: nonce_len,
        });
    }
    let nonce_start = 8usize;
    let nonce_end = nonce_start + nonce_len;
    let nonce = &encrypted[nonce_start..nonce_end];
    let sealed = &encrypted[nonce_end..];

    match algorithm {
        EncryptionAlgorithm::Aes256Gcm => {
            let cipher = Aes256Gcm::new_from_slice(master_key.as_bytes())
                .map_err(|error| Error::DecryptionFailed(error.to_string()))?;
            cipher
                .decrypt(AesGcmNonce::from_slice(nonce), Payload { msg: sealed, aad })
                .map_err(|_| Error::AuthenticationFailed)
        }
        EncryptionAlgorithm::XChaCha20Poly1305 => {
            let cipher = XChaCha20Poly1305::new_from_slice(master_key.as_bytes())
                .map_err(|error| Error::DecryptionFailed(error.to_string()))?;
            cipher
                .decrypt(XNonce::from_slice(nonce), Payload { msg: sealed, aad })
                .map_err(|_| Error::AuthenticationFailed)
        }
    }
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

fn field_monolith_current_geometry_profile(
    payload_len: usize,
    target_cell_size: usize,
) -> FieldMonolithGeometry {
    let chunk_count = chunk_count(payload_len, target_cell_size.max(1));
    let block_cells = field_monolith_current_anchor_block_cells(target_cell_size, chunk_count);
    let block_count = field_monolith_block_count_for_cells(chunk_count, block_cells);
    FieldMonolithGeometry {
        original_len: payload_len,
        target_cell_size,
        chunk_count,
        block_cells,
        block_count,
    }
}

fn field_monolith_infer_geometry(
    payload_len: usize,
    target_cell_size: usize,
) -> Option<FieldMonolithGeometry> {
    let target_cell_size = target_cell_size.max(1);
    if payload_len == 0 {
        return Some(FieldMonolithGeometry {
            original_len: 0,
            target_cell_size,
            chunk_count: 0,
            block_cells: field_monolith_current_anchor_block_cells(target_cell_size, 0),
            block_count: 0,
        });
    }

    let max_chunks = payload_len
        .min(
            payload_len
                .div_ceil(target_cell_size)
                .saturating_add(payload_len / FIELD_MONOLITH_ANCHOR_BLOCK_CELLS_COMPACT)
                .saturating_add(8),
        )
        .max(1);

    for chunk_count in 1..=max_chunks {
        let block_cells = field_monolith_current_anchor_block_cells(target_cell_size, chunk_count);
        let block_count = field_monolith_block_count_for_cells(chunk_count, block_cells);
        if block_count > payload_len {
            continue;
        }
        let original_len = payload_len - block_count;
        let min_original_len = (chunk_count - 1)
            .saturating_mul(target_cell_size)
            .saturating_add(1);
        let max_original_len = chunk_count.saturating_mul(target_cell_size);
        if (min_original_len..=max_original_len).contains(&original_len) {
            return Some(FieldMonolithGeometry {
                original_len,
                target_cell_size,
                chunk_count,
                block_cells,
                block_count,
            });
        }
    }

    None
}

fn field_monolith_block_count_for_cells(chunk_count: usize, block_cells: usize) -> usize {
    if chunk_count == 0 {
        0
    } else {
        1 + (chunk_count - 1) / block_cells.max(1)
    }
}

fn field_monolith_anchor_block_cells(target_cell_size: usize) -> usize {
    if target_cell_size.max(1) <= FIELD_MONOLITH_MAX_CELL_BYTES {
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

fn field_monolith_current_anchor_block_count(chunk_count: usize, target_cell_size: usize) -> usize {
    let block_cells = field_monolith_current_anchor_block_cells(target_cell_size, chunk_count);
    field_monolith_block_count_for_cells(chunk_count, block_cells)
}

fn field_monolith_current_anchor_total_original_len(
    payload_len: usize,
    chunk_count: usize,
    target_cell_size: usize,
) -> Result<usize> {
    let anchor_bytes = field_monolith_current_anchor_block_count(chunk_count, target_cell_size);
    payload_len.checked_sub(anchor_bytes).ok_or_else(|| {
        Error::InvalidConfiguration(
            "field monolith current payload underflowed anchor bytes".to_string(),
        )
    })
}

fn field_monolith_current_surface_len(
    payload: &[u8],
    cursor: usize,
    cell_index: usize,
    chunk_count: usize,
    chunk_size: usize,
) -> Result<usize> {
    if cell_index >= chunk_count {
        return Err(Error::InvalidConfiguration(
            "field monolith current cell index exceeded chunk count".to_string(),
        ));
    }
    if cell_index + 1 < chunk_count {
        let next_cursor = cursor.checked_add(chunk_size).ok_or_else(|| {
            Error::InvalidConfiguration(
                "field monolith current non-final cursor overflowed".to_string(),
            )
        })?;
        if next_cursor > payload.len() {
            return Err(Error::TruncatedPayload {
                expected: next_cursor,
                actual: payload.len(),
            });
        }
        return Ok(chunk_size);
    }

    let total_original_len =
        field_monolith_current_anchor_total_original_len(payload.len(), chunk_count, chunk_size)?;
    let consumed_before_last = chunk_size
        .checked_mul(chunk_count.saturating_sub(1))
        .ok_or_else(|| {
            Error::InvalidConfiguration(
                "field monolith current consumed length overflowed".to_string(),
            )
        })?;
    let original_len = total_original_len
        .checked_sub(consumed_before_last)
        .ok_or_else(|| {
            Error::InvalidConfiguration("field monolith current last cell underflowed".to_string())
        })?;
    let next_cursor = cursor.checked_add(original_len).ok_or_else(|| {
        Error::InvalidConfiguration("field monolith current last cursor overflowed".to_string())
    })?;
    if next_cursor > payload.len() {
        return Err(Error::TruncatedPayload {
            expected: next_cursor,
            actual: payload.len(),
        });
    }
    Ok(original_len)
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

fn field_monolith_next_cell_len(remaining: usize, target_cell_size: usize) -> usize {
    remaining.min(target_cell_size.max(1))
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

fn field_monolith_anchor_baseline_intensity_limit(cell_len: usize) -> usize {
    match field_monolith_cell_band(cell_len) {
        0 => 2,
        1 => 3,
        2 => 3,
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

fn field_monolith_anchor_for_block(
    state: &FieldMonolithState,
    block_index: u32,
    rng: &mut DeterministicRng,
    base_cell_size: usize,
) -> u8 {
    let block0 = block_index as u8;
    let block1 = (block_index >> 8) as u8;
    let block2 = (block_index >> 16) as u8;
    let block3 = (block_index >> 24) as u8;
    let size0 = base_cell_size as u8;
    let size1 = (base_cell_size >> 8) as u8;
    let phase_rot = state.phase.rotate_left(1);
    let echo_rot = state.echo.rotate_right(1);
    let size0_rot1 = size0.rotate_left(1);
    let size0_rot2 = size0.rotate_left(2);
    let size1_rot1 = size1.rotate_right(1);
    let regime = (rng.next_u32() as u8 ^ state.phase ^ state.curvature ^ block0 ^ size0) & 0x03;
    let cadence = (rng.next_u32() as u8 ^ state.echo ^ state.reserve ^ block1 ^ size1) & 0x03;
    let intensity =
        (rng.next_u32() as u8 ^ state.parity ^ state.tension ^ block2 ^ size0_rot1) & 0x03;
    let stride_seed =
        (rng.next_u32() as u8 ^ state.stride ^ state.drift ^ block3 ^ size1_rot1) & 0x03;
    let counter_orbit = block0 ^ phase_rot ^ echo_rot ^ size0_rot2 ^ size1_rot1;
    let cadence = (cadence.wrapping_add(counter_orbit) ^ intensity.rotate_left(1)) & 0x03;
    let intensity =
        (intensity.wrapping_add(counter_orbit.rotate_right(1)) ^ stride_seed.rotate_left(1)) & 0x03;
    let stride_seed =
        (stride_seed.wrapping_add(counter_orbit.rotate_left(1)) ^ regime.rotate_right(1)) & 0x03;

    regime | (cadence << 2) | (intensity << 4) | (stride_seed << 6)
}

fn field_monolith_anchor_baseline_for_block(
    state: &FieldMonolithState,
    block_index: u32,
    rng: &mut DeterministicRng,
    base_cell_size: usize,
) -> u8 {
    let block_mix = block_index.to_le_bytes();
    let size_mix = (base_cell_size as u16).to_le_bytes();
    let regime =
        (rng.next_u32() as u8 ^ state.phase ^ state.curvature ^ block_mix[0] ^ size_mix[0]) & 0x03;
    let cadence =
        (rng.next_u32() as u8 ^ state.echo ^ state.reserve ^ block_mix[1] ^ size_mix[1]) & 0x03;
    let intensity = (rng.next_u32() as u8
        ^ state.parity
        ^ state.tension
        ^ block_mix[2]
        ^ size_mix[0].rotate_left(1))
        & 0x03;
    let stride_seed = (rng.next_u32() as u8
        ^ state.stride
        ^ state.drift
        ^ block_mix[3]
        ^ size_mix[1].rotate_right(1))
        & 0x03;

    regime | (cadence << 2) | (intensity << 4) | (stride_seed << 6)
}

fn field_monolith_current_anchor_for_block_with_chunk_count(
    state: &FieldMonolithState,
    block_index: u32,
    rng: &mut DeterministicRng,
    base_cell_size: usize,
    _chunk_count: usize,
) -> u8 {
    if base_cell_size >= FIELD_MONOLITH_AUTO_MID_CELL_BYTES {
        field_monolith_anchor_baseline_for_block(state, block_index, rng, base_cell_size)
    } else {
        field_monolith_anchor_for_block(state, block_index, rng, base_cell_size)
    }
}

fn field_monolith_plan_for_anchor_cell(
    anchor: u8,
    cell_index: u32,
    cell_len: usize,
    ordinal_in_block: usize,
) -> FieldMonolithCellPlan {
    if cell_len >= FIELD_MONOLITH_CURRENT_AUTO_DIFFUSED_SMALL_CELL_BYTES {
        return field_monolith_plan_for_anchor_baseline_cell(
            anchor,
            cell_index,
            cell_len,
            ordinal_in_block,
        );
    }

    let regime = anchor & 0x03;
    let cadence = (anchor >> 2) & 0x03;
    let intensity = (anchor >> 4) & 0x03;
    let stride_seed = (anchor >> 6) & 0x03;
    let band = field_monolith_cell_band(cell_len) as u8;
    let ordinal = ordinal_in_block as u8;
    let cell_phase = (cell_index as u8)
        .wrapping_add(ordinal.wrapping_mul(3))
        .wrapping_add(band.rotate_left(1));
    let lane_orbit = if band >= 2 {
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
        + if band >= 2 {
            intensity as usize + (((cell_index as usize) >> 1) & 0x01)
        } else {
            0
        })
        % stride_limit)
        + 1;
    let intensity_limit = field_monolith_anchor_intensity_limit(cell_len);
    let pad_len = if intensity_limit <= 1 {
        0
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

fn field_monolith_plan_for_anchor_baseline_cell(
    anchor: u8,
    cell_index: u32,
    cell_len: usize,
    ordinal_in_block: usize,
) -> FieldMonolithCellPlan {
    let regime = anchor & 0x03;
    let cadence = (anchor >> 2) & 0x03;
    let intensity = (anchor >> 4) & 0x03;
    let stride_seed = (anchor >> 6) & 0x03;
    let band = field_monolith_cell_band(cell_len) as u8;
    let ordinal = ordinal_in_block as u8;
    let cell_phase = (cell_index as u8)
        .wrapping_add(ordinal.wrapping_mul(3))
        .wrapping_add(band.rotate_left(1));
    let mutation = FieldMonolithMutationMode::from_bits(
        regime.wrapping_add(cell_phase) ^ cadence.rotate_left((ordinal_in_block % 2) as u32),
    );
    let weave = FieldMonolithWeaveMode::from_bits(
        cadence
            .wrapping_add(ordinal)
            .wrapping_add((cell_index as u8).rotate_left(1))
            .wrapping_add(band),
    );
    let stride_limit = field_monolith_anchor_stride_limit(cell_len);
    let stride = ((stride_seed as usize
        + ordinal_in_block
        + ((cell_index as usize) & 0x01)
        + band as usize)
        % stride_limit)
        + 1;
    let intensity_limit = field_monolith_anchor_baseline_intensity_limit(cell_len);
    let pad_len = (intensity as usize
        + cadence as usize
        + ordinal_in_block
        + (((cell_index as usize) >> 1) & 0x01)
        + band as usize)
        % intensity_limit;

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

fn field_monolith_control_token_a(state: &FieldMonolithState, cell_len: usize) -> u8 {
    state.phase.wrapping_add(state.tension).rotate_left(1) ^ (cell_len as u8)
}

fn field_monolith_control_token_b(state: &FieldMonolithState, cell_index: u32) -> u8 {
    state.drift.wrapping_add(state.reserve).rotate_right(1) ^ (cell_index as u8)
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

fn field_monolith_surface_checksum(
    surface: &[u8],
    state: &FieldMonolithState,
    cell_index: u32,
    descriptor: u8,
) -> u8 {
    let mut acc =
        field_monolith_surface_checksum_seed(surface.len(), state, cell_index, descriptor);
    for (offset, &byte) in surface.iter().enumerate() {
        acc = field_monolith_surface_checksum_step(acc, state, offset, byte);
    }
    acc
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

fn field_monolith_xor_masked_bytes(input: &[u8], mask_lanes: &FieldMonolithMaskLanes) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len());
    let mut offset = 0usize;
    let mut tension_mix = mask_lanes.tension_base;
    let mut parity_mix = mask_lanes.parity_base;
    while offset < input.len() {
        output.push(
            input[offset]
                ^ mask_lanes.phase_lanes[offset & 0x07]
                ^ tension_mix
                ^ mask_lanes.curvature_lanes[offset & 0x07]
                ^ mask_lanes.drift_mix
                ^ mask_lanes.echo_mix
                ^ mask_lanes.reserve_lanes[offset & 0x07]
                ^ parity_mix,
        );
        tension_mix = tension_mix.wrapping_add(3);
        parity_mix = parity_mix.wrapping_add(7);
        offset += 1;
    }
    output
}

fn field_monolith_split_weave(bytes: &[u8]) -> Vec<u8> {
    let even_count = bytes.len().div_ceil(2);
    let odd_count = bytes.len() / 2;
    let mut output = Vec::with_capacity(bytes.len());
    let mut read_index = 0usize;
    while output.len() < even_count {
        output.push(bytes[read_index]);
        read_index += 2;
    }

    let mut odd_index = 0usize;
    let mut odd_read_index = 1usize;
    while odd_index < odd_count {
        output.push(bytes[odd_read_index]);
        odd_index += 1;
        odd_read_index += 2;
    }

    output
}

fn field_monolith_inverse_split_weave(bytes: &[u8]) -> Vec<u8> {
    let even_count = bytes.len().div_ceil(2);
    let (evens, odds) = bytes.split_at(even_count);
    let mut output = Vec::with_capacity(bytes.len());

    let mut even_index = 0usize;
    while even_index < evens.len() || even_index < odds.len() {
        if even_index < evens.len() {
            output.push(evens[even_index]);
        }
        if even_index < odds.len() {
            output.push(odds[even_index]);
        }
        even_index += 1;
    }

    output
}

fn field_monolith_apply_mutation_owned(
    mut bytes: Vec<u8>,
    mutation: FieldMonolithMutationMode,
    stride: usize,
) -> Vec<u8> {
    match mutation {
        FieldMonolithMutationMode::Direct => bytes,
        FieldMonolithMutationMode::StrideSwap => {
            if !bytes.is_empty() {
                let shift = stride % bytes.len();
                bytes.rotate_left(shift);
            }
            bytes
        }
        FieldMonolithMutationMode::SplitWeave => field_monolith_split_weave(&bytes),
        FieldMonolithMutationMode::MirrorWeave => {
            bytes.reverse();
            bytes
        }
    }
}

fn field_monolith_inverse_mutation_owned(
    mut bytes: Vec<u8>,
    mutation: FieldMonolithMutationMode,
    stride: usize,
) -> Vec<u8> {
    match mutation {
        FieldMonolithMutationMode::Direct => bytes,
        FieldMonolithMutationMode::StrideSwap => {
            if !bytes.is_empty() {
                let shift = stride % bytes.len();
                bytes.rotate_right(shift);
            }
            bytes
        }
        FieldMonolithMutationMode::SplitWeave => field_monolith_inverse_split_weave(&bytes),
        FieldMonolithMutationMode::MirrorWeave => {
            bytes.reverse();
            bytes
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

fn field_monolith_virtual_mix_round_limit(plan: FieldMonolithCellPlan) -> usize {
    plan.pad_len
}

fn field_monolith_apply_virtual_mix_with_summary(
    bytes: &mut [u8],
    state: &FieldMonolithState,
    plan: FieldMonolithCellPlan,
    cell_index: u32,
    descriptor: u8,
) -> FieldMonolithSurfaceSummary {
    let round_limit = field_monolith_virtual_mix_round_limit(plan);
    let len = bytes.len();
    let reserve_stride = state
        .reserve
        .wrapping_add((plan.stride as u8).wrapping_mul(13));
    let cell_mix = (cell_index as u8).wrapping_mul(19);
    let weave_mix = (plan.weave as u8).wrapping_add(3);
    let pad_mix = (plan.pad_len as u8).wrapping_mul(29);
    let echo_lanes = field_monolith_left_rotation_lanes(state.echo);
    let parity_lanes = field_monolith_right_rotation_lanes(state.parity);

    let mut round = 0usize;
    while round < round_limit {
        let mut round_echo_lanes = [0u8; 8];
        for (lane, echo) in round_echo_lanes.iter_mut().enumerate() {
            *echo = echo_lanes[(lane + round) & 7];
        }
        let round_mix = reserve_stride
            ^ parity_lanes[(cell_index as usize + plan.pad_len + round) & 7]
            ^ cell_mix
            ^ pad_mix
            ^ (round as u8).wrapping_mul(7);
        let mut offset = 0usize;
        let mut offset_mix = 0u8;
        while offset < len {
            bytes[offset] ^= round_echo_lanes[offset & 7] ^ offset_mix ^ round_mix;
            offset_mix = offset_mix.wrapping_add(weave_mix);
            offset += 1;
        }
        round += 1;
    }

    let mut digest =
        field_monolith_surface_checksum_seed(bytes.len(), state, cell_index, descriptor);
    let mut front = 0u8;
    let mut back = 0u8;
    let mut offset = 0usize;
    let mut final_echo_lanes = [0u8; 8];
    for (lane, echo) in final_echo_lanes.iter_mut().enumerate() {
        *echo = echo_lanes[(lane + round_limit) & 7];
    }
    let final_mix = reserve_stride
        ^ parity_lanes[(cell_index as usize + plan.pad_len + round_limit) & 7]
        ^ cell_mix
        ^ pad_mix
        ^ (round_limit as u8).wrapping_mul(7);
    let mut offset_mix = 0u8;
    while offset < len {
        bytes[offset] ^= final_echo_lanes[offset & 7] ^ offset_mix ^ final_mix;
        let byte = bytes[offset];
        if offset == 0 {
            front = byte;
        }
        back = byte;
        digest = field_monolith_surface_checksum_step(digest, state, offset, byte);
        offset_mix = offset_mix.wrapping_add(weave_mix);
        offset += 1;
    }

    FieldMonolithSurfaceSummary {
        digest,
        front,
        back,
        surface_len: bytes.len(),
    }
}

fn field_monolith_encode_surface_with_summary(
    plaintext: &[u8],
    state: &FieldMonolithState,
    plan: FieldMonolithCellPlan,
    cell_index: u32,
    descriptor: u8,
) -> (Vec<u8>, FieldMonolithSurfaceSummary) {
    let mask_lanes = field_monolith_mask_lanes(state, cell_index, plan.stride);
    let mixed = field_monolith_xor_masked_bytes(plaintext, &mask_lanes);
    let mut surface = field_monolith_apply_mutation_owned(mixed, plan.mutation, plan.stride);
    field_monolith_apply_virtual_permutation(&mut surface, state, plan, cell_index);
    let summary = field_monolith_apply_virtual_mix_with_summary(
        &mut surface,
        state,
        plan,
        cell_index,
        descriptor,
    );
    (surface, summary)
}

fn field_monolith_surface_summary(
    surface: &[u8],
    state: &FieldMonolithState,
    cell_index: u32,
    descriptor: u8,
) -> FieldMonolithSurfaceSummary {
    FieldMonolithSurfaceSummary {
        digest: field_monolith_surface_checksum(surface, state, cell_index, descriptor),
        front: surface.first().copied().unwrap_or(0),
        back: surface.last().copied().unwrap_or(0),
        surface_len: surface.len(),
    }
}

fn field_monolith_decode_surface_with_summary(
    surface: &[u8],
    state: &FieldMonolithState,
    plan: FieldMonolithCellPlan,
    cell_index: u32,
    original_len: usize,
    descriptor: u8,
) -> Result<(Vec<u8>, FieldMonolithSurfaceSummary)> {
    if surface.len() != original_len {
        return Err(Error::InvalidConfiguration(
            "field monolith native surface length did not match original bytes".to_string(),
        ));
    }

    let summary = field_monolith_surface_summary(surface, state, cell_index, descriptor);
    let mut mixed = surface.to_vec();
    field_monolith_apply_virtual_mix_with_summary(&mut mixed, state, plan, cell_index, descriptor);
    field_monolith_remove_virtual_permutation(&mut mixed, state, plan, cell_index);
    let mixed = field_monolith_inverse_mutation_owned(mixed, plan.mutation, plan.stride);
    let mask_lanes = field_monolith_mask_lanes(state, cell_index, plan.stride);
    let decoded = field_monolith_xor_masked_bytes(&mixed, &mask_lanes);

    Ok((decoded, summary))
}

fn field_monolith_update_state_with_summary(
    state: &mut FieldMonolithState,
    descriptor: u8,
    summary: FieldMonolithSurfaceSummary,
    cell_index: u32,
    cell_len: usize,
) {
    let control_a = field_monolith_control_token_a(state, cell_len);
    let control_b = field_monolith_control_token_b(state, cell_index);
    let span = (summary.surface_len as u8) ^ (cell_len as u8);

    state.phase = state.phase.wrapping_add(3).rotate_left(1) ^ summary.digest;
    state.tension =
        state.tension.wrapping_add(control_a).rotate_left(1) ^ summary.surface_len as u8;
    state.curvature = state.curvature.wrapping_add(summary.digest.rotate_left(1)) ^ span;
    state.drift = state.drift.wrapping_add(summary.front).rotate_right(1) ^ descriptor;
    state.echo = state.echo.wrapping_add(summary.back) ^ summary.digest.rotate_right(1);
    state.reserve = state.reserve.wrapping_add(control_b) ^ summary.digest.rotate_left(1);
    state.stride = state
        .stride
        .wrapping_add(((descriptor >> 4) & 0x03) + 1)
        .max(1);
    state.parity ^= summary.digest ^ summary.front ^ summary.back ^ span;
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
        (payload_len + chunk_size.saturating_sub(1)) / chunk_size.max(1)
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

fn canonicalize_nonce(nonce: [u8; SHELL_NONCE_SIZE]) -> [u8; SHELL_NONCE_SIZE] {
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
        assert_eq!(envelope.payload.len(), payload.len() + geometry.block_count);

        let restored = unfuse(&envelope, &master).unwrap();
        assert_eq!(restored, payload);
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
        let payload = b"voided v2 fused flow protects this payload cleanly".repeat(1024);

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
            payload.len(),
            compression_result.compressed.len(),
            compression_result.algorithm,
            encrypted.algorithm,
            opts.preset,
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
