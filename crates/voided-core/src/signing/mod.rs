//! Digital signature module providing Ed25519 and ECDSA (P-256).
//!
//! The RSA-PSS algorithm identifier (0x03) is reserved for wire compatibility but
//! has no linked implementation; all RSA-PSS operations return errors.
//!
//! This module is only available with the `signing` feature flag.

use crate::{Error, Result};
use alloc::{string::String, vec::Vec};
use serde::{Deserialize, Serialize};

/// Supported signing algorithms
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum SigningAlgorithm {
    /// Ed25519 (64-byte signatures)
    Ed25519 = 0x01,
    /// ECDSA with P-256 curve (DER encoded, variable size)
    EcdsaP256 = 0x02,
    /// Reserved wire identifier. RSA-PSS is not a supported operation.
    RsaPss2048 = 0x03,
}

impl SigningAlgorithm {
    /// Get algorithm from byte identifier
    pub fn from_byte(byte: u8) -> Result<Self> {
        match byte {
            0x01 => Ok(SigningAlgorithm::Ed25519),
            0x02 => Ok(SigningAlgorithm::EcdsaP256),
            0x03 => Ok(SigningAlgorithm::RsaPss2048),
            _ => Err(Error::UnsupportedAlgorithm(byte)),
        }
    }

    /// Get algorithm name as string
    pub fn name(&self) -> &'static str {
        match self {
            SigningAlgorithm::Ed25519 => "ed25519",
            SigningAlgorithm::EcdsaP256 => "ecdsa-p256",
            SigningAlgorithm::RsaPss2048 => "rsa-pss-2048",
        }
    }

    /// Whether this build implements key generation, signing, and verification.
    pub fn is_supported(&self) -> bool {
        matches!(
            self,
            SigningAlgorithm::Ed25519 | SigningAlgorithm::EcdsaP256
        )
    }
}

/// Generated key pair
#[derive(Clone)]
pub struct KeyPair {
    /// Public key in PEM format
    pub public_key_pem: String,
    /// Private key in PEM format
    pub private_key_pem: String,
}

impl core::fmt::Debug for KeyPair {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("KeyPair")
            .field("public_key_pem", &self.public_key_pem)
            .field("private_key_pem", &"[REDACTED]")
            .finish()
    }
}

impl Drop for KeyPair {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.private_key_pem.zeroize();
    }
}

/// Generate a signing key pair
#[cfg(feature = "signing")]
pub fn generate_key_pair(algorithm: SigningAlgorithm) -> Result<KeyPair> {
    match algorithm {
        SigningAlgorithm::Ed25519 => generate_ed25519_key_pair_pem(),
        SigningAlgorithm::EcdsaP256 => generate_ecdsa_p256_key_pair(),
        SigningAlgorithm::RsaPss2048 => generate_rsa_pss_key_pair(),
    }
}

#[cfg(feature = "signing")]
fn generate_ed25519_key_pair_pem() -> Result<KeyPair> {
    use ed25519_dalek::pkcs8::{EncodePrivateKey, EncodePublicKey};
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    let private_pem = signing_key
        .to_pkcs8_pem(Default::default())
        .map_err(|e| Error::KeyGenerationFailed(e.to_string()))?
        .to_string();
    let public_pem = verifying_key
        .to_public_key_pem(Default::default())
        .map_err(|e| Error::KeyGenerationFailed(e.to_string()))?;

    Ok(KeyPair {
        public_key_pem: public_pem,
        private_key_pem: private_pem,
    })
}

/// Generate an Ed25519 key pair, returning raw bytes (public_key, private_key)
///
/// Returns: (public_key: `Vec<u8>`, private_key: `Vec<u8>`)
/// - Public key is 32 bytes
/// - Private key (signing key) is 32 bytes
#[cfg(feature = "signing")]
pub fn generate_ed25519_key_pair() -> Result<(Vec<u8>, Vec<u8>)> {
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    Ok((
        verifying_key.as_bytes().to_vec(),
        signing_key.as_bytes().to_vec(),
    ))
}

#[cfg(feature = "signing")]
fn generate_ecdsa_p256_key_pair() -> Result<KeyPair> {
    use p256::ecdsa::SigningKey;
    use p256::pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding};
    use rand::rngs::OsRng;

    let signing_key = SigningKey::random(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    let private_pem = signing_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| Error::KeyGenerationFailed(e.to_string()))?
        .to_string();
    let public_pem = verifying_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| Error::KeyGenerationFailed(e.to_string()))?;

    Ok(KeyPair {
        public_key_pem: public_pem,
        private_key_pem: private_pem,
    })
}

// RSA-PSS keygen is intentionally unimplemented: the byte 0x03 stays reserved for
// wire compatibility, but no RSA implementation is linked. If RSA-PSS ever gains a
// real consumer, back it with a constant-time implementation (ring/aws-lc-rs), not
// the pure-Rust `rsa` crate (RUSTSEC-2023-0071, Marvin timing side channel).
#[cfg(feature = "signing")]
fn generate_rsa_pss_key_pair() -> Result<KeyPair> {
    Err(Error::KeyGenerationFailed(
        "RSA-PSS key generation is not implemented".to_string(),
    ))
}

