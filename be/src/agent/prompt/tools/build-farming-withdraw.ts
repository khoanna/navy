import type { ToolCard } from './types';

export const buildFarmingWithdraw: ToolCard = {
  name: 'build_farming_withdraw',
  description:
    'Use when the user wants to withdraw USDC from the Navy yield vault (redeem their navUSDC shares for USDC). Builds a proposal the user signs in-app; it never executes. amount = 6-decimal USDC base units, or the literal "all" to withdraw everything. If the user gave no amount, ask how much (or whether they mean all).',
};
