/**
 * Cost Gate - Decides whether a movement is profitable enough to execute
 *
 * Implements the complete-cost movement rule per SRCLA design Section 9.1:
 *
 * Movement costs include:
 * - Gas cost = gasLimit * gasPrice * ethPrice / 1e18 (USDC)
 * - Slippage cost = amount * slippageBps / 10000
 * - MEV impact = amount * mevImpactBps / 10000
 * - Total cost = gas + slippage + MEV
 *
 * Expected gain:
 * - expectedGain = amount * (targetRate - currentRate) * horizonSeconds / yearSeconds
 *
 * Gate decision:
 * - passGate = expectedGain > (totalCost + minThreshold)
 */

import {
  CostGateConfig,
  CostBreakdown,
  CostGateDecision,
  MovementType,
  GainParameters,
  CostGateContext,
  CostGateStats,
  MovementCosts,
  DEFAULT_COST_GATE_CONFIG,
  L1DataCostParams,
  FailureCostParams,
  BufferOpportunityParams,
} from './cost-gate-types.js';

// L1 data cost factor: non-zero byte vs zero byte cost ratio on Ethereum
// Ethereum L1 gas: zero byte = 4 gas, non-zero byte = 16 gas
// Factor = 16 / 4 = 4, but we use 16 as the multiplier for full calldata cost
const L1_DATA_COST_FACTOR = 16n;

import { SECONDS_PER_YEAR } from '../protocols/math.js';

/**
 * Cost Gate for evaluating movement profitability
 *
 * Evaluates whether the expected gain from a capital movement exceeds
 * the complete cost including gas, slippage, and MEV impact.
 */
export class CostGate {
  private config: CostGateConfig;
  private lastMovementTime: Map<string, number> = new Map();
  private recentTurnover: bigint = 0n;
  private stats: CostGateStats = {
    totalEvaluated: 0,
    totalPassed: 0,
    blockedByCost: 0,
    blockedByCooldown: 0,
    blockedByTurnover: 0,
    avgNetGain: 0n,
    avgCost: 0n,
  };

  constructor(config: Partial<CostGateConfig> = {}) {
    this.config = { ...DEFAULT_COST_GATE_CONFIG, ...config };
  }

  /**
   * Update the gas price (wei)
   */
  setGasPrice(gasPriceWei: bigint): void {
    this.config.gasPriceWei = gasPriceWei;
  }

  /**
   * Update the ETH price (USDC with 8 decimals)
   */
  setEthPrice(ethPriceUsdc: bigint): void {
    this.config.ethPriceUsdc = ethPriceUsdc;
  }

  /**
   * Update recent turnover tracking
   */
  setRecentTurnover(turnover: bigint): void {
    this.recentTurnover = turnover;
  }

  /**
   * Get the last movement time for a market/position pair
   */
  getLastMovementTime(marketId: string, targetAdapter: string | null): number {
    const key = this.buildMovementKey(marketId, targetAdapter);
    return this.lastMovementTime.get(key) ?? 0;
  }

  /**
   * Record a movement execution
   */
  recordMovement(
    marketId: string,
    targetAdapter: string | null,
    amount: bigint,
    timestamp?: number
  ): void {
    const key = this.buildMovementKey(marketId, targetAdapter);
    this.lastMovementTime.set(key, timestamp ?? Math.floor(Date.now() / 1000));
    this.recentTurnover += amount;
  }

  /**
   * Get current configuration
   */
  getConfig(): CostGateConfig {
    return { ...this.config };
  }

