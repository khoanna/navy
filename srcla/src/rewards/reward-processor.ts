/**
 * Reward Processor
 *
 * Event-driven reward harvesting logic per §9.2-§9.3:
 * - Reward claim threshold exceeded
 * - Price deviation within acceptable bounds
 * - Minimum observation period elapsed
 *
 * Harvest gate:
 * - shouldHarvest = (estimatedOutput - costs) > minValueThreshold
 *
 * Conservative valuation:
 * - Apply haircut for reward valuation
 */

import { ethers } from 'ethers';
import type { ChainClient } from '../chain/client.js';
import { ChainlinkOracle, DEFAULT_CHAINLINK_CONFIG } from './chainlink-oracle.js';
import { UniswapV3Executor, DEFAULT_UNISWAP_CONFIG } from './uniswap-executor.js';
import type {
  ClaimableReward,
  RewardHarvestDecision,
  RewardProcessorConfig,
  RewardObservation,
  HarvestRecord,
  RewardToken,
  UniswapV3Route,
  ConservativeRewardValuation,
} from './types.js';

/**
 * Default reward processor configuration
 */
export const DEFAULT_REWARD_PROCESSOR_CONFIG: RewardProcessorConfig = {
  minClaimableValueUsdc: 100_000_000n, // $100 minimum to consider
  minObservationPeriodSeconds: 3600, // 1 hour minimum between harvests
  valuationHaircutBps: 500n, // 5% haircut for conservative valuation
  maxPriceDeviationBps: 1000n, // 10% max deviation for harvest
  chainlinkConfig: DEFAULT_CHAINLINK_CONFIG,
  uniswapConfig: DEFAULT_UNISWAP_CONFIG,
};

/**
 * Reward Processor - Event-driven reward harvesting
 *
 * Implements the harvest gate per §9.2-§9.3:
 * - Event-driven (not periodic)
 * - Claim threshold exceeded
 * - Price deviation within bounds
 * - Minimum observation period elapsed
 *
 * Harvest decision:
 * shouldHarvest = (estimatedOutput - costs) > minValueThreshold
 */
export class RewardProcessor {
  private client: ChainClient;
  private config: RewardProcessorConfig;
  private chainlinkOracle: ChainlinkOracle;
  private uniswapExecutor: UniswapV3Executor;
  private wallet: ethers.Wallet | null = null;

  // State tracking
  private lastHarvestTime: Map<string, number> = new Map();
  private observations: Map<string, RewardObservation[]> = new Map();
  private harvestHistory: HarvestRecord[] = [];

  // Adapter reward token registry
  private adapterRewards: Map<string, RewardToken[]> = new Map();

  constructor(
    client: ChainClient,
    config: Partial<RewardProcessorConfig> = {}
  ) {
    this.client = client;
    this.config = { ...DEFAULT_REWARD_PROCESSOR_CONFIG, ...config };

    // Initialize sub-components
    this.chainlinkOracle = new ChainlinkOracle(client, this.config.chainlinkConfig);
    this.uniswapExecutor = new UniswapV3Executor(
      client,
      this.chainlinkOracle,
      this.config.uniswapConfig
    );
  }

  /**
   * Set the wallet for signing transactions
   */
  setWallet(wallet: ethers.Wallet): void {
    this.wallet = wallet;
    this.uniswapExecutor.setWallet(wallet);
  }

  /**
   * Register reward tokens for an adapter
   *
   * @param adapter - Adapter address
   * @param tokens - Array of reward tokens
   */
  registerAdapterRewards(adapter: string, tokens: RewardToken[]): void {
    this.adapterRewards.set(adapter.toLowerCase(), tokens);
  }

  /**
   * Register a Uniswap V3 route for reward conversion
   *
   * @param route - Route configuration
   */
  registerRoute(route: UniswapV3Route): void {
    this.uniswapExecutor.registerRoute(route);
  }

