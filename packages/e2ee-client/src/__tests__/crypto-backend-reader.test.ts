import { forceTypeScriptBackend, forceWasmBackend, inspectRotationArtifact, openRotationArtifact } from '../crypto-backend';
import { getWasm, initWasm, isWasmReady, type ProtectedArtifactInfo, type WasmModule } from '../wasm/loader';
import { secureWasmModule } from '../wasm/secure-module';
import { WASM_PLAINTEXT_MAX_BYTES } from '../wasm/boundary';

jest.mock('../wasm/loader', () => ({ getWasm: jest.fn(), initWasm: jest.fn(), isWasmReady: jest.fn(() => false) }));
const init = initWasm as jest.MockedFunction<typeof initWasm>;
const ready = isWasmReady as jest.MockedFunction<typeof isWasmReady>;
const get = getWasm as jest.MockedFunction<typeof getWasm>;
const artifact = new Uint8Array([1, 2, 3]), key = new Uint8Array(32).fill(7), plaintext = new Uint8Array([4, 5, 6]);

function info(version = 3): ProtectedArtifactInfo {
  return { version, preset: 'compact', compressionAlgorithm: 'none',
    encryptionAlgorithm: version === 2 ? 'aes-256-gcm' : 'xchacha20-poly1305',
    originalSize: 3, compressedSize: 3, encryptedSize: 3, protectedSize: 3,
    shellChunkSize: 512, shellChunkCount: 1, shellNonce: new Uint8Array(12) };
}

function raw(version = 3) {
  const result = { openRotationArtifact: jest.fn(() => plaintext), inspectRotationArtifact: jest.fn(() => info(version)),
    open: jest.fn(() => plaintext), inspectArtifact: jest.fn(() => info()) };
  return { result, secure: secureWasmModule(result as unknown as WasmModule) };
}

describe('existing native reader public bindings', () => {
  beforeEach(() => {
    forceTypeScriptBackend(); init.mockReset(); ready.mockReset(); get.mockReset(); ready.mockReturnValue(false);
  });

  test('forwards the exact artifact and key to the secured WASM reader', async () => {
    const f = raw(); init.mockResolvedValue(f.secure); await forceWasmBackend();
    expect(await openRotationArtifact(artifact, key)).toBe(plaintext);
    expect(f.result.openRotationArtifact).toHaveBeenCalledWith(artifact, key);
    expect(f.result.inspectRotationArtifact).toHaveBeenCalledWith(artifact);
    expect(f.result.open).not.toHaveBeenCalled();
  });

  test('exposes validated inspection through the same secured module', async () => {
    const f = raw(); init.mockResolvedValue(f.secure); await forceWasmBackend();
    expect(await inspectRotationArtifact(artifact)).toEqual(info());
    expect(f.result.inspectArtifact).not.toHaveBeenCalled();
  });

  test.each(['open', 'inspect'])('never substitutes a TypeScript %s history reader', async method => {
    const f = raw(); init.mockResolvedValue(f.secure);
    if (method === 'open') await expect(openRotationArtifact(artifact, key)).rejects.toThrow('Rust WASM backend');
    else await expect(inspectRotationArtifact(artifact)).rejects.toThrow('Rust WASM backend');
    expect(f.result.openRotationArtifact).not.toHaveBeenCalled();
    expect(f.result.inspectRotationArtifact).not.toHaveBeenCalled();
  });

  test.each([2, 3])('retains validated version %i metadata without relabeling', version => {
    const f = raw(version);
    expect(f.secure.inspectRotationArtifact(artifact)).toEqual(info(version));
    expect(f.secure.openRotationArtifact(artifact, key)).toBe(plaintext);
  });

  test('rejects an invalid key before raw inspection or opening', () => {
    const f = raw();
    expect(() => f.secure.openRotationArtifact(artifact, new Uint8Array(31))).toThrow('32');
    expect(f.result.inspectRotationArtifact).not.toHaveBeenCalled();
    expect(f.result.openRotationArtifact).not.toHaveBeenCalled();
  });

  test('rejects spoofed typed arrays before invoking either native reader', () => {
    const f = raw(), spoofed = Object.create(Uint8Array.prototype);
    expect(() => f.secure.inspectRotationArtifact(spoofed)).toThrow('valid Uint8Array');
    expect(() => f.secure.openRotationArtifact(spoofed, key)).toThrow('valid Uint8Array');
    expect(f.result.inspectRotationArtifact).not.toHaveBeenCalled();
    expect(f.result.openRotationArtifact).not.toHaveBeenCalled();
  });

  test('rejects excessive advertised plaintext before native opening', () => {
    const f = raw(); f.result.inspectRotationArtifact.mockReturnValue({ ...info(), originalSize: WASM_PLAINTEXT_MAX_BYTES + 1 });
    expect(() => f.secure.openRotationArtifact(artifact, key)).toThrow('original size');
    expect(f.result.openRotationArtifact).not.toHaveBeenCalled();
  });

  test('rejects metadata inconsistent with the exact artifact byte length', () => {
    const f = raw(); f.result.inspectRotationArtifact.mockReturnValue({ ...info(), protectedSize: 4 });
    expect(() => f.secure.inspectRotationArtifact(artifact)).toThrow('size metadata mismatch');
    expect(() => f.secure.openRotationArtifact(artifact, key)).toThrow('size metadata mismatch');
    expect(f.result.openRotationArtifact).not.toHaveBeenCalled();
  });

  test('rejects malformed native output before releasing plaintext', () => {
    const f = raw(); f.result.openRotationArtifact.mockReturnValue(new Uint16Array(3) as unknown as typeof plaintext);
    expect(() => f.secure.openRotationArtifact(artifact, key)).toThrow('valid Uint8Array');
  });

  test('does not route the ordinary current-format API through a history reader', () => {
    const f = raw();
    expect(f.secure.open(artifact, key)).toBe(plaintext);
    expect(f.result.open).toHaveBeenCalledWith(artifact, key);
    expect(f.result.inspectArtifact).toHaveBeenCalledWith(artifact);
    expect(f.result.openRotationArtifact).not.toHaveBeenCalled();
    expect(f.result.inspectRotationArtifact).not.toHaveBeenCalled();
  });
});
