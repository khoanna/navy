/**
 * Harvest Gate - decides when to harvest rewards based on profitability
 *
 * This implements an event-driven harvest gate per SRCLA design Section 3.4:
 * - Calculates harvest costs (gas, slippage, impact)
 * - Compares against potential rewards
 * - Only triggers harvest when profitable above threshold
 */

export interface HarvestGateCosts {
  /** Gas cost for claiming rewards (in native gas units, e.g., wei) */
  claimGasCost: bigint;
  /** Additional gas cost for swap execution */
  swapGasCost: bigint;
  /** L1 data cost (for L2 rollups like Base) */
  l1DataCost: bigint;
  /** Expected price impact in basis points (e.g., 10 = 0.1%) */
  swapImpactBps: bigint;
  /** Expected slippage in basis points */
  slippageBps: bigint;
  /** Safety buffer in basis points */
  bufferBps: bigint;
}

export interface HarvestGateConfig {
  /** Cost model parameters */
  costs: HarvestGateCosts;
  /** Minimum value to harvest (in USDC 6 decimals, e.g., 10_000_0000 = $10) */
  minValueThreshold: bigint;
  /** Minimum time between harvests per adapter (seconds) */
  observationPeriod: number;
}

export interface HarvestDecision {
  /** Whether to execute the harvest */
  execute: boolean;
  /** Reason for the decision */
  reason: string;
  /** Estimated net value (positive = profit, negative = loss) */
  estimatedNetValue: bigint;
  /** Estimated cost breakdown */
  costBreakdown: HarvestCosts;
}

export interface HarvestCosts {
  gasCostUsdc: bigint;
  slippageCostUsdc: bigint;
  impactCostUsdc: bigint;
  bufferCostUsdc: bigint;
  totalCostUsdc: bigint;
}

/**
 * Error codes for harvest gate decisions
 */
export enum HarvestGateReason {
  MINIMUM_VALUE = 'MINIMUM_VALUE',
  NOT_PROFITABLE = 'NOT_PROFITABLE',
  OBSERVATION_PERIOD = 'OBSERVATION_PERIOD',
  PROFITABLE = 'PROFITABLE',
}

/**
 * Harvest Gate for deciding when to harvest rewards
 */
export class HarvestGate {
  private config: HarvestGateConfig;
  private lastHarvestTime: Map<string, number> = new Map();
  private nativeTokenPrice: bigint; // Price of native token in USDC (8 decimals)

  constructor(config: HarvestGateConfig, nativeTokenPrice: bigint = 3500_000000n) {
    // nativeTokenPrice default ~$3500 (ETH price)
    this.config = config;
    this.nativeTokenPrice = nativeTokenPrice;
  }

  /**
   * Update the native token price (e.g., ETH price)
   */
  setNativeTokenPrice(price: bigint): void {
    this.nativeTokenPrice = price;
  }

  /**
   * Get the last harvest time for an adapter
   */
  getLastHarvestTime(adapter: string): number {
    return this.lastHarvestTime.get(adapter) ?? 0;
  }

  /**
   * Record a harvest event for an adapter
   */
  recordHarvest(adapter: string, timestamp?: number): void {
    this.lastHarvestTime.set(adapter, timestamp ?? Math.floor(Date.now() / 1000));
  }

  /**
   * Calculate the total gas cost in USDC
   */
  calculateGasCost(): bigint {
    const { claimGasCost, swapGasCost, l1DataCost } = this.config.costs;
    const totalGas = claimGasCost + swapGasCost + l1DataCost;

    // Convert gas to USDC:
    // totalGas * gasPrice (wei) * ethUsdcPrice (USDC per ETH, 8 decimals) / 1e18
    // Example: 350_000 gas * 30e9 gwei * 2000e8 USDC/ETH / 1e18 = 21_000_000 USDC
    const gasPrice = 30_000_000_000n; // 30 gwei in wei
    // Multiply first, then divide to avoid intermediate zero from integer division
    // Result is in USDC with 6 decimals
    const gasCostUsdc = (totalGas * gasPrice * this.nativeTokenPrice) / 1_000_000_000_000_000_000n;

    return gasCostUsdc;
  }

