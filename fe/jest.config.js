module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }] },
  testMatch: ['<rootDir>/src/lib/**/*.test.ts'],
};
