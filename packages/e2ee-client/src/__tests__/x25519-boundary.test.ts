import { CryptoService } from "../crypto-service";
import {
  getWasm,
  getWasmSync,
  isWasmReady,
  type WasmModule,
} from "../wasm/loader";

jest.mock("../wasm/loader", () => ({
  getWasm: jest.fn(),
  getWasmSync: jest.fn(),
  isWasmReady: jest.fn(),
}));

const mockGetWasm = getWasm as jest.MockedFunction<typeof getWasm>;
const mockGetWasmSync = getWasmSync as jest.MockedFunction<typeof getWasmSync>;
const mockIsWasmReady = isWasmReady as jest.MockedFunction<typeof isWasmReady>;

const privateKey = new Uint8Array(32).fill(7);
const lowOrderPublicKey = (() => {
  const key = new Uint8Array(32);
  key[0] = 1;
  return key;
})();

describe("X25519 agreement boundary", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockGetWasm.mockReset();
    mockGetWasmSync.mockReset();
    mockIsWasmReady.mockReset();
    mockIsWasmReady.mockReturnValue(false);
  });

  test("rejects an all-zero peer public key before selecting a backend", async () => {
    const service = new CryptoService();

    await expect(
      service.x25519SharedSecret(privateKey, new Uint8Array(32))
    ).rejects.toThrow("X25519 agreement rejected: peer public key is all zero");
    expect(mockGetWasm).not.toHaveBeenCalled();
  });

  test("rejects an all-zero WebCrypto result without falling back", async () => {
    const service = new CryptoService();
    jest.spyOn(crypto.subtle, "deriveBits").mockResolvedValue(new ArrayBuffer(32));

    await expect(
      service.x25519SharedSecret(privateKey, lowOrderPublicKey)
    ).rejects.toThrow(
      "WebCrypto produced an all-zero shared secret from a low-order or invalid peer public key"
    );
    expect(mockGetWasm).not.toHaveBeenCalled();
  });

  test("rejects an all-zero result from the WASM fallback", async () => {
    const service = new CryptoService();
    jest.spyOn(crypto.subtle, "importKey").mockRejectedValue(
      new Error("WebCrypto X25519 unavailable")
    );
    const wasmShared = new Uint8Array(32);
    const x25519SharedSecret = jest.fn(() => wasmShared);
    mockGetWasm.mockResolvedValue({
      x25519_shared_secret: x25519SharedSecret,
    } as unknown as WasmModule);

    await expect(
      service.x25519SharedSecret(privateKey, lowOrderPublicKey)
    ).rejects.toThrow(
      "Voided WASM produced an all-zero shared secret from a low-order or invalid peer public key"
    );
    expect(x25519SharedSecret).toHaveBeenCalledTimes(1);
  });

  test("wipes the transient WASM shared-secret buffer after copying it", async () => {
    const service = new CryptoService();
    jest.spyOn(crypto.subtle, "importKey").mockRejectedValue(
      new Error("WebCrypto X25519 unavailable")
    );
    const wasmShared = new Uint8Array(32).fill(0x5a);
    mockGetWasm.mockResolvedValue({
      x25519_shared_secret: () => wasmShared,
    } as unknown as WasmModule);

    const result = await service.x25519SharedSecret(
      privateKey,
      lowOrderPublicKey
    );

    expect(new Uint8Array(result)).toEqual(new Uint8Array(32).fill(0x5a));
    expect(wasmShared).toEqual(new Uint8Array(32));
  });

  test("wipes X25519 generation seed, PKCS#8, and WASM private output copies", async () => {
    const service = new CryptoService();
    const callerSeed = new Uint8Array(32).fill(0x11);
    let importedPkcs8: Uint8Array | null = null;
    jest.spyOn(crypto.subtle, "importKey").mockImplementation(
      async (_format, keyData) => {
        importedPkcs8 = keyData as Uint8Array;
        throw new Error("WebCrypto X25519 unavailable");
      }
    );

    const wasmPrivate = new Uint8Array(32).fill(0x22);
    const wasmPublic = new Uint8Array(32).fill(0x33);
    let receivedSeed: Uint8Array | null = null;
    mockGetWasm.mockResolvedValue({
      generate_x25519_key_pair: (ownedSeed?: Uint8Array | null) => {
        receivedSeed = ownedSeed ?? null;
        return { public_key: wasmPublic, private_key: wasmPrivate };
      },
    } as unknown as WasmModule);

    const pair = await service.generateX25519KeyPair(callerSeed);

    expect(new Uint8Array(pair.privateKey)).toEqual(
      new Uint8Array(32).fill(0x22)
    );
    expect(new Uint8Array(pair.publicKey)).toEqual(
      new Uint8Array(32).fill(0x33)
    );
    expect(callerSeed).toEqual(new Uint8Array(32).fill(0x11));
    expect(importedPkcs8).not.toBeNull();
    expect(importedPkcs8).toEqual(
      new Uint8Array(48)
    );
    expect(receivedSeed).toEqual(new Uint8Array(32));
    expect(wasmPrivate).toEqual(new Uint8Array(32));
  });

  test("preserves a generated caller-owned private key across repeated agreements", async () => {
    const service = new CryptoService();
    const alice = await service.generateX25519KeyPair();
    const bob = await service.generateX25519KeyPair();
    const privateKeyBefore = new Uint8Array(alice.privateKey.slice(0));

    const firstSharedSecret = await service.x25519SharedSecret(
      alice.privateKey,
      bob.publicKey
    );

    expect(new Uint8Array(alice.privateKey)).toEqual(privateKeyBefore);

    const secondSharedSecret = await service.x25519SharedSecret(
      alice.privateKey,
      bob.publicKey
    );

    expect(new Uint8Array(alice.privateKey)).toEqual(privateKeyBefore);
    expect(new Uint8Array(secondSharedSecret)).toEqual(
      new Uint8Array(firstSharedSecret)
    );
  });
});
