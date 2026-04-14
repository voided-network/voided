#!/usr/bin/env node

/**
 * Minimal fused-first Voided example.
 *
 * Build the workspace first:
 *   npm run build
 *
 * Then run:
 *   node examples/simple-demo.js
 */

const pkg = await import("../packages/enc-server/dist/index.js");

const {
  generateKey,
  fuse,
  unfuse,
  inspectFused,
  protect,
  open,
  inspectArtifact,
} = pkg;

const key = generateKey();
const payload = Buffer.from("Voided v2 is fused-first now.".repeat(128));

console.log("Voided simple demo\n");
console.log(`Plaintext bytes: ${payload.length}`);

const fused = fuse(payload, key, "balanced");
const fusedInfo = inspectFused(fused);
const restoredShell = unfuse(fused, key);

console.log("\nFused shell");
console.log(`Preset: ${fusedInfo.preset}`);
console.log(`Chunk count: ${fusedInfo.chunkCount}`);
console.log(`Shell bytes: ${fused.length}`);
console.log(`Roundtrip ok: ${restoredShell.equals(payload)}`);

const protectedArtifact = protect(payload, key, {
  preset: "concealed",
  compressionAlgorithm: "brotli",
  encryptionAlgorithm: "xchacha20-poly1305",
});
const artifactInfo = inspectArtifact(protectedArtifact.artifact);
const restoredArtifact = open(protectedArtifact.artifact, key);

console.log("\nFull flow");
console.log(`Preset: ${artifactInfo.preset}`);
console.log(`Compression: ${artifactInfo.compressionAlgorithm}`);
console.log(`Encryption: ${artifactInfo.encryptionAlgorithm}`);
console.log(`Protected bytes: ${artifactInfo.protectedSize}`);
console.log(`Roundtrip ok: ${restoredArtifact.equals(payload)}`);
