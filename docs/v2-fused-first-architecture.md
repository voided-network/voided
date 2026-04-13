# Voided v2 Fused-First Architecture

Status: proposed starting point for implementation work

## Summary

Voided v2 should move from a map-first product shape to a fused-first product
shape.

The primary full flow should be:

1. compression
2. encryption
3. fused shell

Map-based obfuscation should stop being the default product surface. It can stay
available as an experimental or legacy lane where it still has value, but the
core product should no longer force the whole API and module layout to revolve
around it.

This lets Voided tell the truth about what the system is actually good at:

- the default path is small, native, and direct
- shelling is a first-class outer artifact instead of an afterthought
- profile choice happens at the product level, not through a pile of low-level
  knobs
- Slipner can consume a stable `seal/open/inspect/repack` surface instead of
  hand-assembling flows

## Product goals

- Make fused shell the supported default artifact shape.
- Keep primitive access for compression, encryption, and fused shell.
- Keep map shell only as experimental or legacy compatibility material.
- Give users stable profile names instead of asking them to choose shell tuning
  details.
- Give Slipner one clean consumption model for write, read, and migration.
- Keep the stack lightweight and native. No Docker, no extra service tier.

## Current mismatch

The current public Node surface is still shaped around map-first naming:

- `encryptWithMap`
- `decryptWithMap`
- `VoidedService`
- direct map generation and analysis helpers

At the same time, the shared Rust core already has the basic shell-domain key
derivation helpers, and the fused shell work now lives outside the product in
research code. That means the product contract and the research signal are
pointing in different directions.

Voided v2 should fix that mismatch directly instead of trying to cosmetically
rebrand the old map-first API.

## Architecture direction

### Outer artifact

The fused shell envelope becomes the normal outer artifact for full-flow Voided
payloads.

The outer artifact should carry:

- artifact format version
- profile id
- shell mode
- shell tuning values needed for decode
- authentication material for tamper detection

The compression and encryption steps stay inside the shell flow. Users should
not need to manually serialize encrypted JSON blobs before shelling. That was a
reasonable compatibility tactic for the old map flow, but it should not define
v2.

### Full-flow mental model

Voided should present two layers:

1. profile-first full flows for normal product use
2. primitive modules for expert use, tooling, and labs

Normal callers should think in terms of:

- `seal`
- `open`
- `inspect`
- `repack`
- `profile`

They should not need to think in terms of:

- map temperature
- map seed reuse
- shell family count
- shell chunk geometry

Those knobs should remain available at the primitive layer where they actually
belong.

## Proposed Rust module layout

Voided should evolve the core into a shell-centered layout instead of keeping
shell as a thin helper module.

```text
crates/voided-core/src/
  compression/
  encryption/
  hash/
  shell/
    mod.rs
    auth.rs
    profile.rs
    fused.rs
    map.rs
    inspect.rs
    pipeline.rs
  formats/
  compat/
```

Module responsibilities:

- `compression`
  - raw compression and decompression primitives
  - adaptive compression decision helpers
- `encryption`
  - authenticated encryption primitives and key derivation
- `shell::auth`
  - shell domain key derivation and tag helpers
  - current `shell.rs` helper logic moves here
- `shell::fused`
  - fused shell encode and decode
  - shell envelope types
  - structured or adaptive fused modes when supported
- `shell::map`
  - experimental or legacy map shell handling
  - no longer the center of the product
- `shell::profile`
  - versioned profile registry
  - support level metadata
  - alias resolution such as `default -> fused.default.v2`
- `shell::inspect`
  - lightweight artifact header inspection without full decode
  - read profile id, format version, shell mode, and compatibility flags
- `shell::pipeline`
  - `seal`, `open`, and `repack`
  - glue for `compression -> encryption -> shell`
- `compat`
  - shims for old map-first entry points
  - old payload wrappers that must still be decoded during migration

## Proposed Node package layout

The Node package should stop presenting map flow as the main product API.

### High-level surface

```ts
import {
  seal,
  open,
  inspectArtifact,
  repackArtifact,
  listProfiles,
  resolveProfile,
} from "@voideddev/enc-server";
```

High-level intent:

- `seal(data, { key, profile, aad })`
- `open(artifact, { key, aad })`
- `inspectArtifact(artifact)`
- `repackArtifact(artifact, { fromKey, toKey, profile })`
- `listProfiles()`
- `resolveProfile("default")`

### Primitive surface

```ts
import {
  compression,
  encryption,
  fusedShell,
  experimental,
} from "@voideddev/enc-server";
```

Namespace intent:

- `compression`
  - direct compression primitives
- `encryption`
  - direct encryption primitives
- `fusedShell`
  - fused shell encode and decode primitives
- `experimental.mapShell`
  - map shell helpers when explicitly requested

Map-specific helpers should move under an explicit experimental or legacy
namespace instead of staying at the top level beside the default flow.

## User-facing profiles

The product should expose versioned profile ids plus stable human aliases.

### Stable aliases

- `default`
- `high-security`

### Versioned profile ids

- `fused.default.v2`
- `fused.hardened.v2`
- `fused.structured.v2` as experimental
- `map.legacy.v1`

### Profile definitions

#### `default` -> `fused.default.v2`

Use when the caller wants the normal supported Voided flow.

Properties:

- full flow uses `compression -> encryption -> fused shell`
- adaptive compression is allowed
- default encryption stays modern and boring
- map shell is not used
- tuned for general product traffic, not maximum ceremony

