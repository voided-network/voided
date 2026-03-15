/**
 * Script to copy the compiled native module to the correct location for packaging.
 * 
 * Usage:
 *   node scripts/copy-native.js
 * 
 * This should be run after `cargo build --release -p voided-node`
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const workspaceRoot = join(packageRoot, '..', '..');

// Platform detection
const platform = process.platform;
const arch = process.arch;

const platformMap = {
  'win32-x64': 'win32-x64-msvc',
  'win32-arm64': 'win32-arm64-msvc',
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu',
  'linux-arm64': 'linux-arm64-gnu',
};

const platformId = platformMap[`${platform}-${arch}`] || `${platform}-${arch}`;
const nativeLibraryName =
  process.platform === 'win32'
    ? 'voided_node.dll'
    : process.platform === 'darwin'
      ? 'libvoided_node.dylib'
      : 'libvoided_node.so';

// Source locations (where cargo build puts the output)
const sourceLocations = [
  join(workspaceRoot, 'target', 'release', nativeLibraryName),
  join(workspaceRoot, 'crates', 'target', 'release', nativeLibraryName),
  join(workspaceRoot, 'crates', 'voided-node', 'target', 'release', nativeLibraryName),
  join(workspaceRoot, 'packages', 'enc-server', 'native', 'voided_node.node'),
];

// Destination locations
const destDir = join(packageRoot, 'prebuilds', platformId);
const destFile = join(destDir, 'voided_node.node');

// Also copy to native/ for development
const devDest = join(packageRoot, 'native', 'voided_node.node');

console.log('Looking for native module...');
console.log(`Platform: ${platformId}`);

let sourceFile = null;
for (const loc of sourceLocations) {
  if (existsSync(loc)) {
    sourceFile = loc;
    break;
  }
}

if (!sourceFile) {
  console.error('ERROR: Could not find compiled native module.');
  console.error('Tried locations:');
  sourceLocations.forEach(loc => console.error(`  - ${loc}`));
  console.error('\nPlease run:');
  console.error('  cd crates && cargo build --release -p voided-node');
  process.exit(1);
}

console.log(`Found: ${sourceFile}`);

// Create destination directories
mkdirSync(destDir, { recursive: true });
mkdirSync(dirname(devDest), { recursive: true });

// Copy to prebuilds (for npm package)
copyFileSync(sourceFile, destFile);
console.log(`Copied to: ${destFile}`);

// Copy to native/ (for development)
copyFileSync(sourceFile, devDest);
console.log(`Copied to: ${devDest}`);

console.log('\n✓ Native module ready for packaging!');
console.log(`\nPlatform: ${platformId}`);
console.log(`\nFor cross-platform support, you need to build on each target platform:`);
console.log(`  - win32-x64-msvc   (Windows x64)`);
console.log(`  - darwin-x64       (macOS Intel)`);
console.log(`  - darwin-arm64     (macOS Apple Silicon)`);
console.log(`  - linux-x64-gnu    (Linux x64)`);
console.log(`\nCollect all .node files into prebuilds/ before publishing.`);
console.log(`\nTo publish, run:`);
console.log(`  npm publish`);

