module.exports = {
  projects: [
    // Pure TypeScript / config tests — no React Native setup files needed.
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          tsconfig: '<rootDir>/tsconfig.json',
          diagnostics: false,
        }],
      },
      // All plain-TS logic modules (env, api client, token store, session) are
      // written without React Native imports, so they run here under ts-jest/node.
      testMatch: ['<rootDir>/src/**/*.test.ts'],
    },
    // React Native / Expo component tests (*.test.tsx). None yet — UI is verified
    // by typecheck + manual smoke — but this keeps RN tests off the node project.
    {
      displayName: 'expo',
      preset: 'jest-expo',
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@privy-io/.*|@solana/.*))',
      ],
      testMatch: ['<rootDir>/src/**/*.test.tsx'],
    },
  ],
};
