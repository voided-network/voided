#!/usr/bin/env node

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'voided-provenance-inputs-'));

function write(relativePath, contents = '') {
  const path = join(scratch, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function requireChanged(before, after, label) {
  if (before === after) {
    throw new Error(`[release-provenance-test] ${label} did not change the digest`);
  }
}

function requireUnchanged(before, after, label) {
  if (before !== after) {
    throw new Error(`[release-provenance-test] ${label} changed the digest`);
  }
}

try {
  write('package.json', '{ "type": "module" }\n');
  for (const file of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml']) {
    write(`crates/${file}`, `${file}\n`);
  }
  write('crates/voided-core/Cargo.toml', '[package]\nname = "voided-core"\n');
  write('crates/voided-core/src/lib.rs', 'pub fn core() {}\n');
  write('crates/voided-wasm/Cargo.toml', '[package]\nname = "voided-wasm"\n');
  write('crates/voided-wasm/src/lib.rs', 'pub fn wasm() {}\n');
  write('crates/voided-node/Cargo.toml', '[package]\nname = "voided-node"\n');
  write('crates/voided-node/build.rs', 'fn main() {}\n');
  write('crates/voided-node/src/lib.rs', 'pub fn node() {}\n');
  write('crates/voided-bench/Cargo.toml', '[package]\nname = "voided-bench"\n');
  write('crates/voided-bench/src/main.rs', 'fn main() {}\n');

  for (const packageName of ['e2ee-client', 'enc-server']) {
    const destination = join(
      scratch,
      'packages',
      packageName,
      'scripts',
      'release-provenance.js',
    );
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(
      join(
        repositoryRoot,
        'packages',
        packageName,
        'scripts',
        'release-provenance.js',
      ),
      destination,
    );
  }

  const wasmProvenance = await import(
    `${pathToFileURL(
      join(
        scratch,
        'packages/e2ee-client/scripts/release-provenance.js',
      ),
    ).href}?test=wasm`
  );
  const nativeProvenance = await import(
    `${pathToFileURL(
      join(
        scratch,
        'packages/enc-server/scripts/release-provenance.js',
      ),
    ).href}?test=native`
  );
  const wasmDigest = () =>
    wasmProvenance.digestFiles(wasmProvenance.getWasmSourceFiles());
  const nativeDigest = () =>
    nativeProvenance.digestFiles(nativeProvenance.getNativeSourceFiles());

  for (const provenance of [wasmProvenance, nativeProvenance]) {
    const snapshotFiles = new Set(
      provenance
        .getCargoWorkspaceSnapshotFiles()
        .map((path) =>
          relative(provenance.workspaceRoot, path).replaceAll('\\', '/'),
        ),
    );
    if (!snapshotFiles.has('crates/voided-bench/src/main.rs')) {
      throw new Error('[release-provenance-test] workspace snapshot omitted a member');
    }
  }

  const initialWasm = wasmDigest();
  const initialNative = nativeDigest();

  write('crates/voided-bench/src/main.rs', 'fn main() { println!("changed"); }\n');
  const wasmWithWorkspaceMember = wasmDigest();
  const nativeWithWorkspaceMember = nativeDigest();
  requireChanged(
    initialWasm,
    wasmWithWorkspaceMember,
    'workspace member input for WASM',
  );
  requireChanged(
    initialNative,
    nativeWithWorkspaceMember,
    'workspace member input for native',
  );

  write('crates/voided-wasm/build.rs', 'fn main() { println!("cargo:rerun-if-changed=build.rs"); }\n');
  const wasmWithBuildScript = wasmDigest();
  const nativeWithWasmBuildScript = nativeDigest();
  requireChanged(
    wasmWithWorkspaceMember,
    wasmWithBuildScript,
    'new WASM build.rs for WASM',
  );
  requireChanged(
    nativeWithWorkspaceMember,
    nativeWithWasmBuildScript,
    'new WASM build.rs for native',
  );

  write('crates/voided-core/build.rs', 'fn main() {}\n');
  const wasmWithCoreBuildScript = wasmDigest();
  const nativeWithCoreBuildScript = nativeDigest();
  requireChanged(
    wasmWithBuildScript,
    wasmWithCoreBuildScript,
    'new core build.rs for WASM',
  );
  requireChanged(
    nativeWithWasmBuildScript,
    nativeWithCoreBuildScript,
    'new core build.rs for native',
  );

  write('crates/.cargo/config.toml', '[build]\nrustflags = ["--cfg", "release_input_test"]\n');
  const wasmWithCargoConfig = wasmDigest();
  const nativeWithCargoConfig = nativeDigest();
  requireChanged(
    wasmWithCoreBuildScript,
    wasmWithCargoConfig,
    'new Cargo config for WASM',
  );
  requireChanged(
    nativeWithCoreBuildScript,
    nativeWithCargoConfig,
    'new Cargo config for native',
  );

  write('crates/voided-wasm/pkg/generated.js', 'generated output\n');
  write('crates/voided-core/target/generated.bin', 'generated output\n');
  for (const provenance of [wasmProvenance, nativeProvenance]) {
    const snapshotFiles = new Set(
      provenance
        .getCargoWorkspaceSnapshotFiles()
        .map((path) =>
          relative(provenance.workspaceRoot, path).replaceAll('\\', '/'),
        ),
    );
    for (const output of [
      'crates/voided-wasm/pkg/generated.js',
      'crates/voided-core/target/generated.bin',
    ]) {
      if (snapshotFiles.has(output)) {
        throw new Error(
          `[release-provenance-test] workspace snapshot included output ${output}`,
        );
      }
    }
  }
  requireUnchanged(
    wasmWithCargoConfig,
    wasmDigest(),
    'excluded WASM pkg/target output',
  );
  requireUnchanged(
    nativeWithCargoConfig,
    nativeDigest(),
    'excluded native target output',
  );

  write('crates/voided-core/src/target/compile_input.rs', 'pub fn target_input() {}\n');
  const wasmWithNestedTarget = wasmDigest();
  const nativeWithNestedTarget = nativeDigest();
  requireChanged(
    wasmWithCargoConfig,
    wasmWithNestedTarget,
    'source directory named target for WASM',
  );
  requireChanged(
    nativeWithCargoConfig,
    nativeWithNestedTarget,
    'source directory named target for native',
  );

  write('crates/voided-core/src/pkg/compile_input.rs', 'pub fn pkg_input() {}\n');
  requireChanged(
    wasmWithNestedTarget,
    wasmDigest(),
    'source directory named pkg for WASM',
  );
  requireChanged(
    nativeWithNestedTarget,
    nativeDigest(),
    'source directory named pkg for native',
  );

  if (process.platform !== 'win32') {
    write('external-release-input', 'outside\n');
    symlinkSync(
      join(scratch, 'external-release-input'),
      join(scratch, 'crates/voided-wasm/external-link'),
    );
    let rejectedSymlink = false;
    try {
      wasmProvenance.getWasmSourceFiles();
    } catch (error) {
      rejectedSymlink =
        error instanceof Error && error.message.includes('must not be a symlink');
    }
    if (!rejectedSymlink) {
      throw new Error('[release-provenance-test] symlinked source was not rejected');
    }
  }

  console.log('[release-provenance-test] complete Cargo input coverage passed');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
