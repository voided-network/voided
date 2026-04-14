# voided-core

`voided-core` is the direct Rust implementation of Voided. It is the
source-of-truth crate for the Node and WASM bindings, and it is also the right
entry point if you want to use Voided from Rust without going through the
JavaScript wrappers.

The crate is organized around three layers:

1. primitive cryptography
2. fused shell primitives
3. full-flow fused artifacts

## Contents

- [What This Crate Is For](#what-this-crate-is-for)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [What Fused Means](#what-fused-means)
- [Command Map](#command-map)
- [Public Modules](#public-modules)
- [Quick Start](#quick-start)
- [Choosing The Right Layer](#choosing-the-right-layer)
- [Fused Presets](#fused-presets)
- [Feature Flags](#feature-flags)
- [Build Targets](#build-targets)
- [Testing](#testing)
- [v1 Boundary](#v1-boundary)
- [License](#license)

## What This Crate Is For

Use `voided-core` directly when you want:

- native Rust access to Voided's primitives and artifact formats
- the fused-first Voided v2 model without a JavaScript wrapper
- one implementation that stays aligned across Rust, Node, and WASM
- direct control over whether you use raw primitives, fused shell, or the full
  fused artifact flow

If you want the wrapper layers instead:

- use `@voideddev/enc-server` for Node.js
- use `@voideddev/e2ee-client` for browser runtimes

## Installation

Default backend-oriented build:

```toml
[dependencies]
voided-core = "0.2.0"
```

Browser-oriented build:

```toml
[dependencies]
voided-core = { version = "0.2.0", default-features = false, features = ["browser"] }
```

The default feature set is `backend`.

## Core Concepts

### Primitive Cryptography

The primitive layer covers:

- AEAD encryption
- key generation and derivation
- hashing and HMAC
- compression
- utility helpers

Use this layer when you want Voided's cryptographic building blocks but prefer
to define your own outer envelope or storage format.

### Fused Shell

The fused shell is the outer-shell layer for already-prepared bytes. It gives
you a stable shell envelope with preset-driven behavior.

Use this layer when:

- you already own the bytes being shelled
- you want to inspect shell metadata independently
- you want to apply or remove the shell without using the full artifact flow

### Full-Flow Fused Artifact

The full-flow helper layer is the normal Voided v2 path:

1. optional compression
2. authenticated encryption
3. fused shell envelope

The main functions are:

- `protect`
- `open`
- `inspect_artifact`
- `repack_artifact`

Use this layer when you want the standard Voided v2 artifact contract.

## What Fused Means

The fused shell is the outer envelope format for bytes that are already ready
to store or transport. In the normal Voided v2 flow, those bytes are encrypted
payload bytes.

That means the standard pipeline is:

1. optional compression
2. authenticated encryption
3. fused shell envelope

The shell is responsible for the outer artifact contract:

- versioned envelope structure
- preset selection
- chunk sizing and chunk counts
- shell metadata that can be inspected without opening the artifact

The shell does not replace encryption, and it does not ask the primitive layer
to disappear. It gives the encrypted payload a stable outer form.

In practice:

- use shell helpers when the inner bytes are already in the shape you want
- use full-flow helpers when you want `voided-core` to own the complete
  standard artifact format

## Command Map

The public shell commands break down like this:

- `fuse_bytes`
  - wrap prepared bytes in the fused shell
- `unfuse_bytes`
  - remove the fused shell and return the inner bytes
- `inspect_fused`
  - inspect shell metadata without opening the inner payload
- `protect`
  - compress, encrypt, and shell plaintext into a standard fused artifact
- `open`
  - reverse the full `protect` pipeline and return the original plaintext
- `inspect_artifact`
  - inspect a fused artifact without opening it
- `repack_artifact`
  - reopen and rewrite an artifact with different preset or pipeline options

That gives you three clean entry points:

- primitives when you only need crypto or compression
- shell helpers when you already own the inner bytes
- full-flow helpers when you want the standard Voided v2 artifact contract

## Public Modules

### `voided_core::encryption`

Provides:

- AES-256-GCM and XChaCha20-Poly1305
- HKDF and PBKDF2
- X25519 key agreement helpers
- serialization helpers for encrypted payloads

### `voided_core::hash`

Provides:

- SHA-256 and SHA-512
- HMAC helpers
- PBKDF2-based hash verification helpers
- fingerprints and safety-number formatting

### `voided_core::compression`

Available with the `compression` feature.

Provides:

- Brotli
- Gzip
- compression result metadata
- helpers for compressed payload serialization

### `voided_core::shell`

Provides:

- `fuse_bytes`
- `unfuse_bytes`
- `inspect_fused`
- `protect`
- `open`
- `inspect_artifact`
- `repack_artifact`
- fused preset and options types

Command intent:

- `fuse_bytes` / `unfuse_bytes`
  - direct shell-layer control
- `protect` / `open`
  - standard full-flow artifact entry points
- `inspect_fused` / `inspect_artifact`
  - metadata inspection without opening payloads
- `repack_artifact`
  - rewrite artifacts without forcing callers to manually unpack and rebuild the
    shell pipeline

### `voided_core::util`

Provides:

- random bytes
- secure wipe
- encoding helpers
- small shared utility helpers

### `voided_core::signing`

Available with the `signing` feature.

Provides:

- Ed25519 helpers
- P-256 helpers
- RSA helpers

## Quick Start

### Example: Direct AEAD Encryption

Use the primitive encryption layer when you want direct ciphertext handling and
you do not want Voided to own the outer artifact format.

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

### Example: Standard Fused Artifact

Use `protect/open` when you want the normal Voided v2 artifact shape.

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

### Example: Shell-Only Envelope

Use `fuse_bytes/unfuse_bytes` when the bytes inside the shell are already in the
form you want.

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

- Use `encryption` when you need direct AEAD primitives and want to manage the
  outer format yourself.
- Use `hash` when you need fingerprints, HMACs, or verification helpers without
  touching the artifact flow.
- Use `compression` when you want direct compression results and metadata.
- Use `fuse_bytes` when you already have the bytes you want inside the shell.
- Use `protect` when you want the standard Voided v2 artifact path.
- Use `inspect_fused` or `inspect_artifact` when you want metadata without
  opening the payload.
- Use `repack_artifact` when you want to move an artifact between fused presets
  without changing the underlying plaintext.

## Fused Presets

The stable fused presets are:

- `compact`
- `balanced`
- `concealed`

Practical intent:

- `compact`
  - lowest-overhead preset
- `balanced`
  - default general-purpose preset
- `concealed`
  - heavier preset with more shell variation

If you do not have a strong reason otherwise, start with `balanced`.

## Feature Flags

### `backend`

- enabled by default
- full server-oriented feature set
- includes `compression`, `signing`, and `std`

### `browser`

- browser-oriented subset used by the WASM build
- meant for `voided-wasm` and other browser-compatible targets

### `compression`

- enables Brotli and Gzip helpers
- required for `shell::protect`, `shell::open`, and `shell::repack_artifact`

### `signing`

- enables Ed25519, P-256, and RSA helpers

### `wasm`

- internal support feature used by the WASM binding build

### `std`

- enables the standard library path used by the backend build

## Build Targets

Common target shapes:

- server/native Rust
  - use default features
- browser/WASM-oriented builds
  - disable default features and enable `browser`

The crate itself is the implementation authority for both wrapper bindings, so
behavior added here should be projected through `voided-node` and `voided-wasm`
rather than reimplemented elsewhere.

## Testing

When changing this crate, the most important checks are:

- unit tests around the touched module
- fused artifact stress and vector coverage
- deterministic shell behavior when nonce or chunk settings are fixed

From the workspace Rust root:

```bash
cargo test -p voided-core
```

## v1 Boundary

`voided-core` is the fused-first Rust crate for the current library line.
Map-based obfuscation belongs to deprecated v1 and is not part of the current
crate surface.

That means:

- no map-shell module in the public current surface
- no map-first examples in this crate guide
- no new direct Rust development targeting the old map path

## License

MIT
