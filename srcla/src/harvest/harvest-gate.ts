/**
 * Harvest Gate - Event-driven harvest decision per SRCLA design §9.3
 *
 * This module evaluates when to harvest rewards based on:
 * - Claimable rewards value
 * - Complete cost of claim + swap (gas, L1 data, market impact)
 * - Trigger events (expiry, emission, route, threshold)
 *
 * Per paper §9.3:
 * - Observe every 15 minutes
 * - Harvest when claimable > complete_cost
 * - Triggers: expiry, emission, route, threshold
 */

export interface HarvestGateConfig {
  /** Minimum value to harvest (USDC 6 decimals, e.g., 1_000_000 = $1) */
  minHarvestValue: bigint;
  /** Cooldown between harvests (seconds) */
  harvestCooldownSeconds: number;
  /** Trigger: % of rewards claimable (basis points, e.g., 100 = 1%) */
  claimableThresholdBps: number;
}

export const DEFAULT_HARVEST_CONFIG: HarvestGateConfig = {
  minHarvestValue: 1_000_000n, // $1 minimum
  harvestCooldownSeconds: 3600, // 1 hour
  claimableThresholdBps: 100,   // 1%
};

export enum HarvestTrigger {
  EXPIRY = 'expiry',         // Rewards expiring
  EMISSION = 'emission',      // New emissions started
  ROUTE = 'route',            // Better swap route available
  THRESHOLD = 'threshold',    // Value threshold exceeded
}

export interface HarvestEvaluation {
  /** Whether to execute the harvest */
  shouldHarvest: boolean;
  /** Reason for the decision */
  reason: string;
  /** Total claimable value (USDC 6 decimals) */
  claimableValue: bigint;
  /** Total estimated cost (USDC 6 decimals) */
  totalCost: bigint;
  /** Net gain if harvested (USDC 6 decimals) */
  netGain: bigint;
  /** Active triggers that fired */
  triggers: HarvestTrigger[];
}

/**
 * L1 data cost for L2 rollups (Base, Optimism)
 * CL1data = calldata_bytes * L1_gas_price * ETH_price / 1e18
 */
function calculateL1DataCost(
  calldataBytes: number,
  l1GasPrice: bigint,
  ethPriceUsdc: bigint
): bigint {
  const L1_GAS_PER_BYTE = 16n; // Optimism: 16 gas per non-zero byte

  const l1Gas = BigInt(calldataBytes) * L1_GAS_PER_BYTE;
  const costInWei = l1Gas * l1GasPrice;

  // Convert wei to USDC
  // ethPriceUsdc is in USDC per ETH (8 decimals)
  // 1 ETH = 1e18 wei
  return (costInWei * ethPriceUsdc) / 1_000_000_000_000_000_000n;
}

/**
 * Market impact cost based on pool liquidity
 * Uses sqrt approximation: impact_bps ≈ 100 * sqrt(amount / liquidity)
 */
function calculateMarketImpact(amount: bigint, poolLiquidity: bigint): bigint {
  if (poolLiquidity === 0n) return amount / 100n; // 1% default if no data

  const ratio = Number(amount) / Number(poolLiquidity);
  const impactBps = Math.floor(100 * Math.sqrt(Math.max(0, ratio)));

  // Cap at 10% (1000 bps)
  return (amount * BigInt(Math.min(impactBps, 1000))) / 10000n;
}

/**
 * Evaluate if harvest is profitable
 *
 * Per paper §9.3:
 * - Observe every 15 minutes
 * - Harvest when claimable > complete_cost
 * - Special triggers can override profitability check
 *
 * @param claimableRewards - Total claimable reward value (USDC 6 decimals)
 * @param claimGas - Gas units for claiming rewards
 * @param swapGas - Gas units for swap execution
 * @param l2GasPrice - L2 gas price in wei
 * @param l1GasPrice - L1 gas price in wei (for L2 rollups)
 * @param ethPriceUsdc - ETH price in USDC (8 decimals)
 * @param poolLiquidity - Available pool liquidity for swap
 * @param triggers - Active harvest triggers
 * @param config - Harvest gate configuration
 * @returns HarvestEvaluation with decision and cost breakdown
 */
export function evaluateHarvest(
  claimableRewards: bigint,
  claimGas: bigint,
  swapGas: bigint,
  l2GasPrice: bigint,
  l1GasPrice: bigint,
  ethPriceUsdc: bigint,
  poolLiquidity: bigint,
  triggers: HarvestTrigger[],
  config: HarvestGateConfig = DEFAULT_HARVEST_CONFIG
): HarvestEvaluation {
  // Calculate L2 gas cost
  const totalGas = claimGas + swapGas;
  const l2Cost = (totalGas * l2GasPrice * ethPriceUsdc) / 1_000_000_000_000_000_000n;

  // Calculate L1 data cost (for L2 rollups like Base)
  const avgTxBytes = 300; // Average transaction size
  const l1Cost = calculateL1DataCost(avgTxBytes, l1GasPrice, ethPriceUsdc);

  // Calculate market impact cost
  const impactCost = calculateMarketImpact(claimableRewards, poolLiquidity);

  // Total cost = L2 gas + L1 data + market impact
  const totalCost = l2Cost + l1Cost + impactCost;

  // Net gain = claimable - total cost (0 if negative)
  const netGain = claimableRewards > totalCost
    ? claimableRewards - totalCost
    : 0n;

  // Determine if harvest should execute
  // Primary: profitable by more than minimum threshold
  // Override: special triggers can fire even if marginally profitable
  const shouldHarvest =
    (netGain > config.minHarvestValue) ||
    (triggers.includes(HarvestTrigger.EXPIRY) && claimableRewards > totalCost / 2n) ||
    (triggers.includes(HarvestTrigger.EMISSION) && claimableRewards > totalCost);

  // Build reason string
  let reason: string;
  if (!shouldHarvest) {
    reason = 'NOT_PROFITABLE';
  } else if (netGain > config.minHarvestValue) {
    reason = 'PROFITABLE';
  } else if (triggers.includes(HarvestTrigger.EXPIRY)) {
    reason = 'TRIGGERED_EXPIRY';
  } else if (triggers.includes(HarvestTrigger.EMISSION)) {
    reason = 'TRIGGERED_EMISSION';
  } else {
    reason = 'TRIGGERED';
  }

  return {
    shouldHarvest,
    reason,
    claimableValue: claimableRewards,
    totalCost,
    netGain,
    triggers,
  };
}
