//! Fused shell primitives and fused-first protect/open flows for Voided v2.

use alloc::{format, string::String, vec, vec::Vec};

use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::{
    encryption::{
        derive_key_hkdf, derive_key_hkdf_raw, Algorithm as EncryptionAlgorithm, EncryptOptions,
        EncryptionResult, Key,
    },
    hash::{compare_hashes, generate_hmac, HashAlgorithm},
    Error, Result,
};

#[cfg(feature = "compression")]
use crate::compression::{self, CompressionAlgorithm, CompressionOptions};

/// Truncated outer shell tag size in bytes.
pub const SHELL_TAG_SIZE: usize = 16;

/// Fused shell envelope magic bytes.
pub const FUSED_SHELL_MAGIC: [u8; 4] = *b"VFS2";

/// Fused shell envelope version.
pub const FUSED_SHELL_VERSION: u8 = 0x01;

/// Protected artifact magic bytes.
pub const PROTECTED_ARTIFACT_MAGIC: [u8; 4] = *b"VOF2";

/// Protected artifact version.
pub const PROTECTED_ARTIFACT_VERSION: u8 = 0x01;

/// Shell nonce size in bytes.
pub const SHELL_NONCE_SIZE: usize = 12;

/// Default fused shell chunk size in bytes.
pub const DEFAULT_CHUNK_SIZE: usize = 16 * 1024;

const MIN_CHUNK_SIZE: usize = 256;
const MAX_CHUNK_SIZE: usize = 1024 * 1024;
const FUSED_SHELL_HEADER_LEN: usize = 4 + 1 + 1 + 4 + SHELL_NONCE_SIZE;
const PROTECTED_ARTIFACT_HEADER_LEN: usize = 4 + 1 + 1 + 1 + 1 + 4 + 8 + 8 + SHELL_NONCE_SIZE;

fn domain_info(domain_label: &str) -> String {
    format!("voided:shell:{domain_label}")
}

/// Stable fused preset ids for Voided v2.
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

    fn default_chunk_size(self) -> usize {
        match self {
            Self::Compact => DEFAULT_CHUNK_SIZE,
            Self::Balanced => DEFAULT_CHUNK_SIZE,
            Self::Concealed => 8 * 1024,
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
        if version != FUSED_SHELL_VERSION {
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
        FusedShellInfo {
            version: self.version,
            preset: self.preset,
            preset_label: self.preset.name().to_string(),
            chunk_size: self.chunk_size,
            chunk_count: chunk_count(self.payload.len(), chunk_size),
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
        if version != PROTECTED_ARTIFACT_VERSION {
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
        ProtectedArtifactInfo {
            version: self.version,
            preset: self.preset,
            preset_label: self.preset.name().to_string(),
            compression_algorithm: self.compression_algorithm,
            encryption_algorithm: self.encryption_algorithm,
            original_size: self.original_size as usize,
            compressed_size: self.compressed_size as usize,
            encrypted_size: self.payload.len(),
            protected_size: self.payload.len() + PROTECTED_ARTIFACT_HEADER_LEN + SHELL_TAG_SIZE,
            shell_chunk_size: self.chunk_size,
            shell_chunk_count: chunk_count(self.payload.len(), chunk_size),
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
    let chunk_size = resolve_chunk_size(opts.preset, opts.chunk_size)?;
    let nonce = canonicalize_nonce(opts.shell_nonce.unwrap_or_else(random_nonce));
    let (shell_key, tag_key) = derive_shell_keys(master_key, &nonce)?;
    let payload = transform_payload(data, &shell_key, &nonce, opts.preset, chunk_size, true)?;

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

    transform_payload(
        &envelope.payload,
        &shell_key,
        &envelope.nonce,
        envelope.preset,
        envelope.chunk_size.max(1) as usize,
        false,
    )
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
/// Run the fused-first Voided v2 full flow.
pub fn protect(
    plaintext: &[u8],
    master_key: &Key,
    options: Option<ProtectOptions>,
) -> Result<ProtectResult> {
    let opts = options.unwrap_or_default();
    let chunk_size = resolve_chunk_size(opts.preset, opts.shell_chunk_size)?;
    let nonce = canonicalize_nonce(opts.shell_nonce.unwrap_or_else(random_nonce));

    let compression_result = compression::compress(
        plaintext,
        Some(CompressionOptions {
            algorithm: opts.compression_algorithm,
            min_size_threshold: opts.compression_min_size_threshold,
            level: opts.compression_level,
        }),
    )?;

    let encrypted = crate::encryption::encrypt(
        &compression_result.compressed,
        master_key,
        Some(EncryptOptions {
            algorithm: opts.encryption_algorithm,
            aad: None,
        }),
    )?;
    let encrypted_bytes = encrypted.to_bytes();

    let (shell_key, tag_key) = derive_shell_keys(master_key, &nonce)?;
    let payload = transform_payload(
        &encrypted_bytes,
        &shell_key,
        &nonce,
        opts.preset,
        chunk_size,
        true,
    )?;

    let mut envelope = ProtectedArtifactEnvelope {
        version: PROTECTED_ARTIFACT_VERSION,
        preset: opts.preset,
        compression_algorithm: compression_result.algorithm,
        encryption_algorithm: encrypted.algorithm,
        chunk_size: chunk_size as u32,
        original_size: plaintext.len() as u64,
        compressed_size: compression_result.compressed.len() as u64,
        nonce,
        payload,
        tag: [0u8; SHELL_TAG_SIZE],
    };
    envelope.tag = compute_shell_tag(&envelope.to_unsigned_bytes(), &tag_key)?;

    let artifact = envelope.to_bytes();
    let info = envelope.info();
    Ok(ProtectResult { artifact, info })
}

#[cfg(feature = "compression")]
/// Open a serialized fused protected artifact.
pub fn open(artifact: &[u8], master_key: &Key) -> Result<Vec<u8>> {
    let envelope = ProtectedArtifactEnvelope::from_bytes(artifact)?;
    let (shell_key, tag_key) = derive_shell_keys(master_key, &envelope.nonce)?;
    if !verify_shell_tag(&envelope.to_unsigned_bytes(), &envelope.tag, &tag_key)? {
        return Err(Error::AuthenticationFailed);
    }

    let encrypted_bytes = transform_payload(
        &envelope.payload,
        &shell_key,
        &envelope.nonce,
        envelope.preset,
        envelope.chunk_size.max(1) as usize,
        false,
    )?;
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
/// Inspect a protected artifact without decrypting it.
pub fn inspect_artifact(artifact: &[u8]) -> Result<ProtectedArtifactInfo> {
    Ok(ProtectedArtifactEnvelope::from_bytes(artifact)?.info())
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

fn transform_payload(
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

fn resolve_chunk_size(preset: FusedPreset, requested: Option<usize>) -> Result<usize> {
    let chunk_size = requested.unwrap_or_else(|| preset.default_chunk_size());
    if !(MIN_CHUNK_SIZE..=MAX_CHUNK_SIZE).contains(&chunk_size) {
        return Err(Error::InvalidConfiguration(format!(
            "shell chunk size must be between {MIN_CHUNK_SIZE} and {MAX_CHUNK_SIZE} bytes"
        )));
    }
    Ok(chunk_size)
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
        }
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
