import { performance } from 'perf_hooks';
import { StatsTracker } from './stats.js';
import { 
    compress, 
    decompress, 
    encrypt, 
    decrypt, 
    generateKey,
} from './crypto-backend.js';
import { assertWithinServerUploadLimit } from './limits.js';

export interface OpBenchmarkResult {
    label: string;
    algorithm: string;
    iterations: number;
    avgMs: number;
    totalMs: number;
}

export function benchmarkCompression(
    data: Buffer,
    iterations = 50
): OpBenchmarkResult[] {
    assertWithinServerUploadLimit(data.length);
    const algos: Array<'gzip' | 'brotli'> = ['gzip', 'brotli'];
    const results: OpBenchmarkResult[] = [];

    for (const algo of algos) {
        let total = 0;
        for (let i = 0; i < iterations; i++) {
            const t1 = performance.now();
            const res = compress(data, algo);
            if (res.algorithm !== 'none') {
                decompress(res.compressed, res.algorithm as 'gzip' | 'brotli');
            }
            const t2 = performance.now();
            total += t2 - t1;
        }
        const avg = total / iterations;
        StatsTracker.instance.add({
            label: `compress+decompress-${algo}`,
            originalSize: data.length,
            compressedSize: 0,
            storedSize: 0,
            compressionRatio: 1,
            expansionRatio: 0,
            computeUnits: iterations,
            algorithm: algo,
            temperature: 0,
            durationMs: avg
        });
        results.push({ label: 'compression', algorithm: algo, iterations, avgMs: avg, totalMs: total });
    }
    return results;
}

export function benchmarkEncryption(
    data: Buffer,
    iterations = 100
): OpBenchmarkResult[] {
    assertWithinServerUploadLimit(data.length);
    const algos: Array<'aes-256-gcm' | 'xchacha20-poly1305'> = ['aes-256-gcm', 'xchacha20-poly1305'];
    const key = generateKey();
    const results: OpBenchmarkResult[] = [];
    
    for (const algo of algos) {
        // Warmup
        const warm = encrypt(data, key, algo);
        decrypt(warm, key);

        let total = 0;
        for (let i = 0; i < iterations; i++) {
            const t1 = performance.now();
            const enc = encrypt(data, key, algo);
            const dec = decrypt(enc, key);
            const t2 = performance.now();
            if (dec.length !== data.length) throw new Error('decrypt mismatch');
            total += t2 - t1;
        }
        const avg = total / iterations;
        StatsTracker.instance.add({
            label: `encrypt+decrypt-${algo}`,
            originalSize: data.length,
            compressedSize: 0,
            storedSize: 0,
            compressionRatio: 1,
            expansionRatio: 0,
            computeUnits: iterations,
            algorithm: algo,
            temperature: 0,
            durationMs: avg
        });
        results.push({ label: 'encryption', algorithm: algo, iterations, avgMs: avg, totalMs: total });
    }
    return results;
}

export function benchmarkHashing(
    text: string,
    iterations = 200
): OpBenchmarkResult[] {
    assertWithinServerUploadLimit(Buffer.from(text, 'utf8').length);
    const algs: Array<'sha256' | 'sha512'> = ['sha256', 'sha512'];
    const results: OpBenchmarkResult[] = [];
    
    for (const algo of algs) {
        let total = 0;
        for (let i = 0; i < iterations; i++) {
            const t1 = performance.now();
            const h = require('crypto').createHash(algo).update(text).digest('hex');
            const t2 = performance.now();
            if (h.length === 0) throw new Error('hash failed');
            total += t2 - t1;
        }
        const avg = total / iterations;
        StatsTracker.instance.add({
            label: `hash-${algo}`,
            originalSize: text.length,
            compressedSize: 0,
            storedSize: 0,
            compressionRatio: 1,
            expansionRatio: 0,
            computeUnits: iterations,
            algorithm: algo,
            temperature: 0,
            durationMs: avg
        });
        results.push({ label: 'hash', algorithm: algo, iterations, avgMs: avg, totalMs: total });
    }
    return results;
}

export function benchmarkAll(sampleText = 'benchmark-message', iterations = 50) {
    const data = Buffer.from(sampleText, 'utf8');
    const r1 = benchmarkCompression(data, Math.max(10, Math.floor(iterations / 2)));
    const r2 = benchmarkEncryption(data, iterations);
    const r3 = benchmarkHashing(sampleText, iterations * 4);
    return { compression: r1, encryption: r2, hashing: r3 };
}
