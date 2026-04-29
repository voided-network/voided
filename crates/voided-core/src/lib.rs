//! # voided-core
//!
//! Core cryptographic primitives for the Voided encryption library.
//!
//! This crate provides the source-of-truth implementation for all crypto operations,
//! ensuring identical behavior across Node.js (native binding) and browser (WASM) targets.
//!
//! ## Features
//!
//! - `backend` - Full feature set for Node.js backend (default)
//! - `browser` - Browser-compatible subset for WASM
//! - `compression` - Brotli, Gzip, and Iliad Foundation compression
//! - `signing` - Digital signatures (Ed25519, ECDSA, RSA-PSS)
//!
//! ## Example
//!
//! ```rust
//! use voided_core::encryption;
//!
//! // Generate a key
//! let key = encryption::generate_key();
//!
//! // Encrypt some data
//! let plaintext = b"Hello, World!";
//! let encrypted = encryption::encrypt(plaintext, &key, None).unwrap();
//!
//! // Decrypt it back
//! let decrypted = encryption::decrypt(&encrypted, &key).unwrap();
//! assert_eq!(plaintext, &decrypted[..]);
//! ```

#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]
#![warn(missing_docs)]
#![warn(clippy::all)]

extern crate alloc;

pub mod encryption;
pub mod formats;
pub mod hash;
pub mod shell;
pub mod util;

#[cfg(feature = "compression")]
pub mod compression;

#[cfg(feature = "signing")]
pub mod signing;

#[cfg(feature = "signing")]
pub use signing::{generate_ed25519_key_pair, sign_ed25519, verify_ed25519};

mod error;
pub use error::{Error, Result};

/// Library version
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Wire format version
pub const FORMAT_VERSION: u8 = 0x01;

/// Magic bytes for encrypted payloads
pub const MAGIC_ENCRYPTED: &[u8; 4] = b"VOI1";

/// Magic bytes for signatures
pub const MAGIC_SIGNATURE: &[u8; 4] = b"VOIS";

/// Magic bytes for compression header
pub const MAGIC_COMPRESSED: &[u8; 2] = b"VC";
