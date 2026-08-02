import { CryptoService } from "../crypto-service";
import { KeySharing, KeySharingContext } from "../key-sharing";
import { VoidedE2EEClient } from "../index";
import { InMemoryStorage } from "./test-utils";

function toHex(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isX25519Supported(
  cryptoService: CryptoService
): Promise<boolean> {
  try {
    await cryptoService.generateX25519KeyPair();
    return true;
  } catch {
    return false;
  }
}

describe("key sharing additions", () => {
  const cryptoService = new CryptoService();

  test("HKDF determinism matches RFC5869 test vector", async () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = Uint8Array.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
      0x0b, 0x0c,
    ]);
    const info = Uint8Array.from([
      0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
    ]);

    const okm = await cryptoService.hkdfDeriveRaw(ikm, salt, info, 42);
    expect(toHex(okm)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a" +
        "2d2d0a90cf1a5a4c5db02d56ecc4c5bf" +
        "34007208d5b887185865"
    );
  });

  test("X25519 shared secret is symmetric", async () => {
    if (!(await isX25519Supported(cryptoService))) {
      return;
    }

    const alice = await cryptoService.generateX25519KeyPair();
    const bob = await cryptoService.generateX25519KeyPair();

    const s1 = await cryptoService.x25519SharedSecret(
      alice.privateKey,
      bob.publicKey
    );
    const s2 = await cryptoService.x25519SharedSecret(
      bob.privateKey,
      alice.publicKey
    );

    expect(toHex(s1)).toBe(toHex(s2));
  });

  test("Key sharing round-trip: sender encrypts key for recipient", async () => {
    if (!(await isX25519Supported(cryptoService))) {
      return;
    }

    const sharing = new KeySharing(cryptoService);
    const aliceIdentity = await cryptoService.generateX25519KeyPair();
    const bobIdentity = await cryptoService.generateX25519KeyPair();

    const dataKey = await cryptoService.generateKey();
    const context: KeySharingContext = {
      senderId: "alice",
      recipientId: "bob",
      keyId: "round-trip-key",
      transferId: KeySharing.createTransferId(),
    };
    const encryptedForBob = await sharing.encryptKeyForRecipient(
      dataKey,
      aliceIdentity.privateKey,
      bobIdentity.publicKey,
      context
    );

    const recovered = await sharing.decryptKeyFromSender(
      encryptedForBob,
      bobIdentity.privateKey,
      aliceIdentity.publicKey,
      context
    );

    const dataKeyRaw = await crypto.subtle.exportKey("raw", dataKey);
    const recoveredRaw = await crypto.subtle.exportKey("raw", recovered);
    expect(toHex(recoveredRaw)).toBe(toHex(dataKeyRaw));
  });

  test("Transfer key derivation is symmetric and supports transfer round-trip", async () => {
    if (!(await isX25519Supported(cryptoService))) {
      return;
    }

    const sharing = new KeySharing(cryptoService);
    const deviceA = await cryptoService.generateX25519KeyPair();
    const deviceB = await cryptoService.generateX25519KeyPair();
    const context: KeySharingContext = {
      senderId: "device-a",
      recipientId: "device-b",
      keyId: "transfer-key",
      transferId: KeySharing.createTransferId(),
    };

    const transferA = await sharing.deriveTransferKey(
      deviceA.privateKey,
      deviceB.publicKey,
      context
    );
    const transferB = await sharing.deriveTransferKey(
      deviceB.privateKey,
      deviceA.publicKey,
      context
    );

    const transferARaw = await crypto.subtle.exportKey("raw", transferA);
    const transferBRaw = await crypto.subtle.exportKey("raw", transferB);
    expect(toHex(transferARaw)).toBe(toHex(transferBRaw));

    const dataKey = await cryptoService.generateKey();
    const encrypted = await sharing.encryptKeyForTransfer(dataKey, transferA, context);
    const recovered = await sharing.decryptKeyFromTransfer(encrypted, transferB, context);

    const dataKeyRaw = await crypto.subtle.exportKey("raw", dataKey);
    const recoveredRaw = await crypto.subtle.exportKey("raw", recovered);
    expect(toHex(recoveredRaw)).toBe(toHex(dataKeyRaw));
  });

  test("Backward compatibility: existing default key flow still works", async () => {
    const client = new VoidedE2EEClient({
      storage: new InMemoryStorage(),
      autoGenerateKey: true,
    });

    const encrypted = await client.encrypt("legacy-flow");
    const decrypted = await client.decrypt(encrypted);
    expect(decrypted).toBe("legacy-flow");
  });
});
