# @voideddev/enc-server

`@voideddev/enc-server` is the Node.js Voided library. It exposes the native
Rust-backed primitives for hashing, compression, encryption, and utility
operations while Voided moves toward a fused-first v2 surface.

Today the runtime layering is:

- `voided-core` as the source-of-truth Rust implementation
- `voided-node` as the N-API binding over `voided-core`
- `@voideddev/enc-server` as the TypeScript wrapper over `voided-node`

## Installation

```bash
npm install @voideddev/enc-server
```

If a prebuilt native binary is not available for the current platform, the package falls back to a source build during install. In that case, Rust must be installed locally.

## Removed v1 Surface

Deprecated map-first APIs such as `encryptWithMap`, `VoidedService`, and map
generation helpers have been removed from this branch. That old behavior now
belongs to v1 only.

## Roadmap Note

The v2 direction is fused-first:

1. compression
2. encryption
3. fused shell

The frozen fused preset surface is:

- `compact`
- `balanced`
- `concealed`

with role aliases layered on top:

- `default` -> `balanced`
- `high-security` -> `concealed`

Map-based obfuscation is not part of the Voided v2 package story. The detailed
plan lives in
[`../../docs/v2-fused-first-architecture.md`](../../docs/v2-fused-first-architecture.md).
Planning metadata for the target preset and policy ids also lives in
`VOIDED_V2_PRESET_PLAN` and `DEFAULT_VOIDED_V2_POLICY_PLAN`.

## Package Surface

- Low-level crypto helpers such as `generateKey`, `encrypt`, `decrypt`, `deriveKeyHkdf`, and `deriveKeyPbkdf2`
- Hashing helpers including `hash`, `generateHmac`, `hashPbkdf2`, `fingerprint`, and `safetyNumbers`
- Compression helpers `compress` and `decompress`
- Fused-first v2 planning metadata through `VOIDED_V2_PRESET_PLAN`
- `KeyManager`, streaming helpers, stats, and upload-limit helpers

## Native Builds

```bash
npm run build:native
npm run build
npm test
```

Local development binaries are copied into `native/`. Release prebuilds live in
`prebuilds/`.

## Notes

- Deprecated map-first behavior is no longer exported from this package branch.
- The long-term wrapper target is a thin `protect/open/inspect` surface over `voided-node`, not a second product contract that drifts away from `voided-core`.
- The service layer is synchronous because the native Rust binding is loaded directly into Node.js.
- Examples live in the repository-level `examples/` directory and package test fixtures.

## License

MIT
