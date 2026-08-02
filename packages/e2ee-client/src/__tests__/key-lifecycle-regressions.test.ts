import {
  E2EEStorage,
  MigrationState,
  VoidedE2EEClient,
} from "../index";

class ControllableStorage implements E2EEStorage {
  private keys = new Map<string, string>();
  private migrations = new Map<string, MigrationState>();
  private pairs = new Map<string, string>();

  failNextPrimaryRead = false;
  failPrimaryWrites = false;
  failPrimaryVerificationReadAfterCommit = false;
  failMigrationRemoval = false;
  keyWrites = 0;

  async getKey(keyId: string): Promise<string | null> {
    if (keyId === "default" && this.failNextPrimaryRead) {
      this.failNextPrimaryRead = false;
      throw new Error("transient read failure");
    }
    return this.keys.get(keyId) ?? null;
  }

  async setKey(keyId: string, key: string): Promise<void> {
    if (keyId === "default" && this.failPrimaryWrites) {
      throw new Error("primary write failure");
    }
    this.keyWrites += 1;
    this.keys.set(keyId, key);
    if (keyId === "default" && this.failPrimaryVerificationReadAfterCommit) {
      this.failPrimaryVerificationReadAfterCommit = false;
      this.failNextPrimaryRead = true;
    }
  }

  async removeKey(keyId: string): Promise<void> {
    this.keys.delete(keyId);
  }

  async getMigrationState(keyId: string): Promise<MigrationState | null> {
    return this.migrations.get(keyId) ?? null;
  }

  async setMigrationState(
    keyId: string,
    state: MigrationState
  ): Promise<void> {
    this.migrations.set(keyId, state);
  }

  async removeMigrationState(keyId: string): Promise<void> {
    if (this.failMigrationRemoval) {
      throw new Error("migration marker removal failure");
    }
    this.migrations.delete(keyId);
  }

  async getKeyPair(
    keyId: string,
    type: "signing" | "agreement"
  ): Promise<string | null> {
    return this.pairs.get(`${keyId}_${type}`) ?? null;
  }

  async setKeyPair(
    keyId: string,
    type: "signing" | "agreement",
    keyPair: string
  ): Promise<void> {
    this.pairs.set(`${keyId}_${type}`, keyPair);
  }

  async removeKeyPair(
    keyId: string,
    type: "signing" | "agreement"
  ): Promise<void> {
    this.pairs.delete(`${keyId}_${type}`);
  }

  peek(keyId: string): string | null {
    return this.keys.get(keyId) ?? null;
  }
}

function rawPrimaryKey(storage: ControllableStorage): string {
  const stored = storage.peek("default");
  const match = stored && /^([A-Za-z0-9+/]{43}=)\.v1$/.exec(stored);
  if (!match) throw new Error("Expected a generated version-1 primary key");
  return match[1];
}

function activeMigrationState(
  oldKeyVersion: number,
  newKeyVersion: number
): MigrationState {
  return {
    isActive: true,
    oldKeyVersion,
    newKeyVersion,
    cutoffTime: new Date(),
    lastProgress: 0,
    createdAt: new Date(),
  };
}

