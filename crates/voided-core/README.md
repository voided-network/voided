# voided-core

`voided-core` is the source-of-truth Rust crate behind Voided's Node and WASM
bindings. If you want to use Voided directly from Rust, this is the crate that
owns the actual crypto behavior, fused shell formats, and full-flow artifact
pipeline.

It gives you three layers to work with:

- Primitive modules for hashing, authenticated encryption, compression, and
  key derivation
- Fused shell primitives for shaping opaque outer envelopes around bytes you
  already control
- Full-flow helpers for the default Voided v2 path:
  `compression -> encryption -> fused shell`

## When To Use This Crate

Use `voided-core` directly when you want:

- Native Rust access to Voided without going through the Node or WASM wrappers
- The fused-first artifact model used by Voided v2 and Slipner
- Primitive access to hashing, encryption, compression, and key derivation
- One implementation that stays aligned with the higher-level bindings

If you are building from Node.js or the browser, the wrapper crates are usually
the better entry points:

- Node: `@voideddev/enc-server`
- Browser: `@voideddev/e2ee-client`

## Installation

Default backend-oriented build:

```toml
[dependencies]
voided-core = "0.1.1"
```

Browser-oriented build:

```toml
[dependencies]
voided-core = { version = "0.1.1", default-features = false, features = ["browser"] }
```

## What You Get

### Primitive Modules

- `voided_core::encryption`
  - AEAD encryption with AES-256-GCM and XChaCha20-Poly1305
  - HKDF and PBKDF2 key derivation
  - X25519 key agreement helpers
- `voided_core::hash`
  - SHA-256 and SHA-512 hashing
  - HMAC helpers
  - fingerprints and safety-number formatting
- `voided_core::compression`
  - Brotli and Gzip compression helpers
  - only available when the `compression` feature is enabled
- `voided_core::signing`
  - Ed25519, P-256, and RSA signing helpers
  - only available when the `signing` feature is enabled
- `voided_core::util`
  - random bytes, base64/hex helpers, secure wipe, and related utilities

### Fused Modules

- `voided_core::shell::fuse_bytes`
- `voided_core::shell::unfuse_bytes`
- `voided_core::shell::inspect_fused`
- `voided_core::shell::protect`
- `voided_core::shell::open`
- `voided_core::shell::inspect_artifact`
- `voided_core::shell::repack_artifact`

The public fused presets are:

- `compact`
- `balanced`
- `concealed`

## Quick Start

### Authenticated Encryption

Use the `encryption` module when you want direct AEAD primitives without the
full Voided artifact pipeline.

```rust
use voided_core::encryption::{decrypt, encrypt, generate_key, Algorithm, EncryptOptions};

let key = generate_key();
let plaintext = b"hello direct rust";

let encrypted = encrypt(
    plaintext,
    &key,
    Some(EncryptOptions {
        algorithm: Some(Algorithm::XChaCha20Poly1305),
        aad: None,
    }),
)?;

let decrypted = decrypt(&encrypted, &key)?;
assert_eq!(decrypted, plaintext);
# Ok::<(), voided_core::Error>(())
```

### Full-Flow Fused Artifact

Use `protect/open` when you want the normal Voided v2 storage or transport
artifact shape.

```rust
use voided_core::encryption::generate_key;
use voided_core::shell::{inspect_artifact, open, protect, FusedPreset, ProtectOptions};

let key = generate_key();
let plaintext = b"hello fused world";

let protected = protect(
    plaintext,
    &key,
    Some(ProtectOptions {
        preset: FusedPreset::Balanced,
        ..ProtectOptions::default()
    }),
)?;

let info = inspect_artifact(&protected.artifact)?;
let restored = open(&protected.artifact, &key)?;

assert_eq!(info.preset, FusedPreset::Balanced);
assert_eq!(restored, plaintext);
# Ok::<(), voided_core::Error>(())
```

### Fused Shell Primitive

Use `fuse_bytes/unfuse_bytes` when you already own the bytes inside the shell
and only want the shell layer itself.

```rust
use voided_core::encryption::generate_key;
use voided_core::shell::{fuse_bytes, inspect_fused, unfuse_bytes, FusedPreset, FusedShellOptions};

let key = generate_key();
let payload = b"already-prepared bytes";

let shell = fuse_bytes(
    payload,
    &key,
    Some(FusedShellOptions {
        preset: FusedPreset::Compact,
        ..FusedShellOptions::default()
    }),
)?;

let info = inspect_fused(&shell)?;
let restored = unfuse_bytes(&shell, &key)?;

assert_eq!(info.preset, FusedPreset::Compact);
assert_eq!(restored, payload);
# Ok::<(), voided_core::Error>(())
```

## Choosing The Right Layer

- Use `encryption` when you need direct AEAD primitives and you want to manage
  outer formats yourself.
- Use `fuse_bytes` when you already have encrypted or otherwise prepared bytes
  and only want Voided's shell layer.
- Use `protect` for the normal Voided v2 product path. This is the simplest
  entry point for storage artifacts and the model Slipner now consumes.
- Use `inspect_fused` and `inspect_artifact` when you want metadata without
  opening the payload.
- Use `repack_artifact` when you want to move an artifact between fused presets
  without changing the underlying plaintext.

## Feature Flags

- `backend`
  - default
  - enables the full server-oriented surface
  - includes `compression`, `signing`, and `std`
- `browser`
  - browser-oriented subset used by the WASM crate
  - intended for the `voided-wasm` binding path
- `compression`
  - enables Brotli and Gzip helpers
  - required for `shell::protect`, `shell::open`, and `shell::repack_artifact`
- `signing`
  - enables Ed25519, P-256, and RSA signing helpers
- `wasm`
  - internal support feature used by the WASM binding build
- `std`
  - enables the standard-library path used by the backend build

## Notes

- `voided-core` is the implementation authority for the Voided stack. The Node
  and browser wrappers should project this crate's behavior, not reimplement it.
- Map-based obfuscation belongs to deprecated Voided v1 and is not part of the
  current `voided-core` surface.
- The fused-first full flow is `compression -> encryption -> fused shell`.
- The crate exposes shared payload and envelope formats so Node and WASM stay
  aligned on artifact behavior.

## License

MIT
