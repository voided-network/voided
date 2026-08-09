# Voided

Voided is a monolith-first encryption toolkit built around a shared Rust core
and first-party Node.js and browser wrappers.

The current library surface is organized around three layers:

1. primitive cryptography
2. fused shell primitives for callers that already own their inner bytes
3. whole-monolith protected artifacts for the normal product path

The default full flow in Voided 1.0 is:

1. compression
2. encryption
3. whole-monolith shell/artifact shaping

## Contents

- [What Voided Includes](#what-voided-includes)
- [Choose Your Entry Point](#choose-your-entry-point)
- [Core Concepts](#core-concepts)
- [Recovery Deck](#recovery-deck)
- [What Fused Means](#what-fused-means)
- [Command Map](#command-map)
- [Fused Presets](#fused-presets)
- [Repository Quick Start](#repository-quick-start)
- [Developer Manuals](#developer-manuals)
- [Examples](#examples)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
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
    of the primitive browser API

All three primary surfaces also expose the same deterministic Recovery Deck
protocol for wrapping a stable root key. The deck and derived Recovery Key are
transient secrets; only the authenticated root wrapper is persistable.

## Choose Your Entry Point

Use the package that matches the environment and level of control you want:

- `voided-core`
  - use this when you want direct Rust access to primitives, shell helpers, or
    monolith artifacts
- `@voideddev/enc-server`
  - use this in Node.js when you want native Rust-backed hashing, encryption,
    compression, and monolith artifact handling
- `@voideddev/e2ee-client`
  - use this in browser runtimes when you want stateful client-side encryption,
    key storage, and browser-facing protected artifact helpers

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
stable, inspectable, preset-driven shell format.

Use fused shell primitives when:

- you already control the bytes inside the shell
- you want shell metadata without managing a separate artifact format
- you want preset-driven shell behavior without building your own outer wrapper

### Full-Flow Monolith Artifact

The full-flow helpers are the normal Voided 1.0 product surface:

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

## Recovery Deck

Recovery Deck is a stateless recovery credential built from one uniformly
shuffled standard 52-card deck. The permanent protocol maps the exact card
order to a 29-byte permutation rank and then derives a 32-byte Recovery Key
through domain-separated HKDF-SHA256.

The Recovery Key wraps an existing stable root. Rotation generates a completely
new CSPRNG deck and rewraps that same root without changing application keys or
re-encrypting user data. Never persist or log the ordered deck, permutation
rank, or derived Recovery Key; persist only the opaque authenticated wrapper.

The browser package includes a neutral framework-free deck component that can
open as a modal or mount inline. Products remain responsible for their own
physical-backup and reconstruction experience.

## What Fused Means

The fused shell is not a second encryption algorithm. It is the stable outer
envelope primitive for callers that already own the bytes they want to shell.

The Voided 1.0 product path is the whole-monolith protected artifact. It runs
the safe sequence of compression, encryption, and shell shaping, with shell
state derived from the complete artifact plan.

In the standard Voided protected flow, the bytes going into the shell are:

1. optionally compressed
2. encrypted with an AEAD
3. shaped by the whole-monolith shell

What the shell adds on top of the encrypted payload:

- a stable outer binary format
- preset-driven shell behavior
- chunking metadata
- inspectable envelope metadata
- a consistent artifact contract across Rust, Node, and browser surfaces

The shell does not replace encryption. It sits outside encryption and gives the
encrypted payload a first-class artifact shape.

Normal `protect`, `open`, `inspectArtifact`, and `repackArtifact` use the current
VOF3 whole-monolith wire format. Package version 1.0 and wire-format version 3
are deliberately independent: the package is the first stable public release,
while the existing authenticated byte format remains frozen.

If you already have the bytes you want inside the shell, use shell primitives.
If you want Voided to do the whole flow for you, use full-flow helpers.

## Raw Benchmarking

`voided-bench` reports raw measurements. It does not emit a fake
`security = 100` score, and it does not collapse
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

`voided-fuse-shell-current` measures the raw shell primitive only. It is useful
for measuring shell overhead, while `voided-protect-current` measures the full
compression, encryption, and Fuse artifact path.

Fresh synthetic run from this checkout:

Corpus: `synthetic` | fixtures: `11` | input bytes: `1,885,227` | samples:
`21`

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

### Misdirection Surface

| candidate | known Voided magic prefix hits / trials |
|---|---:|
| `voided-protect-current` | 0 / 11 |
| `voided-c1e-current` | 11 / 11 |
| `voided-fuse-shell-current` | 11 / 11 |
| `xchacha20-poly1305-raw` | 0 / 11 |
| `aes-256-gcm-raw` | 0 / 11 |
| `gzip+xchacha20-poly1305` | 0 / 11 |
| `brotli+xchacha20-poly1305` | 0 / 11 |

### Size And Speed

| candidate | output bytes | byte delta | output/input | overhead % | median enc MiB/s | median dec MiB/s | weighted enc MiB/s | weighted dec MiB/s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `voided-protect-current` | 1,377,062 | -508,165 | 0.730449 | -26.955109 | 74.573 | 11.548 | 77.567 | 77.974 |
| `voided-c1e-current` | 1,376,389 | -508,838 | 0.730092 | -26.990808 | 89.597 | 47.656 | 133.632 | 257.163 |
| `voided-fuse-shell-current` | 1,886,119 | 892 | 1.000473 | 0.047315 | 135.248 | 108.649 | 137.639 | 110.820 |
| `xchacha20-poly1305-raw` | 1,885,667 | 440 | 1.000233 | 0.023339 | 315.601 | 316.285 | 316.533 | 309.034 |
| `aes-256-gcm-raw` | 1,885,535 | 308 | 1.000163 | 0.016338 | 133.811 | 133.734 | 134.307 | 135.029 |
| `gzip+xchacha20-poly1305` | 1,389,776 | -495,451 | 0.737193 | -26.280708 | 75.802 | 29.901 | 54.825 | 264.841 |
| `brotli+xchacha20-poly1305` | 1,376,238 | -508,989 | 0.730012 | -26.998818 | 160.819 | 13.192 | 137.780 | 252.764 |

### Artifact Statistics

| candidate | entropy bits/byte | entropy gap | chi-square/df | serial corr | mean bit bias % | max byte freq % | same-input drift % | input-bit delta % | delta minus drift % | input delta len mean |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `voided-protect-current` | 7.999869 | 0.000131 | 0.980411 | 0.000409 | 0.031308 | 0.402596 | 41.708743 | 45.308849 | 3.600106 | 6.000 |
| `voided-c1e-current` | 7.999871 | 0.000129 | 0.964162 | -0.000183 | 0.048515 | 0.406862 | 48.136698 | 49.651558 | 1.514860 | 6.000 |
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

Use these when you want the normal Voided monolith artifact model:

- `protect`
  - compress, encrypt, and shape data into a monolith artifact
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
npm run build:cross:mac
npm run build:cross:linux
npm run build:cross:windows
```

macOS and Linux release artifacts must be built on their native operating
systems. Windows x64 artifacts may be built on Windows or with the pinned
`cargo-xwin` workflow. Each command emits a signed-input manifest containing
the source, artifact, and toolchain hashes used by the release verifier.

## Developer Manuals

Each primary surface has its own detailed guide:

- [Root Rust crate manual](./crates/voided-core/README.md)
  - direct Rust usage, feature flags, module map, and protected artifact examples
- [Node.js manual](./packages/enc-server/README.md)
  - native loading, synchronous Node APIs, monolith artifact usage, and higher-level
    helper exports
- [Browser manual](./packages/e2ee-client/README.md)
  - stateful browser client flows, top-level helpers, crypto namespace usage,
    and WASM behavior
- [Recovery Deck protocol](./docs/recovery-deck-protocol.md)
  - permanent card/rank/KDF constants, root wrapping, rotation, and the strict
    no-persistence boundary

## Examples

Repository examples live in [`examples/`](./examples/):

- `simple-demo.js`
  - smallest monolith-first example
- `full-demo.js`
  - full artifact lifecycle with `protect`, `inspect`, `repack`, and `open`
- `fuse-presets-demo.js`
  - compare the compact, balanced, and concealed Fuse presets

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

When changing the monolith artifact model, the most important checks are:

- Rust core monolith protect/open tests
- Node wrapper integration tests
- browser/WASM fused roundtrip tests

## License

MIT
