#!/usr/bin/env node

/**
 * Historical filename kept for repo continuity.
 * This demo now compares fused presets instead of old temperature-based maps.
 *
 * Build the workspace first:
 *   npm run build
 *
 * Then run:
 *   node examples/temperature-demo.js
 */

const pkg = await import("../packages/enc-server/dist/index.js");

const { generateKey, protect, inspectArtifact } = pkg;

const key = generateKey();
const payload = Buffer.from(
  JSON.stringify(
    {
      project: "voided-v2",
      summary: "Preset-driven fused artifacts replace the old legacy shell story.",
      repeated: "artifact-profile-data".repeat(2048),
    },
    null,
    2,
  ),
);

console.log("Voided fused preset comparison\n");
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

console.log("Presets replace the old temperature/map tuning story in Voided v2.");
