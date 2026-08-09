module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  env: {
    browser: true,
    es2022: true,
    jest: true,
    node: true,
  },
  ignorePatterns: [
    "**/dist/**",
    "**/node_modules/**",
    "packages/e2ee-client/wasm/**",
    "packages/enc-server/prebuilds/**",
  ],
  rules: {
    "no-constant-condition": ["error", { checkLoops: false }],
    "no-debugger": "error",
    "no-dupe-class-members": "error",
    "no-dupe-keys": "error",
    "no-duplicate-imports": "error",
    "no-unreachable": "error",
    "valid-typeof": "error",
  },
};
