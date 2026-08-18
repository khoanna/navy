/**
 * Implements paper §5.1: Late Depositor Return Calculation.
 */

import { CohortTracker } from './cohort-tracker.js';

const WAD = 1_000_000_000_000_000_000n;

export interface DepositRecord {
  userAddress: string;
  amount: bigint;         // Base asset amount
  shares: bigint;         // Shares received
  sharePrice: bigint;     // Share price at deposit time
  timestamp: Date;
}

export interface LateDepositorResult {
  depositorAddress: string;
  cohortId: number;
  depositAmount: bigint;
  shares: bigint;
  depositTimestamp: Date;
  weightedReturn: number;  // Fractional return
  depositValue: bigint;    // Value at deposit (shares * price)
  currentValue: bigint;    // Current value  
  unrealizedProfit: bigint;
}

export class LateDepositorCalculator {
  private cohortTracker: CohortTracker;
  
  constructor(cohortTracker: CohortTracker) {
    this.cohortTracker = cohortTracker;
  }
  
  async calculateLateReturn(deposit: DepositRecord, currentSharePrice: bigint): Promise<LateDepositorResult> {
    const cohort = await this.cohortTracker.getCurrentCohort();
    const performance = await this.cohortTracker.getCohortPerformance(cohort.id);
    const grossReturn = performance ? performance.grossReturn : 0;
    
    const weightedReturn = this.cohortTracker.calculateWeightedReturn(grossReturn, cohort.windowStart, cohort.windowEnd, deposit.timestamp);
    
    const depositValue = (deposit.shares * deposit.sharePrice) / WAD;
    const currentValue = (deposit.shares * currentSharePrice) / WAD;
    const unrealizedProfit = currentValue - depositValue;
    
    return {
      depositorAddress: deposit.userAddress,
      cohortId: cohort.id,
      depositAmount: deposit.amount,
      shares: deposit.shares,
      depositTimestamp: deposit.timestamp,
      weightedReturn,
      depositValue,
      currentValue,
      unrealizedProfit,
    };
  }
  
  async calculateBatch(deposits: DepositRecord[], currentSharePrice: bigint): Promise<LateDepositorResult[]> {
    return Promise.all(deposits.map(d => this.calculateLateReturn(d, currentSharePrice)));
  }
  
  async calculateTotalProfit(userAddress: string, cohortIds: number[], _currentSharePrice: bigint): Promise<bigint> {
    let totalProfit = 0n;
    for (const cohortId of cohortIds) {
      const position = await this.cohortTracker.getUserCohortPosition(userAddress, cohortId);
      if (position && position.unrealizedProfit !== undefined) {
        totalProfit += position.unrealizedProfit;
      }
    }
    return totalProfit;
  }
}
