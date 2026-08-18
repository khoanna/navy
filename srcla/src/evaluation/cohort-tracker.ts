/**
 * Cohort Tracker Service
 *
 * Implements paper §5.1: Cohort-based profit tracking with weekly evaluation windows.
 *
 * Features:
 * - 7-day cohort windows (604800 seconds)
 * - Cohort return calculation from share price delta
 * - Weighted return calculation for late depositors
 * - Per-user cohort position tracking
 *
 * Uses WAD (1e18) for fixed-point arithmetic.
 */
import { WAD as PROTO_WAD } from '../protocols/math.js';

/** WAD scale for fixed-point arithmetic */
export const WAD = PROTO_WAD;

/** Cohort window duration: 7 days in milliseconds */
const COHORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Cohort window duration: 7 days in seconds (for contract compatibility) */
export const COHORT_WINDOW_SECONDS = 604800n;

/** Unix epoch for cohort ID calculation */
const COHORT_EPOCH_MS = new Date('2024-01-01').getTime();

/**
 * Cohort data structure
 */
export interface Cohort {
  id: number;
  windowStart: Date;
  windowEnd: Date;
  startSharePrice: bigint;
  endSharePrice: bigint | undefined;
  totalDeposits: bigint;
  totalWithdrawals: bigint;
  closed: boolean;
}

/**
 * Cohort performance metrics
 */
export interface CohortPerformance {
  cohortId: number;
  grossReturn: number;        // As decimal (e.g., 0.05 = 5%)
  totalDeposits: bigint;
  totalWithdrawals: bigint;
  avgDepositTimestamp: Date;
  depositorCount: number;
}

/**
 * User's position within a cohort
 */
export interface UserCohortPosition {
  userAddress: string;
  cohortId: number;
  shares: bigint;
  depositAmount: bigint;
  depositTimestamp: Date;
  weightedReturn: number;
  currentValue?: bigint;
  unrealizedProfit?: bigint;
}

/**
 * Deposit record from events
 */
export interface DepositRecord {
  userAddress: string;
  amount: bigint;          // Base asset amount (USDC 6 decimals)
  shares: bigint;           // Shares received (WAD 18 decimals)
  sharePrice: bigint;       // Share price at deposit time (WAD)
  timestamp: Date;
  transactionHash: string;
}

/**
 * Withdrawal record from events
 */
export interface WithdrawalRecord {
  userAddress: string;
  amount: bigint;           // Base asset amount (USDC 6 decimals)
  shares: bigint;           // Shares burned (WAD 18 decimals)
  sharePrice: bigint;       // Share price at withdrawal time (WAD)
  timestamp: Date;
  profit?: bigint;          // Realized profit (WAD)
  transactionHash: string;
}

/**
 * Vault state interface for cohort tracking
 * Defines the minimal state needed from the vault
 */
export interface VaultStateForCohort {
  totalAssets: bigint;
  totalShares: bigint;
  idleBase: bigint;
  strategyBalances: Map<string, bigint>;
  /** Share price in WAD (18 decimals) */
  sharePrice: bigint;
}

/**
 * Vault state fetcher interface
 * Abstracts the chain interaction for testing
 */
export interface VaultStateProvider {
  getCurrentState(): Promise<VaultStateForCohort>;
  getSharePrice(): Promise<bigint>;
}

/**
 * Cohort Tracker Service
 *
 * Tracks cohort windows and calculates profit attribution:
 * - getCurrentCohort(): Returns the current 7-day cohort
 * - getCohortPerformance(id): Returns performance metrics for a cohort
 * - calculateCohortReturn(): Share price delta as percentage
 * - calculateWeightedReturn(): Late depositor adjustment
 */
export class CohortTracker {
  private cohortCache: Map<number, Cohort> = new Map();
  private currentCohortCache: Cohort | null = null;
  private vaultStateProvider: VaultStateProvider;

  constructor(vaultStateProvider: VaultStateProvider) {
    this.vaultStateProvider = vaultStateProvider;
  }

  /**
   * Get or create current cohort
   *
   * Cohorts are defined by 7-day windows starting from the epoch.
   * The cohort ID is computed as: floor((now - epoch) / COHORT_WINDOW_MS)
   */
  async getCurrentCohort(): Promise<Cohort> {
    if (this.currentCohortCache !== null && !this.isCohortExpired(this.currentCohortCache)) {
      return this.currentCohortCache;
    }

    const now = new Date();
    const cohortId = this.computeCohortId(now);
    const { windowStart, windowEnd } = this.computeCohortWindow(cohortId);

    // Get current share price from vault
    const state = await this.vaultStateProvider.getCurrentState();
    const currentSharePrice = state.sharePrice;

    const cohort: Cohort = {
      id: cohortId,
      windowStart,
      windowEnd,
      startSharePrice: currentSharePrice,
      endSharePrice: undefined,
      totalDeposits: 0n,
      totalWithdrawals: 0n,
      closed: now > windowEnd,
    };

    this.currentCohortCache = cohort;
    this.cohortCache.set(cohortId, cohort);

    return cohort;
  }

