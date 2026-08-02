#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));

function fail(message) {
  throw new Error(`[verify-release-source] ${message}`);
}

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    if (options.allowFailure) return null;
    fail(`git ${args.join(' ')} failed\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result.stdout.trim();
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function readVersion(manifestPath) {
  const text = readFileSync(join(workspaceRoot, manifestPath), 'utf8');
  if (manifestPath.endsWith('package.json')) {
    return JSON.parse(text).version;
  }
  const match = text.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) fail(`cannot read version from ${manifestPath}`);
  return match[1];
}

const releasePackages = {
  'packages/e2ee-client': {
    manifest: 'packages/e2ee-client/package.json',
    tagPrefix: 'e2ee-client-v',
    requiredFiles: [
      'packages/e2ee-client/LICENSE',
      'packages/e2ee-client/THIRD_PARTY_NOTICES',
      'packages/e2ee-client/wasm/manifest.json',
      'packages/e2ee-client/wasm/voided_wasm.js',
      'packages/e2ee-client/wasm/voided_wasm_bg.wasm',
    ],
  },
  'packages/enc-server': {
    manifest: 'packages/enc-server/package.json',
    tagPrefix: 'enc-server-v',
    requiredFiles: [
      'packages/enc-server/LICENSE',
      'packages/enc-server/THIRD_PARTY_NOTICES',
      'packages/enc-server/prebuilds/manifest.json',
      'packages/enc-server/prebuilds/darwin-arm64/voided_node.node',
      'packages/enc-server/prebuilds/linux-x64-gnu/voided_node.node',
      'packages/enc-server/prebuilds/win32-x64-msvc/voided_node.node',
    ],
  },
  'crates/voided-core': {
    manifest: 'crates/voided-core/Cargo.toml',
    tagPrefix: 'voided-core-v',
    requiredFiles: [
      'crates/voided-core/LICENSE',
      'crates/voided-core/THIRD_PARTY_NOTICES',
    ],
  },
};

const all = process.argv.includes('--all');
const requestedPackage = option('--package');
const requestedTagPrefix = option('--tag-prefix');
const allowUntagged = process.argv.includes('--allow-untagged');
if (all === Boolean(requestedPackage)) {
  fail('choose exactly one of --all or --package <path>');
}

const gitRoot = realpathSync(git(['rev-parse', '--show-toplevel']));
if (gitRoot !== workspaceRoot) fail(`unexpected Git root ${gitRoot}`);
if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
  fail('release verification requires complete Git history');
}
const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
if (status) fail(`release tree is not clean\n${status}`);
const whitespace = git(['diff', '--check', 'HEAD']);
if (whitespace) fail(`release tree has whitespace errors\n${whitespace}`);

const head = git(['rev-parse', 'HEAD']);
const selected = all
  ? Object.entries(releasePackages)
  : [[requestedPackage, releasePackages[requestedPackage]]];
if (!selected[0][1]) fail(`unknown release package ${requestedPackage}`);

for (const [packagePath, configuration] of selected) {
  const version = readVersion(configuration.manifest);
  const committedManifest = git(['show', `HEAD:${configuration.manifest}`]);
  if (committedManifest !== readFileSync(join(workspaceRoot, configuration.manifest), 'utf8').trim()) {
    fail(`${configuration.manifest} does not match HEAD`);
  }
  for (const file of configuration.requiredFiles) {
    const tracked = git(['ls-files', '--error-unmatch', file], { allowFailure: true });
    if (tracked !== file) fail(`${file} is not tracked by Git`);
  }

  const tagPrefix = requestedPackage ? requestedTagPrefix : configuration.tagPrefix;
  if (!tagPrefix) fail(`no tag prefix configured for ${packagePath}`);
  const tag = `${tagPrefix}${version}`;
  const tagType = git(['cat-file', '-t', `refs/tags/${tag}`], { allowFailure: true });
  if (!allowUntagged || tagType !== null) {
    if (tagType !== 'tag') fail(`${tag} must be an annotated tag`);
    const tagCommit = git(['rev-list', '-n', '1', tag]);
    if (tagCommit !== head) fail(`${tag} points to ${tagCommit}, not ${head}`);
  }
  console.log(`[verify-release-source] ${packagePath}@${version} -> ${head}`);
}

console.log('[verify-release-source] clean committed release source verified');
