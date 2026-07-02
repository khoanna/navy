module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }],
  },
  moduleNameMapper: { '^uuid$': require.resolve('uuid') },
  testMatch: ['<rootDir>/src/lib/**/*.test.ts'],
};
