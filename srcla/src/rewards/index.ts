/**
 * Reward Processing Module
 *
 * Exports all reward processing components for SRCLA:
 * - Chainlink oracle for price validation
 * - Uniswap V3 executor for swap execution
 * - Reward processor for harvest decisions
 */

// Types
export type {
  // Core types
  RewardToken,
  ChainlinkPrice,
  ClaimableReward,
  UniswapV3Route,
  RouteStatus,

  // Harvest types
  RewardHarvestCosts,
  RewardHarvestDecision,

  // Oracle types
  OracleValidation,

  // Swap types
  SwapParams,
  SwapQuote,
  SwapResult,

  // Valuation types
  ConservativeRewardValuation,

  // Configuration types
  ChainlinkOracleConfig,
  UniswapExecutorConfig,
  RewardProcessorConfig,

  // Tracking types
  RewardObservation,
  HarvestRecord,
} from './types.js';

// Chainlink Oracle
export { ChainlinkOracle, DEFAULT_CHAINLINK_CONFIG } from './chainlink-oracle.js';

// Uniswap V3 Executor
export { UniswapV3Executor, DEFAULT_UNISWAP_CONFIG } from './uniswap-executor.js';

// Reward Processor
export { RewardProcessor, DEFAULT_REWARD_PROCESSOR_CONFIG } from './reward-processor.js';
