/**
 * Cost gate type definitions for SRCLA movement decisions
 *
 * Defines cost components, configurations, and decision types
 * per SRCLA design Section 9.1 (Complete-cost movement rule).
 */

/**
 * Cost gate configuration for movement decisions.
 * Encapsulates all cost parameters needed to evaluate move profitability.
 *
 * Cost calculation formula:
 * - gasCost = gasLimit * gasPriceWei * ethPriceUsdc / 1e18 (USDC)
 * - slippageCost = amount * slippageBps / 10000 (USDC)
 * - mevImpact = amount * mevImpactBps / 10000 (USDC)
 * - totalCost = gasCost + slippageCost + mevImpact
 *
 * Expected gain formula:
 * - expectedGain = amount * (targetRate - currentRate) * horizonSeconds / yearSeconds
 *
 * Gate decision:
 * - passGate = expectedGain > (totalCost + minThreshold)
 */
export interface CostGateConfig {
  /** Gas limit for the movement transaction (in gas units) */
  gasLimit: bigint;
  /** Current gas price in wei */
  gasPriceWei: bigint;
  /** ETH price in USDC (8 decimal places, e.g., 3500_00000000 = $3500) */
  ethPriceUsdc: bigint;
  /** Expected slippage in basis points (e.g., 10 = 0.1%) */
  slippageBps: number;
  /** Expected MEV impact in basis points (e.g., 5 = 0.05%) */
  mevImpactBps: number;
  /**
   * Minimum absolute threshold in USDC.
   * Movements below this threshold are rejected regardless of ratio.
   * Default: 1_000_000 (~$1.00 for 6-decimal USDC)
   */
  minThreshold: bigint;
  /** Cooldown period between movements in seconds */
  cooldownSeconds: number;
  /** Maximum allowed turnover in basis points of total assets */
  maxTurnoverBps: number;
}

/**
 * Detailed breakdown of movement costs.
 * All values in USDC with 6 decimal places.
 * Per SRCLA design Section 9.1 - Complete cost formula:
 * Cmove = CL2 + CL1data + Cexit + Centry + Cclaim + Capprove/reset + Cswap + Cimpact + Cslippage/MEV + Cfailure + Cbuffer
 */
export interface CostBreakdown {
  /** L2 gas cost in USDC (gasLimit * gasPrice * ethPrice / 1e18) */
  l2GasCost: bigint;
  /** L1 data availability cost for rollups (in wei, caller converts) */
  l1DataCost: bigint;
  /** Exit cost from source protocol */
  exitCost: bigint;
  /** Entry cost to target protocol */
  entryCost: bigint;
  /** Claim cost for reward harvesting */
  claimCost: bigint;
  /** Approve/reset cost */
  approveResetCost: bigint;
  /** Swap cost for token conversion */
  swapCost: bigint;
  /** Price impact cost */
  impactCost: bigint;
  /** Slippage/MEV cost in USDC (amount * (slippageBps + mevBps) / 10000) */
  slippageCost: bigint;
  /** Expected failure cost (historical failure rate adjusted loss) */
  failureCost: bigint;
  /** Buffer opportunity cost (foregone yield from idle funds) */
  bufferCost: bigint;
  /** Total movement cost in USDC */
  totalCost: bigint;
}

/**
 * Cost gate decision output.
 * Contains the decision and supporting information for logging/auditing.
 */
export interface CostGateDecision {
  /** Whether the movement passes the cost gate */
  passGate: boolean;
  /** Expected gain in USDC if movement executes */
  expectedGain: bigint;
  /** Total cost in USDC */
  totalCost: bigint;
  /** Net gain/loss in USDC (expectedGain - totalCost) */
  netGain: bigint;
  /** Human-readable reason for the decision */
  reason: string;
  /** Detailed cost breakdown */
  costBreakdown: CostBreakdown;
  /** Whether the movement was blocked by cooldown */
  blockedByCooldown: boolean;
  /** Whether the movement was blocked by turnover budget */
  blockedByTurnover: boolean;
}

/**
 * Movement type affecting cost calculation.
 * Different movements have different cost profiles.
 */
export enum MovementType {
  /** Deploy capital to a strategy */
  DEPLOY = 'DEPLOY',
  /** Divest capital from a strategy */
  DIVEST = 'DIVEST',
  /** Harvest rewards from a strategy */
  HARVEST = 'HARVEST',
  /** Emergency exit from a strategy */
  EMERGENCY = 'EMERGENCY',
}

