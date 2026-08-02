function readPackageVersions(cargoLock, packageName) {
  if (typeof cargoLock !== 'string') {
    throw new Error('[build-wasm] Cargo.lock contents must be text');
  }
  const versions = [];
  for (const block of cargoLock.split('[[package]]').slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    if (name !== packageName) continue;
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (!version) {
      throw new Error(`[build-wasm] ${packageName} in Cargo.lock has no version`);
    }
    versions.push(version);
  }
  return versions;
}

export function getLockedWasmBindgenVersion(cargoLock) {
  const versions = readPackageVersions(cargoLock, 'wasm-bindgen');
  if (versions.length !== 1) {
    throw new Error(
      `[build-wasm] expected exactly one wasm-bindgen package in Cargo.lock, found ${versions.length}`,
    );
  }
  return versions[0];
}

export function parseWasmBindgenCliVersion(versionOutput) {
  const match = String(versionOutput)
    .trim()
    .match(/^wasm-bindgen(?:-cli)?\s+([^\s]+)$/);
  if (!match) {
    throw new Error(
      `[build-wasm] could not parse wasm-bindgen --version output: ${String(versionOutput)}`,
    );
  }
  return match[1];
}

export function assertMatchingWasmBindgenVersion(
  versionOutput,
  lockedVersion,
) {
  const actualVersion = parseWasmBindgenCliVersion(versionOutput);
  if (actualVersion !== lockedVersion) {
    throw new Error(
      `[build-wasm] wasm-bindgen CLI ${actualVersion} does not match Cargo.lock ${lockedVersion}. ` +
        `Put the reviewed wasm-bindgen ${lockedVersion} binary on PATH; the release script ` +
        'will not download, install, or copy it.',
    );
  }
  return actualVersion;
}
