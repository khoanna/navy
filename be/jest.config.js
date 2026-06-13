module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleNameMapper: {
    '^uuid$': require.resolve('/home/khoa/Desktop/uni/be/node_modules/.pnpm/uuid@8.3.2/node_modules/uuid/dist/index.js'),
  },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
  setupFiles: ['dotenv/config'],
};
