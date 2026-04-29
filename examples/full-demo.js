#!/usr/bin/env node

/**
 * Full v3 monolith artifact lifecycle demo.
 *
 * Build the workspace first:
 *   npm run build
 *
 * Then run:
 *   node examples/full-demo.js
 */

const pkg = await import("../packages/enc-server/dist/index.js");

const {
  generateKey,
  protect,
  open,
  inspectArtifact,
  repackArtifact,
} = pkg;

const key = generateKey();
const documentBody = JSON.stringify(
  {
    title: "Slipner cloud note",
    author: "alice",
    tags: ["monolith", "voided", "artifact"],
    content: "Compression, encryption, and monolith shell planning now travel together.",
  },
  null,
  2,
);
const payload = Buffer.from(documentBody.repeat(256));

console.log("Voided full-flow demo\n");
console.log(`Original bytes: ${payload.length}`);

const balanced = protect(payload, key, {
  preset: "balanced",
  compressionAlgorithm: "brotli",
  encryptionAlgorithm: "xchacha20-poly1305",
});
const balancedInfo = inspectArtifact(balanced.artifact);

console.log("\nInitial artifact");
console.log(`Preset: ${balancedInfo.preset}`);
console.log(`Compression: ${balancedInfo.compressionAlgorithm}`);
console.log(`Encryption: ${balancedInfo.encryptionAlgorithm}`);
console.log(`Protected bytes: ${balancedInfo.protectedSize}`);

const concealed = repackArtifact(balanced.artifact, key, {
  preset: "concealed",
  compressionAlgorithm: "brotli",
  encryptionAlgorithm: "xchacha20-poly1305",
});
const concealedInfo = inspectArtifact(concealed.artifact);
const restored = open(concealed.artifact, key);

console.log("\nRepacked artifact");
console.log(`Preset: ${concealedInfo.preset}`);
console.log(`Protected bytes: ${concealedInfo.protectedSize}`);
console.log(`Plaintext preserved: ${restored.equals(payload)}`);

console.log("\nSummary");
console.log("- compact/balanced/concealed are the public shell presets");
console.log("- protect/open is the full-flow artifact contract for product callers");
console.log("- repackArtifact changes shell policy without changing plaintext");
