---
name: voided
description: Integrate, review, or debug Voided authenticated data protection, Fuse artifacts, browser, Node.js, Rust, Recovery Deck, and key lifecycle boundaries.
---

# Voided

Use this skill when a task adds or reviews Voided protection, opens protected artifacts, chooses a runtime/API layer, integrates Recovery Deck, or diagnoses a Voided boundary.

## Start with the smallest source

1. Read `https://voidednetwork.com/llms.txt` for routing.
2. If a complete standalone reference is needed, read `https://voidednetwork.com/llms-full.txt`.
3. If the local Voided checkout is available, prefer the read-only Voided MCP described at `https://voidednetwork.com/mcp.html` for source, symbol, and file questions.
4. Use `https://voidednetwork.com/ai.json` only when structured facts are more useful than prose.

## Choose the API by ownership

- Use `protect` / `open` for normal application data.
- Use `fuse` / `unfuse` only when the caller already owns the prepared inner bytes.
- Use primitive `encrypt` / `decrypt` only when the caller deliberately owns serialization, the outer format, nonce/tag handling, and key lifecycle.
- Put the operation where plaintext already exists. Browser-side protection can keep plaintext from the server. A server that receives plaintext is a trusted endpoint and must not be described as end-to-end encrypted.

## Preserve the safety boundary

- Never log or persist plaintext, raw keys, Recovery Deck order, a derived Recovery Key, or a stable user root.
- Treat keyless inspection as untrusted until keyed open authenticates the artifact.
- Fail closed on malformed, oversized, non-canonical, wrong-key, or tampered data. Do not release guessed or partial plaintext.
- Do not substitute an unverified cryptographic fallback for the verified Rust, native, or WASM path.

## Recovery Deck

- Validate exactly 52 unique canonical cards before derivation.
- Keep deck and derived Recovery Key transient.
- Persist only the opaque wrapper around the stable root.
- Rotate with a fresh cryptographically random permutation. Rewrap the same stable root; do not rotate application keys or re-encrypt user data.

## Before handing off

State the chosen runtime, API layer, plaintext trust boundary, key owner, persisted artifacts, and failure behavior. If any of those are unknown, call the uncertainty out rather than inventing architecture.