  /**
   * Calculate slippage cost in USDC
   */
  calculateSlippageCost(claimableValue: bigint, slippageBps: bigint): bigint {
    return (claimableValue * slippageBps) / 10000n;
  }

  /**
   * Calculate impact cost in USDC
   */
  calculateImpactCost(claimableValue: bigint, impactBps: bigint): bigint {
    return (claimableValue * impactBps) / 10000n;
  }

  /**
   * Calculate buffer cost in USDC
   */
  calculateBufferCost(claimableValue: bigint): bigint {
    const { bufferBps } = this.config.costs;
    return (claimableValue * bufferBps) / 10000n;
  }

  /**
   * Calculate all harvest costs
   */
  calculateCosts(claimableValue: bigint, slippageBps?: bigint): HarvestCosts {
    const slippage = slippageBps ?? this.config.costs.slippageBps;
    const { swapImpactBps } = this.config.costs;

    const gasCostUsdc = this.calculateGasCost();
    const slippageCostUsdc = this.calculateSlippageCost(claimableValue, slippage);
    const impactCostUsdc = this.calculateImpactCost(claimableValue, swapImpactBps);
    const bufferCostUsdc = this.calculateBufferCost(claimableValue);

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
   * Decide whether to harvest
   */
  shouldHarvest(params: {
    adapter: string;
    claimableValue: bigint;
    expectedSlippageBps?: bigint;
  }): HarvestDecision {
    const { adapter, claimableValue, expectedSlippageBps } = params;

    // Check minimum value threshold
    if (claimableValue < this.config.minValueThreshold) {
      return {
        execute: false,
        reason: `${HarvestGateReason.MINIMUM_VALUE}: claimable value ${claimableValue} below threshold ${this.config.minValueThreshold}`,
        estimatedNetValue: 0n,
        costBreakdown: this.calculateCosts(claimableValue, expectedSlippageBps),
      };
    }

    // Check observation period
    const lastHarvest = this.getLastHarvestTime(adapter);
    const now = Math.floor(Date.now() / 1000);
    if (lastHarvest > 0 && now - lastHarvest < this.config.observationPeriod) {
      const remaining = this.config.observationPeriod - (now - lastHarvest);
      return {
        execute: false,
        reason: `${HarvestGateReason.OBSERVATION_PERIOD}: must wait ${remaining}s before next harvest`,
        estimatedNetValue: 0n,
        costBreakdown: this.calculateCosts(claimableValue, expectedSlippageBps),
      };
    }

    // Calculate costs and net value
    const costs = this.calculateCosts(claimableValue, expectedSlippageBps);
    const estimatedNetValue = claimableValue - costs.totalCostUsdc;

    // Check if profitable
    if (estimatedNetValue <= 0n) {
      return {
        execute: false,
        reason: `${HarvestGateReason.NOT_PROFITABLE}: net value ${estimatedNetValue} <= 0`,
        estimatedNetValue,
        costBreakdown: costs,
      };
    }

    return {
      execute: true,
      reason: `${HarvestGateReason.PROFITABLE}: net value ${estimatedNetValue} > 0`,
      estimatedNetValue,
      costBreakdown: costs,
    };
  }

  /**
   * Get the minimum harvestable value after costs
   */
  getMinimumHarvestValue(): bigint {
    // Minimum value needed to cover costs
    const costs = this.config.costs;
    const totalCostRatioBps = costs.slippageBps + costs.swapImpactBps + costs.bufferBps;

    // Minimum value = gas cost / (1 - cost ratio)
    // This is an approximation - the exact minimum would require solving:
    // value - (value * ratio + gas) > 0
    // value > gas / (1 - ratio)
    const totalCostRatio = totalCostRatioBps / 10000n;
    const gasCostUsdc = this.calculateGasCost();

    if (totalCostRatio >= 1n) {
      // Costs exceed 100%, can't profit
      return this.config.minValueThreshold;
    }

    const minValue = (gasCostUsdc * 10000n) / (10000n - totalCostRatioBps);
    return minValue > this.config.minValueThreshold ? minValue : this.config.minValueThreshold;
  }
}
