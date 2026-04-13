# Voided

Voided is the source repository for the Voided encryption libraries. The workspace contains the browser-facing end-to-end encryption client, the Node.js server-side encryption library, and the shared Rust core used by both bindings.

## Libraries

- `@voideddev/e2ee-client`: browser-side encryption, key management, chunking, and optional Rust/WASM acceleration
- `@voideddev/enc-server`: server-side compression, authenticated encryption, obfuscation, and streaming helpers backed by native Rust
- `voided-core`: shared Rust implementation used by the native Node and WASM bindings

## Repository Layout

```text
packages/
  e2ee-client/
  enc-server/
crates/
  voided-core/
  voided-node/
  voided-wasm/
examples/
scripts/
```

## Getting Started

```bash
npm install
npm run build
npm test
```

Targeted builds:

```bash
npm run build:node
npm run build:wasm
npm run build:cross
```

Cross-platform native builds require Zig to be installed locally, set via `VOIDED_ZIG_BIN`, or placed in an untracked `tools/zig/` directory.

## Package Documentation

- [`packages/e2ee-client/README.md`](packages/e2ee-client/README.md)
- [`packages/enc-server/README.md`](packages/enc-server/README.md)
- [`crates/voided-core/README.md`](crates/voided-core/README.md)

## Voided v2 Direction

The current package surface still includes a map-first compatibility lane in
`@voideddev/enc-server`, but the planned v2 product direction is fused-first:

1. compression
2. encryption
3. fused shell

That means map-based obfuscation is no longer the long-term default shape of the
product. It remains useful for compatibility and selected experimental work, but
new architecture work should target a profile-first fused shell surface instead.

The detailed plan lives in
[`docs/v2-fused-first-architecture.md`](docs/v2-fused-first-architecture.md).

## Examples

Repository-level examples live in [`examples/`](examples). Package-specific examples live alongside each package.

## Release Notes

- The npm workspace uses a single root `package-lock.json`.
- Build and publish artifacts are produced from package-level build scripts.
- Cross-platform native builds use `scripts/build-cross-platform.js`.
- Large toolchains are not vendored in the Git repository.

## License

MIT
