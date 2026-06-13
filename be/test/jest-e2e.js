// E2E Jest config: inherits the base config (ts-jest transform, dotenv setup,
// and the uuid CJS redirect needed by @solana/web3.js) and overrides only the
// root and test pattern for end-to-end specs under test/.
const base = require('../jest.config');

module.exports = {
  ...base,
  rootDir: '..',
  testRegex: '.e2e-spec.ts$',
};
