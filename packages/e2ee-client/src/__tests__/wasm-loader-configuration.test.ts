type WasmLoader = typeof import('../wasm/loader');

async function freshWasmLoader(): Promise<WasmLoader> {
  jest.resetModules();
  return import('../wasm/loader');
}

const GLUE_A = 'https://static.example.test/voided/voided_wasm.js';
const GLUE_B = 'https://cdn.example.test/voided/voided_wasm.js';

describe('WASM loader configuration', () => {
  test('accepts one idempotent trusted glue URL before initialization', async () => {
    const { configureWasmLoader } = await freshWasmLoader();
    expect(() => configureWasmLoader({ glueUrl: GLUE_A })).not.toThrow();
    expect(() => configureWasmLoader({ glueUrl: new URL(GLUE_A) })).not.toThrow();
    expect(() => configureWasmLoader({ glueUrl: GLUE_B })).toThrow(
      'already configured',
    );
  });

  test.each([
    ['unsupported scheme', 'javascript:voided_wasm.js'],
    ['wrong filename', 'https://static.example.test/voided/not-the-glue.js'],
    ['embedded credentials', 'https://user:secret@static.example.test/voided/voided_wasm.js'],
  ])('rejects %s', async (_label, glueUrl) => {
    const { configureWasmLoader } = await freshWasmLoader();
    expect(() => configureWasmLoader({ glueUrl })).toThrow();
  });

  test('locks configuration once initialization starts and fails closed', async () => {
    const { configureWasmLoader, initWasm } = await freshWasmLoader();
    configureWasmLoader({ glueUrl: GLUE_A });
    await expect(initWasm()).rejects.toThrow(
      'no package-relative fallback was attempted',
    );
    expect(() => configureWasmLoader({ glueUrl: GLUE_A })).toThrow(
      'cannot change after initialization has started',
    );
    await expect(initWasm({ glueUrl: GLUE_B })).rejects.toThrow(
      'cannot change after initialization has started',
    );
  });

  test('accepts the same init option idempotently but never a replacement', async () => {
    const { initWasm } = await freshWasmLoader();
    const first = initWasm({ glueUrl: GLUE_A });
    await expect(first).rejects.toThrow(
      'no package-relative fallback was attempted',
    );
    await expect(initWasm({ glueUrl: GLUE_A })).rejects.toThrow(
      'no package-relative fallback was attempted',
    );
    await expect(initWasm({ glueUrl: GLUE_B })).rejects.toThrow(
      'cannot change after initialization has started',
    );
  });

  test('does not expose a production reset bypass', async () => {
    const loader = await freshWasmLoader();
    expect('resetWasm' in loader).toBe(false);
  });
});
