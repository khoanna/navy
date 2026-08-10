import { MarketSnapshot } from '../domain/snapshots.js';
import { reserveFloorRule, pauseRule } from './rules.js';

export interface AdmissionPolicy {
  minReserveBps: bigint;
  maxAdapterCapBps: bigint;
  maxDependencyGroupCapBps: bigint;
  maxWithdrawalLossBps: bigint;
  dependencyGroups: Array<{ id: string; adapters: string[]; capBps: bigint }>;
}

export interface AdmissionResult {
  admitted: boolean;
  reasons: string[];
  errors: string[];
}

export class AdmissionEngine {
  private policy: AdmissionPolicy;

  constructor(policy: AdmissionPolicy) {
    this.policy = policy;
  }

  evaluate(snapshot: MarketSnapshot): AdmissionResult {
    const reasons: string[] = [];
    const errors: string[] = [];
    let admitted = true;

    // Check pause
    const pauseResult = pauseRule(snapshot);
    if (!pauseResult.passed) {
      reasons.push(pauseResult.reason);
      admitted = false;
    }

    // Check reserve floor
    const reserveResult = reserveFloorRule(snapshot, this.policy.minReserveBps);
    reasons.push(reserveResult.reason);
    if (!reserveResult.passed) admitted = false;

    return { admitted, reasons, errors };
  }

  updatePolicy(policy: AdmissionPolicy): void {
    this.policy = policy;
  }
}
