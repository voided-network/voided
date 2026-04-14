# voided-core

`voided-core` is the shared Rust implementation behind the Voided native Node
binding and the WASM binding. It is the source of truth for crypto behavior
across the workspace, including the fused shell and the fused-first
`protect/open/inspect/repack` artifact flow.

## Features

- Hashing plus authenticated encryption with AES-256-GCM and XChaCha20-Poly1305
- HKDF and PBKDF2 key derivation
- Optional compression and signing modules
- Fused shell presets: `compact`, `balanced`, and `concealed`
- Full-flow artifact helpers: `protect`, `open`, `inspect_artifact`, and `repack_artifact`
- Shared payload formats for the Node and WASM layers

## Example

```rust
use voided_core::encryption;
use voided_core::shell::{open, protect, FusedPreset, ProtectOptions};

let key = encryption::generate_key();
let plaintext = b"hello fused world";

let artifact = protect(
    plaintext,
    &key,
    Some(ProtectOptions {
        preset: FusedPreset::Balanced,
        ..ProtectOptions::default()
    }),
)
.unwrap();

let restored = open(&artifact.artifact, &key).unwrap();
assert_eq!(plaintext, &restored[..]);
```

## Feature Flags

- `backend`: full server-oriented feature set
- `browser`: browser-compatible subset used by the WASM crate
- `compression`: Brotli and Gzip helpers
- `signing`: Ed25519, P-256, and RSA helpers

## Notes

- Map-based obfuscation belongs to deprecated Voided v1 and is not part of the
  current `voided-core` surface.
- The fused-first full flow is `compression -> encryption -> fused shell`.

## License

MIT