  /**
   * Get claimable rewards for an adapter
   * This is a stub - actual implementation would call the adapter contract
   *
   * @param adapter - Adapter address
   * @returns Array of claimable rewards
   */
  async getClaimableRewards(adapter: string): Promise<ClaimableReward[]> {
    // Stub implementation - reads from adapter contract
    // Actual implementation would:
    // 1. Call adapter.getRewardTokens() to get reward token list
    // 2. For each token, call adapter.claimableRewards(token) or similar

    const tokens = this.adapterRewards.get(adapter.toLowerCase());
    if (!tokens) {
      return [];
    }

    const rewards: ClaimableReward[] = [];

    for (const token of tokens) {
      // Read claimable amount from adapter
      // This is a stub - actual implementation would call the contract
      const claimableAmount = await this.getClaimableAmount(adapter, token);

      if (claimableAmount <= 0n) {
        continue;
      }

      // Value the reward
      const valueUsdc = await this.valueRewardToken(claimableAmount, token);

      rewards.push({
        adapter,
        token,
        claimableAmount,
        valueUsdc,
        estimatedAt: new Date(),
      });
    }

    return rewards;
  }

  /**
   * Get claimable amount for a specific token from an adapter
   * Stub - actual implementation calls adapter contract
   */
  private async getClaimableAmount(adapter: string, token: RewardToken): Promise<bigint> {
    // Stub: actual implementation would call the adapter contract
    // e.g., adapter.claimableRewards(token.address) or similar
    try {
      const ADAPTER_REWARD_ABI = [
        'function getClaimableAmount(address rewardToken) external view returns (uint256)',
      ];
      const contract = new ethers.Contract(adapter, ADAPTER_REWARD_ABI, this.client.provider);
      const getClaimableAmountFn = contract.getClaimableAmount;
      if (typeof getClaimableAmountFn !== 'function') {
        return 0n;
      }
      return await getClaimableAmountFn(token.address) as bigint;
    } catch {
      return 0n;
    }
  }

  /**
   * Value a reward token in USDC terms
   *
   * @param _amount - Token amount (unused in stub)
   * @param _token - Token information (unused in stub)
   * @returns Value in USDC 6-decimal units
   */
  async valueRewardToken(_amount: bigint, _token: RewardToken): Promise<bigint> {
    // Get USDC/USD price from Chainlink
    // Then get reward token/USD price
    // Multiply to get USDC value

    // For now, simplified: assume token price can be obtained from oracle
    // Actual implementation would use token-specific oracle

    // Example: COMP at $50 with 18 decimals
    // amount = 1000000000000000000 (1 COMP)
    // price = 5000000000 (50 * 1e8)
    // valueUsdc = amount * price / 10^18 / 10^8 * 10^6
    //           = 1000000000000000000 * 5000000000 / 10^26 * 10^6
    // Simplified: use oracle price directly

    // This is a stub - actual implementation would:
    // 1. Get reward token / USD price from oracle
    // 2. Get USD / USDC price from oracle
    // 3. Calculate value

    // For now, return 0 (requires oracle integration)
    return 0n;
  }

  /**
   * Get conservative reward valuation with haircut applied
   *
   * Per §9.2: apply haircut for conservative valuation
   *
   * @param reward - Claimable reward
   * @returns Valuation with haircut applied
   */
  async getConservativeValuation(reward: ClaimableReward): Promise<ConservativeRewardValuation> {
    // Get oracle data for the token
    const routes = this.uniswapExecutor.getRoutesForToken(reward.token.address);
    if (routes.length === 0) {
      return {
        rawValueUsdc: 0n,
        haircutBps: this.config.valuationHaircutBps,
        conservativeValueUsdc: 0n,
        token: reward.token,
        oracleData: {
          price: 0n,
          decimals: 8,
          updatedAt: new Date(0),
          isStale: true,
        },
      };
    }

    // Use the first route's oracle
    const route = routes[0];
    if (!route) {
      return {
        rawValueUsdc: 0n,
        haircutBps: this.config.valuationHaircutBps,
        conservativeValueUsdc: 0n,
        token: reward.token,
        oracleData: {
          price: 0n,
          decimals: 8,
          updatedAt: new Date(0),
          isStale: true,
        },
      };
    }
    const oracleData = await this.chainlinkOracle.getPrice(route.oracleFeed);

    // Apply haircut for conservative valuation
    const haircutBps = this.config.valuationHaircutBps;
    const conservativeValueUsdc = reward.valueUsdc - (reward.valueUsdc * haircutBps) / 10000n;

    return {
      rawValueUsdc: reward.valueUsdc,
      haircutBps,
      conservativeValueUsdc,
      token: reward.token,
      oracleData,
    };
  }

