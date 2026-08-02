#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path';
import {
  digestFile,
  digestFiles,
  digestText,
  getCargoWorkspaceSnapshotFiles,
  getCoreVersion,
  getNativeBindingVersion,
  getNativeLibraryFileName,
  getNativeSourceFiles,
  getPlatformIdentifier,
  packageRoot,
  readJson,
  workspaceRoot,
} from './release-provenance.js';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `[build-native] ${command} ${args.join(' ')} failed\n` +
        `${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  return result.stdout?.trim() ?? '';
}

function assertCargoHomeHasNoConfiguration() {
  const configuredCargoHome = process.env.CARGO_HOME;
  if (configuredCargoHome && !isAbsolute(configuredCargoHome)) {
    throw new Error('[build-native] CARGO_HOME must be absolute for a release build');
  }
  const cargoHome = configuredCargoHome ?? join(homedir(), '.cargo');
  for (const name of ['config', 'config.toml']) {
    const configPath = join(cargoHome, name);
    if (existsSync(configPath)) {
      throw new Error(
        `[build-native] Cargo-home configuration is an unbound build input: ${configPath}. ` +
          'Use a clean CARGO_HOME on the trusted release runner.',
      );
    }
  }
}

function resolveExecutable(name) {
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        // Preserve the executable basename. rustup dispatches its cargo/rustc
        // symlinks based on argv[0], while digestFile still hashes the target.
        return candidate;
      } catch {
        // Continue to the next exact executable candidate.
      }
    }
  }
  throw new Error(`[build-native] required executable is missing: ${name}`);
}

function assertWindowsX64Dll(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 0x100 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error('[build-native] Windows artifact is not a PE executable');
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (
    peOffset + 24 > bytes.length ||
    bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0'
  ) {
    throw new Error('[build-native] Windows artifact has an invalid PE header');
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  const characteristics = bytes.readUInt16LE(peOffset + 22);
  const optionalHeaderMagic = bytes.readUInt16LE(peOffset + 24);
  if (machine !== 0x8664) {
    throw new Error('[build-native] Windows artifact is not x86_64');
  }
  if ((characteristics & 0x2000) === 0) {
    throw new Error('[build-native] Windows artifact is not marked as a DLL');
  }
  if (optionalHeaderMagic !== 0x20b) {
    throw new Error('[build-native] Windows artifact is not PE32+');
  }
}

function canonicalizeWindowsCodeViewGuid(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 0x100 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error('[build-native] Windows artifact is not a PE executable');
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (
    peOffset + 24 > bytes.length ||
    bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0'
  ) {
    throw new Error('[build-native] Windows artifact has an invalid PE header');
  }

  const sectionCount = bytes.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = bytes.readUInt16LE(peOffset + 20);
  const optionalHeader = peOffset + 24;
  const sectionTable = optionalHeader + optionalHeaderSize;
  if (
    optionalHeaderSize < 112 + 7 * 8 ||
    sectionTable + sectionCount * 40 > bytes.length ||
    bytes.readUInt16LE(optionalHeader) !== 0x20b
  ) {
    throw new Error('[build-native] Windows artifact has an invalid PE32+ header');
  }

  const debugDirectoryEntry = optionalHeader + 112 + 6 * 8;
  const debugRva = bytes.readUInt32LE(debugDirectoryEntry);
  const debugSize = bytes.readUInt32LE(debugDirectoryEntry + 4);
  if (debugRva === 0 || debugSize === 0 || debugSize % 28 !== 0) {
    throw new Error('[build-native] Windows artifact has no valid debug directory');
  }

  function rvaToFileOffset(rva, size) {
    for (let index = 0; index < sectionCount; index += 1) {
      const section = sectionTable + index * 40;
      const virtualSize = bytes.readUInt32LE(section + 8);
      const virtualAddress = bytes.readUInt32LE(section + 12);
      const rawSize = bytes.readUInt32LE(section + 16);
      const rawOffset = bytes.readUInt32LE(section + 20);
      const mappedSize = Math.max(virtualSize, rawSize);
      if (
        rva >= virtualAddress &&
        rva + size <= virtualAddress + mappedSize &&
        rawOffset + (rva - virtualAddress) + size <= bytes.length
      ) {
        return rawOffset + (rva - virtualAddress);
      }
    }
    throw new Error('[build-native] Windows debug RVA is outside all sections');
  }

  const debugOffset = rvaToFileOffset(debugRva, debugSize);
  let guidOffset = null;
  for (let offset = debugOffset; offset < debugOffset + debugSize; offset += 28) {
    const type = bytes.readUInt32LE(offset + 12);
    if (type !== 2) continue;
    const dataSize = bytes.readUInt32LE(offset + 16);
    const dataOffset = bytes.readUInt32LE(offset + 24);
    if (
      dataSize < 24 ||
      dataOffset + dataSize > bytes.length ||
      bytes.toString('ascii', dataOffset, dataOffset + 4) !== 'RSDS' ||
      guidOffset !== null
    ) {
      throw new Error('[build-native] Windows artifact has invalid CodeView data');
    }
    guidOffset = dataOffset + 4;
  }
  if (guidOffset === null) {
    throw new Error('[build-native] Windows artifact is missing CodeView data');
  }

  const canonicalBytes = Buffer.from(bytes);
  canonicalBytes.fill(0, guidOffset, guidOffset + 16);
  const guid = createHash('sha256')
    .update(canonicalBytes)
    .digest()
    .subarray(0, 16);
  guid[6] = (guid[6] & 0x0f) | 0x50;
  guid[8] = (guid[8] & 0x3f) | 0x80;
  guid.copy(bytes, guidOffset);
  writeFileSync(path, bytes);
}

function canonicalizeMachOUuid(path) {
  const bytes = readFileSync(path);
  const machO64LittleEndian = 0xfeedfacf;
  const lcIdDylib = 0x0d;
  const lcUuid = 0x1b;
  const lcCodeSignature = 0x1d;
  const headerSize = 32;
  if (bytes.length < headerSize || bytes.readUInt32LE(0) !== machO64LittleEndian) {
    throw new Error('[build-native] Darwin artifact is not a 64-bit Mach-O binary');
  }

  const commandCount = bytes.readUInt32LE(16);
  const commandsSize = bytes.readUInt32LE(20);
  const commandsEnd = headerSize + commandsSize;
  if (commandsEnd > bytes.length) {
    throw new Error('[build-native] Darwin artifact has invalid load commands');
  }

  let commandOffset = headerSize;
  let dylibIdName = null;
  let uuidOffset = null;
  let codeSignature = null;
  for (let index = 0; index < commandCount; index += 1) {
    if (commandOffset + 8 > commandsEnd) {
      throw new Error('[build-native] Darwin load-command table is truncated');
    }
    const command = bytes.readUInt32LE(commandOffset);
    const commandSize = bytes.readUInt32LE(commandOffset + 4);
    if (commandSize < 8 || commandOffset + commandSize > commandsEnd) {
      throw new Error('[build-native] Darwin artifact has an invalid load command');
    }
    if (command === lcUuid) {
      if (commandSize !== 24 || uuidOffset !== null) {
        throw new Error('[build-native] Darwin artifact has an invalid LC_UUID');
      }
      uuidOffset = commandOffset + 8;
    }
    if (command === lcIdDylib) {
      const nameOffset = bytes.readUInt32LE(commandOffset + 8);
      if (
        commandSize < 24 ||
        nameOffset < 24 ||
        nameOffset >= commandSize ||
        dylibIdName !== null
      ) {
        throw new Error('[build-native] Darwin artifact has an invalid LC_ID_DYLIB');
      }
      dylibIdName = {
        offset: commandOffset + nameOffset,
        size: commandSize - nameOffset,
      };
    }
    if (command === lcCodeSignature) {
      if (commandSize !== 16 || codeSignature !== null) {
        throw new Error('[build-native] Darwin artifact has an invalid code signature');
      }
      codeSignature = {
        offset: bytes.readUInt32LE(commandOffset + 8),
        size: bytes.readUInt32LE(commandOffset + 12),
      };
    }
    commandOffset += commandSize;
  }
  if (uuidOffset === null) {
    throw new Error('[build-native] Darwin artifact is missing LC_UUID');
  }
  if (dylibIdName === null) {
    throw new Error('[build-native] Darwin artifact is missing LC_ID_DYLIB');
  }
  if (
    codeSignature === null ||
    codeSignature.offset + codeSignature.size > bytes.length
  ) {
    throw new Error('[build-native] Darwin artifact has an invalid code-signature range');
  }

  const canonicalDylibId = Buffer.from('@rpath/voided_node.node\0');
  if (canonicalDylibId.length > dylibIdName.size) {
    throw new Error('[build-native] Darwin LC_ID_DYLIB has insufficient space');
  }
  bytes.fill(0, dylibIdName.offset, dylibIdName.offset + dylibIdName.size);
  canonicalDylibId.copy(bytes, dylibIdName.offset);

  const canonicalBytes = Buffer.from(bytes);
  canonicalBytes.fill(0, uuidOffset, uuidOffset + 16);
  canonicalBytes.fill(
    0,
    codeSignature.offset,
    codeSignature.offset + codeSignature.size,
  );
  const uuid = createHash('sha256')
    .update(canonicalBytes)
    .digest()
    .subarray(0, 16);
  uuid[6] = (uuid[6] & 0x0f) | 0x50;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  uuid.copy(bytes, uuidOffset);
  writeFileSync(path, bytes);
}

function copyCargoWorkspaceSnapshot(snapshotWorkspaceRoot) {
  const sourceFiles = getCargoWorkspaceSnapshotFiles();
  for (const sourcePath of sourceFiles) {
    const relativePath = relative(workspaceRoot, sourcePath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`[build-native] release input escaped the workspace: ${sourcePath}`);
    }
    const metadata = lstatSync(sourcePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`[build-native] release input is not a regular file: ${sourcePath}`);
    }
    const destination = join(snapshotWorkspaceRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(sourcePath, destination);
  }
}

const prebuildsRoot = join(packageRoot, 'prebuilds');
mkdirSync(prebuildsRoot, { recursive: true });
writeFileSync(
  join(prebuildsRoot, '.npmignore'),
  '# Build in progress or not yet verified. No native artifact may be packed.\n*\n',
);

const scratch = mkdtempSync(join(tmpdir(), 'voided-native-build-'));
try {
  assertCargoHomeHasNoConfiguration();
  const sourceFiles = getNativeSourceFiles();
  const sourceDigestBefore = digestFiles(sourceFiles);
  const snapshotWorkspaceRoot = join(scratch, 'workspace');
  copyCargoWorkspaceSnapshot(snapshotWorkspaceRoot);
  const snapshotSourceFiles = sourceFiles.map((sourcePath) =>
    join(snapshotWorkspaceRoot, relative(workspaceRoot, sourcePath)),
  );
  const snapshotSourceDigest = digestFiles(
    snapshotSourceFiles,
    snapshotWorkspaceRoot,
  );
  if (snapshotSourceDigest !== sourceDigestBefore) {
    throw new Error('[build-native] copied source snapshot does not match live source');
  }
  const snapshotCratesRoot = join(snapshotWorkspaceRoot, 'crates');
  const args = process.argv.slice(2);
  let requestedPlatform = null;
  if (args.length === 1 && args[0].startsWith('--target=')) {
    requestedPlatform = args[0].slice('--target='.length);
  } else if (args.length !== 0) {
    throw new Error(`[build-native] unsupported arguments: ${args.join(' ')}`);
  }
  const hostPlatform = getPlatformIdentifier();
  const platform = requestedPlatform ?? hostPlatform;
  const supportedTargets = new Set([
    'darwin-arm64',
    'linux-x64-gnu',
    'win32-x64-msvc',
  ]);
  if (!supportedTargets.has(platform)) {
    throw new Error(`[build-native] unsupported release target: ${platform}`);
  }
  const crossWindows =
    platform === 'win32-x64-msvc' && hostPlatform !== 'win32-x64-msvc';
  if (requestedPlatform && !crossWindows) {
    throw new Error(
      `[build-native] cross-release mode only supports win32-x64-msvc; host is ${hostPlatform}`,
    );
  }
  const cargoTargetDir = join(scratch, 'cargo-target');
  const cargoPath = resolveExecutable('cargo');
  const rustcPath = resolveExecutable('rustc');
  const cargoXwinPath = crossWindows ? resolveExecutable('cargo-xwin') : null;
  const codesignPath = platform === 'darwin-arm64'
    ? resolveExecutable('codesign')
    : null;
  const cargoVersion = run(cargoPath, ['--version']);
  const rustcVersion = run(rustcPath, ['--version']);
  const cargoXwinVersion = crossWindows
    ? run(cargoXwinPath, ['--version'])
    : null;

  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
  const rustupHome = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');
  const toolDirectories = [
    dirname(cargoPath),
    dirname(rustcPath),
    ...(cargoXwinPath ? [dirname(cargoXwinPath)] : []),
    ...(codesignPath ? [dirname(codesignPath)] : []),
    dirname(process.execPath),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  const remapFlags = [
    `--remap-path-prefix=${snapshotWorkspaceRoot}=/voided-source`,
    `--remap-path-prefix=${scratch}=/voided-build`,
    `--remap-path-prefix=${cargoHome}=/cargo-home`,
    `--remap-path-prefix=${rustupHome}=/rustup-home`,
  ];
  const releaseEnvironment = {
    PATH: [...new Set(toolDirectories)].join(delimiter),
    HOME: homedir(),
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    CARGO_TARGET_DIR: cargoTargetDir,
    CARGO_INCREMENTAL: '0',
    CARGO_NET_OFFLINE: 'true',
    RUSTC: rustcPath,
    RUSTFLAGS: remapFlags.join(' '),
    SOURCE_DATE_EPOCH: '0',
    TZ: 'UTC',
    LANG: 'C',
    LC_ALL: 'C',
    ZERO_AR_DATE: '1',
  };

  console.log(`[build-native] ${platform} source ${sourceDigestBefore}`);
  const cargoArgs = crossWindows
    ? [
        'xwin',
        'build',
        '--offline',
        '--locked',
        '--release',
        '-p',
        'voided-node',
        '--target',
        'x86_64-pc-windows-msvc',
      ]
    : ['build', '--offline', '--locked', '--release', '-p', 'voided-node'];
  run(cargoPath, cargoArgs, {
    cwd: snapshotCratesRoot,
    env: releaseEnvironment,
    stdio: 'inherit',
  });

  if (digestFiles(getNativeSourceFiles()) !== sourceDigestBefore) {
    throw new Error('[build-native] security-relevant source changed during the build');
  }

  const outputDirectory = crossWindows
    ? join(cargoTargetDir, 'x86_64-pc-windows-msvc', 'release')
    : join(cargoTargetDir, 'release');
  const libraryFileName = crossWindows
    ? 'voided_node.dll'
    : getNativeLibraryFileName();
  const source = join(outputDirectory, libraryFileName);
  if (!existsSync(source)) {
    throw new Error(`[build-native] expected Cargo output is missing: ${source}`);
  }

  const platformDir = join(packageRoot, 'prebuilds', platform);
  const destination = join(platformDir, 'voided_node.node');
  mkdirSync(platformDir, { recursive: true });
  const temporaryDestination = join(platformDir, '.voided_node.node.new');
  copyFileSync(source, temporaryDestination);
  if (platform === 'darwin-arm64') {
    canonicalizeMachOUuid(temporaryDestination);
    run(codesignPath, ['--sign', '-', '--force', temporaryDestination]);
    run(codesignPath, ['--verify', '--strict', temporaryDestination]);
  }
  if (crossWindows) {
    canonicalizeWindowsCodeViewGuid(temporaryDestination);
  }
  renameSync(temporaryDestination, destination);

  const expectedCoreVersion = getCoreVersion();
  if (crossWindows) {
    assertWindowsX64Dll(destination);
  } else {
    const require = createRequire(import.meta.url);
    const binding = require(destination);
    if (binding.VERSION !== expectedCoreVersion) {
      throw new Error(
        `[build-native] binding reports core ${binding.VERSION}; expected ${expectedCoreVersion}`,
      );
    }
    const key = binding.generateKey();
    const plaintext = Buffer.from('voided native release smoke');
    const encrypted = binding.encrypt(plaintext, key, 'aes-256-gcm');
    if (!encrypted.tag) {
      throw new Error('[build-native] native encryption omitted AEAD tag');
    }
    if (!binding.decrypt(encrypted, key).equals(plaintext)) {
      throw new Error('[build-native] native encryption round-trip failed');
    }
    let rejectedLowOrderPoint = false;
    try {
      binding.x25519SharedSecret(Buffer.alloc(32, 7), Buffer.alloc(32));
    } catch {
      rejectedLowOrderPoint = true;
    }
    if (!rejectedLowOrderPoint) {
      throw new Error('[build-native] native artifact accepts low-order X25519 input');
    }
  }

  const artifactSha256 = digestFile(destination);
  const artifactSize = statSync(destination).size;
  const buildId = digestText(
    [
      platform,
      sourceDigestBefore,
      artifactSha256,
      String(artifactSize),
    ].join('\n'),
  );
  const manifestPath = join(packageRoot, 'prebuilds', 'manifest.json');
  let manifest = {
    schemaVersion: 1,
    package: '@voideddev/enc-server',
    packageVersion: readJson(join(packageRoot, 'package.json')).version,
    targets: {},
  };
  if (existsSync(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (existing.schemaVersion === 1 && existing.package === manifest.package) {
      manifest = existing;
      manifest.packageVersion = readJson(join(packageRoot, 'package.json')).version;
    }
  }
  manifest.targets[platform] = {
    file: `${platform}/voided_node.node`,
    sha256: artifactSha256,
    size: artifactSize,
    sourceDigest: sourceDigestBefore,
    coreVersion: expectedCoreVersion,
    bindingVersion: getNativeBindingVersion(),
    buildId,
    tools: {
      cargo: cargoVersion,
      cargoSha256: digestFile(realpathSync(cargoPath)),
      rustc: rustcVersion,
      rustcSha256: digestFile(realpathSync(rustcPath)),
      node: process.version,
      nodeSha256: digestFile(realpathSync(process.execPath)),
      ...(cargoXwinVersion ? { cargoXwin: cargoXwinVersion } : {}),
      ...(cargoXwinPath
        ? { cargoXwinSha256: digestFile(realpathSync(cargoXwinPath)) }
        : {}),
      ...(codesignPath
        ? { codesignSha256: digestFile(realpathSync(codesignPath)) }
        : {}),
    },
    buildEnvironment: {
      cargoIncremental: '0',
      locale: 'C',
      offline: 'true',
      pathRemapBuild: '/voided-build',
      pathRemapCargoHome: '/cargo-home',
      pathRemapRustupHome: '/rustup-home',
      pathRemapSource: '/voided-source',
      machOInstallName:
        platform === 'darwin-arm64' ? '@rpath/voided_node.node' : 'not-applicable',
      machOUuid: platform === 'darwin-arm64' ? 'sha256-v5' : 'not-applicable',
      ...(platform === 'win32-x64-msvc'
        ? { peCodeViewGuid: 'sha256-v5' }
        : {}),
      sourceDateEpoch: '0',
      timezone: 'UTC',
      zeroArDate: '1',
    },
    verification: crossWindows
      ? { mode: 'cross-compiled-static-pe' }
      : { mode: 'native-runtime' },
  };
  const temporaryManifest = join(packageRoot, 'prebuilds', '.manifest.json.new');
  writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporaryManifest, manifestPath);

  console.log(`[build-native] built ${platform} ${buildId}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
