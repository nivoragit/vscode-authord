/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  clearMocks: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*_test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/out/'],
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          allowJs: true,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(unified|remark-parse|remark-gfm|remark-directive|remark-rehype|rehype-raw|rehype-stringify|@authord/render-core)/)',
  ],
  moduleNameMapper: {
    '^unist-util-visit$': '<rootDir>/__mocks__/unist-util-visit.ts',
  },
};