  /**
   * Check if harvest conditions are met for an adapter
   *
   * Per §9.3:
   * - Reward claim threshold exceeded
   * - Price deviation within acceptable bounds
   * - Minimum observation period elapsed
   *
   * @param adapter - Adapter address
   * @returns Boolean indicating if conditions are met
   */
  async checkHarvestConditions(adapter: string): Promise<{
    conditionsMet: boolean;
    claimableRewards: ClaimableReward[];
    conservativeValue: bigint;
    reasons: string[];
  }> {
    const claimableRewards = await this.getClaimableRewards(adapter);
    const reasons: string[] = [];

    if (claimableRewards.length === 0) {
      return {
        conditionsMet: false,
        claimableRewards: [],
        conservativeValue: 0n,
        reasons: ['No claimable rewards'],
      };
    }

    // Calculate total conservative value
    let totalConservativeValue = 0n;
    for (const reward of claimableRewards) {
      const valuation = await this.getConservativeValuation(reward);
      totalConservativeValue += valuation.conservativeValueUsdc;
    }

    // Check claim threshold
    if (totalConservativeValue < this.config.minClaimableValueUsdc) {
      reasons.push(
        `Conservative value ${totalConservativeValue} below threshold ${this.config.minClaimableValueUsdc}`
      );
    } else {
      reasons.push('Claim threshold met');
    }

    // Check price deviation
    const priceDeviationOk = await this.checkPriceDeviation(claimableRewards);
    if (!priceDeviationOk) {
      reasons.push('Price deviation exceeds acceptable bounds');
    } else {
      reasons.push('Price deviation within bounds');
    }

    // Check observation period
    const lastHarvest = this.lastHarvestTime.get(adapter.toLowerCase()) ?? 0;
    const now = Math.floor(Date.now() / 1000);
    const timeSinceLastHarvest = now - lastHarvest;

    if (lastHarvest > 0 && timeSinceLastHarvest < this.config.minObservationPeriodSeconds) {
      reasons.push(
        `Observation period not elapsed: ${timeSinceLastHarvest}s < ${this.config.minObservationPeriodSeconds}s`
      );
    } else {
      reasons.push('Observation period met');
    }

    const conditionsMet =
      totalConservativeValue >= this.config.minClaimableValueUsdc &&
      priceDeviationOk &&
      (lastHarvest === 0 || timeSinceLastHarvest >= this.config.minObservationPeriodSeconds);

    return {
      conditionsMet,
      claimableRewards,
      conservativeValue: totalConservativeValue,
      reasons,
    };
  }

  /**
   * Check if price deviation is within acceptable bounds
   *
   * @param rewards - Rewards to check
   * @returns Boolean indicating if deviation is acceptable
   */
  private async checkPriceDeviation(rewards: ClaimableReward[]): Promise<boolean> {
    for (const reward of rewards) {
      const routes = this.uniswapExecutor.getRoutesForToken(reward.token.address);
      if (routes.length === 0) continue;

      const route = routes[0];
      if (!route) continue;

      // Get current oracle price
      const currentPrice = await this.chainlinkOracle.getPrice(route.oracleFeed);

      if (currentPrice.isStale) {
        return false;
      }

      // Get last observation for deviation check
      const observations = this.observations.get(reward.adapter.toLowerCase());
      if (!observations || observations.length === 0) {
        continue;
      }

      const lastObs = observations[observations.length - 1];
      if (!lastObs) {
        continue;
      }
      const deviation = this.chainlinkOracle.calculateDeviation(
        currentPrice.price,
        lastObs.valueUsdc > 0n ? lastObs.valueUsdc : currentPrice.price
      );

      if (deviation > this.config.maxPriceDeviationBps) {
        return false;
      }
    }

    return true;
  }

  /**
   * Record an observation for tracking
   *
   * @param observation - Reward observation
   */
  recordObservation(observation: RewardObservation): void {
    const key = observation.adapter.toLowerCase();
    const existing = this.observations.get(key) ?? [];
    existing.push(observation);

    // Keep only last 100 observations
    if (existing.length > 100) {
      existing.shift();
    }

    this.observations.set(key, existing);
  }

