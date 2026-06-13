module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  // @solana/web3.js -> rpc-websockets pulls in an ESM-only uuid that Jest's CJS
  // runner can't require; redirect to the CJS-compatible uuid resolved from our
  // direct devDependency (stable, not pinned to a pnpm store hash).
  moduleNameMapper: {
    '^uuid$': require.resolve('uuid'),
  },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
  setupFiles: ['dotenv/config'],
};
