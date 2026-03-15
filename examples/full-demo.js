#!/usr/bin/env node

/**
 * voideddev Full Demo - Chat Application Scenario
 *
 * This demo shows how @voideddev/e2ee-client and @voideddev/enc-server
 * work together in a real application like a chat app.
 *
 * Scenario:
 * - Alice wants to send a private message to Bob (E2EE)
 * - Server also needs to store user metadata securely (Server-side encryption)
 * - Demonstrates both libraries working in harmony
 */

// Simulating imports (in real app these would be from npm packages)
// import { VoidedE2EEClient } from '@voideddev/e2ee-client';
// import { VoidedService, generateMap } from '@voideddev/enc-server';

console.log("🎭 voideddev Full Demo - Secure Chat Application\n");

// Mock implementations for demo (replace with actual imports)
class MockE2EEClient {
  async encrypt(data) {
    return {
      data: Buffer.from(data).toString("base64") + "_encrypted",
      iv: "mock_iv",
      keyId: "alice_key",
      algorithm: "AES-GCM",
      version: "1.0",
      compressed: data.length > 100,
    };
  }

  async decrypt(blob) {
    return Buffer.from(
      blob.data.replace("_encrypted", ""),
      "base64"
    ).toString();
  }
}

class MockServerService {
  async encryptWithMap(data) {
    const obfuscated = data
      .split("")
      .map((c) =>
        Math.random() > 0.5
          ? ["bright", "lunar", "swift", "golden"][
              Math.floor(Math.random() * 4)
            ]
          : c.charCodeAt(0).toString(16)
      )
      .join("_");

    return {
      blob: obfuscated,
      metadata: {
        originalSize: data.length,
        compressedSize: Math.floor(data.length * 0.8),
        encryptedSize: Math.floor(data.length * 0.9),
        obfuscatedSize: obfuscated.length,
        compressionRatio: 0.8,
        expansionRatio: obfuscated.length / data.length,
        algorithm: "aes-256-gcm",
        timestamp: new Date(),
      },
    };
  }
}

