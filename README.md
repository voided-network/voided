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

In the standard Voided protected flow, the bytes going into the shell are:

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

Current protected artifacts use the v3 protect-level monolith path: compression,
encryption, and shelling still run in the safe order above, but the shell state
is now derived from the full-flow artifact plan rather than only from encrypted
payload length. Legacy v1 and v2 protected artifacts remain openable.

If you already have the bytes you want inside the shell, use shell primitives.
If you want Voided to do the whole flow for you, use full-flow helpers.

## Raw Benchmarking

The old capped benchmark scoreboard has been replaced by `voided-bench`.
It does not emit a fake `security = 100` score, and it does not collapse
security, speed, size, and artifact shape into one pretend-universal number.

Run the synthetic corpus:

```sh
cargo run -p voided-bench --release --
```

Run your own corpus:

```sh
cargo run -p voided-bench --release -- --corpus /path/to/corpus
```

Output formats:

```sh
cargo run -p voided-bench --release -- --format markdown
cargo run -p voided-bench --release -- --format json
cargo run -p voided-bench --release -- --format csv
```

Benchmark model:

- Security gates are counts: roundtrip failures, tamper accepts, and wrong-key
  accepts. If all AEAD-backed candidates pass, they all show `0`; the benchmark
  does not inflate that into a differentiating score.
- Size is exact bytes, byte delta, output/input ratio, and overhead percent.
- Speed is median and weighted MiB/s.
- Artifact shape is raw entropy, entropy gap, chi-square per degree of freedom,
  serial correlation, bit bias, max byte frequency, same-input drift, and
  input-bit-flip delta.
- Natural bounded measurements, like input-bit delta percentage, stay
  percentages. Everything else stays in its native unit.

Fresh synthetic run from this checkout:

Corpus: `synthetic` | fixtures: `11` | input bytes: `1,885,227` | samples:
`2`

### Security Gates

| candidate | roundtrip failures | tamper accepts / trials | wrong-key accepts / trials |
|---|---:|---:|---:|
| `voided-protect-current` | 0 | 0 / 33 | 0 / 11 |
| `voided-c1e-current` | 0 | 0 / 33 | 0 / 11 |
| `voided-fuse-shell-current` | 0 | 0 / 33 | 0 / 11 |
| `xchacha20-poly1305-raw` | 0 | 0 / 33 | 0 / 11 |
| `aes-256-gcm-raw` | 0 | 0 / 33 | 0 / 11 |
| `gzip+xchacha20-poly1305` | 0 | 0 / 33 | 0 / 11 |
| `brotli+xchacha20-poly1305` | 0 | 0 / 33 | 0 / 11 |

### Size And Speed

| candidate | output bytes | byte delta | output/input | overhead % | median enc MiB/s | median dec MiB/s | weighted enc MiB/s | weighted dec MiB/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `voided-protect-current` | 1,377,284 | -507,943 | 0.730567 | -26.943334 | 70.934 | 8.429 | 74.631 | 74.249 |
| `voided-c1e-current` | 1,376,389 | -508,838 | 0.730092 | -26.990808 | 88.239 | 47.531 | 127.120 | 247.761 |
| `voided-fuse-shell-current` | 1,886,119 | 892 | 1.000473 | 0.047315 | 128.967 | 102.998 | 131.534 | 105.785 |
| `xchacha20-poly1305-raw` | 1,885,667 | 440 | 1.000233 | 0.023339 | 291.332 | 297.043 | 290.154 | 310.612 |
| `aes-256-gcm-raw` | 1,885,535 | 308 | 1.000163 | 0.016338 | 130.351 | 130.826 | 132.780 | 133.093 |
| `gzip+xchacha20-poly1305` | 1,389,776 | -495,451 | 0.737193 | -26.280708 | 73.302 | 29.012 | 52.984 | 244.030 |
| `brotli+xchacha20-poly1305` | 1,376,238 | -508,989 | 0.730012 | -26.998818 | 161.631 | 11.289 | 136.946 | 250.949 |

### Artifact Statistics

| candidate | entropy bits/byte | entropy gap | chi-square/df | serial corr | mean bit bias % | max byte freq % | same-input drift % | input-bit delta % | delta minus drift % | input delta len mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `voided-protect-current` | 7.999882 | 0.000118 | 0.880547 | -0.001221 | 0.043437 | 0.403403 | 41.113415 | 44.161890 | 3.048475 | 6.000 |
| `voided-c1e-current` | 7.999883 | 0.000117 | 0.877620 | 0.000193 | 0.042003 | 0.403738 | 47.114666 | 49.397124 | 2.282458 | 6.000 |
| `voided-fuse-shell-current` | 7.999898 | 0.000102 | 1.044534 | -0.000696 | 0.026350 | 0.404640 | 0.000000 | 22.833510 | 22.833510 | 0.182 |
| `xchacha20-poly1305-raw` | 7.999893 | 0.000107 | 1.091969 | 0.000145 | 0.032078 | 0.405957 | 0.000000 | 2.583258 | 2.583258 | 0.091 |
| `aes-256-gcm-raw` | 7.999892 | 0.000108 | 1.110937 | -0.000797 | 0.038464 | 0.403175 | 0.000000 | 4.282732 | 4.282732 | 0.091 |
| `gzip+xchacha20-poly1305` | 7.999856 | 0.000144 | 1.087583 | -0.000424 | 0.044081 | 0.404022 | 0.000000 | 24.549544 | 24.549544 | 2.727 |
| `brotli+xchacha20-poly1305` | 7.999881 | 0.000119 | 0.891447 | 0.000588 | 0.029746 | 0.403782 | 0.000000 | 31.669650 | 31.669650 | 6.273 |

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
