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
