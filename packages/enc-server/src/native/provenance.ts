import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface NativeArtifactManifestEntry {
  file: string;
  sha256: string;
  size: number;
  sourceDigest: string;
  coreVersion: string;
  bindingVersion: string;
  buildId: string;
}

interface NativeArtifactManifest {
  schemaVersion: number;
  package: string;
  packageVersion: string;
  targets: Record<string, NativeArtifactManifestEntry>;
}

function sha256Bytes(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function readRegularBytes(path: string): Buffer {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(`not a regular file: ${path}`);
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function verifyPackagedNativeArtifact(
  packageRoot: string,
  platformId: string,
): {
  modulePath: string;
  manifest: NativeArtifactManifestEntry;
} {
  const manifestPath = join(packageRoot, 'prebuilds', 'manifest.json');
  let releaseManifest: NativeArtifactManifest;
  try {
    releaseManifest = JSON.parse(readRegularBytes(manifestPath).toString('utf8'));
  } catch (error) {
    throw new Error(
      `[voided-native] Native provenance manifest is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    releaseManifest.schemaVersion !== 1 ||
    releaseManifest.package !== '@voideddev/enc-server'
  ) {
    throw new Error('[voided-native] Unsupported native provenance manifest');
  }

  let packageMetadata: { version?: unknown };
  try {
    packageMetadata = JSON.parse(
      readRegularBytes(join(packageRoot, 'package.json')).toString('utf8'),
    );
  } catch {
    throw new Error('[voided-native] Package metadata is missing or invalid');
  }
  if (
    typeof packageMetadata.version !== 'string' ||
    releaseManifest.packageVersion !== packageMetadata.version
  ) {
    throw new Error('[voided-native] Native provenance package version mismatch');
  }

  const manifest = releaseManifest.targets?.[platformId];
  if (!manifest) {
    throw new Error(
      `[voided-native] No source-verified native artifact is available for ${platformId}`,
    );
  }
  if (
    manifest.file !== `${platformId}/voided_node.node` ||
    typeof manifest.sha256 !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(manifest.sha256) ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size <= 0 ||
    typeof manifest.sourceDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(manifest.sourceDigest) ||
    typeof manifest.coreVersion !== 'string' ||
    typeof manifest.bindingVersion !== 'string' ||
    typeof manifest.buildId !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(manifest.buildId)
  ) {
    throw new Error(`[voided-native] Invalid provenance entry for ${platformId}`);
  }

  const modulePath = join(packageRoot, 'prebuilds', manifest.file);
  const artifactBytes = readRegularBytes(modulePath);
  const actualSize = artifactBytes.length;
  if (actualSize !== manifest.size) {
    throw new Error(`[voided-native] Native artifact size mismatch for ${platformId}`);
  }
  const actualDigest = sha256Bytes(artifactBytes);
  if (actualDigest !== manifest.sha256) {
    throw new Error(`[voided-native] Native artifact hash mismatch for ${platformId}`);
  }
  const expectedBuildId = sha256Bytes(
    [platformId, manifest.sourceDigest, actualDigest, String(actualSize)].join('\n'),
  );
  if (expectedBuildId !== manifest.buildId) {
    throw new Error(`[voided-native] Native artifact build ID mismatch for ${platformId}`);
  }

  return { modulePath, manifest };
}
