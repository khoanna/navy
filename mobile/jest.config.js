module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@privy-io/.*|@solana/.*))',
  ],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