/**
 * Movement cost parameters including L2 and L1 data costs.
 * Per SRCLA design Section 9.1 cost components.
 */
export interface MovementCosts {
  /** L2 execution gas cost */
  l2GasCost: bigint;
  /** L1 data availability cost (for Base rollups) */
  l1DataCost: bigint;
  /** Exit cost (withdrawal from source protocol) */
  exitCost: bigint;
  /** Entry cost (deposit to target protocol) */
  entryCost: bigint;
  /** Claim cost (for reward harvesting) */
  claimCost: bigint;
  /** Approve/reset cost */
  approveResetCost: bigint;
  /** Swap cost (for reward conversion) */
  swapCost: bigint;
  /** Price impact cost */
  impactCost: bigint;
  /** Slippage/MEV cost */
  slippageCost: bigint;
  /** Failure buffer */
  failureBuffer: bigint;
  /** Safety buffer */
  bufferCost: bigint;
}

/**
 * Expected gain parameters for cost gate evaluation.
 */
export interface GainParameters {
  /** Movement amount in USDC (6 decimals) */
  amount: bigint;
  /** Current rate at source (WAD format, e.g., 50000000000000000n = 5%) */
  currentRate: bigint;
  /** Target rate at destination (WAD format) */
  targetRate: bigint;
  /** Planning horizon in seconds (e.g., 86400 = 1 day) */
  horizonSeconds: bigint;
  /** Expected rate change at destination after allocation (WAD format) */
  destinationRateAfter: bigint;
}

/**
 * Cost gate evaluation context.
 * Aggregates all inputs needed for a cost gate decision.
 */
export interface CostGateContext {
  /** Unique identifier for this movement */
  movementId: string;
  /** Type of movement */
  movementType: MovementType;
  /** Source adapter address */
  sourceAdapter: string | null;
  /** Target adapter address */
  targetAdapter: string | null;
  /** Gain parameters */
  gainParams: GainParameters;
  /** Current total assets in vault */
  totalAssets: bigint;
  /** Recent turnover (last period) */
  recentTurnover: bigint;
  /** Timestamp of evaluation */
  timestamp: Date;
  /** Block hash at evaluation time */
  blockHash: string;
  /** Config digest for this decision */
  configDigest: string;
}

/**
 * Cost gate statistics for monitoring.
 */
export interface CostGateStats {
  /** Total movements evaluated */
  totalEvaluated: number;
  /** Movements that passed the gate */
  totalPassed: number;
  /** Movements blocked by cost */
  blockedByCost: number;
  /** Movements blocked by cooldown */
  blockedByCooldown: number;
  /** Movements blocked by turnover */
  blockedByTurnover: number;
  /** Average net gain when passed */
  avgNetGain: bigint;
  /** Average cost when passed */
  avgCost: bigint;
}

/**
 * Parameters for L1 data cost calculation.
 * L1 calldata costs on rollups (Base) are significant.
 */
export interface L1DataCostParams {
  /** L1 gas price in wei */
  l1GasPrice: bigint;
  /** Number of calldata bytes to publish on L1 */
  l1CalldataBytes: number;
}

/**
 * Parameters for failure cost calculation.
 * Accounts for expected loss from rebalance failures.
 */
export interface FailureCostParams {
  /** Historical failure rate (0-1, e.g., 0.05 = 5%) */
  historicalFailureRate: number;
  /** Estimated loss in USDC if failure occurs */
  estimatedLossOnFailure: bigint;
  /** Volatility factor (0-1) for tail risk adjustment */
  volatilityFactor: number;
}

/**
 * Parameters for buffer opportunity cost calculation.
 * Represents foregone yield from idle funds.
 */
export interface BufferOpportunityParams {
  /** Amount of idle funds */
  idleAmount: bigint;
  /** Best available yield rate per second (WAD format) */
  bestAvailableRate: bigint;
  /** Time funds will be idle in seconds */
  timeSeconds: number;
}

/**
 * Cost gate default configuration values.
 */
export const DEFAULT_COST_GATE_CONFIG: CostGateConfig = {
  gasLimit: 500_000n,
  gasPriceWei: 30_000_000_000n, // 30 gwei
  ethPriceUsdc: 3_500_000_000n, // $3500
  slippageBps: 5, // 0.05%
  mevImpactBps: 5, // 0.05%
  minThreshold: 1_000_000n, // $1 in USDC 6 decimals
  cooldownSeconds: 3600, // 1 hour
  maxTurnoverBps: 100, // 1% of total assets
};
