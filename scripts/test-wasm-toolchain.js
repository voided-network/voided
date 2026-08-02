#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  assertMatchingWasmBindgenVersion,
  getLockedWasmBindgenVersion,
  parseWasmBindgenCliVersion,
} from '../packages/e2ee-client/scripts/wasm-toolchain.js';

const cargoLock = `
version = 4

[[package]]
name = "other-package"
version = "1.0.0"

[[package]]
name = "wasm-bindgen"
version = "0.2.106"
`;

assert.equal(getLockedWasmBindgenVersion(cargoLock), '0.2.106');
assert.equal(parseWasmBindgenCliVersion('wasm-bindgen 0.2.106\n'), '0.2.106');
assert.equal(
  assertMatchingWasmBindgenVersion('wasm-bindgen 0.2.106', '0.2.106'),
  '0.2.106',
);
assert.throws(
  () => assertMatchingWasmBindgenVersion('wasm-bindgen 0.2.105', '0.2.106'),
  /does not match Cargo\.lock 0\.2\.106/,
);
assert.throws(
  () => getLockedWasmBindgenVersion('version = 4\n'),
  /expected exactly one wasm-bindgen package/,
);
assert.throws(
  () => parseWasmBindgenCliVersion('wasm-bindgen unknown extra'),
  /could not parse wasm-bindgen --version output/,
);

console.log('[wasm-toolchain-test] locked CLI version checks passed');
