# @voideddev/e2ee-client

`@voideddev/e2ee-client` is the browser-side Voided library. It provides end-to-end encryption, browser storage, key import/export, chunking for large payloads, and an optional Rust/WASM backend behind a stable TypeScript API.

Today the runtime layering is:

- `voided-core` as the source-of-truth Rust implementation
- `voided-wasm` as the browser binding over `voided-core`
- `@voideddev/e2ee-client` as the browser TypeScript wrapper over `voided-wasm`
  with a TypeScript fallback when WASM cannot load

## Installation

```bash
npm install @voideddev/e2ee-client
```

## Quick Start

```ts
import { VoidedE2EEClient } from "@voideddev/e2ee-client";

const client = new VoidedE2EEClient();

const encrypted = await client.encrypt("Private browser-side data");
const decrypted = await client.decrypt(encrypted);
const exportedKey = await client.exportKey();

console.log(decrypted);
console.log(exportedKey);
```

## Package Surface

- `VoidedE2EEClient` for stateful client-side encryption flows
- Top-level helpers such as `encrypt`, `decrypt`, `exportKey`, `importKey`, and `rotateKey`
- Browser-side fused shell helpers exposed through the crypto backend namespace: `fuse`, `unfuse`, `inspectFused`, `protect`, `open`, `inspectArtifact`, and `repackArtifact`
- `IndexedDBStorage` for browser-local key persistence
- Optional signatures, forward secrecy helpers, and key sharing helpers
- Chunking and client upload-limit helpers for large payloads
- WASM loader exports: `initWasm`, `getWasm`, `isWasmReady`, and `getWasmError`

## Optional WASM Initialization

The package works without explicit WASM setup, but you can initialize the Rust/WASM backend up front when you want deterministic warm-up behavior.

```ts
import { initWasm, isWasmReady } from "@voideddev/e2ee-client";

await initWasm();
console.log(isWasmReady());
```

## Notes

- Encryption keys stay on the client side unless you explicitly export them.
- The package does not implement passkey or OPRF authentication flows; derive session keys in your auth layer and then import them here when needed.
- The fused-first Voided v2 direction should come through `voided-wasm`, not a
  separate handwritten TypeScript shell implementation. The frozen fused preset
  surface is `compact`, `balanced`, and `concealed`, with `balanced` as the
  expected default role alias.
- The new fused shell APIs currently require the Rust/WASM backend; there is no
  handwritten TypeScript fallback for them.
- Deprecated map-first behavior belongs to v1, not to the e2ee-client v2
  direction.
- Examples live in `examples/` and `packages/e2ee-client/examples/`.

## Development

```bash
npm run build:wasm
npm run build
npm test
```

## License

MIT
