import { CryptoService } from "./crypto-service";
import { CryptoError } from "./errors";
import { inspectCanonicalBase64 } from "./base64-validation";

export interface KeySharingContext {
  senderId: string;
  recipientId: string;
  keyId: string;
  /**
   * Unique, unpredictable identifier for this transfer. Use createTransferId().
   * It is authenticated and consumed on successful decryption.
   */
  transferId: string;
  salt?: string;
}

export interface KeySharingReplayStore {
  /**
   * Atomically return true for a new transfer ID and false if it was already
   * consumed. Applications that need replay protection across reloads should
   * provide a durable implementation.
   */
  consume(id: string): Promise<boolean>;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

class MemoryReplayStore implements KeySharingReplayStore {
  private readonly consumed = new Set<string>();

  async consume(id: string): Promise<boolean> {
    if (this.consumed.has(id)) return false;
    if (this.consumed.size >= 4096) {
      throw new CryptoError(
        "In-memory key-sharing replay cache is full; use a durable replay store"
      );
    }
    this.consumed.add(id);
    return true;
  }
}

export class KeySharing {
  constructor(
    private crypto: CryptoService = new CryptoService(),
    private replayStore: KeySharingReplayStore = new MemoryReplayStore()
  ) {}

  static createTransferId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async encryptKeyForRecipient(
    keyToShare: CryptoKey,
    ourPrivateKey: ArrayBuffer | Uint8Array,
    recipientPublicKey: ArrayBuffer | Uint8Array,
    context: KeySharingContext
  ): Promise<ArrayBuffer> {
    const transcript = this.validateContext(context, "recipient-share");
    const sharedSecret = await this.crypto.x25519SharedSecret(
      ourPrivateKey,
      recipientPublicKey
    );

    let rawKey: ArrayBuffer | null = null;
    try {
      const exchangeKey = await this.crypto.deriveKeyFromSharedSecret(
        sharedSecret,
        context.salt ?? "voided-key-share-v2",
        transcript
      );
      rawKey = await crypto.subtle.exportKey("raw", keyToShare);
      return await this.crypto.encrypt(
        new Uint8Array(rawKey),
        exchangeKey,
        new TextEncoder().encode(transcript)
      );
    } finally {
      this.crypto.secureWipe(sharedSecret);
      if (rawKey) this.crypto.secureWipe(rawKey);
    }
  }

