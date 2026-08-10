/**
 * ERC-4626 vault replay engine for backtesting
 */
// Note: WAD is used for documentation of scale; the class stores raw values
import type { VaultState, Cohort } from './state.js';
import { createInitialState, sharePrice } from './state.js';

export class VaultReplay {
  private state: VaultState;

  constructor(initialDeposit: bigint) {
    this.state = createInitialState(initialDeposit);
  }

  /**
   * Current share price (totalAssets / totalShares) in WAD scale
   */
  currentSharePrice(): bigint {
    return sharePrice(this.state);
  }

  /**
   * Deposit assets, mint shares to cohort
   */
  deposit(assets: bigint, cohortId: string): bigint {
    if (assets === 0n) return 0n;

    const shares = this.convertToShares(assets);

    this.state.totalAssets += assets;
    this.state.totalShares += shares;
    this.state.idleBase += assets;

    const existing = this.state.cohorts.get(cohortId);
    if (existing) {
      existing.shares += shares;
      this.state.cohorts.set(cohortId, existing);
    } else {
      this.state.cohorts.set(cohortId, {
        id: cohortId,
        shares,
        depositTimestamp: new Date(),
      });
    }

    return shares;
  }

  /**
   * Redeem shares from cohort, receive assets
   */
  redeem(
    cohortId: string,
    shares: bigint,
    options?: { slippageBps?: bigint; maxLossBps?: bigint },
  ): bigint {
    const cohort = this.state.cohorts.get(cohortId);
    if (!cohort) throw new Error(`Cohort not found: ${cohortId}`);

    if (shares === 0n) return 0n;
    if (shares > cohort.shares) {
      shares = cohort.shares; // Limit to cohort balance
    }

    let assets = this.convertToAssets(shares);

    // Apply slippage
    if (options?.slippageBps && options.slippageBps > 0n) {
      const slippage = (assets * options.slippageBps) / 10000n;
      assets -= slippage;
    }

    // Update state
    this.state.totalAssets -= assets;
    this.state.totalShares -= shares;
    this.state.idleBase = this.state.idleBase >= assets ? this.state.idleBase - assets : 0n;
    cohort.shares -= shares;

    return assets;
  }

  /**
   * Add yield from strategies
   */
  addYield(amount: bigint): void {
    if (amount > 0n) {
      this.state.totalAssets += amount;
    }
  }

  /**
   * Deploy idle funds to a strategy adapter
   */
  deploy(adapterId: string, amount: bigint): void {
    if (amount === 0n) return;
    if (amount > this.state.idleBase) {
      throw new Error(`Insufficient idle: have ${this.state.idleBase}, need ${amount}`);
    }

    this.state.idleBase -= amount;
    const current = this.state.strategyBalances.get(adapterId) ?? 0n;
    this.state.strategyBalances.set(adapterId, current + amount);
  }

  /**
   * Divest funds from a strategy adapter
   */
  divest(adapterId: string, amount: bigint): bigint {
    if (amount === 0n) return 0n;

    const current = this.state.strategyBalances.get(adapterId) ?? 0n;
    const actual = amount > current ? current : amount;

    this.state.idleBase += actual;
    this.state.strategyBalances.set(adapterId, current - actual);

    return actual;
  }

  /**
   * Convert assets to shares at current price
   */
  private convertToShares(assets: bigint): bigint {
    if (this.state.totalAssets === 0n) return assets;
    // shares = assets * totalShares / totalAssets
    return (assets * this.state.totalShares) / this.state.totalAssets;
  }

  /**
   * Convert shares to assets at current price
   */
  private convertToAssets(shares: bigint): bigint {
    if (this.state.totalShares === 0n) return shares;
    // assets = shares * totalAssets / totalShares
    return (shares * this.state.totalAssets) / this.state.totalShares;
  }

  /**
   * Get cohort info
   */
  getCohort(cohortId: string): Cohort | undefined {
    return this.state.cohorts.get(cohortId);
  }

  /**
   * Get current state snapshot (immutable copy)
   */
  getState(): VaultState {
    return {
      totalAssets: this.state.totalAssets,
      totalShares: this.state.totalShares,
      idleBase: this.state.idleBase,
      strategyBalances: new Map(this.state.strategyBalances),
      cohorts: new Map(this.state.cohorts),
    };
  }

  /**
   * Simulate a loss (e.g., from strategy underperformance)
   */
  applyLoss(amount: bigint): void {
    if (amount === 0n) return;
    if (amount > this.state.totalAssets) {
      this.state.totalAssets = 0n;
      this.state.totalShares = 0n;
      this.state.idleBase = 0n;
    } else {
      this.state.totalAssets -= amount;
    }
  }
}
