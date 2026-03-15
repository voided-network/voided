#!/usr/bin/env node

console.log("🔒 voideddev Encryption Demo - Map Generation & Obfuscation\n");

// Simple map generation (simplified version of the actual implementation)
function generateSimpleMap() {
  const characters =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?";
  const words = [
    "bright",
    "lunar",
    "swift",
    "golden",
    "silver",
    "crystal",
    "shadow",
    "whisper",
    "thunder",
    "morning",
  ];
  const phrases = [
    "bright_moon",
    "swift_river",
    "golden_light",
    "silver_storm",
    "crystal_dawn",
  ];

  const map = new Map();
  const reverseMap = new Map();

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    let replacement;

    const rand = Math.random();
    if (rand < 0.3) {
      // 30% chance for words
      replacement = words[Math.floor(Math.random() * words.length)];
    } else if (rand < 0.5) {
      // 20% chance for phrases
      replacement = phrases[Math.floor(Math.random() * phrases.length)];
    } else {
      // 50% chance for character sequences
      const length = Math.floor(Math.random() * 3) + 2;
      replacement = "";
      for (let j = 0; j < length; j++) {
        replacement += String.fromCharCode(97 + Math.floor(Math.random() * 26));
      }
    }

    // Ensure no duplicates
    while (reverseMap.has(replacement)) {
      replacement += Math.floor(Math.random() * 10);
    }

    map.set(char, replacement);
    reverseMap.set(replacement, char);
  }

  return { forward: map, reverse: reverseMap };
}

// Simple obfuscation function
function obfuscateText(text, map) {
  let result = "";
  for (const char of text) {
    const replacement = map.forward.get(char);
    if (replacement) {
      result += replacement + "_";
    } else {
      result += char;
    }
  }
  return result;
}

// Simple deobfuscation function
function deobfuscateText(obfuscated, map) {
  const parts = obfuscated.split("_");
  let result = "";

  for (const part of parts) {
    const original = map.reverse.get(part);
    if (original) {
      result += original;
    }
  }

  return result;
}

// Demo
function runDemo() {
  console.log("🗺️  Generating obfuscation map...");
  const map = generateSimpleMap();
  console.log(
    "✅ Map generated with",
    map.forward.size,
    "character mappings\n"
  );

  // Show some example mappings
  console.log("📋 Sample character mappings:");
  let count = 0;
  for (const [char, replacement] of map.forward.entries()) {
    if (count < 8) {
      console.log(`   '${char}' → '${replacement}'`);
      count++;
    }
  }
  console.log();

  // Test with sample data
  const testData = "Hello World! This is a secret message.";
  console.log("📝 Original text:", testData);
  console.log("📏 Original length:", testData.length, "characters\n");

  // Obfuscate
  const obfuscated = obfuscateText(testData, map);
  console.log("🎭 Obfuscated text:");
  console.log(
    "   ",
    obfuscated.substring(0, 100) + (obfuscated.length > 100 ? "..." : "")
  );
  console.log("📈 Obfuscated length:", obfuscated.length, "characters");
  console.log(
    "📊 Expansion ratio:",
    ((obfuscated.length / testData.length) * 100).toFixed(1) + "%\n"
  );

  // Deobfuscate
  const deobfuscated = deobfuscateText(obfuscated, map);
  console.log("🔓 Deobfuscated text:", deobfuscated);
  console.log(
    "✅ Round-trip success:",
    testData === deobfuscated ? "YES" : "NO"
  );

  console.log("\n🛡️  Security Benefits:");
  console.log("   • Original data completely transformed");
  console.log("   • Character patterns broken up");
  console.log("   • Looks like random word salad");
  console.log("   • Additional layer on top of encryption");
  console.log("   • Requires specific map to reverse");

  console.log("\n💡 In the full implementation:");
  console.log("   • This happens AFTER compression and encryption");
  console.log("   • Maps are deterministic but seed-based");
  console.log("   • Optimized with trie data structures");
  console.log("   • Integrated with AEAD encryption");
  console.log("   • Self-hosted or cloud key management");

  console.log(
    "\n🎉 Demo completed! Ready to build secure applications with voideddev."
  );
}

runDemo();
