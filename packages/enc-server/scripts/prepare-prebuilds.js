#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  digestFile,
  digestFiles,
  digestText,
  getCoreVersion,
  getNativeBindingVersion,
  getNativeSourceFiles,
  getPlatformIdentifier,
  packageRoot,
  readJson,
} from './release-provenance.js';

const requiredTargets = [
  'darwin-arm64',
  'linux-x64-gnu',
  'win32-x64-msvc',
];
const supportedTargets = new Set(requiredTargets);
const prebuildsRoot = join(packageRoot, 'prebuilds');
const manifestPath = join(prebuildsRoot, 'manifest.json');
const npmIgnorePath = join(prebuildsRoot, '.npmignore');
const denyAll = [
  '# Native artifacts are denied until a verified packaging mode prepares an allowlist.',
  '*',
  '',
].join('\n');

// Fail closed before reading any attacker-controlled or incomplete release state.
writeFileSync(npmIgnorePath, denyAll);

const args = process.argv.slice(2);
const currentPlatformSmoke =
  args.length === 1 && args[0] === '--current-platform-smoke';
if (args.length !== 0 && !currentPlatformSmoke) {
  throw new Error(`[prepare-prebuilds] unsupported arguments: ${args.join(' ')}`);
}
if (
  currentPlatformSmoke &&
  process.env.VOIDED_INTERNAL_CURRENT_PLATFORM_SMOKE !== '1'
) {
  throw new Error(
    '[prepare-prebuilds] current-platform mode is internal to package-smoke',
  );
}

if (!existsSync(manifestPath)) {
  throw new Error('[prepare-prebuilds] provenance manifest is missing');
}

const manifest = readJson(manifestPath);
const packageVersion = readJson(join(packageRoot, 'package.json')).version;
const currentSourceDigest = digestFiles(getNativeSourceFiles());
if (
  manifest.schemaVersion !== 1 ||
  manifest.package !== '@voideddev/enc-server' ||
  manifest.packageVersion !== packageVersion
) {
  throw new Error('[prepare-prebuilds] provenance manifest is invalid or stale');
}

const manifestTargets = Object.keys(manifest.targets ?? {}).sort();
for (const target of manifestTargets) {
  if (!supportedTargets.has(target)) {
    throw new Error(`[prepare-prebuilds] unsupported release target ${target}`);
  }
}

let targetsToPrepare;
if (currentPlatformSmoke) {
  const currentTarget = getPlatformIdentifier();
  if (!supportedTargets.has(currentTarget)) {
    throw new Error(`[prepare-prebuilds] unsupported smoke target ${currentTarget}`);
  }
  targetsToPrepare = [currentTarget];
} else {
  const missing = requiredTargets.filter((target) => !manifestTargets.includes(target));
  const extra = manifestTargets.filter((target) => !supportedTargets.has(target));
  if (
    missing.length !== 0 ||
    extra.length !== 0 ||
    manifestTargets.length !== requiredTargets.length
  ) {
    const details = [
      missing.length === 0 ? null : `missing ${missing.join(', ')}`,
      extra.length === 0 ? null : `unexpected ${extra.join(', ')}`,
    ].filter(Boolean).join('; ');
    throw new Error(
      `[prepare-prebuilds] full release requires exactly ${requiredTargets.join(', ')}` +
        (details ? `; ${details}` : ''),
    );
  }
  targetsToPrepare = requiredTargets;
}

function verifyTarget(target) {
  const entry = manifest.targets?.[target];
  if (!entry) {
    throw new Error(`[prepare-prebuilds] ${target} has no verified artifact`);
  }
  if (entry.sourceDigest !== currentSourceDigest) {
    throw new Error(`[prepare-prebuilds] ${target} was built from stale source`);
  }
  if (entry.coreVersion !== getCoreVersion()) {
    throw new Error(`[prepare-prebuilds] ${target} core version is stale`);
  }
  if (entry.bindingVersion !== getNativeBindingVersion()) {
    throw new Error(`[prepare-prebuilds] ${target} binding version is stale`);
  }
  if (entry.file !== `${target}/voided_node.node`) {
    throw new Error(`[prepare-prebuilds] ${target} has an invalid artifact path`);
  }

  const artifactPath = join(prebuildsRoot, entry.file);
  if (!existsSync(artifactPath)) {
    throw new Error(`[prepare-prebuilds] ${target} artifact is missing`);
  }
  const artifactHash = digestFile(artifactPath);
  const artifactSize = statSync(artifactPath).size;
  if (
    !Number.isSafeInteger(entry.size) ||
    entry.size <= 0 ||
    entry.size !== artifactSize ||
    entry.sha256 !== artifactHash
  ) {
    throw new Error(`[prepare-prebuilds] ${target} artifact does not match its manifest`);
  }
  const expectedBuildId = digestText(
    [target, currentSourceDigest, artifactHash, String(artifactSize)].join('\n'),
  );
  if (entry.buildId !== expectedBuildId) {
    throw new Error(`[prepare-prebuilds] ${target} build ID is invalid`);
  }
  return entry;
}

const verifiedEntries = targetsToPrepare.map((target) => [
  target,
  verifyTarget(target),
]);
const allowlist = ['*', '!manifest.json'];
for (const [target, entry] of verifiedEntries) {
  allowlist.push(`!${target}/`, `${target}/*`, `!${entry.file}`);
}

// Any directory outside the verified mode-specific set stays denied.
for (const directory of readdirSync(prebuildsRoot, { withFileTypes: true })) {
  if (directory.isDirectory() && !targetsToPrepare.includes(directory.name)) {
    console.warn(`[prepare-prebuilds] excluding ${directory.name}`);
  }
}
if (digestFiles(getNativeSourceFiles()) !== currentSourceDigest) {
  throw new Error('[prepare-prebuilds] native source changed during verification');
}
for (const [target, entry] of verifiedEntries) {
  const artifactPath = join(prebuildsRoot, entry.file);
  if (
    statSync(artifactPath).size !== entry.size ||
    digestFile(artifactPath) !== entry.sha256
  ) {
    throw new Error(`[prepare-prebuilds] ${target} artifact changed during verification`);
  }
}

const modeLabel = currentPlatformSmoke
  ? 'temporary current-platform package smoke'
  : 'complete native release';
writeFileSync(
  npmIgnorePath,
  [
    `# Generated for ${modeLabel}. Do not hand-edit.`,
    ...allowlist,
    '',
  ].join('\n'),
);
console.log(
  `[prepare-prebuilds] allowlisted ${targetsToPrepare.join(', ')} for ${modeLabel}`,
);
