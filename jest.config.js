/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  clearMocks: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'], 
  modulePathIgnorePatterns: ['<rootDir>/out/'],
  moduleNameMapper: {
    '^unist-util-visit$': '<rootDir>/__mocks__/unist-util-visit.ts',
  },
};
