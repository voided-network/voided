import {
  WASM_ARTIFACT_MAX_BYTES,
  WASM_BOUNDED_DECOMPRESSION_MAX_BYTES,
  WASM_PLAINTEXT_MAX_BYTES,
  assertAggregateBytes,
  assertBytes,
  assertCanonicalBase64,
  assertCanonicalLowerHex,
  authenticatedAlgorithm,
  callAfterPreflight,
  validateArtifactInfo,
  validateBytesResult,
} from '../wasm/boundary';
import { secureWasmModule } from '../wasm/secure-module';
import type { WasmModule } from '../wasm/loader';

describe('WASM loader allocation boundary', () => {
  test('rejects oversized typed arrays before invoking a raw export', () => {
    const rawExport = jest.fn();

    expect(() =>
      callAfterPreflight(
        () => assertBytes(new Uint8Array(9), 'hostile input', 8),
        rawExport,
      ),
    ).toThrow('hostile input');
    expect(rawExport).not.toHaveBeenCalled();
  });

  test('rejects spoofed typed arrays before invoking a raw export', () => {
    const rawExport = jest.fn();
    const spoofed = Object.create(Uint8Array.prototype);

    expect(() =>
      callAfterPreflight(
        () => assertBytes(spoofed, 'hostile input', 8),
        rawExport,
      ),
    ).toThrow('valid Uint8Array');
    expect(rawExport).not.toHaveBeenCalled();
  });

  test('uses intrinsic typed-array identity and length instead of shadowable properties', () => {
    const bytes = new Uint8Array(8);
    Object.defineProperty(bytes, 'byteLength', {
      value: Number.MAX_SAFE_INTEGER,
    });

    expect(assertBytes(bytes, 'real bytes', 8)).toBe(8);
    expect(() =>
      assertBytes(new Uint16Array(4), 'wrong typed array', 8),
    ).toThrow('valid Uint8Array');
  });

  test('rejects stateful length spoofing before wasm-bindgen can allocate', () => {
    const rawHash = jest.fn(() => '00'.repeat(32));
    const secure = secureWasmModule({
      hash: rawHash,
    } as unknown as WasmModule);
    const bytes = new Uint8Array([1]);
    let reads = 0;
    Object.defineProperty(bytes, 'length', {
      get: () => (++reads === 1 ? 1 : 0x7fffffff),
    });

    expect(() => secure.hash(bytes, 'sha256')).toThrow(
      'valid Uint8Array',
    );
    expect(rawHash).not.toHaveBeenCalled();
    expect(reads).toBe(0);
  });

  test('rejects aggregate working sets before invoking a raw export', () => {
    const rawExport = jest.fn();
    expect(() =>
      callAfterPreflight(
        () => assertAggregateBytes('working set', 8, 4, 4, 1),
        rawExport,
      ),
    ).toThrow('working set');
    expect(rawExport).not.toHaveBeenCalled();
  });

  test('rejects oversized or noncanonical encodings before invoking raw exports', () => {
    const rawBase64Decode = jest.fn();
    const rawHexDecode = jest.fn();

    expect(() =>
      callAfterPreflight(
        () => assertCanonicalBase64('AQID', 'encoded input', 2),
        rawBase64Decode,
      ),
    ).toThrow('size limit');
    expect(rawBase64Decode).not.toHaveBeenCalled();

    expect(() =>
      callAfterPreflight(
        () => assertCanonicalLowerHex('00FF', 'encoded input', 2),
        rawHexDecode,
      ),
    ).toThrow('canonical lowercase');
    expect(rawHexDecode).not.toHaveBeenCalled();
  });

  test('rejects unknown option strings before invoking a raw export', () => {
    const rawEncrypt = jest.fn();

    expect(() =>
      callAfterPreflight(
        () => authenticatedAlgorithm('future-but-unreviewed'),
        rawEncrypt,
      ),
    ).toThrow('unsupported');
    expect(rawEncrypt).not.toHaveBeenCalled();
  });

  test('preflights and postflights caller-bounded decompression', () => {
    const compressed = new Uint8Array([1, 2, 3]);
    const rawDecompress = jest.fn(() => new Uint8Array([4, 5, 6, 7]));
    const secure = secureWasmModule({
      decompress_bounded: rawDecompress,
    } as unknown as WasmModule);

    expect(secure.decompress_bounded(compressed, 'brotli', 4)).toEqual(
      new Uint8Array([4, 5, 6, 7]),
    );
    expect(rawDecompress).toHaveBeenCalledWith(compressed, 'brotli', 4);

    rawDecompress.mockClear();
    expect(
      secure.decompress_bounded(
        compressed,
        'brotli',
        256 * 1024 * 1024,
      ),
    ).toEqual(new Uint8Array([4, 5, 6, 7]));
    expect(rawDecompress).toHaveBeenCalledWith(
      compressed,
      'brotli',
      256 * 1024 * 1024,
    );

    rawDecompress.mockClear();
    expect(() =>
      secure.decompress_bounded(
        compressed,
        'brotli',
        WASM_BOUNDED_DECOMPRESSION_MAX_BYTES + 1,
      ),
    ).toThrow('bounded decompression output limit');
    expect(rawDecompress).not.toHaveBeenCalled();

    rawDecompress.mockReturnValue(new Uint8Array(5));
    expect(() =>
      secure.decompress_bounded(compressed, 'brotli', 4),
    ).toThrow('bounded decompressed output');
  });

  test('rejects hostile returned buffers and artifact metadata', () => {
    const rawExport = jest.fn(() => new Uint8Array(9));
    expect(() =>
      callAfterPreflight(
        () => undefined,
        rawExport,
        (value) => validateBytesResult(value, 'raw output', 8),
      ),
    ).toThrow('raw output');
    expect(rawExport).toHaveBeenCalledTimes(1);

    expect(() =>
      validateArtifactInfo(
        {
          version: 3,
          preset: 'balanced',
          compressionAlgorithm: 'none',
          encryptionAlgorithm: 'xchacha20-poly1305',
          originalSize: WASM_PLAINTEXT_MAX_BYTES + 1,
          compressedSize: 0,
          encryptedSize: 0,
          protectedSize: 16,
          shellChunkSize: 512,
          shellChunkCount: 1,
          shellNonce: new Uint8Array(12),
        },
        16,
      ),
    ).toThrow('original size');

    expect(() =>
      validateArtifactInfo(
        {
          version: 3,
          preset: 'balanced',
          compressionAlgorithm: 'none',
          encryptionAlgorithm: 'xchacha20-poly1305',
          originalSize: 0,
          compressedSize: 0,
          encryptedSize: 0,
          protectedSize: WASM_ARTIFACT_MAX_BYTES + 1,
          shellChunkSize: 512,
          shellChunkCount: 1,
          shellNonce: new Uint8Array(12),
        },
        16,
      ),
    ).toThrow('size');
  });
});
