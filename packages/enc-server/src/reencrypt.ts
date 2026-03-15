import { 
    decryptWithMap, 
    encryptWithMap, 
    generateMap,
    type EncryptWithMapResult,
    type ObfuscationMap 
} from './crypto-backend.js';

/**
 * Re-encrypt previously-obfuscated data with a new key while preserving (or optionally replacing)
 * the obfuscation map.
 *
 * Useful for **key rotation** workflows: decrypt with the old key, then immediately encrypt with
 * the new key so callers don't need to handle plaintext in userland.
 */
export function reEncryptWithNewKey(
    obfuscatedData: string,
    map: ObfuscationMap,
    oldKey: Buffer,
    newKey: Buffer,
    opts: {
        /** When true, a fresh map will be generated. */
        regenerateMap?: boolean;
        /** Temperature for the new map if `regenerateMap` is true. Defaults to 0.5 */
        temperature?: number;
        /** Seed for deterministic map generation */
        seed?: string;
    } = {}
): EncryptWithMapResult {
    // 1. Decrypt with old key (compression algorithm is embedded in the payload now)
    const plaintext = decryptWithMap(obfuscatedData, map, oldKey);

    // 2. Decide on map
    if (opts.regenerateMap) {
        // Generate new map - seed is required
        if (!opts.seed) {
            throw new Error('reEncryptWithNewKey requires a seed parameter when regenerateMap is true.');
        }
        const newMap = generateMap(opts.temperature ?? 0.5, opts.seed);
        // 3. Encrypt+obfuscate with new key and new map
        return encryptWithMap(plaintext, {
            key: newKey,
            map: newMap,
            compressionAlgorithm: 'brotli',
        });
    } else {
        // 3. Encrypt+obfuscate with new key and existing map
        return encryptWithMap(plaintext, {
            key: newKey,
            map: map,
            compressionAlgorithm: 'brotli',
        });
    }
} 