  /**
   * Make harvest decision for an adapter
   *
   * Per §9.3 harvest gate:
   * shouldHarvest = (estimatedOutput - costs) > minValueThreshold
   *
   * @param adapter - Adapter address
   * @returns Harvest decision
   */
  async makeHarvestDecision(adapter: string): Promise<RewardHarvestDecision> {
    const conditions = await this.checkHarvestConditions(adapter);

    if (!conditions.conditionsMet) {
      return {
        shouldHarvest: false,
        adapter,
        routeId: null,
        amountIn: null,
        estimatedOutputUsdc: 0n,
        costs: {
          gasCostUsdc: 0n,
          slippageCostUsdc: 0n,
          impactCostUsdc: 0n,
          bufferCostUsdc: 0n,
          totalCostUsdc: 0n,
        },
        reason: conditions.reasons.join('; '),
      };
    }

    // Get the best route for each reward
    let totalEstimatedOutput = 0n;
    let totalAmountIn = 0n;
    let bestRouteId: string | null = null;
    let bestToken: RewardToken | null = null;

    for (const reward of conditions.claimableRewards) {
      const routes = this.uniswapExecutor.getRoutesForToken(reward.token.address);
      if (routes.length === 0) continue;

      // Find best route by quote
      for (const route of routes) {
        const quote = await this.uniswapExecutor.getQuote(route.routeId, reward.claimableAmount);
        if (!quote || !quote.valid) continue;

        // Select route with best output
        const estimatedUsdc = quote.amountOut; // Assuming USDC output
        if (estimatedUsdc > totalEstimatedOutput) {
          totalEstimatedOutput = estimatedUsdc;
          totalAmountIn = reward.claimableAmount;
          bestRouteId = route.routeId;
          bestToken = reward.token;
        }
      }
    }

    // Calculate costs
    const costs = this.calculateHarvestCosts(conditions.conservativeValue, bestToken);

    // Check harvest gate: estimatedOutput > costs
    const netValue = totalEstimatedOutput - costs.totalCostUsdc;

    if (netValue <= this.config.minClaimableValueUsdc) {
      return {
        shouldHarvest: false,
        adapter,
        routeId: bestRouteId,
        amountIn: null,
        estimatedOutputUsdc: totalEstimatedOutput,
        costs,
        reason: `Net value ${netValue} below minimum threshold ${this.config.minClaimableValueUsdc}`,
      };
    }

    return {
      shouldHarvest: true,
      adapter,
      routeId: bestRouteId,
      amountIn: totalAmountIn,
      estimatedOutputUsdc: totalEstimatedOutput,
      costs,
      reason: `Harvest profitable: net value ${netValue} > 0`,
    };
  }

  /**
   * Calculate harvest costs
   *
   * Per §9.3:
   * C_claim + C_approve/reset + C_swap + C_L1data + C_impact + C_slippage/MEV + C_buffer
   *
   * @param claimableValue - Total claimable value in USDC
   * @param token - Reward token (for gas estimation)
   * @returns Harvest costs breakdown
   */
  private calculateHarvestCosts(
    claimableValue: bigint,
    _token?: RewardToken | null
  ): RewardHarvestDecision['costs'] {
    // Gas cost estimation
    // Claim + Swap typically costs ~350k gas on Base
    // At 30 gwei and $3500 ETH = $3500 * 30e9 * 350000 / 1e18 = ~$36.75
    const gasEstimate = 350_000n;
    const gasPrice = 30_000_000_000n; // 30 gwei
    const ethUsdcPrice = 3500_000_000_00n; // $3500 with 2 decimals
    const gasCostUsdc = (gasEstimate * gasPrice * ethUsdcPrice) / 1_000_000_000_000_000_000n;

    // Slippage cost (0.5% default)
    const slippageBps = this.config.uniswapConfig.maxSlippageBps;
    const slippageCostUsdc = (claimableValue * slippageBps) / 10000n;

    // Price impact cost (1% default)
    const impactBps = this.config.uniswapConfig.maxPriceImpactBps;
    const impactCostUsdc = (claimableValue * impactBps) / 10000n;

    // Buffer cost (additional safety margin)
    const bufferBps = 100n; // 1% buffer
    const bufferCostUsdc = (claimableValue * bufferBps) / 10000n;

    const totalCostUsdc = gasCostUsdc + slippageCostUsdc + impactCostUsdc + bufferCostUsdc;

    return {
      gasCostUsdc,
      slippageCostUsdc,
      impactCostUsdc,
      bufferCostUsdc,
      totalCostUsdc,
    };
  }

