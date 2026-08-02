import { compress, decompress } from './compression';
import { VoidedE2EEClient } from './index';

export interface OpBenchmarkResult {
    label: string;
    algorithm: string;
    iterations: number;
    avgMs: number;
    totalMs: number;
}

export async function benchmarkCompression(text: string, iterations = 50): Promise<OpBenchmarkResult[]> {
    const algos: Array<'gzip' | 'brotli' | 'none' | 'auto'> = ['gzip', 'brotli', 'auto'];
    const data = text;
    const results: OpBenchmarkResult[] = [];
    for (const algo of algos) {
        let total = 0;
        for (let i = 0; i < iterations; i++) {
            const t1 = performance.now();
            const res = await compress(data, { algorithm: algo });
            await decompress(res.compressed, res.algorithm);
            const t2 = performance.now();
            total += t2 - t1;
        }
        results.push({ label: 'compression', algorithm: algo, iterations, avgMs: total / iterations, totalMs: total });
    }
    return results;
}

export async function benchmarkEncryption(text: string, iterations = 50): Promise<OpBenchmarkResult[]> {
    const client = new VoidedE2EEClient();
    const algos: Array<'gzip' | 'brotli' | 'none' | 'auto'> = ['auto', 'gzip', 'brotli', 'none'];
    const results: OpBenchmarkResult[] = [];
    for (const algo of algos) {
        // warmup
        await client.encrypt(text, { compressionAlgorithm: algo });
        let total = 0;
        for (let i = 0; i < iterations; i++) {
            const t1 = performance.now();
            const enc = await client.encrypt(text, { compressionAlgorithm: algo });
            const dec = await client.decrypt(enc);
            const t2 = performance.now();
            if (dec.length !== text.length) throw new Error('decrypt mismatch');
            total += t2 - t1;
        }
        results.push({ label: 'encrypt+decrypt', algorithm: algo, iterations, avgMs: total / iterations, totalMs: total });
    }
    return results;
}

export async function benchmarkAll(sampleText = 'benchmark-message', iterations = 50) {
    const r1 = await benchmarkCompression(sampleText, Math.max(10, Math.floor(iterations / 2)));
    const r2 = await benchmarkEncryption(sampleText, iterations);
    return { compression: r1, encryption: r2 };
}


