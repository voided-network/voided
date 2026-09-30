import {
  analyzeCompression,
  compress,
  decompress,
  stringToUint8Array,
  uint8ArrayToString,
} from '../compression';

// Fixed seeds make failures reproducible while still exercising many byte and
// Unicode combinations. This suite must fail when a valid round trip fails.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function randomBytes(next: () => number, length: number): Uint8Array {
  return Uint8Array.from({ length }, () => next() & 0xff);
}

function randomText(next: () => number, length: number): string {
  const scalars = ['\u0000', 'A', 'z', '\u00e9', '\u4e16', '\ufffd', '\ud83c\udf0d'];
  return Array.from({ length }, () => scalars[next() % scalars.length]).join('');
}

describe('compression randomized security properties', () => {
  test.each(['none', 'gzip', 'auto'] as const)(
    '%s preserves valid Unicode and exact UTF-8 byte length',
    async algorithm => {
      const next = random(0x61d0a17);
      for (let trial = 0; trial < 80; trial++) {
        const text = randomText(next, next() % 512);
        const expected = new TextEncoder().encode(text);
        const result = await compress(text, { algorithm });
        const restored = await decompress(result.compressed, result.algorithm, {
          expectedOutputBytes: expected.length,
        });
        expect(restored).toEqual(expected);
        expect(uint8ArrayToString(restored)).toBe(text);
        expect(result.originalSize).toBe(expected.length);
        expect(result.compressedSize).toBe(result.compressed.length);
        expect(result.compressionRatio).toBeGreaterThanOrEqual(0);
        expect(result.compressionRatio).toBeLessThanOrEqual(1);
      }
    },
  );

  test.each(['none', 'gzip', 'auto'] as const)(
    '%s preserves arbitrary binary data',
    async algorithm => {
      const next = random(0x0ddba11);
      for (let trial = 0; trial < 80; trial++) {
        const input = randomBytes(next, next() % 1024);
        const result = await compress(input, { algorithm });
        const restored = await decompress(result.compressed, result.algorithm, {
          expectedOutputBytes: input.length,
        });
        expect(restored).toEqual(input);
      }
    },
  );

  test('rejects lone UTF-16 surrogates instead of silently replacing data', async () => {
    for (const invalid of ['\ud800', 'a\ud800b', '\udc00', '\ud800\ud800']) {
      await expect(compress(invalid)).rejects.toThrow('unpaired UTF-16 surrogate');
      await expect(analyzeCompression(invalid)).rejects.toThrow('unpaired UTF-16 surrogate');
      expect(() => stringToUint8Array(invalid)).toThrow('unpaired UTF-16 surrogate');
    }
    const validPair = '\ud83c\udf0d';
    const compressed = await compress(validPair);
    expect(uint8ArrayToString(await decompress(
      compressed.compressed,
      compressed.algorithm,
    ))).toBe(validPair);
  });

  test('analysis reports byte sizes and a supported recommendation', async () => {
    const next = random(0xa11ce12);
    for (let trial = 0; trial < 40; trial++) {
      const text = randomText(next, 1 + (next() % 512));
      const analysis = await analyzeCompression(text);
      expect(analysis.originalSize).toBe(new TextEncoder().encode(text).length);
      expect(analysis.gzipSize).toBeGreaterThan(0);
      expect(analysis.recommendation).toMatch(/^(gzip|none)$/);
      expect(analysis.recommendation === 'gzip').toBe(analysis.gzipRatio < 0.9);
    }
  });

  test('corrupt gzip and an unsupported decoder fail explicitly', async () => {
    const result = await compress('recoverable material '.repeat(100), {
      algorithm: 'gzip',
    });
    expect(result.algorithm).toBe('gzip');
    const corrupt = new Uint8Array(result.compressed);
    corrupt[0] ^= 0xff;
    await expect(decompress(corrupt, 'gzip')).rejects.toThrow();
    await expect(decompress(result.compressed, 'brotli')).rejects.toThrow(
      'requires the Rust WASM backend',
    );
  });
});
