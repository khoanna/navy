/**
 * Reward Processing Module.
 *
 * Only the Chainlink feed reader survives here. `reward-processor.ts` and
 * `uniswap-executor.ts` were deleted: the first re-implemented §9.2/§9.3's
 * harvest gate more weakly than `policy/harvest.ts#evaluateHarvest` +
 * `policy/steps/reward-admission.ts` (one `output - cost > threshold` rule
 * and a hardcoded 5% haircut, against §9.2's all-or-nothing eight-criteria
 * admission and §9.1's eleven-term cost model), and the second gave the
 * allocator swap calldata §9.4 forbids it. See chainlink-oracle.ts's header
 * for why that one is kept and exactly what is missing to wire it.
 */
export {
  ChainlinkOracle,
  DEFAULT_CHAINLINK_CONFIG,
  type ChainlinkPrice,
  type ChainlinkOracleConfig,
  type OracleValidation,
} from './chainlink-oracle.js';
