import { inspectCanonicalBase64 } from '../base64-validation';

export const WASM_PLAINTEXT_MAX_BYTES = 100 * 1024 * 1024;
export const WASM_BOUNDED_DECOMPRESSION_MAX_BYTES = 512 * 1024 * 1024;
export const WASM_ARTIFACT_MAX_BYTES = 140 * 1024 * 1024;
export const WASM_RAW_MAX_BYTES = 16 * 1024 * 1024;
export const WASM_KDF_INPUT_MAX_BYTES = 1024 * 1024;
export const WASM_CONTEXT_MAX_BYTES = 1024;
export const WASM_CHUNK_MAX_BYTES = 1024 * 1024;
export const WASM_HKDF_MAX_OUTPUT_BYTES = 255 * 32;

const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)?.get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'length',
)?.get;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
)?.get;
const HAS_OWN_PROPERTY = Object.prototype.hasOwnProperty;

function hasIntrinsicTypedArrayLength(value: object): boolean {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'length');
    if (descriptor) {
      return (
        descriptor.get === TYPED_ARRAY_LENGTH_GETTER &&
        descriptor.set === undefined
      );
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}

export function assertAggregateBytes(
  label: string,
  maxBytes: number,
  ...lengths: number[]
): void {
  let total = 0;
  for (const length of lengths) {
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes - total) {
      throw new Error(`[voided-wasm] ${label} exceeds its size limit`);
    }
    total += length;
  }
}

export function callAfterPreflight<T>(
  preflight: () => void,
  rawCall: () => T,
  postflight?: (value: T) => T,
): T {
  preflight();
  const result = rawCall();
  return postflight ? postflight(result) : result;
}

export function assertBytes(
  value: unknown,
  label: string,
  maxBytes: number,
  minBytes = 0,
): number {
  if (
    !TYPED_ARRAY_BYTE_LENGTH_GETTER ||
    !TYPED_ARRAY_LENGTH_GETTER ||
    !TYPED_ARRAY_TAG_GETTER
  ) {
    throw new Error(`[voided-wasm] ${label} must be a Uint8Array`);
  }
  let length: number;
  try {
    if (Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) !== 'Uint8Array') {
      throw new Error('wrong typed-array brand');
    }
    length = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
    if (
      Reflect.apply(HAS_OWN_PROPERTY, value, ['length']) ||
      !hasIntrinsicTypedArrayLength(value as object) ||
      Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) !== length
    ) {
      throw new Error('shadowed typed-array length');
    }
  } catch {
    throw new Error(`[voided-wasm] ${label} must be a valid Uint8Array`);
  }
  if (length < minBytes || length > maxBytes) {
    throw new Error(
      `[voided-wasm] ${label} must contain between ${minBytes} and ${maxBytes} bytes`,
    );
  }
  return length;
}

export function assertExactBytes(
  value: unknown,
  label: string,
  expectedBytes: number,
): number {
  const length = assertBytes(value, label, expectedBytes);
  if (length !== expectedBytes) {
    throw new Error(
      `[voided-wasm] ${label} must contain exactly ${expectedBytes} bytes`,
    );
  }
  return length;
}

export function assertSafeInteger(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `[voided-wasm] ${label} must be a safe integer from ${min} to ${max}`,
    );
  }
  return value;
}

export function assertCanonicalBase64(
  value: unknown,
  label: string,
  maxDecodedBytes: number,
  exactDecodedBytes?: number,
): number {
  const inspected = inspectCanonicalBase64(value, maxDecodedBytes);
  if (!inspected.ok) {
    const reason =
      inspected.reason === 'too-large'
        ? 'exceeds its size limit'
        : 'must be canonical padded base64';
    throw new Error(`[voided-wasm] ${label} ${reason}`);
  }
  if (
    exactDecodedBytes !== undefined &&
    inspected.decodedLength !== exactDecodedBytes
  ) {
    throw new Error(
      `[voided-wasm] ${label} must decode to exactly ${exactDecodedBytes} bytes`,
    );
  }
  return inspected.decodedLength;
}

export function assertCanonicalLowerHex(
  value: unknown,
  label: string,
  maxDecodedBytes: number,
  exactDecodedBytes?: number,
): number {
  if (
    typeof value !== 'string' ||
    value.length > maxDecodedBytes * 2 ||
    value.length % 2 !== 0
  ) {
    throw new Error(
      `[voided-wasm] ${label} must be canonical lowercase hexadecimal within its size limit`,
    );
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      !(
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x61 && code <= 0x66)
      )
    ) {
      throw new Error(
        `[voided-wasm] ${label} must be canonical lowercase hexadecimal within its size limit`,
      );
    }
  }
  const decodedLength = value.length / 2;
  if (
    exactDecodedBytes !== undefined &&
    decodedLength !== exactDecodedBytes
  ) {
    throw new Error(
      `[voided-wasm] ${label} must decode to exactly ${exactDecodedBytes} bytes`,
    );
  }
  return decodedLength;
}

