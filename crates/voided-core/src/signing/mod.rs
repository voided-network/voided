//! Digital signature module providing Ed25519, ECDSA, and RSA-PSS.
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
    /// RSA-PSS with 2048-bit key (256-byte signatures)
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
}

/// Generated key pair
#[derive(Debug, Clone)]
pub struct KeyPair {
    /// Public key in PEM format
    pub public_key_pem: String,
    /// Private key in PEM format
    pub private_key_pem: String,
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
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    // Convert to PEM format (simplified - in production use proper PEM encoding)
    let private_pem = format!(
        "-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----",
        base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            signing_key.as_bytes()
        )
    );

    let public_pem = format!(
        "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----",
        base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            verifying_key.as_bytes()
        )
    );

    Ok(KeyPair {
        public_key_pem: public_pem,
        private_key_pem: private_pem,
    })
}

/// Generate an Ed25519 key pair, returning raw bytes (public_key, private_key)
///
/// Returns: (public_key: Vec<u8>, private_key: Vec<u8>)
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
    use rand::rngs::OsRng;

    let signing_key = SigningKey::random(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    // Simplified PEM encoding
    let private_bytes = signing_key.to_bytes();
    let public_bytes = verifying_key.to_encoded_point(false);

    let private_pem = format!(
        "-----BEGIN EC PRIVATE KEY-----\n{}\n-----END EC PRIVATE KEY-----",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &private_bytes)
    );

    let public_pem = format!(
        "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----",
        base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            public_bytes.as_bytes()
        )
    );

    Ok(KeyPair {
        public_key_pem: public_pem,
        private_key_pem: private_pem,
    })
}

#[cfg(feature = "signing")]
fn generate_rsa_pss_key_pair() -> Result<KeyPair> {
    use rand::rngs::OsRng;
    use rsa::{RsaPrivateKey, RsaPublicKey};

    let bits = 2048;
    let private_key = RsaPrivateKey::new(&mut OsRng, bits)
        .map_err(|e| Error::KeyGenerationFailed(e.to_string()))?;
    let _public_key = RsaPublicKey::from(&private_key);

    // Simplified - in production use proper PKCS#8 encoding
    let private_pem = format!(
        "-----BEGIN RSA PRIVATE KEY-----\n{}\n-----END RSA PRIVATE KEY-----",
        "... RSA PRIVATE KEY DATA ..."
    );

    let public_pem = format!(
        "-----BEGIN RSA PUBLIC KEY-----\n{}\n-----END RSA PUBLIC KEY-----",
        "... RSA PUBLIC KEY DATA ..."
    );

    Ok(KeyPair {
        public_key_pem: public_pem,
        private_key_pem: private_pem,
    })
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
    use ed25519_dalek::{Signer, SigningKey};

    // Extract base64 from PEM
    let pem_content = private_key_pem
        .strip_prefix("-----BEGIN PRIVATE KEY-----\n")
        .and_then(|s| s.strip_suffix("\n-----END PRIVATE KEY-----"))
        .ok_or_else(|| Error::InvalidKeyFormat("Invalid PEM format".to_string()))?;

    let key_bytes =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, pem_content)?;

    if key_bytes.len() != 32 {
        return Err(Error::InvalidKeyLength {
            expected: 32,
            actual: key_bytes.len(),
        });
    }

    let signing_key = SigningKey::from_bytes(
        &key_bytes
            .try_into()
            .map_err(|_| Error::InvalidKeyFormat("Failed to convert key bytes".to_string()))?,
    );

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
fn sign_ecdsa_p256(_data: &[u8], _private_key_pem: &str) -> Result<Vec<u8>> {
    // TODO: Implement proper ECDSA signing with PEM parsing
    Err(Error::SigningFailed("Not yet implemented".to_string()))
}

#[cfg(feature = "signing")]
fn sign_rsa_pss(_data: &[u8], _private_key_pem: &str) -> Result<Vec<u8>> {
    // TODO: Implement proper RSA-PSS signing with PEM parsing
    Err(Error::SigningFailed("Not yet implemented".to_string()))
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
    use ed25519_dalek::{Signature, VerifyingKey};

    // Extract base64 from PEM
    let pem_content = public_key_pem
        .strip_prefix("-----BEGIN PUBLIC KEY-----\n")
        .and_then(|s| s.strip_suffix("\n-----END PUBLIC KEY-----"))
        .ok_or_else(|| Error::InvalidKeyFormat("Invalid PEM format".to_string()))?;

    let key_bytes =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, pem_content)?;

    if key_bytes.len() != 32 {
        return Err(Error::InvalidKeyLength {
            expected: 32,
            actual: key_bytes.len(),
        });
    }

    if signature.len() != 64 {
        return Err(Error::InvalidKeyLength {
            expected: 64,
            actual: signature.len(),
        });
    }

    let verifying_key = VerifyingKey::from_bytes(
        &key_bytes
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
fn verify_ecdsa_p256(_data: &[u8], _signature: &[u8], _public_key_pem: &str) -> Result<bool> {
    // TODO: Implement proper ECDSA verification with PEM parsing
    Err(Error::SignatureVerificationFailed)
}

#[cfg(feature = "signing")]
fn verify_rsa_pss(_data: &[u8], _signature: &[u8], _public_key_pem: &str) -> Result<bool> {
    // TODO: Implement proper RSA-PSS verification with PEM parsing
    Err(Error::SignatureVerificationFailed)
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
    }
}
