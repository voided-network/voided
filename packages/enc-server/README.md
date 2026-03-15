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

## Package Surface

- Low-level crypto helpers such as `generateKey`, `encrypt`, `decrypt`, `deriveKeyHkdf`, and `deriveKeyPbkdf2`
- Hashing helpers including `hash`, `generateHmac`, `hashPbkdf2`, `fingerprint`, and `safetyNumbers`
- Compression helpers `compress` and `decompress`
- Obfuscation helpers `generateMap`, `obfuscate`, `deobfuscate`, `analyzeMap`, and `getExpansionRatio`
- High-level pipeline helpers `encryptWithMap`, `decryptWithMap`, and `decryptWithMapString`
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
- The service layer is synchronous because the native Rust binding is loaded directly into Node.js.
- Examples live in the repository-level `examples/` directory and package test fixtures.

## License

MIT
