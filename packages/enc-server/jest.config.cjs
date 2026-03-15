module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: [
        '**/__tests__/**/*.test.ts',
        '**/__tests__/**/*.stress.test.ts',
        '**/__tests__/**/*.property.test.ts',
        '**/__tests__/**/*.fuzz.test.ts',
        '**/__tests__/**/*.basic.test.ts',
        '**/__tests__/**/*.e2e.test.ts'
    ],
    transform: {
        '^.+\\.ts$': 'ts-jest'
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1'
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/__tests__/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    maxWorkers: 1,
    testTimeout: 60000,
    modulePathIgnorePatterns: ['<rootDir>/dist']
};
