# Voided

Voided is the source repository for the Voided encryption libraries. The workspace contains the browser-facing end-to-end encryption client, the Node.js server-side encryption library, and the shared Rust core used by both bindings.

## Libraries

- `@voideddev/e2ee-client`: browser-side encryption, key management, chunking, and fused artifact helpers backed by `voided-wasm`
- `@voideddev/enc-server`: server-side hashing, compression, authenticated encryption, fused shell, and artifact inspection helpers backed by native Rust
- `voided-core`: shared Rust implementation used by the native Node and WASM bindings, including the fused shell and full-flow artifact pipeline

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

## Voided v2

Voided v2 is fused-first:

1. compression
2. encryption
3. fused shell

The runtime layering that should stay aligned through the migration is:

- `voided-core` as the source-of-truth Rust implementation
- `voided-node` as the Node binding over `voided-core`
- `voided-wasm` as the browser binding over `voided-core`
- `@voideddev/enc-server` as the Node wrapper over `voided-node`
- `@voideddev/e2ee-client` as the browser wrapper over `voided-wasm`

That means map-based obfuscation is a deprecated v1 concern, not part of the
Voided v2 product surface. Current work should target the preset-first fused
shell surface instead of reviving legacy map APIs.

The detailed plan lives in
[`docs/v2-fused-first-architecture.md`](docs/v2-fused-first-architecture.md).

## Examples

Repository-level examples live in [`examples/`](examples) and focus on the
current fused shell and full-flow artifact APIs. Package-specific examples live
alongside each package.

## Release Notes

- The npm workspace uses a single root `package-lock.json`.
- Build and publish artifacts are produced from package-level build scripts.
- Cross-platform native builds use `scripts/build-cross-platform.js`.
- Large toolchains are not vendored in the Git repository.

## License

MIT