/// Sign data with a private key
#[cfg(feature = "signing")]
pub fn sign(data: &[u8], private_key_pem: &str, algorithm: SigningAlgorithm) -> Result<Vec<u8>> {
    match algorithm {
        SigningAlgorithm::Ed25519 => sign_ed25519_pem(data, private_key_pem),
        SigningAlgorithm::EcdsaP256 => sign_ecdsa_p256(data, private_key_pem),
        SigningAlgorithm::RsaPss2048 => sign_rsa_pss(data, private_key_pem),
    }
}

#[cfg(feature = "signing")]
fn sign_ed25519_pem(data: &[u8], private_key_pem: &str) -> Result<Vec<u8>> {
    use ed25519_dalek::pkcs8::DecodePrivateKey;
    use ed25519_dalek::{Signer, SigningKey};

    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem)
        .map_err(|e| Error::InvalidKeyFormat(e.to_string()))?;

    let signature = signing_key.sign(data);
    Ok(signature.to_bytes().to_vec())
}

/// Sign data with an Ed25519 private key (raw bytes)
///
/// # Arguments
/// * `data` - The data to sign
/// * `private_key` - The private key as 32 bytes
///
/// # Returns
/// The signature as 64 bytes
#[cfg(feature = "signing")]
pub fn sign_ed25519(data: &[u8], private_key: &[u8]) -> Result<Vec<u8>> {
    use ed25519_dalek::{Signer, SigningKey};

    if private_key.len() != 32 {
        return Err(Error::InvalidKeyLength {
            expected: 32,
            actual: private_key.len(),
        });
    }

    let signing_key = SigningKey::from_bytes(
        &private_key
            .try_into()
            .map_err(|_| Error::InvalidKeyFormat("Failed to convert key bytes".to_string()))?,
    );

    let signature = signing_key.sign(data);
    Ok(signature.to_bytes().to_vec())
}

#[cfg(feature = "signing")]
fn sign_ecdsa_p256(data: &[u8], private_key_pem: &str) -> Result<Vec<u8>> {
    use p256::ecdsa::{signature::Signer, Signature, SigningKey};
    use p256::pkcs8::DecodePrivateKey;

    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem)
        .map_err(|e| Error::InvalidKeyFormat(e.to_string()))?;
    let signature: Signature = signing_key.sign(data);
    Ok(signature.to_der().as_bytes().to_vec())
}

#[cfg(feature = "signing")]
fn sign_rsa_pss(_data: &[u8], _private_key_pem: &str) -> Result<Vec<u8>> {
    Err(Error::SigningFailed(
        "RSA-PSS is a reserved identifier and is not supported".to_string(),
    ))
}

/// Verify a signature
#[cfg(feature = "signing")]
pub fn verify(
    data: &[u8],
    signature: &[u8],
    public_key_pem: &str,
    algorithm: SigningAlgorithm,
) -> Result<bool> {
    match algorithm {
        SigningAlgorithm::Ed25519 => verify_ed25519_pem(data, signature, public_key_pem),
        SigningAlgorithm::EcdsaP256 => verify_ecdsa_p256(data, signature, public_key_pem),
        SigningAlgorithm::RsaPss2048 => verify_rsa_pss(data, signature, public_key_pem),
    }
}

#[cfg(feature = "signing")]
fn verify_ed25519_pem(data: &[u8], signature: &[u8], public_key_pem: &str) -> Result<bool> {
    use ed25519_dalek::pkcs8::DecodePublicKey;
    use ed25519_dalek::{Signature, VerifyingKey};

    if signature.len() != 64 {
        return Err(Error::InvalidKeyLength {
            expected: 64,
            actual: signature.len(),
        });
    }

    let verifying_key = VerifyingKey::from_public_key_pem(public_key_pem)
        .map_err(|e| Error::InvalidKeyFormat(e.to_string()))?;

    let sig =
        Signature::from_bytes(&signature.try_into().map_err(|_| {
            Error::InvalidKeyFormat("Failed to convert signature bytes".to_string())
        })?);

    verifying_key
        .verify_strict(data, &sig)
        .map(|_| true)
        .map_err(|_| Error::SignatureVerificationFailed)
}

