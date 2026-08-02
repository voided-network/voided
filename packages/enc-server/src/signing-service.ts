import crypto, { KeyObject } from 'crypto';

export type SigningAlgorithm = 'ed25519' | 'ecdsa-p256' | 'rsa-pss-2048';

export interface GeneratedKeyPair {
    publicKeyPem: string;
    privateKeyPem: string;
}

export const RECOMMENDED_ALGORITHMS = {
    modern: 'ed25519' as const, // Best performance + security
    compatible: 'ecdsa-p256' as const, // Widest support
    legacy: 'rsa-pss-2048' as const // Enterprise/compliance
};

function assertSigningAlgorithm(value: unknown): asserts value is SigningAlgorithm {
    if (value !== 'ed25519' && value !== 'ecdsa-p256' && value !== 'rsa-pss-2048') {
        throw new TypeError(`Unsupported signing algorithm: ${String(value)}`);
    }
}

/**
 * SigningService - Server-side signing and verification utilities
 */
export class SigningService {

    /**
     * Generate a signing key pair for the given algorithm
     */
    async generateKeyPair(algorithm: SigningAlgorithm): Promise<GeneratedKeyPair> {
        assertSigningAlgorithm(algorithm);
        if (algorithm === 'ed25519') {
            const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
            });
            return { publicKeyPem: publicKey.toString(), privateKeyPem: privateKey.toString() };
        }

        if (algorithm === 'ecdsa-p256') {
            const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
                namedCurve: 'prime256v1',
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
            });
            return { publicKeyPem: publicKey.toString(), privateKeyPem: privateKey.toString() };
        }

        // rsa-pss-2048
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicExponent: 0x10001,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        return { publicKeyPem: publicKey.toString(), privateKeyPem: privateKey.toString() };
    }

    /**
     * Sign data with the given private key and algorithm
     */
    async sign(
        data: string | Buffer,
        privateKeyPem: string,
        algorithm: SigningAlgorithm,
        outputEncoding: BufferEncoding = 'base64'
    ): Promise<string> {
        assertSigningAlgorithm(algorithm);
        const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');

        if (algorithm === 'ed25519') {
            const signature = crypto.sign(null, dataBuffer, privateKeyPem);
            return signature.toString(outputEncoding);
        }

        if (algorithm === 'ecdsa-p256') {
            const signer = crypto.createSign('sha256');
            signer.update(dataBuffer);
            signer.end();
            const signature = signer.sign({ key: privateKeyPem }); // DER encoded ECDSA sig
            return signature.toString(outputEncoding);
        }

        // rsa-pss-2048
        const signer = crypto.createSign('sha256');
        signer.update(dataBuffer);
        signer.end();
        const signature = signer.sign({
            key: privateKeyPem,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: 32
        });
        return signature.toString(outputEncoding);
    }

    /**
     * Sign many payloads efficiently. Returns signatures in the same order; optional id is echoed back.
     */
    async signMultiple(
        dataArray: Array<{ data: string | Buffer; id?: string }>,
        privateKeyPem: string,
        algorithm: SigningAlgorithm,
        outputEncoding: BufferEncoding = 'base64'
    ): Promise<Array<{ signature: string; id?: string }>> {
        const results: Array<{ signature: string; id?: string }> = [];
        for (const item of dataArray) {
            const signature = await this.sign(item.data, privateKeyPem, algorithm, outputEncoding);
            results.push({ signature, id: item.id });
        }
        return results;
    }

    /**
     * Verify signature for given data and public key
     */
    async verify(
        data: string | Buffer,
        signature: string | Buffer,
        publicKeyPem: string,
        algorithm: SigningAlgorithm,
        inputEncoding: BufferEncoding = 'base64'
    ): Promise<boolean> {
        assertSigningAlgorithm(algorithm);
        const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
        const sigBuffer = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, inputEncoding);

        if (algorithm === 'ed25519') {
            return crypto.verify(null, dataBuffer, publicKeyPem, sigBuffer);
        }

        if (algorithm === 'ecdsa-p256') {
            const verifier = crypto.createVerify('sha256');
            verifier.update(dataBuffer);
            verifier.end();
            return verifier.verify(publicKeyPem, sigBuffer);
        }

        // rsa-pss-2048
        const verifier = crypto.createVerify('sha256');
        verifier.update(dataBuffer);
        verifier.end();
        return verifier.verify(
            {
                key: publicKeyPem,
                padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
                saltLength: 32
            },
            sigBuffer
        );
    }

    /**
     * Verify many signatures efficiently. Returns results aligned to inputs; optional id is echoed back.
     */
    async verifyMultiple(
        items: Array<{ data: string | Buffer; signature: string | Buffer; id?: string }>,
        publicKeyPem: string,
        algorithm: SigningAlgorithm,
        inputEncoding: BufferEncoding = 'base64'
    ): Promise<Array<{ valid: boolean; id?: string }>> {
        const results: Array<{ valid: boolean; id?: string }> = [];
        for (const item of items) {
            const valid = await this.verify(item.data, item.signature, publicKeyPem, algorithm, inputEncoding);
            results.push({ valid, id: item.id });
        }
        return results;
    }

    /**
     * Derive public key PEM from a private key PEM
     */
    getPublicKeyFromPrivate(privateKeyPem: string): string {
        const privateKeyObj = crypto.createPrivateKey(privateKeyPem);
        const publicKeyObj = crypto.createPublicKey(privateKeyObj);
        return publicKeyObj.export({ type: 'spki', format: 'pem' }).toString();
    }

    /**
     * Compute SHA-256 fingerprint (hex) for the public key (SPKI DER)
     */
    getPublicKeyFingerprint(publicKeyPem: string): string {
        const publicKeyObj: KeyObject = crypto.createPublicKey(publicKeyPem);
        const der = publicKeyObj.export({ type: 'spki', format: 'der' }) as Buffer;
        const hashHex = crypto.createHash('sha256').update(der).digest('hex');
        return hashHex;
    }

    /**
     * Format a SHA-256 public-key fingerprint into human-readable groups.
     * This is not Signal's Safety Number protocol and does not bind identities.
     */
    getSafetyNumbers(publicKeyPem: string, groupSize: number = 5): string {
        if (!Number.isSafeInteger(groupSize) || groupSize < 1 || groupSize > 32) {
            throw new RangeError('groupSize must be an integer between 1 and 32.');
        }
        const fp = this.getPublicKeyFingerprint(publicKeyPem);
        const nums = this.hexToNumbers(fp);
        return this.formatSafetyNumbers(nums, groupSize);
    }

    /**
     * Advise on key strength by algorithm choice.
     */
    validateKeyStrength(algorithm: SigningAlgorithm): { secure: boolean; warnings: string[] } {
        assertSigningAlgorithm(algorithm);
        const warnings: string[] = [];
        switch (algorithm) {
            case 'ed25519':
                return { secure: true, warnings };
            case 'ecdsa-p256':
                // P-256 remains widely trusted; ensure proper randomness and side-channel protections
                return { secure: true, warnings };
            case 'rsa-pss-2048':
                warnings.push('RSA-2048 is acceptable today but consider RSA-3072/4096 for long-term data past ~2030.');
                warnings.push('Prefer Ed25519 or ECDSA P-256 unless you require RSA for compatibility.');
                return { secure: true, warnings };
        }
    }

    /**
     * Securely wipe sensitive data from memory if represented as a Buffer
     */
    secureWipe(buffer: Buffer): void {
        crypto.randomFillSync(buffer);
        buffer.fill(0);
    }

    private hexToNumbers(hex: string): number[] {
        const numbers: number[] = [];
        for (let i = 0; i < hex.length; i += 2) {
            const byte = parseInt(hex.substr(i, 2), 16);
            numbers.push(byte);
        }
        return numbers;
    }

    private formatSafetyNumbers(numbers: number[], groupSize: number): string {
        const groups: string[] = [];
        for (let i = 0; i < numbers.length; i += groupSize) {
            const group = numbers.slice(i, i + groupSize);
            const groupString = group.map(n => n.toString().padStart(3, '0')).join(' ');
            groups.push(groupString);
        }
        return groups.join(' ');
    }
}

// Export singleton instance
export const signingService = new SigningService();


