module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleNameMapper: {
    '^otplib$': '<rootDir>/src/__mocks__/otplib-compat.js',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
  setupFiles: ['dotenv/config'],
};