  /**
   * Get cohort by ID
   */
  async getCohort(id: number): Promise<Cohort | null> {
    // Check cache first
    const cached = this.cohortCache.get(id);
    if (cached !== undefined) {
      return cached;
    }

    // In production, this would fetch from database or contract events
    // For now, reconstruct from ID
    const { windowStart, windowEnd } = this.computeCohortWindow(id);
    const now = new Date();

    // Check if this is a past cohort that needs end price
    if (windowEnd < now) {
      // Past cohort - would need to fetch end price from events
      // Return a placeholder for now
      return null;
    }

    // Future cohort - use current price as start
    const currentSharePrice = await this.vaultStateProvider.getSharePrice();

    const cohort: Cohort = {
      id,
      windowStart,
      windowEnd,
      startSharePrice: currentSharePrice,
      endSharePrice: undefined,
      totalDeposits: 0n,
      totalWithdrawals: 0n,
      closed: false,
    };

    this.cohortCache.set(id, cohort);
    return cohort;
  }

  /**
   * Get cohort performance metrics
   */
  async getCohortPerformance(cohortId: number): Promise<CohortPerformance | null> {
    const cohort = await this.getCohort(cohortId);
    if (cohort === null) return null;

    const state = await this.vaultStateProvider.getCurrentState();
    const endSharePrice = cohort.endSharePrice ?? state.sharePrice;

    const grossReturn = this.calculateCohortReturn(cohort, endSharePrice);

    return {
      cohortId,
      grossReturn,
      totalDeposits: cohort.totalDeposits,
      totalWithdrawals: cohort.totalWithdrawals,
      avgDepositTimestamp: cohort.windowStart,
      depositorCount: 0, // Would be computed from deposit events
    };
  }

  /**
   * Calculate cohort return from share price delta
   *
   * Return = (endPrice - startPrice) / startPrice
   * Returns value as decimal (e.g., 0.05 = 5%)
   */
  calculateCohortReturn(cohort: Cohort, endPrice: bigint): number {
    if (!cohort.startSharePrice || cohort.startSharePrice === 0n) {
      return 0;
    }

    // Use bigint arithmetic for precision
    const start = cohort.startSharePrice;
    const end = endPrice;

    // Calculate: (end - start) * WAD / start
    const delta = end - start;
    const returnWad = (delta * WAD) / start;

    // Convert WAD to number
    return Number(returnWad) / Number(WAD);
  }

  /**
   * Calculate weighted return for a late depositor
   *
   * Paper §5.1: "Evaluation must reproduce temporal fairness"
   *
   * Late depositors receive proportionally less return based on
   * the fraction of the cohort window they participated in.
   *
   * @param cohortReturn - Full cohort return (as decimal, e.g., 0.05 = 5%)
   * @param cohortStart - Cohort window start
   * @param cohortEnd - Cohort window end
   * @param depositTimestamp - When the deposit occurred
   * @returns Weighted return (proportional to time in cohort)
   */
  calculateWeightedReturn(
    cohortReturn: number,
    cohortStart: Date,
    cohortEnd: Date,
    depositTimestamp: Date
  ): number {
    const totalMs = cohortEnd.getTime() - cohortStart.getTime();
    if (totalMs <= 0) return 0;

    // Weight = fraction of period after deposit
    const totalDays = totalMs / (24 * 60 * 60 * 1000);
    const msAfterDeposit = cohortEnd.getTime() - depositTimestamp.getTime();
    const daysAfterDeposit = msAfterDeposit / (24 * 60 * 60 * 1000);

    if (daysAfterDeposit <= 0) {
      return 0; // Deposited after cohort ended
    }

    if (msAfterDeposit >= totalMs) {
      return cohortReturn; // Full period depositor (deposited at or before cohort start)
    }

    // Weight = fraction of period after deposit
    const weight = daysAfterDeposit / totalDays;

    // Late depositor gets proportionally less return
    return cohortReturn * weight;
  }

  /**
   * Calculate weighted return using WAD arithmetic
   *
   * More precise version using bigint arithmetic.
   */
  calculateWeightedReturnWad(
    cohortReturnWad: bigint,
    cohortStartMs: bigint,
    cohortEndMs: bigint,
    depositTimestampMs: bigint
  ): bigint {
    const totalMs = cohortEndMs - cohortStartMs;
    if (totalMs <= 0n) return 0n;

    const msAfterDeposit = cohortEndMs - depositTimestampMs;

    if (msAfterDeposit <= 0n) {
      return 0n; // Deposited after cohort ended
    }

    if (msAfterDeposit >= totalMs) {
      return cohortReturnWad; // Full period depositor
    }

    // Weight = msAfterDeposit / totalMs (as WAD fraction)
    const weightWad = (msAfterDeposit * WAD) / totalMs;

    // Weighted return = cohortReturn * weight
    return (cohortReturnWad * weightWad) / WAD;
  }

