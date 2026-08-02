#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  digestFile,
  getPlatformIdentifier,
  packageRoot,
  readJson,
} from './release-provenance.js';

function build(args = []) {
  const result = spawnSync(
    process.execPath,
    [join(packageRoot, 'scripts', 'build-native-release.js'), ...args],
    { cwd: packageRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `[verify-reproducible-native] build failed\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
}

const arguments_ = process.argv.slice(2);
let requestedTarget = null;
if (arguments_.length === 1 && arguments_[0] === '--target=win32-x64-msvc') {
  requestedTarget = 'win32-x64-msvc';
} else if (arguments_.length !== 0) {
  throw new Error(
    `[verify-reproducible-native] unsupported arguments: ${arguments_.join(' ')}`,
  );
}
const platform = requestedTarget ?? getPlatformIdentifier();
const buildArguments = requestedTarget ? [`--target=${requestedTarget}`] : [];
build(buildArguments);
const firstManifest = readJson(join(packageRoot, 'prebuilds', 'manifest.json'));
const firstEntry = firstManifest.targets?.[platform];
if (!firstEntry) throw new Error(`first build omitted ${platform}`);
const artifact = join(packageRoot, 'prebuilds', firstEntry.file);
const firstHash = digestFile(artifact);
const firstBytes = readFileSync(artifact);

build(buildArguments);
const secondManifest = readJson(join(packageRoot, 'prebuilds', 'manifest.json'));
const secondEntry = secondManifest.targets?.[platform];
if (!secondEntry) throw new Error(`second build omitted ${platform}`);
const secondHash = digestFile(join(packageRoot, 'prebuilds', secondEntry.file));
const secondBytes = readFileSync(join(packageRoot, 'prebuilds', secondEntry.file));

if (
  firstHash !== secondHash ||
  firstEntry.buildId !== secondEntry.buildId ||
  !firstBytes.equals(secondBytes)
) {
  const diagnostics = mkdtempSync(
    join(tmpdir(), `voided-native-repro-${platform}-`),
  );
  writeFileSync(join(diagnostics, 'first.node'), firstBytes);
  writeFileSync(join(diagnostics, 'second.node'), secondBytes);
  throw new Error(
    `[verify-reproducible-native] ${platform} was not byte-reproducible\n` +
      `  first:  ${firstHash}\n  second: ${secondHash}\n` +
      `  diagnostics: ${diagnostics}`,
  );
}

console.log(`[verify-reproducible-native] ${platform} ${secondHash}`);