  /**
   * Get statistics
   */
  getStats(): CostGateStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalEvaluated: 0,
      totalPassed: 0,
      blockedByCost: 0,
      blockedByCooldown: 0,
      blockedByTurnover: 0,
      avgNetGain: 0n,
      avgCost: 0n,
    };
  }

  /**
   * Build a unique key for movement tracking
   */
  private buildMovementKey(marketId: string, targetAdapter: string | null): string {
    return `${marketId}:${targetAdapter ?? 'idle'}`;
  }

  /**
   * Calculate gas cost in USDC
   *
   * Formula: gasLimit * gasPriceWei * ethPriceUsdc / 1e18
   *
   * @param gasLimit - Gas units for the transaction
   * @returns Gas cost in USDC (6 decimals)
   */
  calculateGasCost(gasLimit?: bigint): bigint {
    const limit = gasLimit ?? this.config.gasLimit;

    // gasLimit * gasPriceWei can be large, but result fits in USDC 6 decimals
    // Example: 500k gas * 30e9 gwei * 3500 USDC / 1e18 = 52,500,000 (~$52.50)
    return (limit * this.config.gasPriceWei * this.config.ethPriceUsdc) / 1_000_000_000_000_000_000n;
  }

  /**
   * Calculate slippage cost in USDC
   *
   * Formula: amount * slippageBps / 10000
   */
  calculateSlippageCost(amount: bigint, slippageBps?: number): bigint {
    const bps = slippageBps ?? this.config.slippageBps;
    return (amount * BigInt(bps)) / 10000n;
  }

  /**
   * Calculate MEV impact cost in USDC
   *
   * Formula: amount * mevImpactBps / 10000
   */
  calculateMevCost(amount: bigint, mevImpactBps?: number): bigint {
    const bps = mevImpactBps ?? this.config.mevImpactBps;
    return (amount * BigInt(bps)) / 10000n;
  }

  /**
   * Calculate L1 data cost for rollup transactions
   *
   * L1 calldata cost = l1GasPrice * l1CalldataBytes * L1_DATA_COST_FACTOR
   *
   * The L1_DATA_COST_FACTOR accounts for Ethereum's per-byte gas cost
   * (16 gas per non-zero byte, 4 gas per zero byte; using 16 as average).
   *
   * @param params - L1 data cost parameters
   * @returns L1 data cost in wei (to be converted to USDC by caller if needed)
   */
  calculateL1DataCost(params: L1DataCostParams): bigint {
    const { l1GasPrice, l1CalldataBytes } = params;
    return l1GasPrice * BigInt(l1CalldataBytes) * L1_DATA_COST_FACTOR;
  }

  /**
   * Calculate expected failure cost from rebalance failures
   *
   * Failure cost = historicalFailureRate * estimatedLossOnFailure * (1 + volatilityFactor)
   *
   * This represents the expected value of potential loss from failed movements,
   * adjusted for tail risk through the volatility factor.
   *
   * @param params - Failure cost parameters
   * @returns Expected failure cost in USDC (6 decimals)
   */
  calculateFailureCost(params: FailureCostParams): bigint {
    const { historicalFailureRate, estimatedLossOnFailure, volatilityFactor } = params;

    // Multiply estimated loss by failure rate
    const expectedLoss = (estimatedLossOnFailure * BigInt(Math.round(historicalFailureRate * 10000))) / 10000n;

    // Apply volatility factor: (1 + volatilityFactor)
    const volatilityMultiplier = 10000n + BigInt(Math.round(volatilityFactor * 10000));
    const adjustedLoss = (expectedLoss * volatilityMultiplier) / 10000n;

    return adjustedLoss;
  }

  /**
   * Calculate opportunity cost from idle buffer funds
   *
   * Buffer opportunity cost = idleAmount * bestAvailableRate * timeSeconds / year
   *
   * This represents foregone yield from keeping funds idle instead of
   * deploying them to the best available opportunity.
   *
   * Uses WAD arithmetic for rate calculations.
   * - Amount is in 6 decimals (USDC)
   * - Rate is in WAD (18 decimals), e.g., 50000000000000000n = 0.05 = 5%
   *
   * @param params - Buffer opportunity parameters
   * @returns Foregone yield in USDC (6 decimals)
   */
  calculateBufferOpportunityCost(params: BufferOpportunityParams): bigint {
    const { idleAmount, bestAvailableRate, timeSeconds } = params;

    if (idleAmount === 0n || bestAvailableRate === 0n || timeSeconds === 0) {
      return 0n;
    }

    // Convert WAD rate to basis points: rate * 10000
    // e.g., 0.05 (5%) * 10000 = 500 bps
    const rateBps = (bestAvailableRate * 10000n) / 1_000_000_000_000_000_000n;

    // opportunityCost = idleAmount * rateBps * timeSeconds / year / 10000
    // - idleAmount: 6 decimals
    // - rateBps: integer basis points
    // - Result: 6 decimals
    const opportunityCost = (idleAmount * rateBps * BigInt(timeSeconds)) / (SECONDS_PER_YEAR * 10000n);

    return opportunityCost;
  }

  /**
   * Calculate complete movement cost breakdown
   *
   * Aggregates all 11 cost components per SRCLA Section 9.1:
   * Cmove = CL2 + CL1data + Cexit + Centry + Cclaim + Capprove/reset + Cswap + Cimpact + Cslippage/MEV + Cfailure + Cbuffer
   */
  calculateCostBreakdown(params: {
    amount: bigint;
    gasLimit?: bigint;
    slippageBps?: number;
    mevImpactBps?: number;
    movementType?: MovementType;
    l1DataCost?: bigint;
    exitCost?: bigint;
    entryCost?: bigint;
    claimCost?: bigint;
    approveResetCost?: bigint;
    swapCost?: bigint;
    impactCost?: bigint;
    failureCost?: bigint;
    bufferCost?: bigint;
  }): CostBreakdown {
    const {
      amount,
      gasLimit,
      slippageBps,
      mevImpactBps,
      movementType,
      l1DataCost = 0n,
      exitCost = 0n,
      entryCost = 0n,
      claimCost = 0n,
      approveResetCost = 0n,
      swapCost = 0n,
      impactCost = 0n,
      failureCost = 0n,
      bufferCost = 0n,
    } = params;

    const l2GasCost = this.calculateGasCost(gasLimit);
    const slippageCost = this.calculateSlippageCost(amount, slippageBps);
    const mevImpact = this.calculateMevCost(amount, mevImpactBps);

    // Additional costs based on movement type
    let additionalGasCost = 0n;
    let claimAdjustment = 0n;
    if (movementType === MovementType.HARVEST) {
      // Extra gas for claiming rewards
      additionalGasCost = this.calculateGasCost(200_000n);
      claimAdjustment = claimCost;
    } else if (movementType === MovementType.EMERGENCY) {
      // Emergency exits may have higher gas
      additionalGasCost = this.calculateGasCost(300_000n);
    }

    // Total L2 gas including movement-specific adjustments
    const totalL2GasCost = l2GasCost + additionalGasCost;

    // Calculate total: sum all 11 cost components
    const totalCost =
      totalL2GasCost +
      l1DataCost +
      exitCost +
      entryCost +
      claimAdjustment +
      approveResetCost +
      swapCost +
      impactCost +
      slippageCost +
      mevImpact +
      failureCost +
      bufferCost;

    return {
      l2GasCost: totalL2GasCost,
      l1DataCost,
      exitCost,
      entryCost,
      claimCost: claimAdjustment,
      approveResetCost,
      swapCost,
      impactCost,
      slippageCost: slippageCost + mevImpact,
      failureCost,
      bufferCost,
      totalCost,
    };
  }

  /**
   * Calculate expected gain from a capital movement
   *
   * Formula: amount * (targetRate - currentRate) * horizonSeconds / yearSeconds
   *
   * Uses WAD arithmetic for rate calculations.
   * Rates are in WAD format (e.g., 50000000000000000n = 0.05 = 5%)
   *
   * @param amount - Movement amount in USDC (6 decimals)
   * @param currentRate - Current rate at source (WAD)
   * @param targetRate - Target rate at destination (WAD)
   * @param horizonSeconds - Planning horizon (e.g., 86400 for 1 day)
   * @returns Expected gain in USDC (6 decimals)
   */
  calculateExpectedGain(
    amount: bigint,
    currentRate: bigint,
    targetRate: bigint,
    horizonSeconds: bigint
  ): bigint {
    // Rate advantage in WAD
    const rateAdvantage = targetRate - currentRate;

    // If target rate is not better, no gain
    if (rateAdvantage <= 0n) {
      return 0n;
    }

    // expectedGain = amount * rateAdvantage * horizonSeconds / yearSeconds
    // Amount is in 6 decimals, rateAdvantage is in WAD (18 decimals)
    // Result needs to be in 6 decimals

    // Convert rateAdvantage to basis points: rateAdvantage * 10000 / 10^18
    // This gives us a dimensionless multiplier
    const rateBps = (rateAdvantage * 10000n) / 1_000_000_000_000_000_000n;

    // expectedGain = amount * rateBps * horizonSeconds / yearSeconds / 10000
    const expectedGain =
      (amount * rateBps * horizonSeconds) / (SECONDS_PER_YEAR * 10000n);

    return expectedGain;
  }

  /**
   * Evaluate gain from gain parameters
   */
  evaluateGain(gainParams: GainParameters): bigint {
    return this.calculateExpectedGain(
      gainParams.amount,
      gainParams.currentRate,
      gainParams.destinationRateAfter > 0n ? gainParams.destinationRateAfter : gainParams.targetRate,
      gainParams.horizonSeconds
    );
  }

  /**
   * Check if movement is blocked by cooldown
   */
  isBlockedByCooldown(marketId: string, targetAdapter: string | null): boolean {
    const lastMovement = this.getLastMovementTime(marketId, targetAdapter);
    if (lastMovement === 0) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    return now - lastMovement < this.config.cooldownSeconds;
  }

  /**
   * Check if movement is blocked by turnover budget
   */
  isBlockedByTurnover(amount: bigint, totalAssets: bigint): boolean {
    if (totalAssets === 0n) {
      return true;
    }

    const maxTurnover = (totalAssets * BigInt(this.config.maxTurnoverBps)) / 10000n;
    return this.recentTurnover + amount > maxTurnover;
  }

  /**
   * Get cooldown remaining in seconds
   */
  getCooldownRemaining(marketId: string, targetAdapter: string | null): number {
    const lastMovement = this.getLastMovementTime(marketId, targetAdapter);
    if (lastMovement === 0) {
      return 0;
    }

    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - lastMovement;
    return Math.max(0, this.config.cooldownSeconds - elapsed);
  }

  /**
   * Evaluate a movement through the cost gate
   *
   * @param context - Complete evaluation context
   * @returns Cost gate decision
   */
  evaluate(context: CostGateContext): CostGateDecision {
    this.stats.totalEvaluated++;

    const { gainParams, targetAdapter, totalAssets, movementType } = context;
    const marketId = context.sourceAdapter ?? 'idle';

    // Calculate cost breakdown
    const costBreakdown = this.calculateCostBreakdown({
      amount: gainParams.amount,
      movementType,
    });

    // Calculate expected gain
    const expectedGain = this.evaluateGain(gainParams);

    // Calculate net gain
    const netGain = expectedGain - costBreakdown.totalCost;

    // Check cooldown
    const blockedByCooldown = this.isBlockedByCooldown(marketId, targetAdapter);
    if (blockedByCooldown) {
      this.stats.blockedByCooldown++;
      return {
        passGate: false,
        expectedGain,
        totalCost: costBreakdown.totalCost,
        netGain,
        reason: `COOLDOWN_ACTIVE: must wait ${this.getCooldownRemaining(marketId, targetAdapter)}s`,
        costBreakdown,
        blockedByCooldown: true,
        blockedByTurnover: false,
      };
    }

    // Check turnover budget
    const blockedByTurnover = this.isBlockedByTurnover(gainParams.amount, totalAssets);
    if (blockedByTurnover) {
      this.stats.blockedByTurnover++;
      return {
        passGate: false,
        expectedGain,
        totalCost: costBreakdown.totalCost,
        netGain,
        reason: 'TURNOVER_BUDGET_EXCEEDED',
        costBreakdown,
        blockedByCooldown: false,
        blockedByTurnover: true,
      };
    }

    // Check minimum threshold
    if (expectedGain <= costBreakdown.totalCost + this.config.minThreshold) {
      this.stats.blockedByCost++;
      return {
        passGate: false,
        expectedGain,
        totalCost: costBreakdown.totalCost,
        netGain,
        reason: `NOT_PROFITABLE: expectedGain ${expectedGain} <= totalCost ${costBreakdown.totalCost} + threshold ${this.config.minThreshold}`,
        costBreakdown,
        blockedByCooldown: false,
        blockedByTurnover: false,
      };
    }

    // Movement passes the gate
    this.stats.totalPassed++;

    // Update running averages
    if (this.stats.totalPassed === 1) {
      this.stats.avgNetGain = netGain;
      this.stats.avgCost = costBreakdown.totalCost;
    } else {
      // Running average calculation
      const n = BigInt(this.stats.totalPassed);
      this.stats.avgNetGain =
        (this.stats.avgNetGain * (n - 1n) + netGain) / n;
      this.stats.avgCost =
        (this.stats.avgCost * (n - 1n) + costBreakdown.totalCost) / n;
    }

    return {
      passGate: true,
      expectedGain,
      totalCost: costBreakdown.totalCost,
      netGain,
      reason: 'PROFITABLE',
      costBreakdown,
      blockedByCooldown: false,
      blockedByTurnover: false,
    };
  }

  /**
   * Calculate minimum profitable amount for a given rate differential
   *
   * Solves for: amount * rateAdvantage * horizon / year > totalCost + threshold
   * where totalCost = gasCost + amount * slippageBps / 10000 + amount * mevBps / 10000
   *
   * @param rateAdvantage - Rate differential in WAD
   * @param horizonSeconds - Planning horizon
   * @returns Minimum amount in USDC that would be profitable
   */
  calculateMinProfitableAmount(
    rateAdvantage: bigint,
    horizonSeconds: bigint,
    gasLimit?: bigint
  ): bigint {
    if (rateAdvantage <= 0n) {
      return BigInt(this.config.minThreshold) * 10000n;
    }

    // totalCost = gasCost + amount * (slippageBps + mevBps) / 10000
    // threshold = minThreshold
    // profit when: amount * rateAdvantage * horizon / year > totalCost + threshold
    //
    // amount * rateAdvantage * horizon / year > gasCost + amount * costBps / 10000 + threshold
    // amount * (rateAdvantage * horizon / year - costBps / 10000) > gasCost + threshold
    // amount > (gasCost + threshold) / (rateAdvantage * horizon / year - costBps / 10000)

    const gasCost = this.calculateGasCost(gasLimit);
    const totalCostPlusThreshold = gasCost + this.config.minThreshold;

    // Calculate rate return per period in WAD-like scale
    // rateReturn = rateAdvantage * horizon / year (WAD)
    const rateReturnwad = (rateAdvantage * horizonSeconds) / SECONDS_PER_YEAR;

    // Cost ratio per unit (also in WAD-like scale)
    // costRatio = (slippageBps + mevBps) / 10000
    const costBps = this.config.slippageBps + this.config.mevImpactBps;
    const costRatio = BigInt(costBps) * 1_000_000_000_000n / 10000n;

    // Effective return per unit
    const effectiveReturn = rateReturnwad - costRatio;

    if (effectiveReturn <= 0n) {
      // Rate advantage doesn't cover costs at any amount
      return totalCostPlusThreshold * 1_000_000_000_000n;
    }

    // amountwad = totalCostPlusThreshold * 1e12 / effectiveReturn
    // Convert to USDC 6 decimals
    const amountwad = (totalCostPlusThreshold * 1_000_000_000_000n) / effectiveReturn;
    const amount = amountwad / 1_000_000_000_000n;

    return amount < 0n ? 0n : amount;
  }

  /**
   * Create movement costs summary for logging
   */
  static formatMovementCosts(costs: MovementCosts): string {
    const total =
      costs.l2GasCost +
      costs.l1DataCost +
      costs.exitCost +
      costs.entryCost +
      costs.claimCost +
      costs.approveResetCost +
      costs.swapCost +
      costs.impactCost +
      costs.slippageCost +
      costs.failureBuffer +
      costs.bufferCost;

    return [
      `L2 Gas: ${costs.l2GasCost}`,
      `L1 Data: ${costs.l1DataCost}`,
      `Exit: ${costs.exitCost}`,
      `Entry: ${costs.entryCost}`,
      `Claim: ${costs.claimCost}`,
      `Approve/Reset: ${costs.approveResetCost}`,
      `Swap: ${costs.swapCost}`,
      `Impact: ${costs.impactCost}`,
      `Slippage: ${costs.slippageCost}`,
      `Failure Buffer: ${costs.failureBuffer}`,
      `Safety Buffer: ${costs.bufferCost}`,
      `Total: ${total}`,
    ].join(' | ');
  }
}
