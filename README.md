# Voided

Voided is a fused-first encryption toolkit built around a shared Rust core and
first-party Node.js and browser wrappers.

The current library surface is organized around three layers:

1. primitive cryptography
2. fused shell primitives
3. full-flow fused artifacts

The default full flow in Voided v2 is:

1. compression
2. encryption
3. fused shell

## Contents

- [What Voided Includes](#what-voided-includes)
- [Choose Your Entry Point](#choose-your-entry-point)
- [Core Concepts](#core-concepts)
- [What Fused Means](#what-fused-means)
- [Command Map](#command-map)
- [Fused Presets](#fused-presets)
- [Repository Quick Start](#repository-quick-start)
- [Developer Manuals](#developer-manuals)
- [Examples](#examples)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [v1 Boundary](#v1-boundary)
- [License](#license)

## What Voided Includes

Voided ships as one Rust implementation with multiple first-party surfaces on
top of it:

- `voided-core`
  - the source-of-truth Rust crate
  - owns crypto behavior, artifact formats, fused presets, and shell logic
- `voided-node`
  - the N-API binding over `voided-core`
- `voided-wasm`
  - the browser/WASM binding over `voided-core`
- `@voideddev/enc-server`
  - the Node.js package over `voided-node`
- `@voideddev/e2ee-client`
  - the browser package over `voided-wasm`, with TypeScript fallback for parts
    of the older browser API

## Choose Your Entry Point

Use the package that matches the environment and level of control you want:

- `voided-core`
  - use this when you want direct Rust access to primitives, shell helpers, or
    fused artifacts
- `@voideddev/enc-server`
  - use this in Node.js when you want native Rust-backed hashing, encryption,
    compression, and fused artifact handling
- `@voideddev/e2ee-client`
  - use this in browser runtimes when you want stateful client-side encryption,
    key storage, and browser-facing fused artifact helpers

## Core Concepts

### Primitive APIs

These are the low-level building blocks:

- hashing
- AEAD encryption
- key derivation
- compression
- utility helpers

Use primitive APIs when you want to define your own outer format or when you
only need one step of the stack.

### Fused Shell

The fused shell is the outer envelope layer. It lets you shape bytes into a
stable, inspectable shell format without asking callers to keep the old map-era
surface alive.

Use fused shell primitives when:

- you already control the bytes inside the shell
- you want shell metadata without managing a separate artifact format
- you want preset-driven shell behavior without building your own outer wrapper

### Full-Flow Fused Artifact

The full-flow helpers are the normal Voided v2 product surface:

- `protect`
- `open`
- `inspectArtifact`
- `repackArtifact`

Use these when you want Voided to own the normal artifact shape end to end.

### Inspection

Both shell and full-flow artifacts can be inspected without opening them:

- `inspectFused`
- `inspectArtifact`

That makes it easier to reason about preset, sizes, and envelope structure
without immediately decrypting the payload.

## What Fused Means

The fused shell is not a second encryption algorithm and it is not the old map
system under a new name.

It is the outer container layer that wraps already-prepared bytes into a
versioned, preset-driven, inspectable envelope.

In the standard Voided v2 flow, the bytes going into the shell are:

1. optionally compressed
2. encrypted with an AEAD
3. wrapped by the fused shell

What the shell adds on top of the encrypted payload:

- a stable outer binary format
- preset-driven shell behavior
- chunking metadata
- inspectable envelope metadata
- a consistent artifact contract across Rust, Node, and browser surfaces

The shell does not replace encryption. It sits outside encryption and gives the
encrypted payload a first-class artifact shape.

If you already have the bytes you want inside the shell, use shell primitives.
If you want Voided to do the whole flow for you, use full-flow helpers.

## Current Full-Flow Benchmark Snapshot

This is a development benchmark snapshot, not a product guarantee. It was run
outside this repository against the real package functions. Voided rows use the
full `protect/open` flow with Brotli level 6, XChaCha20-Poly1305, the
`balanced` shell preset, deterministic shell nonces for repeatability, and an
eight-file public corpus totaling `2,276,665` bytes.

Corpus mix: Project Gutenberg prose/play/legal text, RFC 8446, CommonMark spec
source, Iris CSV, and Swagger Petstore OpenAPI YAML.

Benchmark column notes:

- `aead/tamper` is a pass/fail score for successful roundtrip plus rejected
  ciphertext tampering. It is not a formal cryptographic proof.
- `artifact` is byte-statistical output quality, not decryptability.
- `avalanche` is reported separately because low plaintext avalanche is normal
  for secure stream-style AEADs.
- Raw AEAD baselines serialize `nonce || ciphertext`; compression baselines use
  the named compressor before XChaCha20-Poly1305.

| candidate | output bytes | overhead | encode MiB/s | decode MiB/s | aead/tamper | artifact | efficiency | size | value | avalanche |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `xchacha20-poly1305-raw` | 2,276,985 | 0.171% | 243.89 | 245.81 | 100.00 | 95.99 | 80.37 | 99.34 | 93.99 | 0.000 |
| `aes-256-gcm-raw` | 2,276,889 | 0.120% | 129.35 | 128.72 | 100.00 | 98.38 | 57.22 | 99.53 | 88.83 | 0.000 |
| `gzip+xchacha20-poly1305` | 812,369 | -70.546% | 29.35 | 193.18 | 100.00 | 95.60 | 47.37 | 100.00 | 85.74 | 0.283 |
| `brotli+xchacha20-poly1305` | 744,106 | -72.588% | 29.88 | 203.31 | 100.00 | 96.78 | 44.09 | 100.00 | 85.22 | 0.329 |
| `voided-protect-v1-package` | 749,780 | -72.263% | 24.37 | 123.96 | 100.00 | 96.72 | 35.16 | 100.00 | 82.97 | 0.497 |
| `voided-protect-v2-current` | 749,981 | -72.249% | 25.56 | 112.65 | 100.00 | 95.59 | 33.18 | 100.00 | 82.19 | 0.499 |

Read: full-flow Voided v1 and v2 both preserve the actual cryptographic gate in
this benchmark: roundtrip succeeds and tampering is rejected. V2 is not easier
to decrypt based on these numbers. The current v2 shell is, however, not a
universal performance/value win over v1: it is slightly larger, slower to open,
and lower on artifact byte-statistics on this corpus. Its main measurable win is
high plaintext-change avalanche after the full flow.

## Command Map

The easiest way to think about the API is by asking which layer you want Voided
to own.

### Primitive Layer

Use these when you only want one part of the stack:

- `hash`
  - digest bytes or strings
- `encrypt` / `decrypt`
  - authenticated encryption without shelling or artifact formatting
- `compress` / `decompress`
  - compression without encryption or shelling

### Shell Layer

Use these when your payload is already prepared and you only want the outer
fused envelope:

- `fuse`
  - wrap prepared bytes in the fused shell
- `unfuse`
  - remove the shell and return the inner bytes
- `inspectFused`
  - read shell metadata without opening the inner payload

### Full-Flow Artifact Layer

Use these when you want the normal Voided v2 artifact model:

- `protect`
  - compress, encrypt, and shell data into a fused artifact
- `open`
  - reverse the full flow and return the original plaintext bytes
- `inspectArtifact`
  - read artifact metadata without opening it
- `repackArtifact`
  - reopen and rewrite an artifact with new options such as preset or
    compression settings

## Fused Presets

The stable fused presets are:

- `compact`
- `balanced`
- `concealed`

Practical intent:

- `compact`
  - lowest-overhead stable preset
- `balanced`
  - default preset for general use
- `concealed`
  - heavier preset with more shell variation

If you are starting from scratch and do not have a strong reason otherwise, use
`balanced`.

## Repository Quick Start

Install dependencies and build everything:

```bash
npm install
npm run build
```

Run the workspace test suites that are exposed through package scripts:

```bash
npm test
```

Targeted builds:

```bash
npm run build:node
npm run build:wasm
npm run build:cross
```

Cross-platform native builds require Zig to be available locally, either
through `VOIDED_ZIG_BIN` or an untracked `tools/zig/` directory.

## Developer Manuals

Each primary surface has its own detailed guide:

- [Root Rust crate manual](./crates/voided-core/README.md)
  - direct Rust usage, feature flags, module map, and fused artifact examples
- [Node.js manual](./packages/enc-server/README.md)
  - native loading, synchronous Node APIs, fused artifact usage, and higher-level
    helper exports
- [Browser manual](./packages/e2ee-client/README.md)
  - stateful browser client flows, top-level helpers, crypto namespace usage,
    and WASM behavior

## Examples

Repository examples live in [`examples/`](./examples/):

- `simple-demo.js`
  - smallest fused-first example
- `full-demo.js`
  - full artifact lifecycle with `protect`, `inspect`, `repack`, and `open`
- `temperature-demo.js`
  - preset comparison demo retained under the historical filename

Build the workspace first, then run an example:

```bash
node examples/simple-demo.js
```

## Development Workflow

Common contributor loop:

```bash
npm install
npm run build
npm test
```

Useful targeted commands:

```bash
npm run build:node
npm run build:wasm
npm run test:enc-server
npm run test:e2ee-client
```

The workspace uses a single root `package-lock.json`.

## Testing

Testing is split across the Rust core and the package wrappers:

- `voided-core`
  - Rust unit, stress, and vector coverage
- `@voideddev/enc-server`
  - native binding tests plus Node integration coverage
- `@voideddev/e2ee-client`
  - browser-facing integration coverage plus dedicated WASM binding tests

When changing the fused artifact model, the most important checks are:

- Rust core fused tests
- Node wrapper integration tests
- browser/WASM fused roundtrip tests

## v1 Boundary

Voided v2 is fused-first. The old map-based surface is not part of the current
library contract.

That means:

- no map-first public API in the current wrappers
- no map-first examples in the primary docs
- no new development targeting the v1 map shape

If someone needs that older map surface, it belongs to deprecated v1 rather
than the current library line.

## License

MIT
