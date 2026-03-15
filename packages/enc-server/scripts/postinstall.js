#!/usr/bin/env node
/**
 * Postinstall script for @voideddev/enc-server
 *
 * Checks if a prebuild exists for the current platform.
 * If not (e.g., macOS), attempts to build from source.
 */

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");

// Platform detection (same logic as native/index.ts)
function getPlatformIdentifier() {
  const platform = process.platform;
  const arch = process.arch;

  const platformMap = {
    "win32-x64": "win32-x64-msvc",
    "win32-arm64": "win32-arm64-msvc",
    "darwin-x64": "darwin-x64",
    "darwin-arm64": "darwin-arm64",
    "linux-x64": "linux-x64-gnu",
    "linux-arm64": "linux-arm64-gnu",
  };

  return platformMap[`${platform}-${arch}`] || `${platform}-${arch}`;
}

function main() {
  const platformId = getPlatformIdentifier();
  const prebuildPath = join(
    packageRoot,
    "prebuilds",
    platformId,
    "voided_node.node"
  );

  console.log(`[voided postinstall] Platform: ${platformId}`);

  // Check if prebuild exists
  if (existsSync(prebuildPath)) {
    console.log("[voided postinstall] ✓ Prebuild found, no action needed.");
    return;
  }

  console.log("[voided postinstall] No prebuild found for this platform.");
  console.log("[voided postinstall] Attempting to build from source...");

  // Check if this is a workspace (has crates folder)
  const cratesPath = join(packageRoot, "..", "..", "crates");
  const hasCrates = existsSync(cratesPath);

  if (!hasCrates) {
    // This is a published package without source - give instructions
    console.error(`
[voided postinstall] ERROR: No prebuild available for ${platformId}

This package includes prebuilt binaries for:
  - Windows x64 (win32-x64-msvc)
  - Linux x64 (linux-x64-gnu)

For macOS or other platforms, you need to build from source:

  1. Clone the repository:
     git clone https://github.com/voideddev/voided.git
     cd voided

  2. Install Rust (if not installed):
     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

  3. Build the native module:
     cd crates
     cargo build --release -p voided-node

  4. Copy the binary:
     mkdir -p node_modules/@voideddev/enc-server/prebuilds/${platformId}
     cp crates/target/release/libvoided_node.dylib \\
        node_modules/@voideddev/enc-server/prebuilds/${platformId}/voided_node.node
`);
    // Don't exit with error - let the require-time error be more specific
    return;
  }

  // We're in development mode with source available - try to build
  try {
    console.log("[voided postinstall] Checking for Rust...");
    execSync("cargo --version", { stdio: "pipe" });
  } catch {
    console.error(`
[voided postinstall] ERROR: Rust is not installed.

To install Rust, run:
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

Then run 'npm install' again.
`);
    return;
  }

  try {
    console.log("[voided postinstall] Building voided-node from source...");
    execSync("cargo build --release -p voided-node", {
      cwd: cratesPath,
      stdio: "inherit",
    });

    // Find the built library
    const targetRelease = join(cratesPath, "target", "release");
    let sourceFile;

    if (process.platform === "darwin") {
      sourceFile = join(targetRelease, "libvoided_node.dylib");
    } else if (process.platform === "linux") {
      sourceFile = join(targetRelease, "libvoided_node.so");
    } else if (process.platform === "win32") {
      sourceFile = join(targetRelease, "voided_node.dll");
    }

    if (sourceFile && existsSync(sourceFile)) {
      // Create prebuilds directory and copy
      const destDir = join(packageRoot, "prebuilds", platformId);
      const destFile = join(destDir, "voided_node.node");

      mkdirSync(destDir, { recursive: true });
      copyFileSync(sourceFile, destFile);
      console.log(
        `[voided postinstall] ✓ Successfully built and installed native module.`
      );
    } else {
      console.error(
        `[voided postinstall] ERROR: Build succeeded but could not find output file.`
      );
    }
  } catch (err) {
    console.error(`[voided postinstall] Build failed: ${err.message}`);
    console.error(`[voided postinstall] You may need to build manually.`);
  }
}

main();