  /**
   * Execute harvest for an adapter
   *
   * @param adapter - Adapter address
   * @param routeId - Route to use
   * @param amountIn - Amount to harvest
   * @returns Harvest record if successful
   */
  async executeHarvest(
    adapter: string,
    routeId: string,
    amountIn: bigint
  ): Promise<HarvestRecord | null> {
    if (!this.wallet) {
      console.error('Wallet not set for harvest execution');
      return null;
    }

    // Verify route is active
    const route = this.uniswapExecutor.getRoute(routeId);
    if (!route) {
      console.error(`Route ${routeId} not found`);
      return null;
    }

    // Get quote for minOut calculation
    const quote = await this.uniswapExecutor.getQuote(routeId, amountIn);
    if (!quote || !quote.valid) {
      console.error(`Invalid quote for route ${routeId}`);
      return null;
    }

    const minOut = this.uniswapExecutor.calculateMinOut(quote.amountOut);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800); // 30 min deadline

    // Execute atomic swap (claim + swap)
    const result = await this.uniswapExecutor.executeAtomicSwap(
      adapter,
      routeId,
      amountIn,
      minOut,
      deadline
    );

    if (!result.success) {
      console.error(`Harvest failed: ${result.error}`);
      return null;
    }

    // Record harvest
    const harvestRecord: HarvestRecord = {
      harvestId: ethers.id(`${adapter}-${routeId}-${Date.now()}`),
      adapter,
      token: {
        address: route.tokenIn,
        symbol: 'UNKNOWN', // Would get from token contract
        decimals: 18, // Would get from token contract
      },
      claimedAmount: amountIn,
      usdcReceived: result.amountOut ?? minOut,
      txHash: result.txHash ?? '',
      timestamp: new Date(),
      netValueUsdc: (result.amountOut ?? minOut) - this.calculateHarvestCosts(
        quote.amountOut,
        undefined
      ).totalCostUsdc,
      profitable: (result.amountOut ?? minOut) > minOut,
    };

    // Update last harvest time
    this.lastHarvestTime.set(adapter.toLowerCase(), Math.floor(Date.now() / 1000));

    // Add to history
    this.harvestHistory.push(harvestRecord);

    return harvestRecord;
  }

  /**
   * Get harvest history for an adapter
   *
   * @param adapter - Adapter address
   * @param limit - Maximum number of records to return
   * @returns Array of harvest records
   */
  getHarvestHistory(adapter?: string, limit = 100): HarvestRecord[] {
    if (adapter) {
      return this.harvestHistory
        .filter((h) => h.adapter.toLowerCase() === adapter.toLowerCase())
        .slice(-limit);
    }
    return this.harvestHistory.slice(-limit);
  }

  /**
   * Get observations for an adapter
   *
   * @param adapter - Adapter address
   * @returns Array of observations
   */
  getObservations(adapter: string): RewardObservation[] {
    return this.observations.get(adapter.toLowerCase()) ?? [];
  }

  /**
   * Get last harvest time for an adapter
   *
   * @param adapter - Adapter address
   * @returns Unix timestamp or 0 if never harvested
   */
  getLastHarvestTime(adapter: string): number {
    return this.lastHarvestTime.get(adapter.toLowerCase()) ?? 0;
  }

  /**
   * Get the Chainlink oracle instance
   */
  getChainlinkOracle(): ChainlinkOracle {
    return this.chainlinkOracle;
  }

  /**
   * Get the Uniswap executor instance
   */
  getUniswapExecutor(): UniswapV3Executor {
    return this.uniswapExecutor;
  }

  /**
   * Get processor configuration
   */
  getConfig(): RewardProcessorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<RewardProcessorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Clear harvest history
   */
  clearHistory(): void {
    this.harvestHistory = [];
  }

  /**
   * Clear observations
   */
  clearObservations(): void {
    this.observations.clear();
  }
}