async function runChatDemo() {
  console.log("👥 Setting up chat participants...\n");

  // Alice and Bob's E2EE clients (client-side)
  const aliceClient = new MockE2EEClient();
  const bobClient = new MockE2EEClient();

  // Server-side encryption service
  const serverVoided = new MockServerService();

  console.log("📱 Alice wants to send a private message to Bob\n");

  // === ALICE'S SIDE (Sender) ===
  const privateMessage =
    "Hey Bob! Let's meet at the secret location we discussed. 🤫";
  console.log("📝 Alice's original message:", privateMessage);

  // Alice encrypts the message (E2EE - server can never read this)
  const encryptedMessage = await aliceClient.encrypt(privateMessage);
  console.log(
    "🔐 Alice encrypts with E2EE:",
    encryptedMessage.data.substring(0, 50) + "..."
  );

  // === SERVER SIDE ===
  console.log("\n🖥️  Server processing...");

  // Server stores message metadata (but NOT the private message content)
  const messageMetadata = {
    fromUser: "alice",
    toUser: "bob",
    timestamp: new Date().toISOString(),
    messageType: "private_message",
    chatRoom: "alice_bob_private",
  };

  // Server encrypts its own metadata using server-side encryption
  const serverEncrypted = await serverVoided.encryptWithMap(
    JSON.stringify(messageMetadata)
  );
  console.log(
    "🔒 Server encrypts metadata:",
    serverEncrypted.blob.substring(0, 50) + "..."
  );
  console.log("📊 Server encryption stats:");
  console.log(
    `   - Original size: ${serverEncrypted.metadata.originalSize} bytes`
  );
  console.log(
    `   - Obfuscated size: ${serverEncrypted.metadata.obfuscatedSize} bytes`
  );
  console.log(
    `   - Expansion ratio: ${(
      serverEncrypted.metadata.expansionRatio * 100
    ).toFixed(1)}%`
  );

  // Simulate server database storage
  const serverDatabase = {
    messageId: "msg_12345",
    encryptedContent: encryptedMessage, // E2EE - server can't read
    encryptedMetadata: serverEncrypted.blob, // Server-encrypted metadata
    publicData: {
      participants: ["alice", "bob"],
      timestamp: new Date().toISOString(),
    },
  };

  console.log("\n💾 Server stores in database:");
  console.log("   - E2EE message (server can't read): ✅");
  console.log("   - Encrypted metadata (server can read): ✅");
  console.log("   - Public routing data: ✅");

  // === BOB'S SIDE (Receiver) ===
  console.log("\n📱 Bob receives the message...");

  // Bob's client retrieves the message from server
  const retrievedMessage = serverDatabase.encryptedContent;

  // Bob decrypts the private message (only Bob can do this)
  const decryptedMessage = await bobClient.decrypt(retrievedMessage);
  console.log("🔓 Bob decrypts message:", decryptedMessage);

  // === SECURITY ANALYSIS ===
  console.log("\n🛡️  Security Analysis:");
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ What can different parties see?                         │");
  console.log("├─────────────────────────────────────────────────────────┤");
  console.log("│ 🔍 Database Administrator:                              │");
  console.log("│   - Can see: Routing data, encrypted blobs             │");
  console.log("│   - Cannot see: Message content, metadata plaintext    │");
  console.log("│                                                         │");
  console.log("│ 🏢 Server Application:                                  │");
  console.log("│   - Can see: Metadata (after decryption), routing      │");
  console.log("│   - Cannot see: Message content (E2EE protected)       │");
  console.log("│                                                         │");
  console.log("│ 👤 Alice & Bob:                                         │");
  console.log("│   - Can see: Everything (they have the E2EE keys)      │");
  console.log("│                                                         │");
  console.log("│ 👹 Attacker:                                            │");
  console.log("│   - Can see: Nothing useful (all encrypted/obfuscated) │");
  console.log("└─────────────────────────────────────────────────────────┘");

  console.log("\n✨ Demo completed successfully!");
  console.log("\n💡 Key Takeaways:");
  console.log("   • E2EE ensures only sender/receiver can read messages");
  console.log("   • Server-side encryption protects metadata and routing info");
  console.log("   • Obfuscation adds extra layer against database breaches");
  console.log("   • Both libraries work together seamlessly");
  console.log("   • Zero-trust architecture: minimal data exposure");
}

async function runPerformanceDemo() {
  console.log("\n⚡ Performance Demonstration\n");

  const testSizes = [
    { name: "Tweet", data: "A".repeat(280) },
    { name: "Email", data: "B".repeat(2000) },
    { name: "Document", data: "C".repeat(10000) },
    { name: "Large File", data: "D".repeat(50000) },
  ];

  console.log("📊 Processing different data sizes...\n");

  for (const test of testSizes) {
    const start = Date.now();

    // E2EE encryption
    const e2eeClient = new MockE2EEClient();
    const e2eeEncrypted = await e2eeClient.encrypt(test.data);

    // Server-side encryption
    const serverService = new MockServerService();
    const serverEncrypted = await serverService.encryptWithMap(test.data);

    const end = Date.now();

    console.log(`🔬 ${test.name} (${test.data.length} bytes):`);
    console.log(`   ⏱️  Processing time: ${end - start}ms`);
    console.log(`   📦 E2EE result: ${e2eeEncrypted.data.length} bytes`);
    console.log(`   🎭 Server result: ${serverEncrypted.blob.length} bytes`);
    console.log(
      `   📈 Server expansion: ${(
        serverEncrypted.metadata.expansionRatio * 100
      ).toFixed(1)}%`
    );
    console.log("");
  }
}

// Run the demo
async function main() {
  try {
    await runChatDemo();
    await runPerformanceDemo();

    console.log("\n🎉 All demos completed successfully!");
    console.log("🚀 Ready to implement voideddev in your application!");
  } catch (error) {
    console.error("❌ Demo failed:", error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { runChatDemo, runPerformanceDemo };
