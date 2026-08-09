import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createRecoveryDeck,
  deriveRecoveryKey,
  encodeRecoveryDeck,
  generateKey,
  generateRecoveryDeck,
  rotateRecoveryDeck,
  unwrapRootWithRecoveryKey,
  validateRecoveryDeck,
  wrapRootWithRecoveryKey,
} = require('../../dist/index.cjs');

const canonicalDeck = [
  'AS', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', '10S', 'JS', 'QS', 'KS',
  'AH', '2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', '10H', 'JH', 'QH', 'KH',
  'AD', '2D', '3D', '4D', '5D', '6D', '7D', '8D', '9D', '10D', 'JD', 'QD', 'KD',
  'AC', '2C', '3C', '4C', '5C', '6C', '7C', '8C', '9C', '10C', 'JC', 'QC', 'KC',
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`✗ ${name}: ${error.message}`);
  }
}

console.log('=== Recovery Deck Tests ===\n');

test('canonical deck matches permanent encoding and derivation vectors', () => {
  assert.strictEqual(validateRecoveryDeck(canonicalDeck), true);
  assert.strictEqual(encodeRecoveryDeck(canonicalDeck).toString('hex'), '00'.repeat(29));
  assert.strictEqual(
    deriveRecoveryKey(canonicalDeck).toString('hex'),
    '7d819b1d9cb4a0346a7e03a505e9bc6ef738518aa91ce99b04a866e436efd95c',
  );
});

test('validation rejects missing, unknown, and duplicate cards', () => {
  assert.strictEqual(validateRecoveryDeck(canonicalDeck.slice(0, 51)), false);
  assert.strictEqual(validateRecoveryDeck(['A♠', ...canonicalDeck.slice(1)]), false);
  assert.strictEqual(
    validateRecoveryDeck([...canonicalDeck.slice(0, 51), 'AS']),
    false,
  );
});

test('generated decks are complete permutations', () => {
  const deck = generateRecoveryDeck();
  assert.strictEqual(validateRecoveryDeck(deck), true);
  assert.strictEqual(new Set(deck).size, 52);
});

test('root wrapping authenticates the exact reconstructed deck', () => {
  const root = generateKey();
  const recoveryKey = deriveRecoveryKey(canonicalDeck);
  const wrapper = wrapRootWithRecoveryKey(root, recoveryKey);
  assert.strictEqual(wrapper.length, 80);
  assert.deepStrictEqual(unwrapRootWithRecoveryKey(wrapper, recoveryKey), root);

  const wrongDeck = [...canonicalDeck];
  [wrongDeck[0], wrongDeck[1]] = [wrongDeck[1], wrongDeck[0]];
  assert.throws(() =>
    unwrapRootWithRecoveryKey(wrapper, deriveRecoveryKey(wrongDeck)),
  );
  recoveryKey.fill(0);
});

test('rotation preserves the stable root and rejects the old deck', () => {
  const root = generateKey();
  const initial = createRecoveryDeck(root);
  const rotated = rotateRecoveryDeck(initial.rootWrapper, initial.deck);
  assert.strictEqual(validateRecoveryDeck(rotated.deck), true);
  assert.notDeepStrictEqual(rotated.deck, initial.deck);

  const newRecoveryKey = deriveRecoveryKey(rotated.deck);
  assert.deepStrictEqual(
    unwrapRootWithRecoveryKey(rotated.rootWrapper, newRecoveryKey),
    root,
  );
  const oldRecoveryKey = deriveRecoveryKey(initial.deck);
  assert.throws(() =>
    unwrapRootWithRecoveryKey(rotated.rootWrapper, oldRecoveryKey),
  );
  newRecoveryKey.fill(0);
  oldRecoveryKey.fill(0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
