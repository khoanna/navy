/**
 * Reward Processing Types
 *
 * Type definitions for SRCLA reward processing module per Section 9.2-9.4:
 * - Chainlink oracle validation (staleness, deviation)
 * - Uniswap V3 route validation and execution
 * - Event-driven harvest decision logic
 */

/**
 * Token information for reward processing
 */
export interface RewardToken {
  /** ERC-20 token address */
  address: string;
  /** Token symbol (e.g., "COMP", "AAVE") */
  symbol: string;
  /** Token decimals (e.g., 18 for most tokens, 6 for USDC) */
  decimals: number;
}

/**
 * Chainlink price data from on-chain feed
 */
export interface ChainlinkPrice {
  /** Price in USD with feed decimals (e.g., 1e8 = $1) */
  price: bigint;
  /** Number of decimals in the price feed */
  decimals: number;
  /** Unix timestamp of last update */
  updatedAt: Date;
  /** Whether the price is stale (>24 hours old) */
  isStale: boolean;
}

/**
 * Claimable reward from a protocol adapter
 */
export interface ClaimableReward {
  /** Adapter contract address that holds the reward */
  adapter: string;
  /** Token information */
  token: RewardToken;
  /** Claimable amount in raw token units */
  claimableAmount: bigint;
  /** Estimated value in USDC 6-decimal units */
  valueUsdc: bigint;
  /** Timestamp when valuation was computed */
  estimatedAt: Date;
}

/**
 * Immutable Uniswap V3 route configuration
 * Per §9.4: route is admin-approved and immutable at execution time
 */
export interface UniswapV3Route {
  /** Unique route identifier */
  routeId: string;
  /** Input token address (reward token) */
  tokenIn: string;
  /** Output token address (should be USDC) */
  tokenOut: string;
  /** Pool fee in hundredths of a basis points (500 = 0.05%, 3000 = 0.30%) */
  poolFee: number;
  /** Chainlink oracle feed address for price validation */
  oracleFeed: string;
}

/**
 * Route status from RewardExecutor
 */
export type RouteStatus = 'active' | 'inactive' | 'stale';

/**
 * Harvest costs breakdown per §9.3
 */
export interface RewardHarvestCosts {
  gasCostUsdc: bigint;
  slippageCostUsdc: bigint;
  impactCostUsdc: bigint;
  bufferCostUsdc: bigint;
  totalCostUsdc: bigint;
}

/**
 * Harvest decision output
 */
export interface RewardHarvestDecision {
  /** Whether the harvest should be executed */
  shouldHarvest: boolean;
  /** Adapter address for this decision */
  adapter: string;
  /** Selected route ID */
  routeId: string | null;
  /** Amount to claim and swap (only set when shouldHarvest is true) */
  amountIn: bigint | null;
  /** Estimated USDC output after costs */
  estimatedOutputUsdc: bigint;
  /** Detailed cost breakdown */
  costs: RewardHarvestCosts;
  /** Human-readable reason for the decision */
  reason: string;
}

/**
 * Oracle validation result
 */
export interface OracleValidation {
  /** Whether the oracle data is valid */
  valid: boolean;
  /** Current price */
  price?: bigint;
  /** Last update timestamp */
  updatedAt?: Date;
  /** Whether price is stale */
  isStale?: boolean;
  /** Deviation from last known price (basis points) */
  deviationBps?: bigint;
  /** Validation failure reason */
  reason?: string;
}

/**
 * Swap execution parameters
 */
export interface SwapParams {
  /** Route identifier */
  routeId: string;
  /** Amount of input token */
  amountIn: bigint;
  /** Minimum acceptable output (slippage protection) */
  minOut: bigint;
  /** Deadline for execution */
  deadline: bigint;
}

/**
 * Swap quote from Uniswap Quoter
 */
export interface SwapQuote {
  /** Expected output amount */
  amountOut: bigint;
  /** Execution price including fee */
  executionPrice: bigint;
  /** Price impact in basis points */
  priceImpactBps: bigint;
  /** Whether quote is valid */
  valid: boolean;
}

/**
 * Swap execution result
 */
export interface SwapResult {
  /** Whether the swap succeeded */
  success: boolean;
  /** Transaction hash if successful */
  txHash?: string;
  /** Actual output amount received */
  amountOut?: bigint;
  /** Gas used for the transaction */
  gasUsed?: bigint;
  /** Error message if failed */
  error?: string;
}

/**
 * Reward valuation with conservative haircut
 * Per §9.2: rewards use haircut for conservative valuation
 */
export interface ConservativeRewardValuation {
  /** Raw reward value in USDC */
  rawValueUsdc: bigint;
  /** Haircut percentage applied (basis points, e.g., 500 = 5%) */
  haircutBps: bigint;
  /** Conservative value after haircut */
  conservativeValueUsdc: bigint;
  /** Token information */
  token: RewardToken;
  /** Source oracle data */
  oracleData: ChainlinkPrice;
}

/**
 * Configuration for Chainlink oracle validation
 */
export interface ChainlinkOracleConfig {
  /** Maximum staleness in seconds (default: 86400 = 24 hours) */
  maxStalenessSeconds: number;
  /** Maximum price deviation in basis points (default: 5000 = 50%) */
  maxDeviationBps: bigint;
  /** Cache duration for prices in seconds */
  cacheDurationSeconds: number;
}

/**
 * Configuration for Uniswap V3 executor
 */
export interface UniswapExecutorConfig {
  /** Router address */
  routerAddress: string;
  /** Quoter address for price estimation */
  quoterAddress: string;
  /** Maximum slippage in basis points */
  maxSlippageBps: bigint;
  /** Minimum swap amount in USDC terms */
  minSwapAmountUsdc: bigint;
  /** Maximum price impact in basis points */
  maxPriceImpactBps: bigint;
}

/**
 * Configuration for reward processor
 */
export interface RewardProcessorConfig {
  /** Minimum claimable value to consider (USDC 6 decimals) */
  minClaimableValueUsdc: bigint;
  /** Minimum observation period in seconds */
  minObservationPeriodSeconds: number;
  /** Haircut for conservative valuation (basis points) */
  valuationHaircutBps: bigint;
  /** Maximum acceptable price deviation for harvest (basis points) */
  maxPriceDeviationBps: bigint;
  /** Chainlink oracle config */
  chainlinkConfig: ChainlinkOracleConfig;
  /** Uniswap executor config */
  uniswapConfig: UniswapExecutorConfig;
}

/**
 * Reward observation record for tracking
 */
export interface RewardObservation {
  /** Adapter address */
  adapter: string;
  /** Reward token */
  token: RewardToken;
  /** Observed claimable amount */
  amount: bigint;
  /** Value in USDC at observation time */
  valueUsdc: bigint;
  /** Timestamp of observation */
  timestamp: Date;
  /** Block number of observation */
  blockNumber: number;
}

/**
 * Harvest history record
 */
export interface HarvestRecord {
  /** Unique harvest identifier */
  harvestId: string;
  /** Adapter address */
  adapter: string;
  /** Reward token */
  token: RewardToken;
  /** Amount claimed */
  claimedAmount: bigint;
  /** USDC output received */
  usdcReceived: bigint;
  /** Transaction hash */
  txHash: string;
  /** Timestamp */
  timestamp: Date;
  /** Net value after costs */
  netValueUsdc: bigint;
  /** Whether harvest was profitable */
  profitable: boolean;
}