describe("key lifecycle regressions", () => {
  test("a transient read error never becomes key absence or overwrites storage", async () => {
    const storage = new ControllableStorage();
    const firstClient = new VoidedE2EEClient({ storage });
    const blob = await firstClient.encrypt("survives a storage retry");
    const originalKey = storage.peek("default");
    const writesBeforeFailure = storage.keyWrites;

    storage.failNextPrimaryRead = true;
    const reloadedClient = new VoidedE2EEClient({ storage });

    await expect(reloadedClient.encrypt("must fail closed")).rejects.toThrow(
      "transient read failure"
    );
    expect(storage.peek("default")).toBe(originalKey);
    expect(storage.keyWrites).toBe(writesBeforeFailure);

    await expect(reloadedClient.decrypt(blob)).resolves.toBe(
      "survives a storage retry"
    );
  });

  test("force rotation leaves the old primary intact when replacement publication fails", async () => {
    const storage = new ControllableStorage();
    const client = new VoidedE2EEClient({ storage });
    const oldBlob = await client.encrypt("old key remains recoverable");
    const originalKey = storage.peek("default");

    storage.failPrimaryWrites = true;
    await expect(client.rotateKey({ force: true })).rejects.toThrow(
      "primary write failure"
    );
    expect(storage.peek("default")).toBe(originalKey);

    storage.failPrimaryWrites = false;
    const reloadedClient = new VoidedE2EEClient({ storage });
    await expect(reloadedClient.decrypt(oldBlob)).resolves.toBe(
      "old key remains recoverable"
    );
  });

  test("force rotation resolves a committed primary after a transient verification read", async () => {
    const storage = new ControllableStorage();
    const client = new VoidedE2EEClient({ storage });
    const oldBlob = await client.encrypt("old generation");

    storage.failPrimaryVerificationReadAfterCommit = true;
    await expect(client.rotateKey({ force: true })).resolves.toEqual(
      expect.any(String)
    );

    const newBlob = await client.encrypt("new generation");
    const reloadedClient = new VoidedE2EEClient({ storage });
    await expect(reloadedClient.decrypt(newBlob)).resolves.toBe("new generation");
    await expect(reloadedClient.decrypt(oldBlob)).rejects.toThrow(
      "Decryption failed"
    );
  });

  test("migration survives reload and finalization preserves the new primary", async () => {
    const storage = new ControllableStorage();
    const client = new VoidedE2EEClient({ storage });
    const oldBlob = await client.encrypt("legacy");

    // Version slots and the migration marker are the durable authority. A
    // failed compatibility-alias write must not destroy either generation.
    storage.failPrimaryWrites = true;
    await client.rotateKey({ force: false, migrate: true });
    storage.failPrimaryWrites = false;

    const newBlob = await client.encrypt("current");
    const reloadedClient = new VoidedE2EEClient({ storage });
    await expect(reloadedClient.getCurrentKeyVersion()).resolves.toBe(2);
    await expect(reloadedClient.decrypt(oldBlob)).resolves.toBe("legacy");
    await expect(reloadedClient.decrypt(newBlob)).resolves.toBe("current");

    await reloadedClient.finalizeMigration();
    expect(storage.peek("default")).not.toBeNull();
    expect(storage.peek("default::voided:key:v1")).toBeNull();

    const finalizedClient = new VoidedE2EEClient({ storage });
    await expect(finalizedClient.decrypt(newBlob)).resolves.toBe("current");
    await expect(finalizedClient.decrypt(oldBlob)).rejects.toThrow(
      "Decryption failed"
    );
  });

  test("deleting a key also removes a leftover current-version staging slot", async () => {
    const storage = new ControllableStorage();
    const client = new VoidedE2EEClient({ storage });
    await client.encrypt("initialize key");
    const currentKey = storage.peek("default");
    expect(currentKey).not.toBeNull();

    await storage.setKey("default::voided:key:v1", currentKey!);
    await client.deleteKey();

    expect(storage.peek("default")).toBeNull();
    expect(storage.peek("default::voided:key:v1")).toBeNull();
  });

  test("failed migration-marker removal never deletes the legacy key", async () => {
    const storage = new ControllableStorage();
    const client = new VoidedE2EEClient({ storage });
    const legacyBlob = await client.encrypt("legacy must remain recoverable");

    await client.rotateKey({ force: false, migrate: true });
    storage.failMigrationRemoval = true;

    await expect(client.finalizeMigration()).rejects.toThrow(
      "migration marker removal failure"
    );
    expect(storage.peek("default::voided:key:v1")).not.toBeNull();

    const reloadedClient = new VoidedE2EEClient({ storage });
    await expect(reloadedClient.decrypt(legacyBlob)).resolves.toBe(
      "legacy must remain recoverable"
    );
  });

  test("accepts only an exact canonical bare key as legacy version 1", async () => {
    const storage = new ControllableStorage();
    const seedClient = new VoidedE2EEClient({ storage });
    await seedClient.encrypt("seed");
    const rawKey = rawPrimaryKey(storage);

    await storage.setKey("default", rawKey);
    const legacyClient = new VoidedE2EEClient({ storage });

    await expect(legacyClient.getCurrentKeyVersion()).resolves.toBe(1);
    const blob = await legacyClient.encrypt("bare legacy key remains usable");
    await expect(legacyClient.decrypt(blob)).resolves.toBe(
      "bare legacy key remains usable"
    );
  });

  test("rejects malformed, non-canonical, and unsafe primary key versions", async () => {
    const seedStorage = new ControllableStorage();
    await new VoidedE2EEClient({ storage: seedStorage }).encrypt("seed");
    const rawKey = rawPrimaryKey(seedStorage);
    const invalidValues = [
      `${rawKey}.v01`,
      `${rawKey}.v0`,
      `${rawKey}.v-1`,
      `${rawKey}.v1junk`,
      `${rawKey}.v1.v2`,
      `${rawKey}.v9007199254740992`,
      `${rawKey}.v1${"0".repeat(1024 * 1024)}`,
      `${rawKey.slice(0, -2)}B=`,
      rawKey.slice(1),
    ];

    for (const invalidValue of invalidValues) {
      const storage = new ControllableStorage();
      await storage.setKey("default", invalidValue);
      const client = new VoidedE2EEClient({ storage });

      await expect(client.getCurrentKeyVersion()).rejects.toThrow(
        "Invalid stored encryption key format"
      );
      expect(storage.peek("default")).toBe(invalidValue);
    }
  });

  test("force rotation cannot bypass malformed or overflowing versions", async () => {
    const seedStorage = new ControllableStorage();
    await new VoidedE2EEClient({ storage: seedStorage }).encrypt("seed");
    const rawKey = rawPrimaryKey(seedStorage);
    const rejectedPrimaries = [
      `${rawKey}.v01`,
      `${rawKey}.v${Number.MAX_SAFE_INTEGER}`,
    ];

    for (const rejectedPrimary of rejectedPrimaries) {
      const storage = new ControllableStorage();
      await storage.setKey("default", rejectedPrimary);
      const writesBeforeRotation = storage.keyWrites;
      const client = new VoidedE2EEClient({ storage });

      await expect(client.rotateKey({ force: true })).rejects.toThrow();
      expect(storage.peek("default")).toBe(rejectedPrimary);
      expect(storage.keyWrites).toBe(writesBeforeRotation);
    }
  });

  test("binds an active migration new-key slot to its state version", async () => {
    const storage = new ControllableStorage();
    await new VoidedE2EEClient({ storage }).encrypt("seed");
    const rawKey = rawPrimaryKey(storage);

    await storage.setKey("default::voided:key:v2", `${rawKey}.v3`);
    await storage.setMigrationState("default", activeMigrationState(1, 2));

    const reloadedClient = new VoidedE2EEClient({ storage });
    await expect(reloadedClient.getCurrentKeyVersion()).rejects.toThrow(
      "expected slot v2"
    );
  });

  test("binds an active migration legacy slot to its state version", async () => {
    const storage = new ControllableStorage();
    const oldClient = new VoidedE2EEClient({ storage });
    const oldBlob = await oldClient.encrypt("legacy generation");
    const oldRawKey = rawPrimaryKey(storage);

    const newStorage = new ControllableStorage();
    await new VoidedE2EEClient({ storage: newStorage }).encrypt("new seed");
    const newRawKey = rawPrimaryKey(newStorage);
    expect(newRawKey).not.toBe(oldRawKey);

    await storage.setKey("default", `${newRawKey}.v2`);
    await storage.setKey("default::voided:key:v2", `${newRawKey}.v2`);
    await storage.setKey("default::voided:key:v1", `${oldRawKey}.v2`);
    await storage.setMigrationState("default", activeMigrationState(1, 2));

    const reloadedClient = new VoidedE2EEClient({ storage });
    await expect(reloadedClient.decrypt(oldBlob)).rejects.toThrow(
      "expected slot v1"
    );
  });

  test("rejects forged migration-state version ranges before slot lookup", async () => {
    const forgedRanges = [
      activeMigrationState(1, 1),
      activeMigrationState(2, 1),
      activeMigrationState(1, Number.MAX_SAFE_INTEGER + 1),
    ];

    for (const forgedState of forgedRanges) {
      const storage = new ControllableStorage();
      await storage.setMigrationState("default", forgedState);
      const client = new VoidedE2EEClient({ storage });

      await expect(client.getCurrentKeyVersion()).rejects.toThrow();
      expect(storage.keyWrites).toBe(0);
    }
  });
});
