import {
  decompressBounded,
  decrypt,
  encrypt,
  forceTypeScriptBackend,
  forceWasmBackend,
} from '../crypto-backend';
import {
  getWasm,
  initWasm,
  isWasmReady,
  type WasmModule,
} from '../wasm/loader';

jest.mock('../wasm/loader', () => ({
  getWasm: jest.fn(),
  initWasm: jest.fn(),
  isWasmReady: jest.fn(() => false),
}));

const mockGetWasm = getWasm as jest.MockedFunction<typeof getWasm>;
const mockInitWasm = initWasm as jest.MockedFunction<typeof initWasm>;
const mockIsWasmReady = isWasmReady as jest.MockedFunction<typeof isWasmReady>;

function base64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}

describe('packaged WASM backend boundary', () => {
  beforeEach(() => {
    mockGetWasm.mockReset();
    mockInitWasm.mockReset();
    mockIsWasmReady.mockReset();
    mockIsWasmReady.mockReturnValue(false);
  });

  test('keeps the detached WASM tag in the public ciphertext wire format', async () => {
    const decryptWasm = jest.fn(() => new Uint8Array([9, 8, 7]));
    const encryptWasm = jest.fn(() => ({
        ciphertext: base64([1, 2, 3]),
        nonce: base64(new Array(12).fill(4)),
        tag: base64(new Array(16).fill(5)),
        algorithm: 'aes-256-gcm',
      }));
    const wasm = {
      encrypt: encryptWasm,
      decrypt: decryptWasm,
    } as unknown as WasmModule;
    mockInitWasm.mockResolvedValue(wasm);
    await forceWasmBackend();

    const encrypted = await encrypt(new Uint8Array([9, 8, 7]), new Uint8Array(32));
    expect(Buffer.from(encrypted.data, 'base64')).toEqual(
      Buffer.from([1, 2, 3, ...new Array(16).fill(5)]),
    );
    expect(encrypted.encryptedSize).toBe(19);
    expect(encryptWasm).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.any(Uint8Array),
      'aes-256-gcm',
    );

    await expect(decrypt(encrypted, new Uint8Array(32))).resolves.toEqual(
      new Uint8Array([9, 8, 7]),
    );
    expect(decryptWasm).toHaveBeenCalledWith(
      base64([1, 2, 3]),
      encrypted.iv,
      base64(new Array(16).fill(5)),
      expect.any(Uint8Array),
      'aes-256-gcm',
    );
  });

  test('rejects a WASM result that violates the compatibility algorithm contract', async () => {
    const wasm = {
      encrypt: jest.fn(() => ({
        ciphertext: base64([1, 2, 3]),
        nonce: base64(new Array(24).fill(4)),
        tag: base64(new Array(16).fill(5)),
        algorithm: 'xchacha20-poly1305',
      })),
    } as unknown as WasmModule;
    mockInitWasm.mockResolvedValue(wasm);
    await forceWasmBackend();

    await expect(
      encrypt(new Uint8Array([9, 8, 7]), new Uint8Array(32)),
    ).rejects.toThrow('unexpected encryption algorithm');
  });

  test('forwards the exact bounded-decompression contract to WASM', async () => {
    const compressed = new Uint8Array([1, 2, 3]);
    const decompressed = new Uint8Array([9, 8, 7, 6]);
    const decompressWasm = jest.fn(() => decompressed);
    const wasm = {
      decompress_bounded: decompressWasm,
    } as unknown as WasmModule;
    mockInitWasm.mockResolvedValue(wasm);
    await forceWasmBackend();

    await expect(
      decompressBounded(compressed, 'brotli', 256 * 1024 * 1024),
    ).resolves.toEqual(decompressed);
    expect(decompressWasm).toHaveBeenCalledWith(
      compressed,
      'brotli',
      256 * 1024 * 1024,
    );

    decompressWasm.mockClear();
    await expect(
      decompressBounded(compressed, 'brotli', 512 * 1024 * 1024 + 1),
    ).rejects.toThrow('Bounded decompression output limit');
    expect(decompressWasm).not.toHaveBeenCalled();
  });

  test('never substitutes the TypeScript backend for bounded decompression', async () => {
    forceTypeScriptBackend();
    await expect(
      decompressBounded(new Uint8Array([1]), 'brotli', 32),
    ).rejects.toThrow('requires the Rust WASM backend');
  });

  test('does not silently downgrade a browser after WASM initialization fails', async () => {
    jest.resetModules();
    const loader = jest.requireMock('../wasm/loader') as {
      getWasm: jest.Mock;
      initWasm: jest.Mock;
      isWasmReady: jest.Mock;
    };
    loader.getWasm.mockRejectedValue(new Error('asset hash mismatch'));
    const backend = await import('../crypto-backend');

    await expect(backend.useWasmBackend()).rejects.toThrow(
      'call forceTypeScriptBackend() explicitly',
    );
  });
});