export function assertUtf8String(
  value: unknown,
  label: string,
  maxBytes: number,
  minBytes = 0,
): number {
  if (typeof value !== 'string') {
    throw new Error(`[voided-wasm] ${label} must be a string`);
  }
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > maxBytes) break;
  }
  if (bytes < minBytes || bytes > maxBytes) {
    throw new Error(
      `[voided-wasm] ${label} must contain between ${minBytes} and ${maxBytes} UTF-8 bytes`,
    );
  }
  return bytes;
}

export function assertOneOf<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): asserts value is T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`[voided-wasm] ${label} is unsupported`);
  }
}

export function authenticatedAlgorithm(value?: string): 'xchacha20-poly1305' | 'aes-256-gcm' {
  const algorithm = value ?? 'xchacha20-poly1305';
  assertOneOf(algorithm, 'authenticated encryption algorithm', [
    'xchacha20-poly1305',
    'aes-256-gcm',
  ] as const);
  return algorithm;
}

export function hashAlgorithm(value?: string): 'sha256' | 'sha512' {
  const algorithm = value ?? 'sha256';
  assertOneOf(algorithm, 'hash algorithm', ['sha256', 'sha512'] as const);
  return algorithm;
}

export function compressionAlgorithm(
  value?: string,
): 'gzip' | 'brotli' | 'none' {
  const algorithm = value ?? 'brotli';
  assertOneOf(algorithm, 'compression algorithm', [
    'gzip',
    'brotli',
    'none',
  ] as const);
  return algorithm;
}

export function fusedPreset(
  value?: string,
): 'compact' | 'balanced' | 'concealed' {
  const preset = value ?? 'balanced';
  assertOneOf(preset, 'fused preset', [
    'compact',
    'balanced',
    'concealed',
  ] as const);
  return preset;
}

export function compressionLevel(
  algorithm: 'gzip' | 'brotli' | 'none',
  value?: number,
): number {
  const level = value ?? 6;
  const max = algorithm === 'gzip' ? 9 : algorithm === 'brotli' ? 11 : 6;
  const min = algorithm === 'none' && level !== 6 ? 0 : 0;
  assertSafeInteger(level, 'compression level', min, max);
  if (algorithm === 'none' && level !== 0 && level !== 6) {
    throw new Error('[voided-wasm] compression level is invalid for none');
  }
  return level;
}

export function optionalChunkSize(value?: number): number | undefined {
  if (value === undefined) return undefined;
  return assertSafeInteger(value, 'shell chunk size', 1, WASM_CHUNK_MAX_BYTES);
}

export function pbkdfParameters(
  input: unknown,
  salt: unknown,
  iterations: unknown,
): void {
  assertBytes(input, 'PBKDF2 input', WASM_KDF_INPUT_MAX_BYTES, 1);
  assertBytes(salt, 'PBKDF2 salt', 1024, 16);
  assertSafeInteger(iterations, 'PBKDF2 iterations', 100_000, 1_000_000);
}

export function validateEncryptionResult(
  value: unknown,
  expectedAlgorithm: 'xchacha20-poly1305' | 'aes-256-gcm',
): any {
  if (!value || typeof value !== 'object') {
    throw new Error('[voided-wasm] encryption result must be an object');
  }
  const result = value as Record<string, unknown>;
  if (result.algorithm !== expectedAlgorithm) {
    throw new Error('[voided-wasm] encryption result algorithm mismatch');
  }
  assertCanonicalBase64(
    result.ciphertext,
    'ciphertext',
    WASM_PLAINTEXT_MAX_BYTES,
  );
  assertCanonicalBase64(
    result.nonce,
    'nonce',
    expectedAlgorithm === 'xchacha20-poly1305' ? 24 : 12,
    expectedAlgorithm === 'xchacha20-poly1305' ? 24 : 12,
  );
  assertCanonicalBase64(result.tag, 'authentication tag', 16, 16);
  return value;
}

export function validateHashResult(
  value: unknown,
  algorithm: 'sha256' | 'sha512',
  label = 'hash result',
): string {
  assertCanonicalLowerHex(
    value,
    label,
    algorithm === 'sha256' ? 32 : 64,
    algorithm === 'sha256' ? 32 : 64,
  );
  return value as string;
}

export function validateBytesResult(
  value: unknown,
  label: string,
  maxBytes: number,
  exactBytes?: number,
): Uint8Array {
  if (exactBytes === undefined) assertBytes(value, label, maxBytes);
  else assertExactBytes(value, label, exactBytes);
  return value as Uint8Array;
}

function metadataInteger(
  value: unknown,
  label: string,
  max: number,
): number {
  return assertSafeInteger(value, label, 0, max);
}

