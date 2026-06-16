module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  // @solana/web3.js -> rpc-websockets pulls in an ESM-only uuid that Jest's CJS
  // runner can't require; redirect to the CJS-compatible uuid resolved from our
  // direct devDependency (stable, not pinned to a pnpm store hash).
  //
  // @solendprotocol/solend-sdk -> @pythnetwork/pyth-solana-receiver -> jito-ts ->
  // @solana/web3.js@1.77.4 -> rpc-websockets/dist/lib/client (directory, no index.js)
  // fails under Jest's CJS resolver; redirect to the .cjs bundle that exists there.
  moduleNameMapper: {
    '^uuid$': require.resolve('uuid'),
    // @solana/web3.js@1.77.x (transitive, from jito-ts) requires rpc-websockets/dist/lib/client
    // as a directory import with no index.js; Jest's CJS resolver can't handle that.
    // Point it at the concrete .cjs file in the v7 bundle that does exist.
    '^rpc-websockets/dist/lib/client$': '<rootDir>/node_modules/.pnpm/rpc-websockets@7.11.2/node_modules/rpc-websockets/dist/lib/client.cjs',
    '^rpc-websockets/dist/lib/client/websocket$': '<rootDir>/node_modules/.pnpm/rpc-websockets@7.11.2/node_modules/rpc-websockets/dist/lib/client/websocket.cjs',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
  setupFiles: ['dotenv/config'],
};
