import { CryptoService } from "../crypto-service";

describe("CryptoService transient key custody", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("wipes raw AES bytes after Base64 export", async () => {
    const service = new CryptoService();
    const raw = new Uint8Array(32).fill(0x4a);
    jest.spyOn(crypto.subtle, "exportKey").mockResolvedValue(raw.buffer);

    await expect(service.exportKey({} as CryptoKey)).resolves.toBe(
      Buffer.from(new Uint8Array(32).fill(0x4a)).toString("base64")
    );
    expect(raw).toEqual(new Uint8Array(32));
  });

  test("wipes raw AES and digest buffers after fingerprinting", async () => {
    const service = new CryptoService();
    const raw = new Uint8Array(32).fill(0x51);
    const digest = new Uint8Array(32).fill(0x62);
    jest.spyOn(crypto.subtle, "exportKey").mockResolvedValue(raw.buffer);
    jest.spyOn(crypto.subtle, "digest").mockResolvedValue(digest.buffer);

    await expect(service.getKeyFingerprint({} as CryptoKey)).resolves.toBe(
      "6262626262626262"
    );
    expect(raw).toEqual(new Uint8Array(32));
    expect(digest).toEqual(new Uint8Array(32));
  });

  test("wipes raw AES and digest buffers after safety-number generation", async () => {
    const service = new CryptoService();
    const raw = new Uint8Array(32).fill(0x73);
    const digest = new Uint8Array(32).fill(0x84);
    jest.spyOn(crypto.subtle, "exportKey").mockResolvedValue(raw.buffer);
    jest.spyOn(crypto.subtle, "digest").mockResolvedValue(digest.buffer);

    await expect(service.getSafetyNumbers({} as CryptoKey)).resolves.toMatch(
      /^(?:\d{3} ){7}\d{3}$/
    );
    expect(raw).toEqual(new Uint8Array(32));
    expect(digest).toEqual(new Uint8Array(32));
  });
});
