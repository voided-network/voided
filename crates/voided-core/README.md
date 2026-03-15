# voided-core

`voided-core` is the shared Rust implementation behind the Voided native Node binding and the WASM binding. It is the source of truth for crypto behavior across the workspace.

## Features

- Authenticated encryption with AES-256-GCM and XChaCha20-Poly1305
- HKDF and PBKDF2 key derivation
- Optional compression, signing, and obfuscation modules
- Shared payload formats for the Node and WASM layers

## Example

```rust
use voided_core::encryption;

let key = encryption::generate_key();
let plaintext = b"hello";

let encrypted = encryption::encrypt(plaintext, &key, None).unwrap();
let decrypted = encryption::decrypt(&encrypted, &key).unwrap();

assert_eq!(plaintext, &decrypted[..]);
```

## Feature Flags

- `backend`: full server-oriented feature set
- `browser`: browser-compatible subset used by the WASM crate
- `compression`: Brotli and Gzip helpers
- `signing`: Ed25519, P-256, and RSA helpers
- `obfuscation`: map-based character obfuscation

## License

MIT