  async decryptKeyFromSender(
    encryptedBlob: ArrayBuffer | Uint8Array,
    ourPrivateKey: ArrayBuffer | Uint8Array,
    senderPublicKey: ArrayBuffer | Uint8Array,
    context: KeySharingContext
  ): Promise<CryptoKey> {
    const transcript = this.validateContext(context, "recipient-share");
    const encryptedBytes = this.validateEncryptedKeyBlob(encryptedBlob);
    const sharedSecret = await this.crypto.x25519SharedSecret(
      ourPrivateKey,
      senderPublicKey
    );

    let rawKey: Uint8Array | null = null;
    try {
      const exchangeKey = await this.crypto.deriveKeyFromSharedSecret(
        sharedSecret,
        context.salt ?? "voided-key-share-v2",
        transcript
      );
      const iv = encryptedBytes.subarray(0, 12);
      rawKey = await this.crypto.decrypt(
        encryptedBytes,
        iv,
        exchangeKey,
        new TextEncoder().encode(transcript)
      );
      if (rawKey.length !== 32) {
        throw new CryptoError("Decrypted key must contain exactly 32 bytes");
      }
      const imported = await crypto.subtle.importKey(
        "raw",
        rawKey as unknown as BufferSource,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      if (!(await this.replayStore.consume(transcript))) {
        throw new CryptoError("Key-sharing transfer was already consumed");
      }
      return imported;
    } finally {
      this.crypto.secureWipe(sharedSecret);
      if (rawKey) this.crypto.secureWipe(rawKey);
    }
  }

  async encryptKeyForTransfer(
    keyToTransfer: CryptoKey,
    transferKey: CryptoKey,
    context: KeySharingContext
  ): Promise<ArrayBuffer> {
    const transcript = this.validateContext(context, "pre-shared-transfer");
    const raw = await crypto.subtle.exportKey("raw", keyToTransfer);
    try {
      return await this.crypto.encrypt(
        new Uint8Array(raw),
        transferKey,
        new TextEncoder().encode(transcript)
      );
    } finally {
      this.crypto.secureWipe(raw);
    }
  }

  async decryptKeyFromTransfer(
    encryptedBlob: ArrayBuffer | Uint8Array,
    transferKey: CryptoKey,
    context: KeySharingContext
  ): Promise<CryptoKey> {
    const transcript = this.validateContext(context, "pre-shared-transfer");
    const encryptedBytes = this.validateEncryptedKeyBlob(encryptedBlob);
    const iv = encryptedBytes.subarray(0, 12);
    const raw = await this.crypto.decrypt(
      encryptedBytes,
      iv,
      transferKey,
      new TextEncoder().encode(transcript)
    );
    try {
      if (raw.length !== 32) {
        throw new CryptoError("Decrypted key must contain exactly 32 bytes");
      }
      const imported = await crypto.subtle.importKey(
        "raw",
        raw as unknown as BufferSource,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      if (!(await this.replayStore.consume(transcript))) {
        throw new CryptoError("Key-sharing transfer was already consumed");
      }
      return imported;
    } finally {
      this.crypto.secureWipe(raw);
    }
  }

  async deriveTransferKey(
    ourPrivateKey: ArrayBuffer | Uint8Array,
    theirPublicKey: ArrayBuffer | Uint8Array,
    context: KeySharingContext
  ): Promise<CryptoKey> {
    const transcript = this.validateContext(context, "derived-transfer-key");
    const sharedSecret = await this.crypto.x25519SharedSecret(
      ourPrivateKey,
      theirPublicKey
    );
    try {
      return await this.crypto.deriveKeyFromSharedSecret(
        sharedSecret,
        context.salt ?? "voided-transfer-v2",
        transcript
      );
    } finally {
      this.crypto.secureWipe(sharedSecret);
    }
  }

  private validateContext(
    context: KeySharingContext,
    purpose: "recipient-share" | "pre-shared-transfer" | "derived-transfer-key"
  ): string {
    if (!context || typeof context !== "object") {
      throw new CryptoError("Key-sharing context is required");
    }
    for (const [label, value] of Object.entries({
      senderId: context.senderId,
      recipientId: context.recipientId,
      keyId: context.keyId,
    })) {
      if (
        typeof value !== "string" ||
        value.length < 1 ||
        value.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(value)
      ) {
        throw new CryptoError(`Invalid key-sharing ${label}`);
      }
    }
    const transferIdInspection = inspectCanonicalBase64(context.transferId, 16);
    if (!transferIdInspection.ok || transferIdInspection.decodedLength !== 16) {
      throw new CryptoError(
        "Key-sharing transferId must be a canonical base64 16-byte value"
      );
    }
    if (
      context.salt !== undefined &&
      (typeof context.salt !== "string" ||
        context.salt.length < 16 ||
        context.salt.length > 256)
    ) {
      throw new CryptoError("Key-sharing salt must contain 16 to 256 characters");
    }
    return JSON.stringify({
      domain: "voided/key-sharing/v2",
      purpose,
      senderId: context.senderId,
      recipientId: context.recipientId,
      keyId: context.keyId,
      transferId: context.transferId,
    });
  }

  private validateEncryptedKeyBlob(
    encryptedBlob: ArrayBuffer | Uint8Array
  ): Uint8Array {
    const encryptedBytes = toUint8Array(encryptedBlob);
    // 12-byte IV + 32-byte key + 16-byte GCM tag.
    if (encryptedBytes.length !== 60) {
      throw new CryptoError("Encrypted key blob must contain exactly 60 bytes");
    }
    return encryptedBytes;
  }
}
