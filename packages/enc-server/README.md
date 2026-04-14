# @voideddev/enc-server

`@voideddev/enc-server` is the Node.js package for Voided's native Rust-backed
runtime. It exposes synchronous server-side APIs for hashing, compression,
authenticated encryption, fused shell operations, and full-flow fused
artifacts.

Under the hood, the package is layered like this:

- `voided-core`
  - source-of-truth Rust implementation
- `voided-node`
  - N-API binding over `voided-core`
- `@voideddev/enc-server`
  - TypeScript package surface over the native binding

## Contents

- [What This Package Is For](#what-this-package-is-for)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Choosing The Right API Layer](#choosing-the-right-api-layer)
- [Primitive Crypto APIs](#primitive-crypto-apis)
- [Fused Shell And Full-Flow APIs](#fused-shell-and-full-flow-apis)
- [Higher-Level Helper Exports](#higher-level-helper-exports)
- [Fused Presets And Planning Metadata](#fused-presets-and-planning-metadata)
- [Native Runtime Behavior](#native-runtime-behavior)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [v1 Boundary](#v1-boundary)
- [License](#license)

## What This Package Is For

Use `@voideddev/enc-server` when you want:

- Node.js access to the Voided native runtime
- synchronous server-side APIs backed by Rust
- the fused-first Voided v2 artifact model
- direct use of hashing, compression, encryption, shell, and artifact helpers
- small higher-level utilities that are packaged on top of the native runtime

If you want direct Rust instead, use `voided-core`. If you want browser-side
usage, use `@voideddev/e2ee-client`.

## Installation

```bash
npm install @voideddev/enc-server
```

The package prefers prebuilt native binaries. If a prebuild is not available
for the current platform, install falls back to a local source build. In that
case, Rust must be installed on the machine.

## Quick Start

### Full-Flow Fused Artifact

This is the normal Voided v2 path in Node.js.

```ts
import {
  generateKey,
  protect,
  open,
  inspectArtifact,
} from "@voideddev/enc-server";

const key = generateKey();
const plaintext = Buffer.from("hello from enc-server");

const protectedResult = protect(plaintext, key, {
  preset: "balanced",
  compressionAlgorithm: "brotli",
  encryptionAlgorithm: "xchacha20-poly1305",
});

const info = inspectArtifact(protectedResult.artifact);
const restored = open(protectedResult.artifact, key);

console.log(info.preset);
console.log(restored.toString("utf8"));
```

### Primitive Encryption

Use raw AEAD helpers when you want to manage the outer format yourself.

```ts
import {
  generateKey,
  encrypt,
  decrypt,
} from "@voideddev/enc-server";

const key = generateKey();
const plaintext = Buffer.from("primitive path");

const encrypted = encrypt(plaintext, key, "xchacha20-poly1305");
const restored = decrypt(encrypted, key);

console.log(restored.equals(plaintext));
```

### Inspect And Repack

Use `inspectArtifact` when you want metadata without opening the payload, and
`repackArtifact` when you want to move an artifact between presets.

```ts
import {
  generateKey,
  protect,
  repackArtifact,
  inspectArtifact,
  open,
} from "@voideddev/enc-server";

const key = generateKey();
const payload = Buffer.from("repack me".repeat(1024));

const initial = protect(payload, key, { preset: "balanced" });
const repacked = repackArtifact(initial.artifact, key, { preset: "concealed" });
const info = inspectArtifact(repacked.artifact);
const restored = open(repacked.artifact, key);

console.log(info.preset);
console.log(restored.equals(payload));
```

## Choosing The Right API Layer

The package exposes several layers. Use the smallest one that fits your job.

### Use primitive helpers when you want:

- direct hashing
- direct AEAD encryption
- direct compression
- explicit control over your own outer format

### Use fused shell helpers when you want:

- `fuse`
- `unfuse`
- `inspectFused`

These are for cases where you already own the bytes being shelled.

### Use full-flow helpers when you want:

- `protect`
- `open`
- `inspectArtifact`
- `repackArtifact`

These are the standard Voided v2 artifact APIs.

## Primitive Crypto APIs

Primitive exports include:

- `generateKey`
- `encrypt`
- `decrypt`
- `deriveKeyHkdf`
- `deriveKeyPbkdf2`
- `hash`
- `hashWithSalt`
- `compareHashes`
- `generateHmac`
- `verifyHmac`
- `hashPbkdf2`
- `verifyPbkdf2`
- `fingerprint`
- `safetyNumbers`
- `compress`
- `decompress`
- `randomBytes`
- `generateSalt`
- `secureWipe`
- `base64Encode`
- `base64Decode`
- `hexEncode`
- `hexDecode`

Important behavior notes:

- all binary inputs and outputs use Node `Buffer`
- the package is synchronous because the native module is loaded directly into
  Node.js
- there is no TypeScript crypto fallback in this package

## Fused Shell And Full-Flow APIs

### Fused Shell

Use these when you want the shell layer directly:

- `fuse(data, key, preset?, chunkSize?)`
- `unfuse(data, key)`
- `inspectFused(data)`

`inspectFused` gives you metadata such as:

- preset
- chunk size
- chunk count
- payload size
- shell size

### Full-Flow Artifacts

Use these when you want the standard Voided v2 artifact contract:

- `protect(data, key, options?)`
- `open(artifact, key)`
- `inspectArtifact(artifact)`
- `repackArtifact(artifact, key, options?)`

`protect` and `repackArtifact` accept:

- `preset`
- `compressionAlgorithm`
- `compressionLevel`
- `encryptionAlgorithm`
- `shellChunkSize`

`inspectArtifact` reports:

- preset
- compression algorithm
- encryption algorithm
- original size
- compressed size
- encrypted size
- protected size
- shell chunk size
- shell chunk count

If you do not have a strong reason otherwise, start with:

- `preset: "balanced"`
- `compressionAlgorithm: "brotli"`
- `encryptionAlgorithm: "xchacha20-poly1305"`

## Higher-Level Helper Exports

The package also includes higher-level helper modules built on top of the native
runtime:

- `KeyManager`
  - key lifecycle and storage helper
- `SigningService`
  - higher-level signing orchestration using Node.js crypto
- `StatsTracker`
  - metrics collection for tests and measurement
- stream helpers
  - compression
  - decompression
  - encryption
  - decryption
  - chunking
  - line splitting
- limits helpers
  - upload limit checks
  - stream threshold helpers
- benchmarks
  - compression
  - encryption
  - hashing

The package also re-exports the low-level runtime as a namespace:

```ts
import { rust } from "@voideddev/enc-server";
```

That can be convenient when you want the raw native wrapper grouped under one
namespace instead of pulling individual functions.

## Fused Presets And Planning Metadata

The stable public fused presets are:

- `compact`
- `balanced`
- `concealed`

Planning metadata is exported through:

- `VOIDED_V2_PRESET_PLAN`
- `DEFAULT_VOIDED_V2_POLICY_PLAN`
- `HIGH_SECURITY_VOIDED_V2_POLICY_PLAN`
- `listVoidedV2Presets()`
- `resolveVoidedV2Preset()`

This metadata is useful when you want to align on preset ids, aliases, or
default policy selection in higher-level tooling.

## Native Runtime Behavior

Important runtime facts:

- the package requires the native Node binding
- native loading happens at runtime when the package is first used
- the package prefers prebuilt binaries
- local development builds live under `native/`
- release prebuilds live under `prebuilds/`

For local development:

```bash
npm run build:native
npm run build
```

## Development

Useful commands:

```bash
npm run build
npm run build:native
npm run test
npm run test:native
npm run test:integration
npm run test:all
```

The package-level integration tests are especially useful when you change the
fused artifact model or its Node wrapper behavior.

## Troubleshooting

### The native module does not load

Usually this means one of these:

- there is no prebuilt binary for the current platform
- the local source build did not run successfully
- the workspace has not been built yet in local development

Typical fixes:

- install Rust if a source build is required
- run `npm run build:native`
- run `npm run build`

### I want the standard artifact path, but I am using `encrypt/decrypt`

Use `protect/open` instead. `encrypt/decrypt` are primitive AEAD helpers, while
`protect/open` are the fused-first full-flow artifact APIs.

### I only want the shell layer

Use `fuse/unfuse` instead of `protect/open`.

## v1 Boundary

This package is the fused-first current line. The old map-based APIs such as
`encryptWithMap` and `VoidedService` have been removed from this branch and
belong to deprecated v1 only.

That means:

- no map-first public API in the current package
- no map-first examples in this manual
- no new current-line development targeting the old map shape

## License

MIT
