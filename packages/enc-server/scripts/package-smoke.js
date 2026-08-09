#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformIdentifier, packageRoot } from './release-provenance.js';

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

const requiredTargets = [
  'darwin-arm64',
  'linux-x64-gnu',
  'win32-x64-msvc',
];
const args = process.argv.slice(2);
const currentPlatformOnly = args.length === 1 && args[0] === '--current-platform';
if (args.length !== 0 && !currentPlatformOnly) {
  throw new Error(`[package-smoke] unsupported arguments: ${args.join(' ')}`);
}
const platform = getPlatformIdentifier();
if (!requiredTargets.includes(platform)) {
  throw new Error(`[package-smoke] unsupported native smoke platform ${platform}`);
}
const targetsToSmoke = currentPlatformOnly ? [platform] : requiredTargets;
const npmIgnorePath = join(packageRoot, 'prebuilds', '.npmignore');
const denyAll = [
  '# Native artifacts are denied until a verified packaging mode prepares an allowlist.',
  '*',
  '',
].join('\n');

const scratch = mkdtempSync(join(tmpdir(), 'voided-enc-server-pack-'));
try {
  const prepareArgs = [join(packageRoot, 'scripts', 'prepare-prebuilds.js')];
  const prepareOptions = {};
  if (currentPlatformOnly) {
    prepareArgs.push('--current-platform-smoke');
    prepareOptions.env = {
      ...process.env,
      VOIDED_INTERNAL_CURRENT_PLATFORM_SMOKE: '1',
    };
  }
  run(process.execPath, prepareArgs, prepareOptions);
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

  const packedFiles = new Set(
    report[0].files.map((entry) => entry.path.replaceAll('\\', '/')),
  );
  const packedRoot = join(scratch, 'package');
  for (const path of [
    'LICENSE',
    'THIRD_PARTY_NOTICES',
    'dist/index.js',
    'dist/native/index.js',
    'prebuilds/manifest.json',
    ...targetsToSmoke.map((target) => `prebuilds/${target}/voided_node.node`),
    'scripts/postinstall-verify.js',
  ]) {
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
  for (const forbidden of ['crates/', 'target/', 'native/voided_node.node']) {
    if ([...packedFiles].some((path) => path.startsWith(forbidden))) {
      throw new Error(`[package-smoke] packed tarball leaked ${forbidden}`);
    }
  }

  const manifest = JSON.parse(
    readFileSync(join(packedRoot, 'prebuilds', 'manifest.json'), 'utf8'),
  );
  for (const target of targetsToSmoke) {
    const entry = manifest.targets?.[target];
    if (!entry || entry.file !== `${target}/voided_node.node`) {
      throw new Error(`[package-smoke] packed manifest omitted ${target}`);
    }
    if (!packedFiles.has(`prebuilds/${entry.file}`)) {
      throw new Error(
        `[package-smoke] manifest target ${target} is missing from the tarball`,
      );
    }
  }
  const packedNativeArtifacts = [...packedFiles]
    .filter((path) => /^prebuilds\/[^/]+\/voided_node\.node$/.test(path))
    .sort();
  const expectedNativeArtifacts = targetsToSmoke
    .map((target) => `prebuilds/${target}/voided_node.node`)
    .sort();
  if (
    packedNativeArtifacts.length !== expectedNativeArtifacts.length ||
    packedNativeArtifacts.some(
      (path, index) => path !== expectedNativeArtifacts[index],
    )
  ) {
    throw new Error(
      `[package-smoke] tarball native target set is wrong: ${packedNativeArtifacts.join(', ')}`,
    );
  }

  const childScript = join(scratch, 'smoke.mjs');
  writeFileSync(
    childScript,
    `
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const root = ${JSON.stringify(packedRoot)};
      const require = createRequire(import.meta.url);
      const api = await import(pathToFileURL(root + '/dist/index.js').href);
      const nativeEntry = await import(pathToFileURL(root + '/dist/native/index.js').href);
      for (const exportName of [
        'generateRecoveryDeck',
        'validateRecoveryDeck',
        'encodeRecoveryDeck',
        'deriveRecoveryKey',
        'wrapRootWithRecoveryKey',
        'unwrapRootWithRecoveryKey',
        'createRecoveryDeck',
        'rotateRecoveryDeck',
      ]) {
        if (!(exportName in api)) {
          throw new Error('packed server API omitted ' + exportName);
        }
      }
      const key = api.generateKey();
      const plaintext = Buffer.from('packed enc-server smoke');
      const encrypted = api.encrypt(plaintext, key);
      if (!encrypted.tag) throw new Error('missing AEAD tag');
      if (!api.decrypt(encrypted, key).equals(plaintext)) {
        throw new Error('packed native round-trip failed');
      }
      const mutateBuffer = (value) => {
        const bytes = Buffer.from(value);
        if (bytes.length === 0) throw new Error('cannot mutate empty AEAD field');
        bytes[0] ^= 1;
        return bytes;
      };
      const requireDecryptRejection = (candidate, label) => {
        let rejected = false;
        try {
          api.decrypt(candidate, key);
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error('packed native accepted mutated ' + label);
      };
      requireDecryptRejection(
        { ...encrypted, encrypted: mutateBuffer(encrypted.encrypted) },
        'ciphertext',
      );
      requireDecryptRejection(
        { ...encrypted, tag: mutateBuffer(encrypted.tag) },
        'authentication tag',
      );

      const canonicalDeck = [
        'AS', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', '10S', 'JS', 'QS', 'KS',
        'AH', '2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', '10H', 'JH', 'QH', 'KH',
        'AD', '2D', '3D', '4D', '5D', '6D', '7D', '8D', '9D', '10D', 'JD', 'QD', 'KD',
        'AC', '2C', '3C', '4C', '5C', '6C', '7C', '8C', '9C', '10C', 'JC', 'QC', 'KC',
      ];
      if (!api.validateRecoveryDeck(canonicalDeck)) {
        throw new Error('packed server Recovery Deck rejected the canonical card set');
      }
      if (
        api.validateRecoveryDeck([...canonicalDeck.slice(0, 51), canonicalDeck[0]])
      ) {
        throw new Error('packed server Recovery Deck accepted a duplicate card');
      }
      const canonicalRank = api.encodeRecoveryDeck(canonicalDeck);
      const canonicalRecoveryKey = api.deriveRecoveryKey(canonicalDeck);
      if (
        canonicalRank.toString('hex') !== '00'.repeat(29) ||
        canonicalRecoveryKey.toString('hex') !==
          '7d819b1d9cb4a0346a7e03a505e9bc6ef738518aa91ce99b04a866e436efd95c'
      ) {
        throw new Error('packed server Recovery Deck changed a permanent vector');
      }
      const cjsApi = require(root + '/dist/index.cjs');
      const cjsNative = require(root + '/dist/native/index.cjs');
      if (
        typeof cjsApi.deriveRecoveryKey !== 'function' ||
        typeof cjsApi.rotateRecoveryDeck !== 'function' ||
        typeof cjsNative.getNative !== 'function' ||
        cjsApi.deriveRecoveryKey(canonicalDeck).toString('hex') !==
          canonicalRecoveryKey.toString('hex')
      ) {
        throw new Error('packed server CommonJS entry points are incomplete');
      }
      const recoveryRoot = Buffer.alloc(32, 0x5a);
      const directRecoveryWrapper = api.wrapRootWithRecoveryKey(
        recoveryRoot,
        canonicalRecoveryKey,
      );
      if (
        directRecoveryWrapper.length !== 80 ||
        !api.unwrapRootWithRecoveryKey(
          directRecoveryWrapper,
          canonicalRecoveryKey,
        ).equals(recoveryRoot)
      ) {
        throw new Error('packed server Recovery Deck root wrapping failed');
      }
      const wrongDeck = [...canonicalDeck];
      [wrongDeck[0], wrongDeck[1]] = [wrongDeck[1], wrongDeck[0]];
      const wrongRecoveryKey = api.deriveRecoveryKey(wrongDeck);
      let wrongDeckRejected = false;
      try {
        api.unwrapRootWithRecoveryKey(directRecoveryWrapper, wrongRecoveryKey);
      } catch {
        wrongDeckRejected = true;
      }
      if (!wrongDeckRejected) {
        throw new Error('packed server Recovery Deck accepted the wrong deck');
      }
      const recoverySetup = api.createRecoveryDeck(recoveryRoot);
      const setupRecoveryKey = api.deriveRecoveryKey(recoverySetup.deck);
      if (
        !api.validateRecoveryDeck(recoverySetup.deck) ||
        recoverySetup.rootWrapper.length !== 80 ||
        !api.unwrapRootWithRecoveryKey(
          recoverySetup.rootWrapper,
          setupRecoveryKey,
        ).equals(recoveryRoot)
      ) {
        throw new Error('packed server Recovery Deck setup failed');
      }
      const rotatedRecovery = api.rotateRecoveryDeck(
        recoverySetup.rootWrapper,
        recoverySetup.deck,
      );
      const rotatedRecoveryKey = api.deriveRecoveryKey(rotatedRecovery.deck);
      if (
        !api.validateRecoveryDeck(rotatedRecovery.deck) ||
        !api.unwrapRootWithRecoveryKey(
          rotatedRecovery.rootWrapper,
          rotatedRecoveryKey,
        ).equals(recoveryRoot)
      ) {
        throw new Error('packed server Recovery Deck rotation changed the stable root');
      }
      let oldDeckRejected = false;
      try {
        api.unwrapRootWithRecoveryKey(
          rotatedRecovery.rootWrapper,
          setupRecoveryKey,
        );
      } catch {
        oldDeckRejected = true;
      }
      if (!oldDeckRejected) {
        throw new Error('packed server Recovery Deck rotation accepted the old deck');
      }
      for (const bytes of [
        canonicalRank,
        canonicalRecoveryKey,
        recoveryRoot,
        directRecoveryWrapper,
        wrongRecoveryKey,
        recoverySetup.rootWrapper,
        setupRecoveryKey,
        rotatedRecovery.rootWrapper,
        rotatedRecoveryKey,
      ]) {
        bytes.fill(0);
      }
      recoverySetup.deck.fill('');
      rotatedRecovery.deck.fill('');

      const binding = nativeEntry.getNative();
      let rejected = false;
      try {
        binding.x25519SharedSecret(Buffer.alloc(32, 7), Buffer.alloc(32));
      } catch {
        rejected = true;
      }
      if (!rejected) throw new Error('packed native accepts low-order X25519 input');
      const alice = binding.generateX25519KeyPair(Buffer.alloc(32, 0x11));
      const bob = binding.generateX25519KeyPair(Buffer.alloc(32, 0x22));
      const aliceShared = binding.x25519SharedSecret(alice.privateKey, bob.publicKey);
      const bobShared = binding.x25519SharedSecret(bob.privateKey, alice.publicKey);
      if (
        aliceShared.length !== 32 ||
        bobShared.length !== 32 ||
        aliceShared.every((byte) => byte === 0) ||
        !aliceShared.equals(bobShared)
      ) {
        throw new Error('packed native failed valid X25519 agreement symmetry');
      }
      console.log('packed enc-server smoke passed');
    `,
  );
  run(process.execPath, [childScript], { cwd: scratch });
  console.log('[package-smoke] packed enc-server tarball passed');
} finally {
  try {
    if (currentPlatformOnly) {
      writeFileSync(npmIgnorePath, denyAll);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
