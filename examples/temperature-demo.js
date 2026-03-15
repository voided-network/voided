const {
  generateMap,
  TEMPERATURE_PROFILES,
  analyzeMap,
  getExpansionRatio,
  calculateComputeCost,
  obfuscate,
  deobfuscate,
  testObfuscationRoundTrip,
  analyzeObfuscation,
} = require("./packages/enc-server");

/**
 * 🌡️ TEMPERATURE-BASED OBFUSCATION DEMO
 *
 * This demonstrates the new temperature system where:
 * - Each character can have MULTIPLE possible mappings
 * - Temperature (0.0 to 1.0) controls complexity
 * - Higher temperature = more mappings + longer sequences
 */

console.log("\n🌡️  voideddev TEMPERATURE-BASED OBFUSCATION SYSTEM");
console.log("=".repeat(60));
console.log("Defense in depth: Compression → Encryption → Obfuscation\n");

// Demo data
const testData =
  "Hello World! This is a test message with numbers 123 and symbols @#$.";
console.log(`📝 Test Data: "${testData}"`);
console.log(`📏 Length: ${testData.length} characters\n`);

// Show all temperature profiles
console.log("🌡️  AVAILABLE TEMPERATURE PROFILES:\n");
for (const [name, config] of Object.entries(TEMPERATURE_PROFILES)) {
  console.log(`  ${name.toUpperCase()}:`);
  console.log(`    🌡️  Temperature: ${config.temperature}`);
  console.log(
    `    🔢 Mappings per char: ${config.minMappings}-${config.maxMappings}`
  );
  console.log(`    📏 Mapping length: ${config.minLength}-${config.maxLength}`);
  console.log(`    📈 Target expansion: ${config.expansionRatio}x`);
  console.log(`    ⚡ Compute score: ${config.computeScore}/100\n`);
}

// Temperature comparison table
console.log("🔥 TEMPERATURE COMPARISON:\n");
console.log(
  "Profile  | Temp | Mappings | Avg Len | Expansion | Compute | Example: H →"
);
console.log(
  "---------|------|----------|---------|-----------|---------|------------------"
);

const profiles = ["minimal", "low", "medium", "high", "extreme"];
const seed = "demo-seed-123";

for (const profileName of profiles) {
  const config = TEMPERATURE_PROFILES[profileName];
  const map = generateMap({ temperature: config.temperature, seed });
  const analysis = analyzeMap(map);

  // Show example mappings for letter 'H'
  const hMappings = map["H"] || ["none"];
  const exampleMapping = hMappings.slice(0, 2).join(", ");

  console.log(
    `${profileName.padEnd(8)} | ` +
      `${config.temperature.toString().padEnd(4)} | ` +
      `${analysis.averageMappingsPerChar.toFixed(1).padEnd(8)} | ` +
      `${analysis.averageMappingLength.toFixed(1).padEnd(7)} | ` +
      `${analysis.expansionRatio.toFixed(1).padEnd(9)} | ` +
      `${analysis.computeScore.toString().padEnd(7)} | ` +
      `${exampleMapping}`
  );
}

console.log("\n🎯 CHARACTER MAPPING SHOWCASE:\n");

// Generate a medium temperature map to show character mappings
const demoMap = generateMap({ temperature: 0.6, seed: "mapping-showcase" });

// Show mappings for various characters
const testChars = ["H", "e", "l", "o", " ", "!", "1", "@"];
console.log("CHARACTER → POSSIBLE MAPPINGS:\n");
for (const char of testChars) {
  const mappings = demoMap[char] || ["(not mapped)"];
  console.log(`  '${char}' → [${mappings.join(", ")}]`);
}

// Demonstrate different selection strategies
const testText = "Hello!";
console.log(`\n🎲 SELECTION STRATEGIES for "${testText}":\n`);

const strategies = ["random", "round-robin", "shortest", "longest"];

for (const strategy of strategies) {
  const result = obfuscate(testText, demoMap, {
    seed: "strategy-demo",
    selectionStrategy: strategy,
  });

  console.log(`  ${strategy.padEnd(11)}: "${result.obfuscated}"`);
  console.log(
    `  ${" ".repeat(14)} (${result.stats.expansionRatio.toFixed(
      1
    )}x expansion, ${result.stats.mappingsUsed} mappings used)`
  );
}

