import { benchmarkCompression, benchmarkEncryption, benchmarkAll } from '../benchmark-all';

describe('e2ee-client benchmark scaffolding', () => {
    test('compression benchmark returns results', async () => {
        const res = await benchmarkCompression('hello world', 5);
        expect(res.length).toBeGreaterThan(0);
    });

    test('encryption benchmark returns results', async () => {
        const res = await benchmarkEncryption('hello world', 3);
        expect(res.length).toBeGreaterThan(0);
    });

    test('benchmarkAll returns both groups', async () => {
        const res = await benchmarkAll('hello world', 3);
        expect(res.compression.length).toBeGreaterThan(0);
        expect(res.encryption.length).toBeGreaterThan(0);
    });
});


