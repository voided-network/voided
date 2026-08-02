import { gzipSync } from "fflate";
import { decompress } from "../compression";
import { CryptoService } from "../crypto-service";
import { CryptoError, ValidationError } from "../errors";
import {
  E2EEStorage,
  EncryptedBlob,
  IndexedDBStorage,
  MigrationState,
  VoidedE2EEClient,
} from "../index";
import { KeySharing, KeySharingContext } from "../key-sharing";
import { escapeKeyUiHtml, parseKeyQrPayload } from "../key-ui";
import { inspectCanonicalBase64 } from "../base64-validation";
import {
  assertWithinClientUploadLimit,
  CLIENT_MAX_IN_MEMORY_BYTES,
  CLIENT_MIN_CHUNK_BYTES,
  CLIENT_MAX_UPLOAD_BYTES,
} from "../limits";
import { InMemoryStorage } from "./test-utils";

function cloneBlob(blob: EncryptedBlob): EncryptedBlob {
  return JSON.parse(JSON.stringify(blob)) as EncryptedBlob;
}

function flipFirstBase64Byte(value: string): string {
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  bytes[0] ^= 1;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function setNonZeroBase64PaddingBits(value: string): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const dataIndex = value.endsWith("==")
    ? value.length - 3
    : value.endsWith("=")
      ? value.length - 2
      : -1;
  if (dataIndex < 0) throw new Error("Test value must contain base64 padding");
  const sextet = alphabet.indexOf(value[dataIndex]);
  if (sextet < 0) throw new Error("Test value is not base64");
  return (
    value.slice(0, dataIndex) +
    alphabet[sextet | 1] +
    value.slice(dataIndex + 1)
  );
}

