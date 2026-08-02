#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const platformMap = {
  'win32-x64': 'win32-x64-msvc',
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu',
};
const platform = platformMap[`${process.platform}-${process.arch}`] ??
  `${process.platform}-${process.arch}`;
const supportedTargets = new Set([
  'darwin-arm64',
  'linux-x64-gnu',
  'win32-x64-msvc',
]);

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function readRegularFile(path) {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new Error(`[voided postinstall] Native artifact is not a regular file: ${path}`);
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

if (!supportedTargets.has(platform)) {
  console.warn(
    `[voided postinstall] No native artifact is produced for unsupported target ${platform}`,
  );
  process.exit(0);
}

const manifestPath = join(packageRoot, 'prebuilds', 'manifest.json');
if (!existsSync(manifestPath)) {
  throw new Error('[voided postinstall] Native provenance manifest is missing');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const packageMetadata = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
);
if (
  manifest.schemaVersion !== 1 ||
  manifest.package !== '@voideddev/enc-server' ||
  typeof packageMetadata.version !== 'string' ||
  manifest.packageVersion !== packageMetadata.version
) {
  throw new Error('[voided postinstall] Native provenance manifest is invalid');
}

const entry = manifest.targets?.[platform];
if (
  !entry ||
  entry.file !== `${platform}/voided_node.node` ||
  typeof entry.sha256 !== 'string' ||
  !/^sha256:[0-9a-f]{64}$/.test(entry.sha256) ||
  !Number.isSafeInteger(entry.size) ||
  entry.size <= 0 ||
  typeof entry.sourceDigest !== 'string' ||
  !/^sha256:[0-9a-f]{64}$/.test(entry.sourceDigest) ||
  typeof entry.buildId !== 'string' ||
  !/^sha256:[0-9a-f]{64}$/.test(entry.buildId)
) {
  throw new Error(`[voided postinstall] No valid verified native artifact for ${platform}`);
}

const artifact = join(packageRoot, 'prebuilds', entry.file);
if (!existsSync(artifact)) {
  throw new Error(`[voided postinstall] Verified native artifact is missing for ${platform}`);
}
const artifactBytes = readRegularFile(artifact);
const size = artifactBytes.length;
if (size !== entry.size) {
  throw new Error(`[voided postinstall] Native artifact size mismatch for ${platform}`);
}
const digest = sha256(artifactBytes);
if (digest !== entry.sha256) {
  throw new Error(`[voided postinstall] Native artifact hash mismatch for ${platform}`);
}
const buildId = sha256(
  [platform, entry.sourceDigest, digest, String(size)].join('\n'),
);
if (buildId !== entry.buildId) {
  throw new Error(`[voided postinstall] Native artifact build ID mismatch for ${platform}`);
}

console.log(`[voided postinstall] verified ${platform} ${entry.buildId}`);