  /**
   * Get user's cohort position
   */
  async getUserCohortPosition(
    userAddress: string,
    cohortId: number
  ): Promise<UserCohortPosition | null> {
    const cohort = await this.getCohort(cohortId);
    if (cohort === null) return null;

    const state = await this.vaultStateProvider.getCurrentState();
    const endPrice = cohort.endSharePrice ?? state.sharePrice;

    // In production, fetch from deposit events
    // For now, return a placeholder
    const shares = 0n;
    const depositAmount = 0n;
    const depositTimestamp = cohort.windowStart;

    const grossReturn = this.calculateCohortReturn(cohort, endPrice);
    const weightedReturn = this.calculateWeightedReturn(
      grossReturn,
      cohort.windowStart,
      cohort.windowEnd,
      depositTimestamp
    );

    // Calculate value: shares * price (converting WAD to USDC)
    const currentValue = (shares * endPrice) / WAD;
    const depositCost = depositAmount;
    const unrealizedProfit = currentValue - depositCost;

    return {
      userAddress,
      cohortId,
      shares,
      depositAmount,
      depositTimestamp,
      weightedReturn,
      currentValue,
      unrealizedProfit,
    };
  }

  /**
   * Calculate profit for a user based on their position
   *
   * Profit = shares * weightedReturn
   * Returns profit in base asset units (USDC 6 decimals)
   */
  calculateProfit(shares: bigint, weightedReturn: number): bigint {
    if (shares === 0n) return 0n;

    // Convert return to WAD
    const returnWad = BigInt(Math.round(weightedReturn * Number(WAD)));

    // Profit = shares * return (both in WAD terms for shares)
    // shares is in WAD (18 decimals)
    // return is in WAD (dimensionless)
    // result is in WAD * WAD = WAD^2, need to divide by WAD
    const profitWad = (shares * returnWad) / WAD;

    // Convert from WAD to USDC (divide by 1e12 since WAD=1e18, USDC=1e6)
    return profitWad / (10n ** 12n);
  }

  /**
   * Record a deposit event
   */
  recordDeposit(deposit: DepositRecord): void {
    const cohortId = this.computeCohortId(deposit.timestamp);
    let cohort = this.cohortCache.get(cohortId);

    if (cohort === undefined) {
      const { windowStart, windowEnd } = this.computeCohortWindow(cohortId);
      cohort = {
        id: cohortId,
        windowStart,
        windowEnd,
        startSharePrice: deposit.sharePrice,
        endSharePrice: undefined,
        totalDeposits: 0n,
        totalWithdrawals: 0n,
        closed: new Date() > windowEnd,
      };
      this.cohortCache.set(cohortId, cohort);
    }

    cohort.totalDeposits += deposit.amount;
  }

  /**
   * Record a withdrawal event
   */
  recordWithdrawal(withdrawal: WithdrawalRecord): void {
    const cohortId = this.computeCohortId(withdrawal.timestamp);
    let cohort = this.cohortCache.get(cohortId);

    if (cohort === undefined) {
      const { windowStart, windowEnd } = this.computeCohortWindow(cohortId);
      cohort = {
        id: cohortId,
        windowStart,
        windowEnd,
        startSharePrice: 0n, // Unknown at this point
        endSharePrice: undefined,
        totalDeposits: 0n,
        totalWithdrawals: 0n,
        closed: new Date() > windowEnd,
      };
      this.cohortCache.set(cohortId, cohort);
    }

    cohort.totalWithdrawals += withdrawal.amount;
  }

  /**
   * Close a cohort and record end price
   */
  closeCohort(cohortId: number, endSharePrice: bigint): Cohort | null {
    const cohort = this.cohortCache.get(cohortId);
    if (cohort === undefined) return null;

    cohort.endSharePrice = endSharePrice;
    cohort.closed = true;

    // Invalidate current cohort cache if this is the current cohort
    if (this.currentCohortCache?.id === cohortId) {
      this.currentCohortCache = null;
    }

    return cohort;
  }

  /**
   * Compute cohort ID from a date
   */
  computeCohortId(date: Date): number {
    return Math.floor((date.getTime() - COHORT_EPOCH_MS) / COHORT_WINDOW_MS);
  }

  /**
   * Compute cohort window from cohort ID
   */
  computeCohortWindow(cohortId: number): { windowStart: Date; windowEnd: Date } {
    const windowStartMs = COHORT_EPOCH_MS + cohortId * COHORT_WINDOW_MS;
    const windowEndMs = windowStartMs + COHORT_WINDOW_MS;

    return {
      windowStart: new Date(windowStartMs),
      windowEnd: new Date(windowEndMs),
    };
  }

  /**
   * Check if a cohort has expired
   */
  private isCohortExpired(cohort: Cohort): boolean {
    return new Date() > cohort.windowEnd;
  }
}

/**
 * Create a CohortTracker with default vault state provider
 */
export function createCohortTracker(vaultStateProvider: VaultStateProvider): CohortTracker {
  return new CohortTracker(vaultStateProvider);
}
