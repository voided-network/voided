module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.stress.test.ts', '**/__tests__/**/*.property.test.ts', '**/__tests__/**/*.fuzz.test.ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/__tests__/**',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
    testTimeout: 5000, // Much faster timeout
    maxWorkers: 1, // Run tests sequentially to avoid resource conflicts
    silent: false,
    verbose: false,
    noStackTrace: true
}; 