export function validateCompressionResult(
  value: unknown,
  inputLength: number,
  requestedAlgorithm: 'gzip' | 'brotli' | 'none',
): any {
  if (!value || typeof value !== 'object') {
    throw new Error('[voided-wasm] compression result must be an object');
  }
  const result = value as Record<string, unknown>;
  assertOneOf(result.algorithm, 'returned compression algorithm', [
    'gzip',
    'brotli',
    'none',
  ] as const);
  if (
    result.algorithm !== requestedAlgorithm &&
    result.algorithm !== 'none'
  ) {
    throw new Error('[voided-wasm] compression result algorithm mismatch');
  }
  const compressedLength = assertBytes(
    result.compressed,
    'compressed result',
    WASM_PLAINTEXT_MAX_BYTES,
  );
  if (
    metadataInteger(
      result.originalSize,
      'compression original size',
      WASM_PLAINTEXT_MAX_BYTES,
    ) !== inputLength ||
    metadataInteger(
      result.compressedSize,
      'compression output size',
      WASM_PLAINTEXT_MAX_BYTES,
    ) !== compressedLength
  ) {
    throw new Error('[voided-wasm] compression metadata size mismatch');
  }
  if (
    typeof result.compressionRatio !== 'number' ||
    !Number.isFinite(result.compressionRatio) ||
    result.compressionRatio < 0
  ) {
    throw new Error('[voided-wasm] compression ratio is invalid');
  }
  return value;
}

export function validateFusedShellInfo(
  value: unknown,
  shellLength: number,
): any {
  if (!value || typeof value !== 'object') {
    throw new Error('[voided-wasm] fused shell metadata must be an object');
  }
  const info = value as Record<string, unknown>;
  assertSafeInteger(info.version, 'fused shell version', 1, 255);
  assertOneOf(info.preset, 'returned fused preset', [
    'compact',
    'balanced',
    'concealed',
  ] as const);
  assertSafeInteger(info.chunkSize, 'fused shell chunk size', 1, WASM_CHUNK_MAX_BYTES);
  metadataInteger(info.chunkCount, 'fused shell chunk count', Number.MAX_SAFE_INTEGER);
  const payload = metadataInteger(
    info.payloadSize,
    'fused shell payload size',
    WASM_PLAINTEXT_MAX_BYTES,
  );
  const metadata = metadataInteger(
    info.metadataSize,
    'fused shell metadata size',
    WASM_ARTIFACT_MAX_BYTES,
  );
  const tag = metadataInteger(
    info.tagSize,
    'fused shell tag size',
    WASM_ARTIFACT_MAX_BYTES,
  );
  const shell = metadataInteger(
    info.shellSize,
    'fused shell size',
    WASM_ARTIFACT_MAX_BYTES,
  );
  if (
    shell !== shellLength ||
    payload + metadata + tag !== shell ||
    !Number.isSafeInteger(payload + metadata + tag)
  ) {
    throw new Error('[voided-wasm] fused shell metadata size mismatch');
  }
  return value;
}

export function validateArtifactInfo(
  value: unknown,
  artifactLength: number,
): any {
  if (!value || typeof value !== 'object') {
    throw new Error('[voided-wasm] protected artifact metadata must be an object');
  }
  const info = value as Record<string, unknown>;
  assertSafeInteger(info.version, 'protected artifact version', 1, 255);
  assertOneOf(info.preset, 'returned fused preset', [
    'compact',
    'balanced',
    'concealed',
  ] as const);
  assertOneOf(info.compressionAlgorithm, 'returned compression algorithm', [
    'gzip',
    'brotli',
    'none',
  ] as const);
  assertOneOf(info.encryptionAlgorithm, 'returned encryption algorithm', [
    'xchacha20-poly1305',
    'aes-256-gcm',
  ] as const);
  metadataInteger(
    info.originalSize,
    'protected artifact original size',
    WASM_PLAINTEXT_MAX_BYTES,
  );
  metadataInteger(
    info.compressedSize,
    'protected artifact compressed size',
    WASM_PLAINTEXT_MAX_BYTES,
  );
  metadataInteger(
    info.encryptedSize,
    'protected artifact encrypted size',
    WASM_ARTIFACT_MAX_BYTES,
  );
  if (
    metadataInteger(
      info.protectedSize,
      'protected artifact size',
      WASM_ARTIFACT_MAX_BYTES,
    ) !== artifactLength
  ) {
    throw new Error('[voided-wasm] protected artifact size metadata mismatch');
  }
  assertSafeInteger(
    info.shellChunkSize,
    'protected artifact shell chunk size',
    1,
    WASM_CHUNK_MAX_BYTES,
  );
  metadataInteger(
    info.shellChunkCount,
    'protected artifact shell chunk count',
    Number.MAX_SAFE_INTEGER,
  );
  assertExactBytes(info.shellNonce, 'protected artifact shell nonce', 12);
  return value;
}

export function validateProtectResult(
  value: unknown,
  originalLength: number,
): any {
  if (!value || typeof value !== 'object') {
    throw new Error('[voided-wasm] protect result must be an object');
  }
  const result = value as Record<string, unknown>;
  const artifactLength = assertBytes(
    result.artifact,
    'protected artifact result',
    WASM_ARTIFACT_MAX_BYTES,
  );
  validateArtifactInfo(value, artifactLength);
  if (result.originalSize !== originalLength) {
    throw new Error('[voided-wasm] protect result original size mismatch');
  }
  return value;
}