/// Verify an Ed25519 signature (raw bytes)
///
/// # Arguments
/// * `data` - The original data that was signed
/// * `signature` - The signature as 64 bytes
/// * `public_key` - The public key as 32 bytes
///
/// # Returns
/// `true` if the signature is valid, `false` otherwise
#[cfg(feature = "signing")]
pub fn verify_ed25519(data: &[u8], signature: &[u8], public_key: &[u8]) -> Result<bool> {
    use ed25519_dalek::{Signature, VerifyingKey};

    if public_key.len() != 32 {
        return Err(Error::InvalidKeyLength {
            expected: 32,
            actual: public_key.len(),
        });
    }

    if signature.len() != 64 {
        return Err(Error::InvalidKeyLength {
            expected: 64,
            actual: signature.len(),
        });
    }

    let verifying_key = VerifyingKey::from_bytes(
        &public_key
            .try_into()
            .map_err(|_| Error::InvalidKeyFormat("Failed to convert key bytes".to_string()))?,
    )
    .map_err(|_| Error::InvalidKeyFormat("Invalid public key".to_string()))?;

    let sig =
        Signature::from_bytes(&signature.try_into().map_err(|_| {
            Error::InvalidKeyFormat("Failed to convert signature bytes".to_string())
        })?);

    verifying_key
        .verify_strict(data, &sig)
        .map(|_| true)
        .map_err(|_| Error::SignatureVerificationFailed)
}

#[cfg(feature = "signing")]
fn verify_ecdsa_p256(data: &[u8], signature: &[u8], public_key_pem: &str) -> Result<bool> {
    use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
    use p256::pkcs8::DecodePublicKey;

    let verifying_key = VerifyingKey::from_public_key_pem(public_key_pem)
        .map_err(|e| Error::InvalidKeyFormat(e.to_string()))?;
    let signature =
        Signature::from_der(signature).map_err(|_| Error::SignatureVerificationFailed)?;
    verifying_key
        .verify(data, &signature)
        .map(|_| true)
        .map_err(|_| Error::SignatureVerificationFailed)
}

#[cfg(feature = "signing")]
fn verify_rsa_pss(_data: &[u8], _signature: &[u8], _public_key_pem: &str) -> Result<bool> {
    Err(Error::SigningFailed(
        "RSA-PSS is a reserved identifier and is not supported".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_algorithm_from_byte() {
        assert_eq!(
            SigningAlgorithm::from_byte(0x01).unwrap(),
            SigningAlgorithm::Ed25519
        );
        assert_eq!(
            SigningAlgorithm::from_byte(0x02).unwrap(),
            SigningAlgorithm::EcdsaP256
        );
        assert_eq!(
            SigningAlgorithm::from_byte(0x03).unwrap(),
            SigningAlgorithm::RsaPss2048
        );
        assert!(SigningAlgorithm::from_byte(0xFF).is_err());
    }

    #[test]
    fn test_algorithm_name() {
        assert_eq!(SigningAlgorithm::Ed25519.name(), "ed25519");
        assert_eq!(SigningAlgorithm::EcdsaP256.name(), "ecdsa-p256");
        assert_eq!(SigningAlgorithm::RsaPss2048.name(), "rsa-pss-2048");
        assert!(SigningAlgorithm::Ed25519.is_supported());
        assert!(SigningAlgorithm::EcdsaP256.is_supported());
        assert!(!SigningAlgorithm::RsaPss2048.is_supported());
    }

    #[test]
    fn test_standard_pem_roundtrips_and_signatures() {
        use ed25519_dalek::pkcs8::{
            DecodePrivateKey as EdDecodePrivateKey, DecodePublicKey as EdDecodePublicKey,
        };
        let message = b"standard signing envelope";
        for algorithm in [SigningAlgorithm::Ed25519, SigningAlgorithm::EcdsaP256] {
            let pair = generate_key_pair(algorithm).unwrap();
            assert!(pair
                .private_key_pem
                .starts_with("-----BEGIN PRIVATE KEY-----")); // gitleaks:allow -- PEM marker only
            assert!(pair
                .public_key_pem
                .starts_with("-----BEGIN PUBLIC KEY-----"));
            let debug = format!("{pair:?}");
            assert!(debug.contains("[REDACTED]"));
            assert!(!debug.contains(&pair.private_key_pem));

            match algorithm {
                SigningAlgorithm::Ed25519 => {
                    ed25519_dalek::SigningKey::from_pkcs8_pem(&pair.private_key_pem).unwrap();
                    ed25519_dalek::VerifyingKey::from_public_key_pem(&pair.public_key_pem).unwrap();
                }
                SigningAlgorithm::EcdsaP256 => {
                    p256::ecdsa::SigningKey::from_pkcs8_pem(&pair.private_key_pem).unwrap();
                    p256::ecdsa::VerifyingKey::from_public_key_pem(&pair.public_key_pem).unwrap();
                }
                SigningAlgorithm::RsaPss2048 => unreachable!(),
            }

            let signature = sign(message, &pair.private_key_pem, algorithm).unwrap();
            assert!(verify(message, &signature, &pair.public_key_pem, algorithm).unwrap());
            assert!(verify(b"tampered", &signature, &pair.public_key_pem, algorithm).is_err());
        }

        assert!(generate_key_pair(SigningAlgorithm::RsaPss2048).is_err());
    }
}
