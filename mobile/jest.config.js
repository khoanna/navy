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
      // uuid v14 is ESM-only; remap it to the CJS-compatible v8 build that's
      // already present in the pnpm store as a transitive dependency.
      moduleNameMapper: {
        '^uuid$': '<rootDir>/node_modules/.pnpm/uuid@8.3.2/node_modules/uuid/dist/index.js',
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
