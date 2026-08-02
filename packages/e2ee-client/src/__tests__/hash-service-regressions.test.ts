import { CryptoService, HashService } from "../crypto-service";
import { CLIENT_MAX_IN_MEMORY_BYTES } from "../limits";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("HashService security and Rust parity", () => {
  const hashes = new HashService();

  test.each(["sha1", "md5", "SHA-256", "", null])(
    "rejects unsupported runtime hash algorithm %p",
    async (algorithm) => {
      const runtimeAlgorithm = algorithm as unknown as "sha256" | "sha512";

      await expect(hashes.hash(bytes("data"), runtimeAlgorithm)).rejects.toThrow(
        "Unsupported hash algorithm"
      );
      await expect(
        hashes.hashWithSalt(bytes("data"), bytes("salt"), runtimeAlgorithm)
      ).rejects.toThrow("Unsupported hash algorithm");
      await expect(
        hashes.hmac(bytes("data"), bytes("key"), runtimeAlgorithm)
      ).rejects.toThrow("Unsupported hash algorithm");
    }
  );

  test("matches Rust v2 salted-hash transcript vectors", async () => {
    await expect(
      hashes.hashWithSalt(bytes("a"), bytes("bc"), "sha256")
    ).resolves.toBe(
      "ff4df9545edd82e7d105bad64c4f681e326dd0e183c65371bfd293661e3e516d"
    );
    await expect(
      hashes.hashWithSalt(bytes("a"), bytes("bc"), "sha512")
    ).resolves.toBe(
      "13d8eb47acccbedd1e4924b993ef71f96853eaf3e7fd47c32da0dd71f344c19d" +
        "6d56adb4233fdcb36a3bdf5565e27b67ee609513ff0d206a745b7087e287fe9e"
    );
    await expect(
      hashes.hashWithSalt(bytes("ab"), bytes("c"), "sha256")
    ).resolves.toBe(
      "356ccd7889f508270a3a7c266560b511e801964e0ab2132ab0928ab19d39696e"
    );
  });

  test("keeps distinct data/salt tuples distinct", async () => {
    const first = await hashes.hashWithSalt(bytes("a"), bytes("bc"));
    const second = await hashes.hashWithSalt(bytes("ab"), bytes("c"));
    expect(first).not.toBe(second);
  });

  test("rejects an oversized transcript before WebCrypto digest", async () => {
    const digest = jest.spyOn(crypto.subtle, "digest");
    const overLimit = {
      length: CLIENT_MAX_IN_MEMORY_BYTES,
    } as Uint8Array;
    try {
      await expect(
        hashes.hashWithSalt(overLimit, new Uint8Array(0))
      ).rejects.toThrow(
        "Salted hash transcript exceeds the 100 MiB browser in-memory limit"
      );
      expect(digest).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });

  test("wipes its temporary plaintext and salt transcript", async () => {
    let capturedTranscript: Uint8Array | null = null;
    const digest = jest
      .spyOn(crypto.subtle, "digest")
      .mockImplementation(async (_algorithm, input) => {
        capturedTranscript = input as Uint8Array;
        return new ArrayBuffer(32);
      });
    try {
      await hashes.hashWithSalt(bytes("secret"), bytes("salt"));
      expect(capturedTranscript).not.toBeNull();
      const wipedTranscript = capturedTranscript as unknown as Uint8Array;
      expect(
        Array.from(wipedTranscript).every(
          (value) => value === 0
        )
      ).toBe(true);
    } finally {
      digest.mockRestore();
    }
  });

  test.each([0, -1, 33, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe fingerprint length %p",
    async (length) => {
      await expect(hashes.fingerprint(bytes("Voided"), length)).rejects.toThrow(
        "Fingerprint length must be a safe integer from 1 to 32"
      );
    }
  );

  test.each([0, -1, 33, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe safety-number group size %p",
    async (groupSize) => {
      await expect(
        hashes.safetyNumbers(bytes("Voided"), groupSize)
      ).rejects.toThrow(
        "Fingerprint group size must be a safe integer from 1 to 32"
      );
    }
  );

  test("accepts fingerprint boundaries and formats all Rust safety-number groups", async () => {
    await expect(hashes.fingerprint(bytes("Voided"), 1)).resolves.toHaveLength(
      2
    );
    await expect(hashes.fingerprint(bytes("Voided"), 32)).resolves.toHaveLength(
      64
    );
    await expect(hashes.safetyNumbers(bytes("Voided"), 1)).resolves.toBe(
      "159  154  226  201  188  186  202  233  215  063  138  132  019  207  " +
        "165  209  199  215  192  196  161  099  232  227  017  120  006  136  " +
        "081  163  062  119"
    );
    await expect(hashes.safetyNumbers(bytes("Voided"), 32)).resolves.toBe(
      "159 154 226 201 188 186 202 233 215 063 138 132 019 207 165 209 " +
        "199 215 192 196 161 099 232 227 017 120 006 136 081 163 062 119"
    );
  });
});

describe("CryptoService public-key import validation", () => {
  const service = new CryptoService();

  test("round-trips canonical P-256 SPKI for both supported usages", async () => {
    const ecdh = await service.generateKeyAgreementKeyPair();
    const ecdhSpki = await service.exportPublicKey(ecdh.publicKey);
    await expect(service.importPublicKey(ecdhSpki, "ECDH")).resolves.toBeDefined();

    const ecdsa = await service.generateSigningKeyPair();
    const ecdsaSpki = await service.exportPublicKey(ecdsa.publicKey);
    await expect(
      service.importPublicKey(ecdsaSpki, "ECDSA")
    ).resolves.toBeDefined();
  });

  test("rejects invalid runtime usage before importing", async () => {
    await expect(
      service.importPublicKey("AAAA", "RSA" as unknown as "ECDSA")
    ).rejects.toThrow("Public key usage must be ECDSA or ECDH");
  });

  test.each([
    "",
    "not base64",
    "A===",
    "AA",
    "A".repeat(1369),
  ])("rejects non-canonical or oversized SPKI base64", async (keyString) => {
    await expect(service.importPublicKey(keyString, "ECDSA")).rejects.toThrow(
      "P-256 SPKI must be canonical base64"
    );
  });

  test("rejects decoded SPKI above 1 KiB and non-canonical padding bits", async () => {
    const oversized = btoa(String.fromCharCode(...new Uint8Array(1025)));
    await expect(service.importPublicKey(oversized, "ECDSA")).rejects.toThrow(
      "P-256 SPKI must decode canonically to 1-1024 bytes"
    );
    await expect(service.importPublicKey("AB==", "ECDSA")).rejects.toThrow(
      "P-256 SPKI must decode canonically to 1-1024 bytes"
    );
  });

  test("wipes the decoded SPKI buffer after WebCrypto imports it", async () => {
    const pair = await service.generateSigningKeyPair();
    const spki = await service.exportPublicKey(pair.publicKey);
    const wipe = jest.spyOn(service, "secureWipe");
    try {
      await service.importPublicKey(spki, "ECDSA");
      const wipedBuffer = wipe.mock.calls.find(
        ([value]) => value instanceof ArrayBuffer
      )?.[0];
      expect(wipedBuffer).toBeInstanceOf(ArrayBuffer);
      expect(
        Array.from(new Uint8Array(wipedBuffer as ArrayBuffer)).every(
          (value) => value === 0
        )
      ).toBe(true);
    } finally {
      wipe.mockRestore();
    }
  });
});
