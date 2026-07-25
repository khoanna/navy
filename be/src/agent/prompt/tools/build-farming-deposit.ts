export const buildFarmingDeposit = {
  name: 'build_farming_deposit',
  description:
    'Use when the user wants to earn yield / supply / deposit USDC into farming. Builds a proposal the user signs in-app; it never executes. Requires an explicit amount from the user — if none was given, ask how much first. amountBase = 6-decimal USDC base units.',
} as const;
