/**
 * Execution cost model for replay
 */

export interface ExecutionParams {
  kind: 'deploy' | 'divest' | 'harvest';
  adapter: string;
  amount: bigint;
  gasPrice: bigint;
  swapCostBps?: bigint;
}

export interface ExecutionResult {
  success: boolean;
  gasUsed: bigint;
  gasCostBase: bigint;
  swapCostBase: bigint;
  totalCostBase: bigint;
  netAmount: bigint;
}

/**
 * Model execution costs for a given action
 */
export function modelExecution(
  params: ExecutionParams,
  _state: { idleBase: bigint; strategyBalances: Map<string, bigint> },
): ExecutionResult {
  const gasEstimates: Record<string, bigint> = {
    deploy: 200_000n,
    divest: 250_000n,
    harvest: 300_000n,
  };

  const gasUsed = gasEstimates[params.kind] ?? 200_000n;
  const gasCostBase = gasUsed * params.gasPrice;

  let swapCostBase = 0n;
  let netAmount = params.amount;

  if (params.kind === 'harvest' && params.swapCostBps) {
    swapCostBase = (params.amount * params.swapCostBps) / 10_000n;
    netAmount = params.amount - swapCostBase;
  }

  const totalCostBase = gasCostBase + swapCostBase;

  return {
    success: true,
    gasUsed,
    gasCostBase,
    swapCostBase,
    totalCostBase,
    netAmount,
  };
}

/**
 * Calculate net return after execution costs
 */
export function calculateNetReturn(
  grossReturn: bigint,
  totalCosts: bigint,
  initialInvestment: bigint,
): number {
  if (initialInvestment === 0n) return 0;
  const netReturn = grossReturn - totalCosts;
  return Number(netReturn) / Number(initialInvestment);
}

/**
 * Estimate breakeven APY for a deployment given fixed costs
 */
export function breakevenApy(
  fixedCostBase: bigint,
  deployedAmount: bigint,
  horizonSeconds: number,
): bigint {
  if (deployedAmount === 0n) return 0n;
  // Breakeven rate: fixedCost / deployedAmount per horizon
  // Expressed as WAD: breakeven = fixedCost * WAD / (deployedAmount * horizonSeconds / SECONDS_PER_YEAR)
  const SECONDS_PER_YEAR = 31_557_600n;
  const WAD = 1_000_000_000_000_000_000n;
  return (fixedCostBase * WAD * SECONDS_PER_YEAR) / (deployedAmount * BigInt(horizonSeconds));
}
