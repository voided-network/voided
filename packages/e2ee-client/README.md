# @voideddev/e2ee-client

`@voideddev/e2ee-client` is the browser-facing Voided package. It gives you a
stateful client API for browser encryption workflows, top-level convenience
helpers, a lower-level crypto namespace, browser key storage, and fused
artifact helpers backed by the Voided WASM runtime.

At a high level, the package exposes four layers:

1. `VoidedE2EEClient`
2. top-level helper functions
3. the `crypto` namespace
4. the WASM loader

## Contents

- [What This Package Is For](#what-this-package-is-for)
- [Installation](#installation)
- [Recommended Browser Path](#recommended-browser-path)
- [Package Layers](#package-layers)
- [Quick Start](#quick-start)
- [What Fused Means In The Browser](#what-fused-means-in-the-browser)
- [Stateful Client Guide](#stateful-client-guide)
- [Top-Level Helper Guide](#top-level-helper-guide)
- [Low-Level Crypto Guide](#low-level-crypto-guide)
- [WASM And Backend Behavior](#wasm-and-backend-behavior)
- [Fused Artifact Guide](#fused-artifact-guide)
- [Key Storage And Lifecycle](#key-storage-and-lifecycle)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [v1 Boundary](#v1-boundary)
- [License](#license)

## What This Package Is For

Use `@voideddev/e2ee-client` when you want:

- browser-side encryption with first-party Voided APIs
- a stateful client that manages browser key storage for you
- fused artifact helpers in browser runtimes
- top-level helper functions for simpler app code
- access to the WASM-backed low-level crypto layer when you need more control

If you want direct Rust instead, use `voided-core`. If you want Node.js instead
of the browser, use `@voideddev/enc-server`.

## Installation

```bash
npm install @voideddev/e2ee-client
```

If you plan to use fused helpers in the browser, treat the WASM runtime as part
of the normal package requirement. The TypeScript fallback is useful for the
older browser encryption path and primitive helpers, but it is not the current
fused artifact path.

## Recommended Browser Path

If you are choosing quickly and do not need a custom integration, start here:

1. create a `VoidedE2EEClient`
2. use `protect` to produce a fused artifact
3. use `inspectProtected` when you want metadata without opening it
4. use `open` to restore the original text

That is the normal browser-facing Voided v2 path.

Use a different layer only when you have a clear reason:

- use top-level helpers when you want the same browser behavior with less setup
- use `crypto` when you want `Uint8Array` control and explicit backend control
- use the WASM loader when you want to manage initialization or readiness
  yourself

## Package Layers

### `VoidedE2EEClient`

Use this when you want:

- browser key lifecycle handled for you
- default IndexedDB-backed storage
- high-level string-oriented APIs
- stateful operations like key import, export, and rotation

This is the recommended entry point for most browser applications.

### Top-Level Helpers

The package also exports convenience functions like:

- `encrypt`
- `decrypt`
- `protect`
- `open`
- `inspectProtected`
- `exportKey`
- `importKey`
- `rotateKey`

These operate through a default singleton client.

This is useful when you want the same fused browser path but do not want to
hold a client instance yourself.

### `crypto` Namespace

Use `crypto` when you want direct lower-level control over:

- `Uint8Array` inputs and outputs
- backend selection
- primitive crypto helpers
- fused artifact helpers without the stateful client wrapper

Use this when you want byte-level control or you want to make the WASM/runtime
choice explicit.

### WASM Loader

Use the WASM loader when you want:

- explicit backend initialization
- access to the normalized WASM module
- visibility into WASM readiness or initialization errors

Use this when startup and readiness are part of your app architecture rather
than something you want the library to resolve lazily.

## Quick Start

### Stateful Fused Artifact Example

```ts
import { VoidedE2EEClient } from "@voideddev/e2ee-client";

const client = new VoidedE2EEClient();

const protectedBlob = await client.protect("Private browser-side data", {
  preset: "balanced",
});

const reopened = await client.open(protectedBlob);
const info = await client.inspectProtected(protectedBlob);

console.log(info.preset);
console.log(reopened);
```

The client generates and persists a key on first use if one does not already
exist for the configured key id.

### Top-Level Helper Example

```ts
import { protect, open, inspectProtected } from "@voideddev/e2ee-client";

const blob = await protect("hello from top-level helpers", {
  preset: "balanced",
});

const info = await inspectProtected(blob);
const restored = await open(blob);

console.log(info.protectedSize);
console.log(restored);
```

## What Fused Means In The Browser

The fused shell is the outer artifact envelope. It does not replace browser
encryption. It wraps already-prepared bytes in a stable, inspectable,
preset-driven format.

In the standard Voided v2 browser flow, the steps are:

1. optional compression
2. encryption
3. fused shell wrapping

That means:

- `encrypt` returns the older encrypted blob shape
- `fuse` wraps prepared bytes in the shell
- `protect` returns the standard fused artifact shape

Use `protect/open` when you want the standard Voided v2 artifact contract.

Use `fuse/unfuse` only when you already control the inner bytes and only need
the outer shell.

Another way to think about it:

- `encrypt`
  - "give me ciphertext"
- `fuse`
  - "give these bytes a shell"
- `protect`
  - "own the normal browser artifact flow for me"

## Stateful Client Guide

`VoidedE2EEClient` is the highest-level browser API in the package.

Important behaviors:

- string-oriented inputs and outputs
- key storage handled by the internal `KeyManager`
- default storage is IndexedDB
- the client auto-loads or auto-generates its current key
- fused `protect/open` and older `encrypt/decrypt` flows both live here

Common client operations:

- `protect` / `open`
  - fused-first artifact path
- `inspectProtected`
  - inspect a fused protected blob without opening it
- `encrypt` / `decrypt`
  - older stateful encrypted blob path
- `exportKey` / `importKey`
  - move keys in and out of the client
- `rotateKey`
  - change the current key
- `deriveKeyFromPassword`
  - create a managed key from password material

Use the stateful client when you want application-oriented browser behavior and
do not want to manually wire key bytes into every operation.

Recommended mental model:

- `protect/open`
  - the current default path for browser artifacts
- `inspectProtected`
  - the safe metadata view for those artifacts
- `encrypt/decrypt`
  - the older browser blob path, still available but not the main v2 shape

Command intent:

- `protect`
  - compress, encrypt, and shell text through the standard fused flow
- `open`
  - reverse the full fused flow and return the original text
- `inspectProtected`
  - inspect fused artifact metadata without opening it
- `encrypt` / `decrypt`
  - use the older encrypted blob format instead of the fused artifact format

## Top-Level Helper Guide

The top-level helpers mirror the default client instance.

They are useful when:

- you only need one configured default client
- you want small call sites
- you do not need to explicitly manage multiple client instances

The tradeoff is that you are opting into the default singleton client rather
than a client instance you constructed yourself.

If you are writing a small browser app and only have one logical Voided client,
the top-level helpers are usually enough.

## Low-Level Crypto Guide

The package exports a `crypto` namespace for lower-level operations:

```ts
import { crypto, forceWasmBackend } from "@voideddev/e2ee-client";

await forceWasmBackend();

const key = await crypto.generateKey();
const plaintext = new TextEncoder().encode("hello bytes");

const protectedResult = await crypto.protect(plaintext, key, {
  preset: "balanced",
  compressionAlgorithm: "gzip",
  encryptionAlgorithm: "xchacha20-poly1305",
});

const restored = await crypto.open(protectedResult.artifact, key);
console.log(new TextDecoder().decode(restored));
```

The `crypto` namespace is the right layer when you want:

- `Uint8Array` control instead of string-oriented client APIs
- direct access to low-level primitives
- explicit backend selection and inspection
- fused helpers without the stateful client wrapper

Use it when your code already works in bytes, when you are integrating Voided
into another binary protocol, or when you want to make the WASM dependency
obvious in the call site.

Primitive helpers exposed through `crypto` include:

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

Fused helpers exposed through `crypto` include:

- `fuse`
- `unfuse`
- `inspectFused`
- `protect`
- `open`
- `inspectArtifact`
- `repackArtifact`

What they do:

- `fuse`
  - wrap prepared bytes in the fused shell
- `unfuse`
  - remove the shell and return the inner bytes
- `inspectFused`
  - inspect shell metadata without opening the inner payload
- `protect`
  - compress, encrypt, and shell bytes into a standard fused artifact
- `open`
  - reverse the full fused flow and return the original bytes
- `inspectArtifact`
  - inspect artifact metadata without opening it
- `repackArtifact`
  - rewrite an artifact with new preset or pipeline options

## WASM And Backend Behavior

The browser package has two backend modes:

- Rust/WASM
- TypeScript/Web Crypto fallback

Important behavior:

- the fused shell and fused artifact helpers currently require the Rust/WASM
  backend
- the older browser primitive APIs can fall back to TypeScript/Web Crypto when
  WASM is unavailable
- in that TypeScript fallback, compression support is intentionally limited to
  `gzip` and `none`
- real browser-side `brotli` support remains part of the Rust/WASM path

Practical meaning:

- the TypeScript fallback is a primitives-and-legacy-path fallback
- it is not currently a fused shell fallback
- if your browser app depends on `fuse`, `protect`, `inspectArtifact`, or
  `repackArtifact`, treat WASM as required today

If you are wondering whether this is a migration blocker, the practical answer
is usually no: for the current browser fused path, WASM is the intended runtime
rather than an optional acceleration layer.

Useful exports:

- `initWasm`
- `getWasm`
- `getWasmSync`
- `isWasmReady`
- `getWasmError`
- `useWasmBackend`
- `forceTypeScriptBackend`
- `forceWasmBackend`
- `getCurrentBackend`
- `isWasmBackendReady`

Optional warm-up:

```ts
import { initWasm, isWasmReady, getCurrentBackend } from "@voideddev/e2ee-client";

await initWasm();
console.log(isWasmReady());
console.log(await getCurrentBackend());
```

If you plan to use fused helpers through the `crypto` namespace, explicit WASM
initialization can make startup behavior easier to reason about.

## Fused Artifact Guide

The fused artifact APIs are:

- `protect`
- `open`
- `inspectProtected` or `inspectArtifact`
- `repackArtifact`

Stable presets:

- `compact`
- `balanced`
- `concealed`

Recommended starting point:

- `preset: "balanced"`

The normal browser artifact lifecycle is:

1. `protect`
   - produce a fused artifact from text or bytes
2. `inspectProtected` or `inspectArtifact`
   - read preset, sizes, and envelope metadata
3. `open`
   - recover the original plaintext or bytes
4. `repackArtifact`
   - rewrite an existing artifact when you need different preset or pipeline
     settings

The stateful client returns a browser-friendly `ProtectedBlob` with fields such
as:

- `artifact`
- `keyId`
- `version`
- `pipeline`
- `preset`
- compression metadata
- encryption algorithm
- shell metadata
- `protectedSize`

The lower-level `crypto.protect` helper returns the lower-level runtime result
with a raw `Uint8Array` artifact.

Important caveats:

- fused helpers currently require the WASM backend
- `VoidedE2EEClient.protect/open` do not yet wrap the artifact with the older
  signature or forward-secrecy options
- those older options still belong to the stateful `encrypt/decrypt` path for
  now

In other words, the fused artifact flow is the storage/artifact flow. It is not
trying to replace every older high-level browser feature in one API.

## Key Storage And Lifecycle

By default, `VoidedE2EEClient` uses IndexedDB-backed storage through
`IndexedDBStorage`.

That gives you:

- persisted current key storage
- migration state storage
- key-pair storage for the client features that need it

If you need custom storage behavior, provide your own `storage` implementation
through the client config.

Useful lifecycle operations include:

- `exportKey`
- `importKey`
- `rotateKey`
- `deleteKey`
- password-derived key setup

## Development

Useful commands:

```bash
npm run build:wasm
npm run build
npm test
npm run test:integration
npm run test:wasm
```

`test:wasm` is especially important when you change fused helpers, because the
fused browser path depends on the WASM runtime.

## Troubleshooting

### Fused helpers throw instead of using the fallback backend

That is expected today. The fused shell and fused artifact helpers currently
require the Rust/WASM backend in `@voideddev/e2ee-client`.

Typical fixes:

- call `await initWasm()`
- call `await forceWasmBackend()`
- check `getWasmError()`
- verify the WASM assets are present in your bundle or local build output

### I only need browser encryption and do not care about fused artifacts

Use the older `encrypt/decrypt` path or the relevant primitive helpers through
`crypto`.

### I want explicit bytes, not string-oriented helpers

Use the `crypto` namespace instead of `VoidedE2EEClient`.

### I want more control over initialization

Use the WASM loader exports directly instead of relying on lazy backend
selection.

## v1 Boundary

This package is the fused-first current line. The old map-based surface is not
part of the current public browser package contract.

That means:

- no map-first API in the current browser guide
- no new current-line development targeting the old map shape
- no expectation that the current package should preserve the deprecated map
  surface

## License

MIT
