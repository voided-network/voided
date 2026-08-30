## Voided integration

- Read https://voidednetwork.com/llms.txt to locate the smallest relevant reference. Use https://voidednetwork.com/llms-full.txt when local source or the Voided MCP is unavailable.
- Default to `protect` / `open` for normal application data. Use `fuse` / `unfuse` only when the application already owns the prepared inner bytes. Use primitive `encrypt` / `decrypt` only when the application deliberately owns serialization, the outer format, and the complete key lifecycle.
- Run Voided in the trust boundary where plaintext already exists. Browser-side protection can keep plaintext from the server. Server-side protection is appropriate only when the server is intentionally trusted with plaintext; do not describe that architecture as end-to-end encryption.
- Treat keyless artifact inspection as attacker-controlled structural metadata. Authenticate with `open` before trusting content or authorizing behavior.
- Never log, persist, analyze, transmit, or include in crash reports: plaintext, raw keys, Recovery Deck order, a derived Recovery Key, or a stable user root.
- Recovery Deck setup and derivation must run through the permanent canonical protocol. Persist only the opaque root wrapper. Rotation generates a fresh random deck and replaces the wrapper around the same stable root; it does not rotate application keys or re-encrypt data.
- Do not replace verified Rust, native, or WASM cryptographic paths with an unverified language fallback.

