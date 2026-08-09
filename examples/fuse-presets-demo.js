#!/usr/bin/env node

/**
 * Compare the stable Voided 1.0 Fuse presets.
 *
 * Build the workspace first:
 *   npm run build
 *
 * Then run:
 *   node examples/fuse-presets-demo.js
 */

const pkg = await import("../packages/enc-server/dist/index.js");

const { generateKey, protect, inspectArtifact } = pkg;

const key = generateKey();
const payload = Buffer.from(
  JSON.stringify(
    {
      project: "voided-1.0",
      summary: "Preset-driven Fuse artifacts with one stable public surface.",
      repeated: "artifact-profile-data".repeat(2048),
    },
    null,
    2,
  ),
);

console.log("Voided Fuse preset comparison\n");
console.log(`Plaintext bytes: ${payload.length}\n`);

for (const preset of ["compact", "balanced", "concealed"]) {
  const result = protect(payload, key, {
    preset,
    compressionAlgorithm: "brotli",
    encryptionAlgorithm: "xchacha20-poly1305",
  });
  const info = inspectArtifact(result.artifact);

  console.log(`${preset.toUpperCase()}`);
  console.log(`  protected bytes : ${info.protectedSize}`);
  console.log(`  compressed bytes: ${info.compressedSize}`);
  console.log(`  shell chunks    : ${info.shellChunkCount}`);
  console.log(`  shell chunk size: ${info.shellChunkSize}`);
  console.log("");
}

console.log("Voided 1.0 uses compact, balanced, and concealed Fuse presets.");
