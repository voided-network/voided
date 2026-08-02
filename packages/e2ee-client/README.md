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
- [Authenticated Browser Envelope](#authenticated-browser-envelope)
- [Top-Level Helper Guide](#top-level-helper-guide)
- [Low-Level Crypto Guide](#low-level-crypto-guide)
- [WASM And Backend Behavior](#wasm-and-backend-behavior)
- [Monolith Artifact Guide](#monolith-artifact-guide)
- [Key Storage And Lifecycle](#key-storage-and-lifecycle)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [v1 Boundary](#v1-boundary)
- [License](#license)

## What This Package Is For

Use `@voideddev/e2ee-client` when you want:

- browser-side encryption with first-party Voided APIs
- a stateful client that manages browser key storage for you
- v3 monolith artifact helpers in browser runtimes
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
monolith artifact path.

## Recommended Browser Path

If you are choosing quickly and do not need a custom integration, start here:

1. create a `VoidedE2EEClient`
2. use `protect` to produce a v3 monolith artifact
3. use `inspectProtected` when you want metadata without opening it
4. use `open` to restore the original text

That is the normal browser-facing Voided v3 path.

`inspectProtected`, `inspectArtifact`, and `inspectFused` are keyless structural
inspection helpers. Their returned metadata is unauthenticated and must be
treated as attacker-controlled until `open` or `unfuse` succeeds with the
expected key. Do not use inspected fields for authorization, trust decisions,
or unbounded allocation.

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
- monolith artifact helpers without the stateful client wrapper

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

### Stateful Monolith Artifact Example

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

In the standard Voided v3 browser flow, the steps are:

1. optional compression
2. encryption
3. whole-monolith shell shaping

That means:

- `encrypt` returns the older encrypted blob shape
- `fuse` wraps prepared bytes in the shell
- `protect` returns the standard v3 monolith artifact shape

Use `protect/open` when you want the standard Voided v3 monolith artifact contract.

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
  - monolith-first artifact path
- `inspectProtected`
  - inspect a monolith protected blob without opening it
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
  - a bounded but unauthenticated metadata view; treat every field as
    attacker-controlled until `open` succeeds
- `encrypt/decrypt`
  - the older browser blob path, still available but not the main v2 shape

Command intent:

- `protect`
  - compress, encrypt, and shape text through the standard monolith flow
- `open`
  - reverse the full fused flow and return the original text
- `inspectProtected`
  - inspect monolith artifact metadata without opening it
- `encrypt` / `decrypt`
  - use the older encrypted blob format instead of the monolith artifact format

## Authenticated Browser Envelope

The stateful `encrypt/decrypt` API emits authenticated browser envelope
version `1.1`. Version `1.1` cryptographically binds all fields that affect
plaintext interpretation:

- message ID and key namespace
- encryption and compression algorithms
- original and compressed byte lengths
- text encoding
- whether the message is chunked
- total chunk count, chunk size, each chunk index, and each chunk plaintext size

Chunk indices must be unique, contiguous, and already in canonical order.
Omitted, duplicated, reordered, cross-message, or truncated chunks fail before
plaintext is returned. The browser helper bounds aggregate decoding to 100 MiB,
128 chunks, 8 MiB per chunk, and four concurrent cryptographic operations.

### Prelaunch format break

Legacy `1.0` browser blobs are rejected. They did not authenticate the
metadata and chunk framing above, so silently opening them would reintroduce
reordering, truncation, and encoding-substitution attacks. This is an
intentional prelaunch format break; migrate trusted data before updating rather
than enabling a permissive compatibility fallback.

### Signatures

Signature mode is fail-closed. A sender must create a signing key before
encryption, and a receiver must explicitly provision the peer public key:

```ts
const senderPublicKey = await sender.generateSigningKeys();
await receiver.setTrustedSigningPublicKey(senderPublicKey);
```

When `enableSignatures: true`, removing the envelope signature or any chunk
signature causes decryption to fail. A locally generated key is never
implicitly trusted as a peer identity.

### Compression

High-level browser encryption defaults to `compressionAlgorithm: "none"`.
Compression can leak secrets through ciphertext length when secret and
attacker-controlled values share one compression context. Opt in only when the
entire plaintext has one trust boundary:

```ts
await client.encrypt(data, { compressionAlgorithm: "gzip" });
// or
await client.encrypt(data, { forceCompression: true });
```

Explicit algorithms are strict: an unsupported or unavailable algorithm
throws. Only `auto` may decide that uncompressed output is appropriate.
Decompression enforces authenticated output size, an absolute browser memory
cap, and an expansion-ratio cap while inflating.

### Forward secrecy and key sharing

`enableForwardSecrecy` was removed and now throws. The previous option was
not a ratchet and did not provide forward secrecy. Use an independently
reviewed ratcheting protocol when forward secrecy is required.

`KeySharing` remains available for explicit X25519 key transfer. Every
transfer now requires sender ID, recipient ID, key ID, and a unique transfer
ID from `KeySharing.createTransferId()`. Those values and the transfer
direction are bound into both HKDF and AEAD. Successful transfer IDs are
consumed by a replay store; provide a durable `KeySharingReplayStore` when
replay protection must survive a reload.

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
- `decompressBounded`
- `randomBytes`
- `generateSalt`

`decompressBounded(data, algorithm, maxOutputBytes)` is the lossless,
WASM-backed path for formats that already carry a trusted or independently
validated size ceiling. It streams decoder output into an absolute caller cap,
accepts highly compressible data without a ratio heuristic, and rejects before
returning any output if that cap would be crossed. The explicit ceiling may be
at most 512 MiB. This method fails closed when the Rust/WASM backend is
unavailable; it never substitutes an unbounded TypeScript decoder.

`hashWithSalt` now matches the core/native v2 transcript exactly: a
domain-separated, length-prefixed encoding of the data and salt. It
intentionally differs from the legacy `hash(data || salt)` construction.
Persisted legacy salted digests must be migrated or recomputed before they can
be verified by the current API.

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
  - compress, encrypt, and shape bytes into a standard v3 monolith artifact
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

- the fused shell and monolith artifact helpers currently require the Rust/WASM
  backend
- the older browser primitive APIs can fall back to TypeScript/Web Crypto when
  WASM is unavailable
- in that TypeScript fallback, compression support is intentionally limited to
  `gzip` and `none`
- real browser-side `brotli` support remains part of the Rust/WASM path
- `decompressBounded` is deliberately WASM-only so its output-bound contract
  cannot be weakened by fallback behavior

Practical meaning:

- the TypeScript fallback is a primitives-and-legacy-path fallback
- it is not currently a fused shell fallback
- if your browser app depends on `fuse`, `protect`, `inspectArtifact`, or
  `repackArtifact`, treat WASM as required today

If you are wondering whether this is a migration blocker, the practical answer
is usually no: for the current browser fused path, WASM is the intended runtime
rather than an optional acceleration layer.

Useful exports:

- `configureWasmLoader`
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

`configureWasmLoader` and its `WasmLoaderOptions` type are exported from the
main package, `@voideddev/e2ee-client/wasm`, and
`@voideddev/e2ee-client/crypto`, so configuration and the code that initializes
WASM can share the same package entry point.
Import configuration and initialization from the same entry point; separately
bundled subpath entry points do not share loader state.

The default loader keeps the package's unbundled layout and tries the shipped
`wasm/voided_wasm.js` paths. A flattened application bundle cannot preserve
that relative package layout. For Vite or another static host, copy the glue
and binary together without renaming either file:

```bash
mkdir -p public/voided
cp node_modules/@voideddev/e2ee-client/wasm/voided_wasm.js public/voided/
cp node_modules/@voideddev/e2ee-client/wasm/voided_wasm_bg.wasm public/voided/
```

Configure the trusted glue URL before any client, backend, or WASM helper can
start initialization:

```ts
import {
  configureWasmLoader,
  initWasm,
} from "@voideddev/e2ee-client";

configureWasmLoader({
  glueUrl: new URL(
    `${import.meta.env.BASE_URL}voided/voided_wasm.js`,
    window.location.origin,
  ),
});
await initWasm();
```

Vite copies `public/voided` into the static output unchanged. Serve
`voided_wasm_bg.wasm` with `application/wasm` and keep it adjacent to
`voided_wasm.js`. Configuration is locked once initialization starts. If a
configured URL fails, the loader fails closed and does not try package-relative
assets. There is no production reset API: retrying with different configuration
requires a fresh page or module context.

The configured URL is a JavaScript module import, not passive data: it executes
with the application's privileges. Copy it from the exact locked package
version and serve it only from a trusted, deployment-controlled origin. Do not
accept this URL from users, query parameters, or untrusted remote configuration.

Optional warm-up:

```ts
import { initWasm, isWasmReady, getCurrentBackend } from "@voideddev/e2ee-client";

await initWasm();
console.log(isWasmReady());
console.log(await getCurrentBackend());
```

If you plan to use fused helpers through the `crypto` namespace, explicit WASM
initialization can make startup behavior easier to reason about.

## Monolith Artifact Guide

The monolith artifact APIs are:

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
   - produce a v3 monolith artifact from text or bytes
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
- `VoidedE2EEClient.protect/open` do not yet wrap artifacts with peer
  signatures
- the removed `enableForwardSecrecy` option is not supported by either path

In other words, the monolith artifact flow is the storage/artifact flow. It is not
trying to replace every older high-level browser feature in one API.

## Key Storage And Lifecycle

By default, `VoidedE2EEClient` uses IndexedDB-backed storage through
`IndexedDBStorage`. This is a zero-configuration fallback so the package can
work on first use; it is not recovery-grade storage and should not be the sole
custody mechanism for production keys.

That gives you:

- persisted current key storage
- migration state storage
- key-pair storage for the client features that need it

If you need custom storage behavior, provide your own `storage` implementation
through the client config.

For production custody, prefer Slipner Auth's OPRF-backed key path where it is
available, or provide an external `E2EEStorage` implementation with the
durability and recovery guarantees your application requires. Keep an explicit
export/import or recovery path as appropriate for the product. Browser storage
can be cleared, isolated, or made unavailable by browser and origin policy.
Neither IndexedDB nor WebCrypto can hide plaintext or usable keys from fully
compromised same-origin JavaScript. Treat XSS prevention, dependency hygiene,
and a restrictive Content Security Policy as part of the application security
boundary.

The fallback distinguishes confirmed absence from storage failure: only a
successful `null` read can create a first-use key. Read errors fail closed and
are retryable; they never authorize overwriting an existing key. IndexedDB also
does not coordinate multiple tabs as a recovery or custody system, so avoid
concurrent first-use, rotation, migration, or deletion writers for the same key
ID.

Each key-dependent operation revalidates persisted authority before taking a
stable-key lease, so a later operation notices a completed rotation from
another client instance. Keep exactly one lifecycle writer per key ID: truly
concurrent rotations or replacements across tabs/processes require an
application-owned transactional storage lock and are not coordinated by the
generic `E2EEStorage` interface.

Useful lifecycle operations include:

- `exportKey`
- `importKey`
- `rotateKey`
- `deleteKey`
- password-derived key setup

`deriveKeyFromPassword` requires a password of at least 12 characters, a
16-64 byte salt, and 600,000-1,000,000 PBKDF2-SHA256 iterations. It returns
the exact salt/iteration record needed for recovery and also stores that record
under an internal, collision-resistant namespace:

```ts
const parameters = await client.deriveKeyFromPassword({
  password,
  // optional: salt and iterations
});

const persistedParameters =
  await client.getPasswordKeyDerivationRecord();
```

Preserve the returned parameters with the same care as other recovery
metadata. They are not secret, but losing them prevents deterministic
re-derivation. The stored record is bound to the monotonic primary-key version;
import, rotation, agreement, and deletion remove it, and a failed cleanup can
never make an old record describe the newly active key.

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

For a release, build the provenance-bound baseline before invoking
`npm publish`:

```bash
npm run build:wasm
npm publish --access public
```

The publish lifecycle verifies the baseline against the current source, creates
a second clean build under a different physical root, requires every shipped
WASM byte and the provenance manifest to match, rebuilds the TypeScript
surfaces, and executes the exact packed tarball. Missing, stale, path-leaking,
toolchain-mismatched, nondeterministic, or hostile-input-failing artifacts
remain excluded from the package.

## Troubleshooting

### Fused helpers throw instead of using the fallback backend

That is expected today. The fused shell and monolith artifact helpers currently
require the Rust/WASM backend in `@voideddev/e2ee-client`.

Typical fixes:

- call `await initWasm()`
- call `await forceWasmBackend()`
- check `getWasmError()`
- for flattened bundles, copy and configure the trusted glue URL exactly as
  shown in [WASM And Backend Behavior](#wasm-and-backend-behavior)

### I only need browser encryption and do not care about monolith artifacts

Use the older `encrypt/decrypt` path or the relevant primitive helpers through
`crypto`.

### I want explicit bytes, not string-oriented helpers

Use the `crypto` namespace instead of `VoidedE2EEClient`.

### I want more control over initialization

Use the WASM loader exports directly instead of relying on lazy backend
selection.

## v1 Boundary

This package is the monolith-first current line. The old map-based surface is not
part of the current public browser package contract.

Separately, encrypted browser envelope `1.0` is rejected in favor of the
authenticated `1.1` format described above.

That means:

- no map-first API in the current browser guide
- no new current-line development targeting the old map shape
- no expectation that the current package should preserve the deprecated map
  surface

## License

MIT
