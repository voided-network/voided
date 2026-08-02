#!/usr/bin/env node

/**
 * Safe dispatcher for verified native release builds.
 *
 * Linux and macOS artifacts are built on their native operating systems.
 * Windows x64 may be built natively or through the pinned cargo-xwin workflow
 * implemented by packages/enc-server/scripts/build-native-release.js.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseBuilder = join(
  workspaceRoot,
  'packages',
  'enc-server',
  'scripts',
  'build-native-release.js',
);

const host = `${process.platform}-${process.arch}`;
const hostTarget = {
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu',
  'win32-x64': 'win32-x64-msvc',
}[host];
const requested = process.argv.slice(2);
if (requested.length !== 1) {
  throw new Error(
    'Choose exactly one verified target: --mac, --linux, or --windows',
  );
}

const target = {
  '--mac': 'darwin-arm64',
  '--linux': 'linux-x64-gnu',
  '--windows': 'win32-x64-msvc',
}[requested[0]];
if (!target) throw new Error(`Unsupported release target ${requested[0]}`);
if (target !== hostTarget && target !== 'win32-x64-msvc') {
  throw new Error(
    `${target} must be built on its native operating system; current host is ${host}`,
  );
}

const builderArgs = [releaseBuilder];
if (target !== hostTarget) builderArgs.push(`--target=${target}`);
const result = spawnSync(process.execPath, builderArgs, {
  cwd: workspaceRoot,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
