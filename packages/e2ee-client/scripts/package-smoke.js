#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageRoot } from './release-provenance.js';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `[package-smoke] ${command} failed\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  return result;
}

const scratch = mkdtempSync(join(tmpdir(), 'voided-e2ee-pack-'));
try {
  const pack = run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    scratch,
  ]);
  const report = JSON.parse(pack.stdout);
  const tarball = join(scratch, report[0].filename);
  run('tar', ['-xzf', tarball, '-C', scratch]);

  const packedRoot = join(scratch, 'package');
  const expected = [
    'LICENSE',
    'THIRD_PARTY_NOTICES',
    'dist/index.js',
    'dist/wasm/loader.js',
    'examples/key-export-import-example.html',
    'examples/customizable-key-ui-example.html',
    'examples/simple-key-ui.js',
    'examples/key-ui-styles.css',
    'examples/recovery-deck-ui-example.html',
    'wasm/manifest.json',
    'wasm/voided_wasm.js',
    'wasm/voided_wasm_bg.wasm',
  ];
  const packedFiles = new Set(
    report[0].files.map((entry) => entry.path.replaceAll('\\', '/')),
  );
  for (const path of expected) {
    if (!packedFiles.has(path)) {
      throw new Error(`[package-smoke] packed tarball is missing ${path}`);
    }
  }
  for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES']) {
    const text = readFileSync(join(packedRoot, notice), 'utf8');
    if (!text.includes('MIT License')) {
      throw new Error(`[package-smoke] ${notice} is incomplete`);
    }
  }
  for (const example of [
    'examples/key-export-import-example.html',
    'examples/customizable-key-ui-example.html',
    'examples/simple-key-ui.js',
    'examples/recovery-deck-ui-example.html',
  ]) {
    const text = readFileSync(join(packedRoot, example), 'utf8');
    if (!text.includes('../dist/index.js') || text.includes('../dist/index.mjs')) {
      throw new Error(`[package-smoke] ${example} does not load the packed ESM library`);
    }
  }
  for (const forbidden of ['crates/', 'target/', 'src/']) {
    if ([...packedFiles].some((path) => path.startsWith(forbidden))) {
      throw new Error(`[package-smoke] packed tarball leaked ${forbidden}`);
    }
  }

  const childScript = join(scratch, 'smoke.mjs');
  const manifest = JSON.parse(
    readFileSync(join(packedRoot, 'wasm', 'manifest.json'), 'utf8'),
  );
  const script = `
    import { readFile } from 'node:fs/promises';
    import { createRequire } from 'node:module';
    import { pathToFileURL, fileURLToPath } from 'node:url';
    import { brotliCompressSync } from 'node:zlib';

    const packedRoot = ${JSON.stringify(packedRoot)};
    const require = createRequire(import.meta.url);
    const nativeFetch = globalThis.fetch;
    // Exercise the browser loader under Node while preserving the Web Crypto
    // surface required by getrandom inside the compiled WASM.
    globalThis.window = { crypto: globalThis.crypto };
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('file:')) {
        return new Response(await readFile(fileURLToPath(url)), {
          status: 200,
          headers: { 'Content-Type': 'application/wasm' },
        });
      }
      return nativeFetch(input, init);
    };

    const loader = await import(
      pathToFileURL(packedRoot + '/dist/wasm/loader.js').href +
        '?buildId=${encodeURIComponent(manifest.buildId)}'
    );
    const publicRoot = await import(
      pathToFileURL(packedRoot + '/dist/index.js').href +
        '?root=${encodeURIComponent(manifest.buildId)}'
    );
    for (const exportName of [
      'CryptoService',
      'cryptoService',
      'decompressBounded',
      'VoidedRecoveryDeckUI',
      'createRecoveryDeckUI',
      'moveRecoveryDeckUICard',
      'RECOVERY_DECK_UI_CARD_IDS',
      'RECOVERY_DECK_DEFAULT_CSS',
      'generateRecoveryDeck',
      'validateRecoveryDeck',
      'encodeRecoveryDeck',
      'deriveRecoveryKey',
      'wrapRootWithRecoveryKey',
      'unwrapRootWithRecoveryKey',
      'createRecoveryDeck',
      'rotateRecoveryDeck',
    ]) {
      if (!(exportName in publicRoot)) {
        throw new Error('packed root API omitted intentional export ' + exportName);
      }
    }
    if (
      publicRoot.RECOVERY_DECK_UI_CARD_IDS.length !== 52 ||
      new Set(publicRoot.RECOVERY_DECK_UI_CARD_IDS).size !== 52
    ) {
      throw new Error('packed Recovery Deck UI omitted the canonical card set');
    }
    const wasm = await loader.initWasm();
    const configuredLoader = await import(
      pathToFileURL(packedRoot + '/dist/wasm/loader.js').href +
        '?configured=${encodeURIComponent(manifest.buildId)}'
    );
    if ('resetWasm' in configuredLoader) {
      throw new Error('packed WASM loader exposed its test-only reset');
    }
    const configuredGlueUrl = pathToFileURL(
      packedRoot + '/wasm/voided_wasm.js',
    );
    configuredLoader.configureWasmLoader({
      glueUrl: configuredGlueUrl,
    });
    const configuredWasm = await configuredLoader.initWasm();
    if (configuredWasm.version() !== wasm.version()) {
      throw new Error('configured packed WASM loader returned a different runtime');
    }
    let configurationStayedLocked = false;
    try {
      configuredLoader.configureWasmLoader({ glueUrl: configuredGlueUrl });
    } catch (error) {
      configurationStayedLocked =
        error instanceof Error &&
        error.message.includes('cannot change after initialization has started');
    }
    if (!configurationStayedLocked) {
      throw new Error('packed WASM loader configuration was mutable after init');
    }
    const key = wasm.generate_key();
    const data = new TextEncoder().encode('packed e2ee-client smoke');
    const encrypted = wasm.encrypt(data, key, 'aes-256-gcm');
    if (!encrypted.tag) throw new Error('missing AEAD tag');
    const opened = wasm.decrypt(
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.tag,
      key,
      encrypted.algorithm,
    );
    if (new TextDecoder().decode(opened) !== 'packed e2ee-client smoke') {
      throw new Error('packed WASM round-trip failed');
    }
    const publicBackend = await import(
      pathToFileURL(packedRoot + '/dist/crypto-backend.js').href +
        '?public=${encodeURIComponent(manifest.buildId)}'
    );
    publicBackend.configureWasmLoader({ glueUrl: configuredGlueUrl });
    await publicBackend.forceWasmBackend();
    const publicKey = await publicBackend.generateKey();
    const publicEncrypted = await publicBackend.encrypt(data, publicKey);
    if (publicEncrypted.algorithm !== 'aes-256-gcm') {
      throw new Error('packed public raw API did not pin AES-256-GCM');
    }
    const publicOpened = await publicBackend.decrypt(publicEncrypted, publicKey);
    if (new TextDecoder().decode(publicOpened) !== 'packed e2ee-client smoke') {
      throw new Error('packed public raw API round-trip failed');
    }
    const canonicalDeck = [...publicRoot.RECOVERY_DECK_UI_CARD_IDS];
    if (!(await publicBackend.validateRecoveryDeck(canonicalDeck))) {
      throw new Error('packed Recovery Deck rejected the canonical card set');
    }
    if (
      await publicBackend.validateRecoveryDeck(
        [...canonicalDeck.slice(0, 51), canonicalDeck[0]],
      )
    ) {
      throw new Error('packed Recovery Deck accepted a duplicate card');
    }
    const canonicalRank = await publicBackend.encodeRecoveryDeck(canonicalDeck);
    if (canonicalRank.length !== 29 || canonicalRank.some((byte) => byte !== 0)) {
      throw new Error('packed Recovery Deck changed the permanent rank vector');
    }
    const canonicalRecoveryKey = await publicBackend.deriveRecoveryKey(canonicalDeck);
    if (
      Buffer.from(canonicalRecoveryKey).toString('hex') !==
      '7d819b1d9cb4a0346a7e03a505e9bc6ef738518aa91ce99b04a866e436efd95c'
    ) {
      throw new Error('packed Recovery Deck changed the permanent key vector');
    }
    const cjsRoot = require(packedRoot + '/dist/index.cjs');
    for (const exportName of [
      'VoidedRecoveryDeckUI',
      'generateRecoveryDeck',
      'deriveRecoveryKey',
      'rotateRecoveryDeck',
    ]) {
      if (!(exportName in cjsRoot)) {
        throw new Error('packed CommonJS root omitted ' + exportName);
      }
    }
    cjsRoot.configureWasmLoader({ glueUrl: configuredGlueUrl });
    await cjsRoot.forceWasmBackend();
    const cjsRecoveryKey = await cjsRoot.deriveRecoveryKey(canonicalDeck);
    if (
      Buffer.from(cjsRecoveryKey).toString('hex') !==
      '7d819b1d9cb4a0346a7e03a505e9bc6ef738518aa91ce99b04a866e436efd95c'
    ) {
      throw new Error('packed CommonJS Recovery Deck changed the key vector');
    }
    const recoveryRoot = new Uint8Array(32).fill(0x5a);
    const directRecoveryWrapper = await publicBackend.wrapRootWithRecoveryKey(
      recoveryRoot,
      canonicalRecoveryKey,
      cjsRecoveryKey,
    );
    const directRecoveryOpened = await publicBackend.unwrapRootWithRecoveryKey(
      directRecoveryWrapper,
      canonicalRecoveryKey,
    );
    if (
      directRecoveryWrapper.length !== 80 ||
      !Buffer.from(directRecoveryOpened).equals(Buffer.from(recoveryRoot))
    ) {
      throw new Error('packed Recovery Deck root wrapping failed');
    }
    const wrongDeck = [...canonicalDeck];
    [wrongDeck[0], wrongDeck[1]] = [wrongDeck[1], wrongDeck[0]];
    const wrongRecoveryKey = await publicBackend.deriveRecoveryKey(wrongDeck);
    let wrongDeckRejected = false;
    try {
      await publicBackend.unwrapRootWithRecoveryKey(
        directRecoveryWrapper,
        wrongRecoveryKey,
      );
    } catch {
      wrongDeckRejected = true;
    }
    if (!wrongDeckRejected) {
      throw new Error('packed Recovery Deck accepted the wrong deck');
    }
    const recoverySetup = await publicBackend.createRecoveryDeck(recoveryRoot);
    const setupRecoveryKey = await publicBackend.deriveRecoveryKey(recoverySetup.deck);
    const setupRecoveryOpened = await publicBackend.unwrapRootWithRecoveryKey(
      recoverySetup.rootWrapper,
      setupRecoveryKey,
    );
    if (
      !(await publicBackend.validateRecoveryDeck(recoverySetup.deck)) ||
      recoverySetup.rootWrapper.length !== 80 ||
      !Buffer.from(setupRecoveryOpened).equals(Buffer.from(recoveryRoot))
    ) {
      throw new Error('packed Recovery Deck setup failed');
    }
    const rotatedRecovery = await publicBackend.rotateRecoveryDeck(
      recoverySetup.rootWrapper,
      recoverySetup.deck,
    );
    const rotatedRecoveryKey = await publicBackend.deriveRecoveryKey(
      rotatedRecovery.deck,
    );
    const rotatedRecoveryOpened = await publicBackend.unwrapRootWithRecoveryKey(
      rotatedRecovery.rootWrapper,
      rotatedRecoveryKey,
    );
    if (
      !(await publicBackend.validateRecoveryDeck(rotatedRecovery.deck)) ||
      !Buffer.from(rotatedRecoveryOpened).equals(Buffer.from(recoveryRoot))
    ) {
      throw new Error('packed Recovery Deck rotation changed the stable root');
    }
    let oldDeckRejected = false;
    try {
      await publicBackend.unwrapRootWithRecoveryKey(
        rotatedRecovery.rootWrapper,
        setupRecoveryKey,
      );
    } catch {
      oldDeckRejected = true;
    }
    if (!oldDeckRejected) {
      throw new Error('packed Recovery Deck rotation accepted the old deck');
    }
    for (const bytes of [
      canonicalRank,
      canonicalRecoveryKey,
      recoveryRoot,
      directRecoveryWrapper,
      directRecoveryOpened,
      wrongRecoveryKey,
      recoverySetup.rootWrapper,
      setupRecoveryKey,
      setupRecoveryOpened,
      rotatedRecovery.rootWrapper,
      rotatedRecoveryKey,
      rotatedRecoveryOpened,
    ]) {
      bytes.fill(0);
    }
    recoverySetup.deck.fill('');
    rotatedRecovery.deck.fill('');
    const compressionInput = new Uint8Array(4096).fill(0x41);
    const compressed = wasm.compress(compressionInput, 'gzip', 6);
    if (!(compressed.compressed instanceof Uint8Array)) {
      throw new Error('packed WASM compression returned an untyped byte field');
    }
    const decompressed = wasm.decompress(
      compressed.compressed,
      compressed.algorithm,
    );
    if (
      decompressed.length !== compressionInput.length ||
      decompressed.some((byte, index) => byte !== compressionInput[index])
    ) {
      throw new Error('packed WASM compression round-trip failed');
    }
    const boundedInput = new TextEncoder().encode(
      (
        '<article class="oathdoc-root">' +
        '<section class="oathdoc-clause">' +
        'Auditable terms, transitions, and exact style state.' +
        '</section></article>\\n'
      ).repeat(20_000),
    );
    const boundedCompressed = brotliCompressSync(boundedInput);
    if (boundedCompressed.length * 256 >= boundedInput.length) {
      throw new Error('packed bounded smoke did not create a high-ratio stream');
    }
    const boundedOpened = wasm.decompress_bounded(
      boundedCompressed,
      'brotli',
      boundedInput.length,
    );
    if (
      boundedOpened.length !== boundedInput.length ||
      boundedOpened.some((byte, index) => byte !== boundedInput[index])
    ) {
      throw new Error('packed normalized bounded decompression was not exact');
    }
    const publicBoundedOpened = await publicBackend.decompressBounded(
      boundedCompressed,
      'brotli',
      boundedInput.length,
    );
    if (
      publicBoundedOpened.length !== boundedInput.length ||
      publicBoundedOpened.some((byte, index) => byte !== boundedInput[index])
    ) {
      throw new Error('packed public bounded decompression was not exact');
    }
    for (const boundedCall of [
      () =>
        wasm.decompress_bounded(
          boundedCompressed,
          'brotli',
          boundedInput.length - 1,
        ),
      () =>
        publicBackend.decompressBounded(
          boundedCompressed,
          'brotli',
          boundedInput.length - 1,
        ),
    ]) {
      let boundedRejected = false;
      try {
        await boundedCall();
      } catch {
        boundedRejected = true;
      }
      if (!boundedRejected) {
        throw new Error('packed bounded decompression accepted an undersized cap');
      }
    }
    const protectedResult = wasm.protect(
      data,
      key,
      'balanced',
      'none',
      0,
      'aes-256-gcm',
      1024,
    );
    if (
      !(protectedResult.artifact instanceof Uint8Array) ||
      !(protectedResult.shellNonce instanceof Uint8Array)
    ) {
      throw new Error('packed WASM protect returned an untyped byte field');
    }
    const inspected = wasm.inspectArtifact(protectedResult.artifact);
    if (!(inspected.shellNonce instanceof Uint8Array)) {
      throw new Error('packed WASM inspect returned an untyped nonce');
    }
    const protectedOpened = wasm.open(protectedResult.artifact, key);
    if (new TextDecoder().decode(protectedOpened) !== 'packed e2ee-client smoke') {
      throw new Error('packed WASM protect/open round-trip failed');
    }
    const mutateBase64 = (value) => {
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length === 0) throw new Error('cannot mutate empty AEAD field');
      bytes[0] ^= 1;
      return bytes.toString('base64');
    };
    const requireDecryptRejection = (ciphertext, tag, label) => {
      let rejected = false;
      try {
        wasm.decrypt(
          ciphertext,
          encrypted.nonce,
          tag,
          key,
          encrypted.algorithm,
        );
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('packed WASM accepted mutated ' + label);
    };
    requireDecryptRejection(
      mutateBase64(encrypted.ciphertext),
      encrypted.tag,
      'ciphertext',
    );
    requireDecryptRejection(
      encrypted.ciphertext,
      mutateBase64(encrypted.tag),
      'authentication tag',
    );
    if (
      typeof wasm.generate_x25519_key_pair !== 'function' ||
      typeof wasm.x25519_shared_secret !== 'function'
    ) {
      throw new Error('packed WASM is missing X25519 exports');
    }
    let rejected = false;
    try {
      wasm.x25519_shared_secret(
        new Uint8Array(32).fill(7),
        new Uint8Array(32),
      );
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('packed WASM accepts low-order X25519 input');
    const alice = wasm.generate_x25519_key_pair(new Uint8Array(32).fill(0x11));
    const bob = wasm.generate_x25519_key_pair(new Uint8Array(32).fill(0x22));
    const aliceShared = new Uint8Array(
      wasm.x25519_shared_secret(
        new Uint8Array(alice.privateKey),
        new Uint8Array(bob.publicKey),
      ),
    );
    const bobShared = new Uint8Array(
      wasm.x25519_shared_secret(
        new Uint8Array(bob.privateKey),
        new Uint8Array(alice.publicKey),
      ),
    );
    if (
      aliceShared.length !== 32 ||
      bobShared.length !== 32 ||
      aliceShared.every((byte) => byte === 0) ||
      aliceShared.some((byte, index) => byte !== bobShared[index])
    ) {
      throw new Error('packed WASM failed valid X25519 agreement symmetry');
    }
    console.log('packed e2ee-client smoke passed');
  `;
  await import('node:fs/promises').then(({ writeFile }) => writeFile(childScript, script));
  run(process.execPath, [childScript], { cwd: scratch });

  if (readdirSync(scratch).length === 0) {
    throw new Error('[package-smoke] scratch package unexpectedly disappeared');
  }
  console.log('[package-smoke] packed e2ee-client tarball passed');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
