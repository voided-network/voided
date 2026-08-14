# Voided Developer Website

Static developer-support site for `voidednetwork.com`.

```sh
npm run site:dev
npm run site:check
```

The site has no server-side requirements. Publish the
contents of this directory to static hosting or a CDN with clean HTTPS. Keep
the included Content Security Policy behavior when configuring production
headers. Do not enable cross-origin embedding.

The interactive homepage uses byte-identical copies of the built browser
package and verified WASM assets from `packages/e2ee-client/` under
`website/runtime/`. The Recovery Deck preview mounts the package's exported
generic component rather than duplicating it. Its thirteen showcase designs use
the component's stable classes, card-rendering hook, lifecycle callbacks, and
behavior-owning card buttons to demonstrate grids, hands, rings, tables,
spatial maps, scrollable sequences, stacks, and printable groupings without
changing or copying the recovery model. The
function lab switches between valid Node.js and Rust usage while showing the
normal string path alongside a complete raw trace: input text and UTF-8 bytes, ephemeral key,
generated output, public structure, restored bytes, restored text, and exact
match state. It does not persist or transmit any of them. `npm run site:check`
fails if the runtime copies drift. Production CSP
must include `'wasm-unsafe-eval'` in `script-src`; all scripts and WASM remain
self-hosted.

The human and machine reference surfaces are deliberately first-class:

- `index.html`, `docs.html`, and `updates.html` are the three primary human pages.
- `docs.html` is the Guided/Expert Developer Lab, complete library map, runtime reference, and support workbench.
- `legal.html`, `support.html`, and the earlier learning surface remain contextual secondary routes.
- `ai.html` is the semantic direct implementation reference.
- `llms.txt` routes an agent to the smallest relevant source.
- `llms-full.txt` is a standalone complete context file.
- `ai.json` contains structured product and protocol facts.
- `mcp.html` and `mcp.json` document the read-only source-aware MCP server.
- `downloads/voided-mcp.mjs` is the current single-file Node.js 18+ MCP artifact.

When the MCP source changes, rebuild the artifact, update its SHA-256 in all
descriptors, and run `npm run site:check`. The direct download is the current
launch path; `@slipner/cli` is not yet public on the npm registry.

The release status is deliberately labeled as a release candidate until the
Windows native gate, tags, and package publication are complete.
