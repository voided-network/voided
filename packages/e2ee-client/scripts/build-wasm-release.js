#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  sep,
} from 'node:path';
import {
  digestFile,
  digestFiles,
  digestText,
  getCoreVersion,
  getWasmBindingVersion,
  getWasmSourceFiles,
  packageRoot,
  readJson,
  workspaceRoot,
} from './release-provenance.js';
import {
  assertMatchingWasmBindgenVersion,
  getLockedWasmBindgenVersion,
} from './wasm-toolchain.js';

const outputDir = join(packageRoot, 'wasm');
const buildArguments = process.argv.slice(2);
let reproducibilitySlot = '';
if (buildArguments.length > 0) {
  const match =
    buildArguments.length === 1
      ? /^--repro-slot=([a-z0-9-]+)$/.exec(buildArguments[0])
      : null;
  if (!match) {
    throw new Error(
      '[build-wasm] expected no arguments or one --repro-slot=<name> argument',
    );
  }
  reproducibilitySlot = match[1];
}

function findExecutable(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  for (const directory of [
    join(homedir(), '.cargo', 'bin'),
    '/opt/homebrew/opt/rustup/bin',
    ...(process.env.PATH ?? '').split(delimiter),
  ]) {
    const candidate = join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  return executable;
}

function findExecutableOnPath(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `[build-wasm] ${command} ${args.join(' ')} failed\n` +
        `${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  return result.stdout?.trim() ?? '';
}

function assertCargoHomeHasNoConfiguration() {
  const configuredCargoHome = process.env.CARGO_HOME;
  if (configuredCargoHome && !isAbsolute(configuredCargoHome)) {
    throw new Error('[build-wasm] CARGO_HOME must be absolute for a release build');
  }
  const cargoHome = configuredCargoHome ?? join(homedir(), '.cargo');
  for (const name of ['config', 'config.toml']) {
    const configPath = join(cargoHome, name);
    if (existsSync(configPath)) {
      throw new Error(
        `[build-wasm] Cargo-home configuration is an unbound build input: ${configPath}. ` +
          'Use a clean CARGO_HOME on the trusted release runner.',
      );
    }
  }
  return realpathSync(cargoHome);
}

function assertNoUnboundRustEnvironment() {
  const exactNames = new Set([
    'RUSTC_BOOTSTRAP',
    'RUSTFLAGS',
    'RUSTUP_TOOLCHAIN',
    'SOURCE_DATE_EPOCH',
  ]);
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      ((name.startsWith('CARGO_') && name !== 'CARGO_HOME') ||
        name.startsWith('RUSTC_') ||
        name.startsWith('RUSTDOC_') ||
        name.startsWith('WASM_BINDGEN_') ||
        name.startsWith('WASM_PACK_') ||
        exactNames.has(name))
    ) {
      throw new Error(
        `[build-wasm] ${name} is an unbound release input; unset it before building`,
      );
    }
  }
}

function copyCargoWorkspaceSnapshot(snapshotWorkspaceRoot, sourceFiles) {
  for (const sourcePath of sourceFiles) {
    const relativePath = relative(workspaceRoot, sourcePath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`[build-wasm] release input escaped the workspace: ${sourcePath}`);
    }
    const metadata = lstatSync(sourcePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`[build-wasm] release input is not a regular file: ${sourcePath}`);
    }
    const destination = join(snapshotWorkspaceRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(sourcePath, destination);
  }
}

function isPathWithin(root, candidate) {
  const path = relative(root, candidate);
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  );
}

function assertMetadataIsConfined(metadata, snapshotWorkspaceRoot) {
  if (
    !metadata ||
    !Array.isArray(metadata.packages) ||
    typeof metadata.workspace_root !== 'string'
  ) {
    throw new Error('[build-wasm] Cargo metadata response is invalid');
  }
  if (!isPathWithin(snapshotWorkspaceRoot, metadata.workspace_root)) {
    throw new Error(
      `[build-wasm] Cargo workspace escaped the source snapshot: ` +
        `${metadata.workspace_root}`,
    );
  }
  for (const cargoPackage of metadata.packages) {
    if (
      cargoPackage.source === null &&
      (typeof cargoPackage.manifest_path !== 'string' ||
        !isPathWithin(snapshotWorkspaceRoot, cargoPackage.manifest_path))
    ) {
      throw new Error(
        `[build-wasm] local Cargo package escaped the source snapshot: ` +
          `${cargoPackage.manifest_path ?? '<missing manifest path>'}`,
      );
    }
  }
}

const cargo = findExecutable('cargo');
const rustc = findExecutable('rustc');
const wasmPack = findExecutable('wasm-pack');
const wasmBindgen = findExecutableOnPath('wasm-bindgen');

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  join(outputDir, '.npmignore'),
  '# Build in progress or not yet verified. No WASM artifact may be packed.\n*\n',
);

const cargoHome = assertCargoHomeHasNoConfiguration();
assertNoUnboundRustEnvironment();
run(cargo, ['--version'], { cwd: join(workspaceRoot, 'crates') });
run(rustc, ['--version'], { cwd: join(workspaceRoot, 'crates') });
try {
  run(wasmPack, ['--version']);
} catch {
  throw new Error(
    '[build-wasm] wasm-pack is required. Install a reviewed wasm-pack release before building; ' +
      'the release script will not download or install tools implicitly.',
  );
}
if (!wasmBindgen) {
  throw new Error(
    '[build-wasm] wasm-bindgen CLI is required on PATH. Put the reviewed binary ' +
      'matching crates/Cargo.lock on PATH; this release script will not download, ' +
      'install, or copy tool binaries.',
  );
}
const lockedWasmBindgenVersion = getLockedWasmBindgenVersion(
  readFileSync(join(workspaceRoot, 'crates', 'Cargo.lock'), 'utf8'),
);
const wasmBindgenVersionOutput = run(wasmBindgen, ['--version']);
const wasmBindgenVersion = assertMatchingWasmBindgenVersion(
  wasmBindgenVersionOutput,
  lockedWasmBindgenVersion,
);
const wasmBindgenDigest = digestFile(realpathSync(wasmBindgen));

const sourceFiles = getWasmSourceFiles();
const sourceDigestBefore = digestFiles(sourceFiles);
const scratch = join(
  tmpdir(),
  `voided-wasm-build-${sourceDigestBefore.slice(
    'sha256:'.length,
    'sha256:'.length + 32,
  )}${reproducibilitySlot ? `-${reproducibilitySlot}` : ''}`,
);
if (existsSync(scratch)) {
  throw new Error(
    `[build-wasm] deterministic scratch path is already in use: ${scratch}`,
  );
}
mkdirSync(scratch);
try {
  const canonicalScratch = realpathSync(scratch);
  const snapshotWorkspaceRoot = join(scratch, 'workspace');
  copyCargoWorkspaceSnapshot(snapshotWorkspaceRoot, sourceFiles);
  const canonicalSnapshotWorkspaceRoot = realpathSync(snapshotWorkspaceRoot);
  const snapshotSourceFiles = sourceFiles.map((sourcePath) =>
    join(snapshotWorkspaceRoot, relative(workspaceRoot, sourcePath)),
  );
  const snapshotSourceDigest = digestFiles(
    snapshotSourceFiles,
    snapshotWorkspaceRoot,
  );
  if (snapshotSourceDigest !== sourceDigestBefore) {
    throw new Error('[build-wasm] copied source snapshot does not match live source');
  }
  const wasmCrate = join(snapshotWorkspaceRoot, 'crates', 'voided-wasm');
  const generatedDir = join(scratch, 'pkg');
  const temporaryDir = join(scratch, 'tmp');
  mkdirSync(temporaryDir);
  const rustToolchainRoot = realpathSync(
    run(rustc, ['--print', 'sysroot'], { cwd: wasmCrate }),
  );
  const buildEnvironment = {
    cargoIncremental: '0',
    locale: 'C',
    offline: 'true',
    pathRemapBuild: '/voided-build',
    pathRemapCargoHome: '/cargo-home',
    pathRemapSource: '/voided-source',
    pathRemapToolchain: '/rust-toolchain',
    sourceDateEpoch: '0',
    timezone: 'UTC',
  };
  const encodedRustFlags = [
    `--remap-path-prefix=${canonicalSnapshotWorkspaceRoot}=${buildEnvironment.pathRemapSource}`,
    `--remap-path-prefix=${canonicalScratch}=${buildEnvironment.pathRemapBuild}`,
    `--remap-path-prefix=${cargoHome}=${buildEnvironment.pathRemapCargoHome}`,
    `--remap-path-prefix=${rustToolchainRoot}=${buildEnvironment.pathRemapToolchain}`,
  ].join('\u001f');
  const toolchainCargo = realpathSync(
    join(
      rustToolchainRoot,
      'bin',
      process.platform === 'win32' ? 'cargo.exe' : 'cargo',
    ),
  );
  const toolchainRustc = realpathSync(
    join(
      rustToolchainRoot,
      'bin',
      process.platform === 'win32' ? 'rustc.exe' : 'rustc',
    ),
  );
  const wasmPackBinary = realpathSync(wasmPack);
  const wasmBindgenBinary = realpathSync(wasmBindgen);
  const releasePath = [
    dirname(toolchainCargo),
    dirname(wasmBindgenBinary),
    dirname(wasmPackBinary),
    process.env.PATH ?? '',
  ].join(delimiter);
  const releaseEnvironment = {
    PATH: releasePath,
    HOME: homedir(),
    CARGO_HOME: cargoHome,
    CARGO_ENCODED_RUSTFLAGS: encodedRustFlags,
    CARGO_INCREMENTAL: buildEnvironment.cargoIncremental,
    CARGO_TARGET_DIR: join(scratch, 'cargo-target'),
    LANG: buildEnvironment.locale,
    LC_ALL: buildEnvironment.locale,
    RUSTC: toolchainRustc,
    SOURCE_DATE_EPOCH: buildEnvironment.sourceDateEpoch,
    TEMP: temporaryDir,
    TMP: temporaryDir,
    TMPDIR: temporaryDir,
    TZ: buildEnvironment.timezone,
  };
  for (const name of ['COMSPEC', 'PATHEXT', 'SYSTEMROOT']) {
    if (process.env[name]) releaseEnvironment[name] = process.env[name];
  }
  if (process.env.RUSTUP_HOME) {
    releaseEnvironment.RUSTUP_HOME = realpathSync(process.env.RUSTUP_HOME);
  }
  const tools = {
    cargo: run(toolchainCargo, ['--version'], { cwd: wasmCrate }),
    cargoSha256: digestFile(toolchainCargo),
    rustc: run(toolchainRustc, ['--version'], { cwd: wasmCrate }),
    rustcSha256: digestFile(toolchainRustc),
    wasmPack: run(wasmPackBinary, ['--version']),
    wasmPackSha256: digestFile(wasmPackBinary),
    wasmBindgen: `wasm-bindgen ${wasmBindgenVersion}`,
    wasmBindgenSha256: digestFile(wasmBindgenBinary),
  };
  if (tools.wasmBindgenSha256 !== wasmBindgenDigest) {
    throw new Error('[build-wasm] wasm-bindgen binary changed during setup');
  }
  const metadata = JSON.parse(
    run(
      toolchainCargo,
      ['metadata', '--format-version', '1', '--locked', '--offline'],
      {
        cwd: join(snapshotWorkspaceRoot, 'crates'),
        env: releaseEnvironment,
      },
    ),
  );
  assertMetadataIsConfined(metadata, canonicalSnapshotWorkspaceRoot);

  console.log(`[build-wasm] source ${sourceDigestBefore}`);
  run(
    wasmPack,
    [
      'build',
      '--mode',
      'no-install',
      '--target',
      'web',
      '--release',
      '--out-dir',
      generatedDir,
      '--out-name',
      'voided_wasm',
      '--locked',
      '--offline',
    ],
    {
      cwd: wasmCrate,
      env: releaseEnvironment,
      stdio: 'inherit',
    },
  );

  const sourceDigestAfter = digestFiles(getWasmSourceFiles());
  if (sourceDigestAfter !== sourceDigestBefore) {
    throw new Error('[build-wasm] security-relevant source changed during the build');
  }

  const requiredArtifacts = [
    'voided_wasm.js',
    'voided_wasm_bg.wasm',
    'voided_wasm.d.ts',
    'voided_wasm_bg.wasm.d.ts',
    'package.json',
  ];
  for (const name of requiredArtifacts) {
    if (!existsSync(join(generatedDir, name))) {
      throw new Error(`[build-wasm] wasm-pack did not produce ${name}`);
    }
  }

  mkdirSync(outputDir, { recursive: true });
  for (const name of requiredArtifacts) {
    const temporaryDestination = join(outputDir, `.${name}.new`);
    copyFileSync(join(generatedDir, name), temporaryDestination);
    renameSync(temporaryDestination, join(outputDir, name));
  }

  const artifacts = requiredArtifacts.map((file) => {
    const path = join(outputDir, file);
    return {
      file,
      sha256: digestFile(path),
      size: statSync(path).size,
    };
  });
  const packageVersion = readJson(join(packageRoot, 'package.json')).version;
  const toolEntries = Object.entries(tools)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}:${value}`);
  const buildEnvironmentEntries = Object.entries(buildEnvironment)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}:${value}`);
  const buildId = digestText(
    [
      'wasm32-unknown-unknown',
      sourceDigestBefore,
      ...toolEntries,
      ...buildEnvironmentEntries,
      ...artifacts
        .map((artifact) => `${artifact.file}:${artifact.sha256}:${artifact.size}`)
        .sort(),
    ].join('\n'),
  );
  const manifest = {
    schemaVersion: 4,
    package: '@voideddev/e2ee-client',
    packageVersion,
    target: 'wasm32-unknown-unknown',
    coreVersion: getCoreVersion(),
    bindingVersion: getWasmBindingVersion(),
    sourceDigest: sourceDigestBefore,
    buildId,
    tools,
    buildEnvironment,
    artifacts,
  };
  const manifestTemporary = join(outputDir, '.manifest.json.new');
  writeFileSync(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(manifestTemporary, join(outputDir, 'manifest.json'));

  const persistedManifest = JSON.parse(
    readFileSync(join(outputDir, 'manifest.json'), 'utf8'),
  );
  if (persistedManifest.buildId !== buildId) {
    throw new Error('[build-wasm] persisted provenance manifest is inconsistent');
  }
  console.log(`[build-wasm] built ${buildId}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
