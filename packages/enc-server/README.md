# @voideddev/enc-server

`@voideddev/enc-server` is the Node.js Voided library. It exposes the native Rust-backed primitives for hashing, compression, encryption, and obfuscation, plus a higher-level service layer for common server-side workflows.

## Installation

```bash
npm install @voideddev/enc-server
```

If a prebuilt native binary is not available for the current platform, the package falls back to a source build during install. In that case, Rust must be installed locally.

## Quick Start

```ts
import { VoidedService } from "@voideddev/enc-server";

const service = new VoidedService({
  seed: "app-seed",
});

const encrypted = service.encrypt("Sensitive server-side payload");
const decrypted = service.decrypt(encrypted.data, encrypted.map);

console.log(decrypted);
```

## Roadmap Note

The current package still exposes map-first helpers such as `encryptWithMap`
and `VoidedService`. Those are still useful for compatibility, but they are not
the planned long-term shape of Voided.

The v2 direction is fused-first:

1. compression
2. encryption
3. fused shell

Map-based obfuscation should move to experimental or legacy positioning instead
of remaining the default product story. The detailed plan lives in
[`../../docs/v2-fused-first-architecture.md`](../../docs/v2-fused-first-architecture.md).
Planning metadata for the target profile and policy ids also lives in
`VOIDED_V2_PROFILE_PLAN` and `DEFAULT_VOIDED_V2_POLICY_PLAN`.

## Package Surface

- Low-level crypto helpers such as `generateKey`, `encrypt`, `decrypt`, `deriveKeyHkdf`, and `deriveKeyPbkdf2`
- Hashing helpers including `hash`, `generateHmac`, `hashPbkdf2`, `fingerprint`, and `safetyNumbers`
- Compression helpers `compress` and `decompress`
- Obfuscation helpers `generateMap`, `obfuscate`, `deobfuscate`, `analyzeMap`, and `getExpansionRatio`
- Compatibility pipeline helpers `encryptWithMap`, `decryptWithMap`, and `decryptWithMapString`
- `VoidedService`, `KeyManager`, streaming helpers, stats, and upload-limit helpers

## Native Builds

```bash
npm run build:native
npm run build
npm test
```

Local development binaries are copied into `native/`. Release prebuilds live in `prebuilds/`.

## Notes

- `encryptWithMap` requires either an existing obfuscation map or a deterministic `seed`.
- `encryptWithMap` and `VoidedService` should be treated as compatibility helpers while the fused-first v2 surface is implemented.
- The service layer is synchronous because the native Rust binding is loaded directly into Node.js.
- Examples live in the repository-level `examples/` directory and package test fixtures.

## License

MIT
