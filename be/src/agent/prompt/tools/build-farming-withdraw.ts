export const buildFarmingWithdraw = {
  name: 'build_farming_withdraw',
  description:
    'Use when the user wants to take USDC out of farming. Builds a proposal the user signs in-app; it never executes. amount = 6-decimal base units, or the literal "all" to withdraw everything. If the user gave no amount, ask how much (or whether they mean all).',
} as const;
