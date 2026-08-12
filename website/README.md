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
generic component rather than duplicating it. `npm run site:check` fails if
those copies drift. Production CSP must include
`'wasm-unsafe-eval'` in `script-src`; all scripts and WASM remain self-hosted.

The human and machine reference surfaces are deliberately first-class:

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