describe("browser security regressions", () => {
  test("authenticates encoding and compression metadata", async () => {
    const client = new VoidedE2EEClient({
      storage: new InMemoryStorage(),
      keyId: "metadata-test",
    });
    const blob = await client.encrypt("safe\u0000text", {
      compressionAlgorithm: "none",
    });

    const encodingTamper = cloneBlob(blob);
    encodingTamper.textEncoding = "utf16le";
    await expect(client.decrypt(encodingTamper)).rejects.toBeInstanceOf(
      CryptoError
    );

    const compressionTamper = cloneBlob(blob);
    compressionTamper.compression.algorithm = "gzip";
    await expect(client.decrypt(compressionTamper)).rejects.toBeInstanceOf(
      CryptoError
    );
  });

  test("rejects reordered, truncated, and cross-message chunks", async () => {
    const client = new VoidedE2EEClient({
      storage: new InMemoryStorage(),
      keyId: "chunk-test",
      chunkSize: CLIENT_MIN_CHUNK_BYTES,
      minChunkThreshold: 1,
    });
    const first = await client.encrypt(
      "A".repeat(CLIENT_MIN_CHUNK_BYTES) +
        "B".repeat(CLIENT_MIN_CHUNK_BYTES) +
        "C".repeat(CLIENT_MIN_CHUNK_BYTES), {
      compressionAlgorithm: "none",
    });
    const second = await client.encrypt(
      "1".repeat(CLIENT_MIN_CHUNK_BYTES) +
        "2".repeat(CLIENT_MIN_CHUNK_BYTES) +
        "3".repeat(CLIENT_MIN_CHUNK_BYTES), {
      compressionAlgorithm: "none",
    });

    const nonCanonicalOrder = cloneBlob(first);
    [nonCanonicalOrder.chunks![0], nonCanonicalOrder.chunks![1]] = [
      nonCanonicalOrder.chunks![1],
      nonCanonicalOrder.chunks![0],
    ];
    await expect(client.decrypt(nonCanonicalOrder)).rejects.toBeInstanceOf(
      ValidationError
    );

    const duplicate = cloneBlob(first);
    duplicate.chunks![1] = { ...duplicate.chunks![0] };
    await expect(client.decrypt(duplicate)).rejects.toBeInstanceOf(
      ValidationError
    );

    const reordered = cloneBlob(first);
    [reordered.chunks![0].data, reordered.chunks![1].data] = [
      reordered.chunks![1].data,
      reordered.chunks![0].data,
    ];
    [reordered.chunks![0].iv, reordered.chunks![1].iv] = [
      reordered.chunks![1].iv,
      reordered.chunks![0].iv,
    ];
    await expect(client.decrypt(reordered)).rejects.toBeInstanceOf(CryptoError);

    const ivTamper = cloneBlob(first);
    ivTamper.chunks![0].iv =
      ivTamper.chunks![0].iv === "AAAAAAAAAAAAAAAA"
        ? "AQAAAAAAAAAAAAAA"
        : "AAAAAAAAAAAAAAAA";
    await expect(client.decrypt(ivTamper)).rejects.toBeInstanceOf(CryptoError);

    const truncated = cloneBlob(first);
    truncated.chunks!.pop();
    await expect(client.decrypt(truncated)).rejects.toBeInstanceOf(
      ValidationError
    );

    const substituted = cloneBlob(first);
    substituted.chunks![1] = cloneBlob(second).chunks![1];
    await expect(client.decrypt(substituted)).rejects.toBeInstanceOf(
      CryptoError
    );
  });

  test("signature mode fails closed and verifies every chunk", async () => {
    const client = new VoidedE2EEClient({
      storage: new InMemoryStorage(),
      keyId: "signature-test",
      enableSignatures: true,
      chunkSize: CLIENT_MIN_CHUNK_BYTES,
      minChunkThreshold: 1,
    });
    const trustedPublicKey = await client.generateSigningKeys();
    await client.setTrustedSigningPublicKey(trustedPublicKey);
    const blob = await client.encrypt("A".repeat(CLIENT_MIN_CHUNK_BYTES * 2), {
      compressionAlgorithm: "none",
    });

    const strippedEnvelope = cloneBlob(blob);
    delete strippedEnvelope.signature;
    await expect(client.decrypt(strippedEnvelope)).rejects.toThrow(
      "Missing required envelope signature"
    );

    const strippedChunk = cloneBlob(blob);
    delete strippedChunk.chunks![0].signature;
    await expect(client.decrypt(strippedChunk)).rejects.toThrow(
      "Missing required chunk 0 signature"
    );
  });

  test("signature verification requires the explicitly trusted peer key", async () => {
    const client = new VoidedE2EEClient({
      storage: new InMemoryStorage(),
      enableSignatures: true,
    });
    await client.generateSigningKeys();
    const blob = await client.encrypt("signed");
    await expect(client.decrypt(blob)).rejects.toThrow(
      "explicitly trusted peer signing public key"
    );

    const stranger = new VoidedE2EEClient({
      storage: new InMemoryStorage(),
      enableSignatures: true,
    });
    const strangerPublicKey = await stranger.generateSigningKeys();
    await client.setTrustedSigningPublicKey(strangerPublicKey);
    await expect(client.decrypt(blob)).rejects.toThrow(
      "Invalid envelope signature"
    );
  });

  test("legacy 1.0 envelopes fail closed", async () => {
    const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
    const blob = await client.encrypt("new format");
    (blob as any).version = "1.0";
    await expect(client.decrypt(blob)).rejects.toThrow(
      "only the authenticated 1.1 envelope is supported"
    );
  });

  test("rejects a mutated embedded IV prefix even when the separate IV is intact", async () => {
    const singleClient = new VoidedE2EEClient({ storage: new InMemoryStorage() });
    const single = await singleClient.encrypt("single envelope");
    const singleTamper = cloneBlob(single);
    singleTamper.data = flipFirstBase64Byte(singleTamper.data!);
    await expect(singleClient.decrypt(singleTamper)).rejects.toThrow(
      "IV prefix does not match"
    );

    const chunkClient = new VoidedE2EEClient({
      storage: new InMemoryStorage(),
      chunkSize: CLIENT_MIN_CHUNK_BYTES,
      minChunkThreshold: 1,
    });
    const chunked = await chunkClient.encrypt(
      "C".repeat(CLIENT_MIN_CHUNK_BYTES * 2),
      { compressionAlgorithm: "none" }
    );
    const chunkTamper = cloneBlob(chunked);
    chunkTamper.chunks![0].data = flipFirstBase64Byte(
      chunkTamper.chunks![0].data
    );
    await expect(chunkClient.decrypt(chunkTamper)).rejects.toThrow(
      "IV prefix does not match"
    );
  });

  test("rejects alternate base64 spellings with non-zero padding bits", async () => {
    const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
    const blob = await client.encrypt("canonical envelope");
    const tampered = cloneBlob(blob);
    tampered.messageId = setNonZeroBase64PaddingBits(tampered.messageId);

    await expect(client.decrypt(tampered)).rejects.toThrow(
      "messageId is not canonical base64"
    );
  });

  test("compression defaults to none and explicit brotli does not downgrade", async () => {
    const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
    const blob = await client.encrypt("secret=".repeat(1000));
    expect(blob.compression.algorithm).toBe("none");
    const optedIn = await client.encrypt("compress-me-".repeat(1000), {
      forceCompression: true,
    });
    expect(optedIn.compression.algorithm).toBe("gzip");
    await expect(
      client.encrypt("unknown", {
        compressionAlgorithm: "zip" as any,
      })
    ).rejects.toThrow("Unsupported compression algorithm");
    await expect(
      client.encrypt("brotli request", { compressionAlgorithm: "brotli" })
    ).rejects.toThrow("Brotli compression requires");
  });

  test("bounded decompression rejects empty gzip and high expansion", async () => {
    await expect(decompress(new Uint8Array(0), "gzip")).rejects.toThrow(
      "cannot be empty"
    );
    const bomb = gzipSync(new Uint8Array(2 * 1024 * 1024));
    await expect(
      decompress(bomb, "gzip", {
        maxOutputBytes: 128 * 1024,
        maxExpansionRatio: 64,
      })
    ).rejects.toThrow("exceeds configured output limits");
  });

  test("removed forward-secrecy claim fails closed", () => {
    expect(
      () =>
        new VoidedE2EEClient({
          storage: new InMemoryStorage(),
          enableForwardSecrecy: true,
        })
    ).toThrow("not a forward-secret ratchet");
  });

  test("password KDF rejects weak policy and returns recovery metadata", async () => {
    const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
    await expect(
      client.deriveKeyFromPassword({
        password: "short",
        iterations: 600_000,
      })
    ).rejects.toThrow("at least 12");
    await expect(
      client.deriveKeyFromPassword({
        password: "long-enough-password",
        iterations: 1,
      })
    ).rejects.toThrow("PBKDF2 iterations");

    const salt = new Uint8Array(16).fill(7);
    const record = await client.deriveKeyFromPassword({
      password: "long-enough-password",
      salt,
      iterations: 600_000,
    });
    expect(record).toEqual({
      version: 1,
      algorithm: "PBKDF2-SHA256",
      salt: "BwcHBwcHBwcHBwcHBwcHBw==",
      iterations: 600_000,
      keyVersion: 1,
    });
  });

  test("reserved storage namespaces cannot collide", () => {
    expect(
      () =>
        new VoidedE2EEClient({
          storage: new InMemoryStorage(),
          keyId: "user::voided:key:v1",
        })
    ).toThrow("reserved namespace");
  });

  test("rejects pre-allocation HKDF and upload-boundary abuse", async () => {
    const cryptoService = new CryptoService();
    await expect(
      cryptoService.hkdfDeriveRaw(
        new Uint8Array(32),
        new Uint8Array(16),
        new Uint8Array(0),
        8161
      )
    ).rejects.toThrow("1 to 8160");
    expect(() => assertWithinClientUploadLimit(Number.NaN)).toThrow(
      "non-negative safe integer"
    );
    expect(() =>
      assertWithinClientUploadLimit(CLIENT_MAX_UPLOAD_BYTES + 1)
    ).toThrow("4 GiB - 1 byte");
  });

  test("validates multi-megabyte canonical base64 without recursive regex", () => {
    const encoded = "A".repeat(8 * 1024 * 1024);
    expect(inspectCanonicalBase64(encoded, 6 * 1024 * 1024)).toEqual({
      ok: true,
      decodedLength: 6 * 1024 * 1024,
    });
  });

  test("rejects raw AES-GCM memory and fake-byte abuse before WebCrypto", async () => {
    const cryptoService = new CryptoService();
    const encryptSpy = jest.spyOn(crypto.subtle, "encrypt");
    const decryptSpy = jest.spyOn(crypto.subtle, "decrypt");
    const unusedKey = {} as CryptoKey;
    const sharedBytes = new Uint8Array(
      Math.floor(CLIENT_MAX_IN_MEMORY_BYTES / 2) + 1
    );
    const fakeOversizeBytes = {
      byteLength: CLIENT_MAX_IN_MEMORY_BYTES + 1,
      length: CLIENT_MAX_IN_MEMORY_BYTES + 1,
    } as unknown as Uint8Array;

    try {
      await expect(
        cryptoService.encrypt(sharedBytes, unusedKey, sharedBytes)
      ).rejects.toThrow("100 MiB browser in-memory limit");
      await expect(
        cryptoService.decrypt(
          sharedBytes,
          new Uint8Array(12),
          unusedKey,
          sharedBytes,
          false
        )
      ).rejects.toThrow("100 MiB browser in-memory limit");

      await expect(
        cryptoService.encrypt(fakeOversizeBytes, unusedKey)
      ).rejects.toThrow("must be a Uint8Array");
      await expect(
        cryptoService.decrypt(
          fakeOversizeBytes,
          new Uint8Array(12),
          unusedKey,
          undefined,
          false
        )
      ).rejects.toThrow("must be a Uint8Array");

      await expect(
        cryptoService.decrypt(
          new Uint8Array(28),
          new Uint8Array(11),
          unusedKey,
          undefined,
          true
        )
      ).rejects.toThrow("IV must contain exactly 12 bytes");
      await expect(
        cryptoService.decrypt(
          new Uint8Array(16),
          new Uint8Array(13),
          unusedKey,
          undefined,
          false
        )
      ).rejects.toThrow("IV must contain exactly 12 bytes");

      expect(encryptSpy).not.toHaveBeenCalled();
      expect(decryptSpy).not.toHaveBeenCalled();
    } finally {
      encryptSpy.mockRestore();
      decryptSpy.mockRestore();
    }
  });

  test("aligns raw KDF bounds and rejects invalid shared secrets", async () => {
    const cryptoService = new CryptoService();
    const salt = new Uint8Array(16);
    await expect(
      cryptoService.deriveKeyPbkdf2(new Uint8Array([1]), salt, 99_999)
    ).rejects.toThrow("100000 to 1000000");
    await expect(
      cryptoService.deriveKeyPbkdf2(new Uint8Array([1]), salt, 1_000_001)
    ).rejects.toThrow("100000 to 1000000");
    await expect(
      cryptoService.deriveKeyFromSharedSecret(
        new Uint8Array(32),
        "shared-secret-salt",
        "shared-secret-info"
      )
    ).rejects.toThrow("all-zero shared secret");
    await expect(
      cryptoService.deriveKeyFromSharedSecret(
        new Uint8Array(31).fill(1),
        "shared-secret-salt",
        "shared-secret-info"
      )
    ).rejects.toThrow("invalid X25519 shared secret length");
  });

  test("rejects tiny chunks before hostile inputs can create millions of views", () => {
    expect(
      () => new VoidedE2EEClient({
        storage: new InMemoryStorage(),
        chunkSize: 1,
      })
    ).toThrow(`${CLIENT_MIN_CHUNK_BYTES}`);
  });

  test("IndexedDB reads and writes wait for transaction completion", async () => {
    const originalIndexedDB = global.indexedDB;
    const transactions: any[] = [];
    const operationRequests: any[] = [];
    const openRequests: any[] = [];
    const captured = async (items: any[], index: number, label: string) => {
      for (let attempt = 0; attempt < 10 && !items[index]; attempt += 1) {
        await Promise.resolve();
      }
      if (!items[index]) throw new Error(`Test fixture did not capture ${label}`);
      return items[index];
    };
    const makeRequest = (result: unknown) => {
      const request: any = { result, error: null };
      operationRequests.push(request);
      return request;
    };
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore: jest.fn(),
      close: jest.fn(),
      transaction: () => {
        const transaction: any = {
          error: null,
          db: { close: jest.fn() },
          objectStore: () => ({
            put: () => makeRequest(undefined),
            get: () => makeRequest(null),
            delete: () => makeRequest(undefined),
          }),
          abort: () => transaction.onabort?.({ target: transaction }),
        };
        transactions.push(transaction);
        return transaction;
      },
    };
    (global as any).indexedDB = {
      open: () => {
        const request: any = { result: db, error: null };
        openRequests.push(request);
        return request;
      },
    };

    try {
      const storage = new IndexedDBStorage();
      let writeSettled = false;
      const write = storage.setKey("durable", "value").then(() => {
        writeSettled = true;
      });
      const writeOpen = await captured(openRequests, 0, "write open request");
      writeOpen.onsuccess({ target: writeOpen });
      const writeRequest = await captured(operationRequests, 0, "write request");
      writeRequest.onsuccess({ target: writeRequest });
      await Promise.resolve();
      expect(writeSettled).toBe(false);
      transactions[0].oncomplete({ target: transactions[0] });
      await write;

      let readSettled = false;
      const read = storage.getKey("missing").then(value => {
        readSettled = true;
        return value;
      });
      const readOpen = await captured(openRequests, 1, "read open request");
      readOpen.onsuccess({ target: readOpen });
      const readRequest = await captured(operationRequests, 1, "read request");
      readRequest.onsuccess({ target: readRequest });
      await Promise.resolve();
      expect(readSettled).toBe(false);
      transactions[1].oncomplete({ target: transactions[1] });
      await expect(read).resolves.toBeNull();
    } finally {
      (global as any).indexedDB = originalIndexedDB;
    }
  });

  test("holds a stable-key lease until encryption has fully returned", async () => {
    const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
    const cryptoService = (client as any).crypto as CryptoService;
    const originalEncrypt = cryptoService.encrypt.bind(cryptoService);
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    (cryptoService as any).encrypt = async (...args: any[]) => {
      entered();
      await gate;
      return originalEncrypt(args[0], args[1], args[2]);
    };

    const order: string[] = [];
    const encryption = client.encrypt("paused encryption").then(blob => {
      order.push("encrypt");
      return blob;
    });
    await started;
    const rotation = client.rotateKey().then(key => {
      order.push("rotate");
      return key;
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(order).toEqual([]);
    resume();
    await encryption;
    await rotation;
    expect(order).toEqual(["encrypt", "rotate"]);
  });

  test("refreshes a stale client cache after another instance rotates", async () => {
    const storage = new InMemoryStorage();
    const first = new VoidedE2EEClient({ storage, keyId: "shared-client" });
    const second = new VoidedE2EEClient({ storage, keyId: "shared-client" });
    const initial = await first.encrypt("initial");
    await expect(second.decrypt(initial)).resolves.toBe("initial");
    await first.rotateKey();
    const fresh = await second.encrypt("fresh");
    await expect(first.decrypt(fresh)).resolves.toBe("fresh");
  });

  test("rejects raw replacement while migration authority is active", async () => {
    const client = new VoidedE2EEClient({ storage: new InMemoryStorage() });
    await client.encrypt("initialize durable key");
    const oldKey = await client.exportKey();
    await client.rotateKey({ force: false, migrate: true });
    await expect(client.importKey(oldKey)).rejects.toThrow(
      "while a migration is active"
    );
    const duringMigration = await client.encrypt("migration stays coherent");
    await expect(client.decrypt(duringMigration)).resolves.toBe(
      "migration stays coherent"
    );
  });

  test("auxiliary KDF metadata failures never falsify a committed key operation", async () => {
    class MetadataFailingStorage extends InMemoryStorage {
      failMetadataWrites = false;
      failMetadataDeletes = false;
      async setKey(keyId: string, value: string): Promise<void> {
        if (this.failMetadataWrites && keyId.includes("password-kdf")) {
          throw new Error("metadata write failed");
        }
        return super.setKey(keyId, value);
      }
      async removeKey(keyId: string): Promise<void> {
        if (this.failMetadataDeletes && keyId.includes("password-kdf")) {
          throw new Error("metadata delete failed");
        }
        return super.removeKey(keyId);
      }
    }

    const writeFailingStorage = new MetadataFailingStorage();
    writeFailingStorage.failMetadataWrites = true;
    const writeFailingClient = new VoidedE2EEClient({ storage: writeFailingStorage });
    await expect(writeFailingClient.deriveKeyFromPassword({
      password: "long-enough-password",
      iterations: 600_000,
    })).rejects.toThrow("metadata write failed");
    await expect(writeFailingClient.hasKey()).resolves.toBe(false);

    const storage = new MetadataFailingStorage();
    const client = new VoidedE2EEClient({ storage });
    await client.deriveKeyFromPassword({
      password: "long-enough-password",
      iterations: 600_000,
    });
    const exported = await client.exportKey();
    storage.failMetadataDeletes = true;
    await expect(client.importKey(exported)).resolves.toBeUndefined();
    await expect(client.getPasswordKeyDerivationRecord()).resolves.toBeNull();
    await expect(client.rotateKey()).resolves.toEqual(expect.any(String));
    await expect(client.deleteKey()).resolves.toBeUndefined();
  });

  test("escapes caller-controlled key UI template text", () => {
    expect(escapeKeyUiHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
  });

  test("accepts only non-empty Voided key QR payloads", () => {
    expect(parseKeyQrPayload("voideddev-KEY:YWJjZA==")).toBe("YWJjZA==");
    expect(() => parseKeyQrPayload("https://attacker.example/key")).toThrow(
      "not a Voided encryption key"
    );
    expect(() => parseKeyQrPayload("voideddev-KEY:   ")).toThrow(
      "empty encryption key"
    );
  });

  test("key sharing binds direction/context and consumes transfer IDs", async () => {
    const cryptoService = new CryptoService();
    const sender = await cryptoService.generateX25519KeyPair();
    const recipient = await cryptoService.generateX25519KeyPair();
    const key = await cryptoService.generateKey();
    const sharing = new KeySharing(cryptoService);
    const context: KeySharingContext = {
      senderId: "alice",
      recipientId: "bob",
      keyId: "document-key",
      transferId: KeySharing.createTransferId(),
    };
    await expect(
      sharing.encryptKeyForRecipient(
        key,
        sender.privateKey,
        recipient.publicKey,
        {
          ...context,
          transferId: setNonZeroBase64PaddingBits(context.transferId),
        }
      )
    ).rejects.toThrow("canonical base64 16-byte value");
    await expect(
      sharing.encryptKeyForRecipient(
        key,
        sender.privateKey,
        recipient.publicKey,
        { ...context, salt: 7 as any }
      )
    ).rejects.toThrow("salt must contain");

    const encrypted = await sharing.encryptKeyForRecipient(
      key,
      sender.privateKey,
      recipient.publicKey,
      context
    );

    await expect(
      sharing.decryptKeyFromSender(
        encrypted,
        recipient.privateKey,
        sender.publicKey,
        { ...context, senderId: "bob", recipientId: "alice" }
      )
    ).rejects.toBeInstanceOf(CryptoError);

    await expect(
      sharing.decryptKeyFromSender(
        encrypted,
        recipient.privateKey,
        sender.publicKey,
        context
      )
    ).resolves.toBeDefined();
    await expect(
      sharing.decryptKeyFromSender(
        encrypted,
        recipient.privateKey,
        sender.publicKey,
        context
      )
    ).rejects.toThrow("already consumed");
  });

  test("public lifecycle reads propagate storage failures", async () => {
    class FailingStorage implements E2EEStorage {
      async getKey(): Promise<string | null> {
        throw new Error("read failed");
      }
      async setKey(): Promise<void> {}
      async removeKey(): Promise<void> {}
      async getMigrationState(): Promise<MigrationState | null> {
        throw new Error("migration read failed");
      }
      async setMigrationState(): Promise<void> {}
      async removeMigrationState(): Promise<void> {}
      async getKeyPair(): Promise<string | null> {
        return null;
      }
      async setKeyPair(): Promise<void> {}
      async removeKeyPair(): Promise<void> {}
    }
    const client = new VoidedE2EEClient({ storage: new FailingStorage() });
    await expect(client.hasKey()).rejects.toThrow("read failed");
    await expect(client.getMigrationStatus()).rejects.toThrow(
      "migration read failed"
    );
    await expect(client.getMigrationInfo()).rejects.toThrow(
      "migration read failed"
    );
    await expect(client.getCurrentKeyVersion()).rejects.toThrow(
      "migration read failed"
    );
  });
});