This should be the default write profile for Slipner.

#### `high-security` -> `fused.hardened.v2`

Use when the caller wants stronger shell hardness at the cost of more overhead.

Properties:

- still fused-first
- still does not default to map shell
- allows more aggressive shell geometry and stricter profile policy
- remains stable and supported

This is not an excuse to drag the map path back into the center. If map-based
hardness proves useful later, it should be opt-in and separately labeled.

#### Experimental fused profiles

Example:

- `fused.structured.v2`

Use for research-backed but not yet default fused modes.

Properties:

- explicit opt-in
- not selected by default alias resolution
- readable only when policy allows experimental profiles

#### Legacy map profile

- `map.legacy.v1`

Use only for:

- decoding historical artifacts
- controlled migration writes during rollout
- edge cases where an operator intentionally accepts the tradeoff

This profile should be treated as compatibility material, not as the normal
shape of Voided.

## Profile policy surface

Voided should distinguish between profile metadata and runtime policy.

Suggested policy model:

```ts
interface VoidedProfilePolicy {
  defaultWriteProfile: string;
  acceptedReadProfiles: string[];
  allowExperimentalRead?: boolean;
  allowExperimentalWrite?: boolean;
  allowLegacyRead?: boolean;
  allowLegacyWrite?: boolean;
  repackOnRead?: boolean;
}
```

Policy rules:

- default writes should always target one stable profile
- experimental writes must be explicit
- legacy writes should default to off
- legacy reads should be allowed during migration
- optional repack should convert old artifacts to the current write profile

This keeps profile choice explicit and keeps compatibility policy out of random
call sites.

## Slipner consumption model

Slipner should consume Voided through the high-level profile-first surface.

### What Slipner should call

- `seal`
- `open`
- `inspectArtifact`
- `repackArtifact`
- `resolveProfile`

### What Slipner should not do

- manually compose compression plus encryption plus shell steps in product code
- directly generate maps for the normal path
- expose shell geometry knobs in user-facing settings
- call experimental map helpers unless a specific migration or research workflow
  needs them

### Suggested Slipner configuration

Slipner should store Voided-specific policy under names that do not collide with
existing `SurfacePreset` concepts.

Suggested naming:

- `voided_default_write_profile`
- `voided_accepted_read_profiles`
- `voided_allow_experimental_profiles`
- `voided_allow_legacy_map_reads`
- `voided_allow_legacy_map_writes`
- `voided_migration_mode`

Suggested defaults:

- write profile: `default`
- accepted reads: `default`, `high-security`, `map.legacy.v1`
- experimental writes: off
- legacy writes: off
- migration mode: lazy repack on read or background repack

### Suggested Slipner metadata per artifact

Store enough metadata to reason about migration without fully decoding:

- `voided_profile_id`
- `voided_artifact_version`
- `voided_format_family`
- `voided_written_at`
- optional `voided_origin_profile_id` after repack

That gives Slipner an honest compatibility story and avoids guessing from raw
bytes later.

## Deprecation plan

### Stays public

- compression primitives
- encryption primitives
- fused shell primitives
- profile registry and inspection helpers
- high-level `seal/open/repack` flow

### Becomes compatibility or experimental

- `encryptWithMap`
- `decryptWithMap`
- `decryptWithMapString`
- `VoidedService` as a map-first convenience wrapper
- top-level map generation and analysis helpers

### Becomes internal

- map-first JSON payload wrapping details
- temperature-driven map defaults as a product concept
- implicit map-first naming in the main service API

## Migration path

### Phase 0: document the target

Done by this plan.

Goals:

- state the fused-first direction explicitly
- define profile ids and policy language
- stop pretending the old map-first API is the long-term shape

### Phase 1: promote shell into core

Implementation tasks:

- move fused shell implementation out of lab code into `voided-core`
- turn the current `shell.rs` helper file into a shell module tree
- add artifact inspection support
- add profile registry support in Rust

### Phase 2: ship dual surface in Node

Implementation tasks:

- add `seal/open/inspect/repack` to `@voideddev/enc-server`
- expose fused shell primitives
- move map helpers under explicit experimental or compatibility naming
- keep old map-first functions as adapters for one release window

### Phase 3: make Slipner dual-read and single-write

Implementation tasks:

- write new artifacts with `default`
- continue reading `map.legacy.v1`
- optionally repack old artifacts on read or in background jobs
- record artifact profile metadata in Slipner storage

### Phase 4: deprecate legacy writes

Implementation tasks:

- disable map writes by default
- keep map reads for compatibility
- make legacy write enablement require explicit policy

### Phase 5: shrink the compatibility surface

Implementation tasks:

- remove map-first examples from primary docs
- make `encryptWithMap` a clearly deprecated adapter
- keep only the minimal legacy surface needed for long-tail decode

## Starter changes needed next

The first implementation pass after this doc should be small and concrete:

1. Add a versioned profile registry in the Rust core.
2. Add a shell inspection header that carries profile id and shell mode.
3. Move fused shell encode and decode into `voided-core`.
4. Add Node bindings for fused shell primitives and `seal/open`.
5. Re-express `encryptWithMap` as a compatibility adapter instead of the main
   story.
6. Teach Slipner to store Voided profile metadata and default to `default`
   writes.

## Non-goals

- preserving the old map-default product shape out of loyalty
- adding a container runtime or Docker-based workflow
- exposing every shell tuning knob as a product setting
- shipping a stable map-heavy profile unless it proves clearly worth the cost