// Round-trip testing
console.log("\n🔄 ROUND-TRIP TESTING:\n");

const testTexts = [
  "Simple text",
  "Complex: Hello World! 123 @#$ symbols",
  "Multi-line\ntext with\ttabs and spaces",
];

const testMap = generateMap({ temperature: 0.5, seed: "roundtrip-test" });

console.log("Testing obfuscation round-trips...\n");

for (let i = 0; i < testTexts.length; i++) {
  const text = testTexts[i];
  const result = testObfuscationRoundTrip(text, testMap, { seed: "test-seed" });

  console.log(`Test ${i + 1}: ${result.success ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Original:     "${text}"`);
  console.log(
    `  Obfuscated:   "${result.obfuscatedText.substring(0, 50)}${
      result.obfuscatedText.length > 50 ? "..." : ""
    }"`
  );
  console.log(`  Deobfuscated: "${result.deobfuscatedText}"`);
  console.log(`  Expansion:    ${result.stats.expansionRatio.toFixed(2)}x`);

  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }
  console.log("");
}

// Performance analysis
console.log("\n⚡ PERFORMANCE ANALYSIS:\n");

const dataSizes = [100, 1000, 10000];
const temperatures = [0.2, 0.5, 0.8];

console.log("DATA SIZE | TEMP | COMPUTE COST | EXPANSION | TIME (est.)");
console.log("----------|------|--------------|-----------|------------");

for (const size of dataSizes) {
  for (const temp of temperatures) {
    const map = generateMap({ temperature: temp, seed: "perf-test" });
    const computeCost = calculateComputeCost(map, size);
    const expansionRatio = getExpansionRatio(map);

    // Rough time estimation (milliseconds)
    const estimatedTime = Math.round(computeCost * 0.1 + size * 0.001);

    console.log(
      `${size.toString().padEnd(9)} | ` +
        `${temp.toString().padEnd(4)} | ` +
        `${computeCost.toString().padEnd(12)} | ` +
        `${expansionRatio.toFixed(1).padEnd(9)} | ` +
        `${estimatedTime}ms`
    );
  }
}

console.log("\n💰 API USAGE SIMULATION:\n");

// Simulate API billing based on compute units
const apiRequests = [
  { user: "user1", data: "Simple message", temperature: 0.2 },
  {
    user: "user2",
    data: "Medium complexity data with numbers 123",
    temperature: 0.5,
  },
  {
    user: "user3",
    data: "Complex data with lots of special characters @#$%^&*()",
    temperature: 0.8,
  },
  { user: "user4", data: "A".repeat(1000), temperature: 1.0 }, // Large data
];

console.log("USER   | DATA SIZE | TEMP | COMPUTE UNITS | BILL ($)");
console.log("-------|-----------|------|---------------|----------");

let totalUnits = 0;

for (const request of apiRequests) {
  const map = generateMap({
    temperature: request.temperature,
    seed: "billing-demo",
  });
  const computeUnits = calculateComputeCost(map, request.data.length);
  const billAmount = computeUnits * 0.001; // $0.001 per compute unit

  totalUnits += computeUnits;

  console.log(
    `${request.user.padEnd(6)} | ` +
      `${request.data.length.toString().padEnd(9)} | ` +
      `${request.temperature.toString().padEnd(4)} | ` +
      `${computeUnits.toString().padEnd(13)} | ` +
      `$${billAmount.toFixed(3)}`
  );
}

console.log("-------|-----------|------|---------------|----------");
console.log(
  `TOTAL  |           |      | ${totalUnits.toString().padEnd(13)} | $${(
    totalUnits * 0.001
  ).toFixed(3)}`
);

console.log("\n✨ DEMO COMPLETE!\n");
console.log("🎯 Key Features:");
console.log("   • Temperature-controlled obfuscation complexity (0.0 to 1.0)");
console.log("   • Multiple mappings per character (like k → l, qybf, frankly)");
console.log("   • Deterministic mapping generation with seeds");
console.log("   • Multiple selection strategies for different use cases");
console.log("   • Performance analysis and compute cost measurement");
console.log("   • Perfect for SaaS APIs with scalable security and billing!");
console.log(
  "\n💡 Higher temperature = better obfuscation but more compute cost"
);
console.log("💡 Perfect balance between security and performance\n");
