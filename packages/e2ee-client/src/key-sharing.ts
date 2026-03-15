import { CryptoService } from "./crypto-service";
import { CryptoError } from "./errors";

interface KeySharingContext {
  salt?: string;
  info?: string;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export class KeySharing {
  constructor(private crypto: CryptoService = new CryptoService()) {}

  async encryptKeyForRecipient(
    keyToShare: CryptoKey,
    ourPrivateKey: ArrayBuffer | Uint8Array,
    recipientPublicKey: ArrayBuffer | Uint8Array,
    context?: KeySharingContext
  ): Promise<ArrayBuffer> {
    const sharedSecret = await this.crypto.x25519SharedSecret(
      ourPrivateKey,
      recipientPublicKey
    );

    let rawKey: ArrayBuffer | null = null;
    try {
      const exchangeKey = await this.crypto.deriveKeyFromSharedSecret(
        sharedSecret,
        context?.salt ?? "voided-key-share-v1",
        context?.info ?? "key-share"
      );

      rawKey = await crypto.subtle.exportKey("raw", keyToShare);
      return await this.crypto.encrypt(new Uint8Array(rawKey), exchangeKey);
    } finally {
      this.crypto.secureWipe(sharedSecret);
      if (rawKey) {
        this.crypto.secureWipe(rawKey);
      }
    }
  }

  async decryptKeyFromSender(
    encryptedBlob: ArrayBuffer | Uint8Array,
    ourPrivateKey: ArrayBuffer | Uint8Array,
    senderPublicKey: ArrayBuffer | Uint8Array,
    context?: KeySharingContext
  ): Promise<CryptoKey> {
    const encryptedBytes = toUint8Array(encryptedBlob);
    if (encryptedBytes.length <= 12) {
      throw new CryptoError("Encrypted key blob is too short");
    }

    const sharedSecret = await this.crypto.x25519SharedSecret(
      ourPrivateKey,
      senderPublicKey
    );

    let rawKey: Uint8Array | null = null;
    try {
      const exchangeKey = await this.crypto.deriveKeyFromSharedSecret(
        sharedSecret,
        context?.salt ?? "voided-key-share-v1",
        context?.info ?? "key-share"
      );

      const iv = encryptedBytes.slice(0, 12);
      rawKey = await this.crypto.decrypt(encryptedBytes, iv, exchangeKey);
      return await crypto.subtle.importKey(
        "raw",
        rawKey as unknown as BufferSource,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    } finally {
      this.crypto.secureWipe(sharedSecret);
      if (rawKey) {
        this.crypto.secureWipe(rawKey);
      }
    }
  }

  async encryptKeyForTransfer(
    keyToTransfer: CryptoKey,
    transferKey: CryptoKey
  ): Promise<ArrayBuffer> {
    const raw = await crypto.subtle.exportKey("raw", keyToTransfer);
    try {
      return await this.crypto.encrypt(new Uint8Array(raw), transferKey);
    } finally {
      this.crypto.secureWipe(raw);
    }
  }

  async decryptKeyFromTransfer(
    encryptedBlob: ArrayBuffer | Uint8Array,
    transferKey: CryptoKey
  ): Promise<CryptoKey> {
    const encryptedBytes = toUint8Array(encryptedBlob);
    if (encryptedBytes.length <= 12) {
      throw new CryptoError("Encrypted transfer blob is too short");
    }

    const iv = encryptedBytes.slice(0, 12);
    const raw = await this.crypto.decrypt(encryptedBytes, iv, transferKey);
    try {
      return await crypto.subtle.importKey(
        "raw",
        raw as unknown as BufferSource,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    } finally {
      this.crypto.secureWipe(raw);
    }
  }

  async deriveTransferKey(
    ourPrivateKey: ArrayBuffer | Uint8Array,
    theirPublicKey: ArrayBuffer | Uint8Array
  ): Promise<CryptoKey> {
    const sharedSecret = await this.crypto.x25519SharedSecret(
      ourPrivateKey,
      theirPublicKey
    );
    try {
      return await this.crypto.deriveKeyFromSharedSecret(
        sharedSecret,
        "voided-transfer-v1",
        "key-transfer"
      );
    } finally {
      this.crypto.secureWipe(sharedSecret);
    }
  }
}
