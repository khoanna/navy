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
      testMatch: ['<rootDir>/src/config/**/*.test.ts'],
    },
    // React Native / Expo component tests.
    {
      displayName: 'expo',
      preset: 'jest-expo',
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@privy-io/.*|@solana/.*))',
      ],
      testMatch: ['<rootDir>/src/**/!(config)/**/*.test.{ts,tsx}', '<rootDir>/src/**/*.test.tsx'],
    },
  ],
};
