/**
 * Execution cost model for replay.
 *
 * UNITS (this file has already produced one ~3.3e8x error, so every quantity
 * states its unit):
 *   - gas amounts        : gas units
 *   - gasPriceWei        : wei per gas unit
 *   - ethUsdE8           : USD per ETH, 8 decimals (Chainlink ETH/USD shape)
 *   - amount / *Base     : USDC base units, 6 decimals
 *
 * The bug this replaces: `gasCostBase = gasUsed * gasPrice` produced a value
 * in WEI and `replay.ts` added it straight into a USDC-base-unit accumulator.
 * One 200,000-gas deploy at 30 gwei is 6e15 wei = 0.006 ETH; booked as USDC
 * base units that is 6e15 / 1e6 = $6,000,000,000 of "cost" against a 10,000
 * USDC tier, versus a true ~$18 at $3,000/ETH — an overstatement of roughly
 * 3.3e8x, which drove `calculateNetApy` straight into its -100% clamp for
 * every policy that moved at all.
 */

/** wei per ETH. */
const WEI_PER_ETH = 10n ** 18n;
/** ETH/USD price scale (8 decimals). */
const USD_E8 = 10n ** 8n;
/** USDC base units per 1 USD (6 decimals). */
const USDC_BASE_PER_USD = 10n ** 6n;

export interface ExecutionParams {
  kind: 'deploy' | 'divest' | 'harvest';
  adapter: string;
  /** USDC base units (6 dp). */
  amount: bigint;
  /** wei per gas unit. */
  gasPriceWei: bigint;
  /** USD per ETH, 8 decimals. Required — without it a gas cost cannot be
   *  expressed in USDC base units at all, which is how the old model came to
   *  book wei as dollars. */
  ethUsdE8: bigint;
  swapCostBps?: bigint;
}

export interface ExecutionResult {
  success: boolean;
  /** gas units. */
  gasUsed: bigint;
  /** USDC base units (6 dp). */
  gasCostBase: bigint;
  /** USDC base units (6 dp). */
  swapCostBase: bigint;
  /** USDC base units (6 dp). */
  totalCostBase: bigint;
  /** USDC base units (6 dp). */
  netAmount: bigint;
}

/**
 * Convert a gas spend to USDC base units.
 *
 *   USD      = gasUnits * gasPriceWei / 1e18 * (ethUsdE8 / 1e8)
 *   USDCbase = USD * 1e6
 *            = gasUnits * gasPriceWei * ethUsdE8 / 1e20
 *
 * Exported so the conversion has exactly one implementation and one test.
 */
export function gasCostToUsdcBase(gasUnits: bigint, gasPriceWei: bigint, ethUsdE8: bigint): bigint {
  return (gasUnits * gasPriceWei * ethUsdE8 * USDC_BASE_PER_USD) / (WEI_PER_ETH * USD_E8);
}

/**
 * Model execution costs for a given action.
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
  const gasCostBase = gasCostToUsdcBase(gasUsed, params.gasPriceWei, params.ethUsdE8);

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
