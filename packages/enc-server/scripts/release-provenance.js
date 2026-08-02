import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const workspaceRoot = join(packageRoot, '..', '..');
export const cratesRoot = join(workspaceRoot, 'crates');
const excludedWorkspaceSnapshotPaths = new Set([
  join(cratesRoot, '.git'),
  join(cratesRoot, 'reports'),
  join(cratesRoot, 'target'),
  join(cratesRoot, 'voided-bench', '.git'),
  join(cratesRoot, 'voided-bench', 'target'),
  join(cratesRoot, 'voided-core', '.git'),
  join(cratesRoot, 'voided-core', 'target'),
  join(cratesRoot, 'voided-node', '.git'),
  join(cratesRoot, 'voided-node', 'target'),
  join(cratesRoot, 'voided-wasm', '.git'),
  join(cratesRoot, 'voided-wasm', 'pkg'),
  join(cratesRoot, 'voided-wasm', 'target'),
]);

function readRegularFile(path) {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new Error(`Release input must be a regular file: ${path}`);
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function collectFiles(path, output, excludedPaths) {
  if (excludedPaths.has(path)) return;
  if (!existsSync(path)) throw new Error(`Required release source is missing: ${path}`);
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Release source must not be a symlink: ${path}`);
  }
  if (metadata.isFile()) {
    output.push(path);
    return;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Release source must be a regular file or directory: ${path}`);
  }
  for (const name of readdirSync(path).sort()) {
    collectFiles(join(path, name), output, excludedPaths);
  }
}

export function getNativeSourceFiles() {
  return getCargoWorkspaceSnapshotFiles();
}

export function getCargoWorkspaceSnapshotFiles() {
  const files = [];
  collectFiles(cratesRoot, files, excludedWorkspaceSnapshotPaths);
  const workspaceCargoConfig = join(workspaceRoot, '.cargo');
  if (existsSync(workspaceCargoConfig)) {
    collectFiles(workspaceCargoConfig, files, excludedWorkspaceSnapshotPaths);
  }
  return files.sort();
}

export function digestFiles(files, root = workspaceRoot) {
  const digest = createHash('sha256');
  for (const path of files) {
    digest.update(relative(root, path).replaceAll('\\', '/'));
    digest.update('\0');
    digest.update(readRegularFile(path));
    digest.update('\0');
  }
  return `sha256:${digest.digest('hex')}`;
}

export function digestFile(path) {
  return `sha256:${createHash('sha256').update(readRegularFile(path)).digest('hex')}`;
}

export function digestText(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function readJson(path) {
  return JSON.parse(readRegularFile(path).toString('utf8'));
}

function crateVersion(crateName) {
  const cargoToml = readRegularFile(
    join(cratesRoot, crateName, 'Cargo.toml'),
  ).toString('utf8');
  const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`Could not read ${crateName} version`);
  return match[1];
}

export const getCoreVersion = () => crateVersion('voided-core');
export const getNativeBindingVersion = () => crateVersion('voided-node');

export function getPlatformIdentifier() {
  const platformMap = {
    'win32-x64': 'win32-x64-msvc',
    'win32-arm64': 'win32-arm64-msvc',
    'darwin-x64': 'darwin-x64',
    'darwin-arm64': 'darwin-arm64',
    'linux-x64': 'linux-x64-gnu',
    'linux-arm64': 'linux-arm64-gnu',
  };
  return platformMap[`${process.platform}-${process.arch}`] ??
    `${process.platform}-${process.arch}`;
}

export function getNativeLibraryFileName() {
  if (process.platform === 'win32') return 'voided_node.dll';
  if (process.platform === 'darwin') return 'libvoided_node.dylib';
  return 'libvoided_node.so';
}
