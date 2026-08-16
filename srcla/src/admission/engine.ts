import { MarketSnapshot } from '../domain/snapshots.js';
import { reserveFloorRule, pauseRule } from './rules.js';
import type { VaultSnapshot } from '../collector/types.js';

export interface AdmissionPolicy {
  minReserveBps: bigint;
  maxAdapterCapBps: bigint;
  maxDependencyGroupCapBps: bigint;
  maxWithdrawalLossBps: bigint;
  dependencyGroups: Array<{ id: string; adapters: string[]; capBps: bigint }>;
  // Production vault policy fields
  maxTotalCapBps?: bigint;
  maxPerUserCapBps?: bigint;
  minRewardCacheAgeSeconds?: bigint;
  maxSequencerStalenessSeconds?: bigint;
  maxFeedStalenessSeconds?: bigint;
  expectedRewardPolicyDigest?: string;
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

  /**
   * Evaluate production vault snapshot against full policy
   * Validates reward state, route status, oracle quality, and caps
   */
  evaluateVault(vaultSnapshot: VaultSnapshot): AdmissionResult {
    const reasons: string[] = [];
    const errors: string[] = [];
    let admitted = true;

    // 1. Check reward state
    if (vaultSnapshot.rewardReady !== undefined && !vaultSnapshot.rewardReady) {
      errors.push('REWARD_NOT_READY');
      admitted = false;
    }

    // 2. Check reward cache freshness
    if (vaultSnapshot.rewardCacheTimestamp !== undefined && this.policy.minRewardCacheAgeSeconds !== undefined) {
      const now = BigInt(Math.floor(Date.now() / 1000));
      const cacheAge = now - vaultSnapshot.rewardCacheTimestamp;

      if (cacheAge > this.policy.minRewardCacheAgeSeconds) {
        errors.push(`REWARD_CACHE_STALE: age=${cacheAge}s, max=${this.policy.minRewardCacheAgeSeconds}s`);
        admitted = false;
      }
    }

    // 3. Check route status
    if (vaultSnapshot.routeStatus !== undefined) {
      if (vaultSnapshot.routeStatus === 'inactive') {
        errors.push('ROUTE_INACTIVE');
        admitted = false;
      } else if (vaultSnapshot.routeStatus === 'stale') {
        errors.push('ROUTE_STALE');
        admitted = false;
      }
    }

    // 4. Check sequencer staleness
    if (vaultSnapshot.sequencerRound !== undefined && this.policy.maxSequencerStalenessSeconds !== undefined) {
      const now = BigInt(Math.floor(Date.now() / 1000));
      // sequencerRound may be a timestamp or a sequential number
      const staleness = now - vaultSnapshot.sequencerRound;

      if (staleness > this.policy.maxSequencerStalenessSeconds) {
        errors.push(`SEQUENCER_STALE: staleness=${staleness}s, max=${this.policy.maxSequencerStalenessSeconds}s`);
        admitted = false;
      }
    }

    // 5. Check feed staleness
    if (vaultSnapshot.feedRounds !== undefined && this.policy.maxFeedStalenessSeconds !== undefined) {
      for (const feed of vaultSnapshot.feedRounds) {
        if (feed.staleness) {
          errors.push(`FEED_STALE: feed=${feed.feed}`);
          admitted = false;
          break; // One stale feed is enough to reject
        }

        // Check round freshness if round is timestamp-based
        const now = BigInt(Math.floor(Date.now() / 1000));
        const feedStaleness = now - feed.round;
        if (feedStaleness > this.policy.maxFeedStalenessSeconds) {
          errors.push(`FEED_STALE: feed=${feed.feed}, staleness=${feedStaleness}s`);
          admitted = false;
          break;
        }
      }
    }

    // 6. Check reward policy digest
    if (vaultSnapshot.rewardPolicyDigest !== undefined && this.policy.expectedRewardPolicyDigest !== undefined) {
      if (vaultSnapshot.rewardPolicyDigest !== this.policy.expectedRewardPolicyDigest) {
        errors.push(`REWARD_DIGEST_MISMATCH: expected=${this.policy.expectedRewardPolicyDigest}, actual=${vaultSnapshot.rewardPolicyDigest}`);
        admitted = false;
      }
    }

    // 7. Check absolute caps
    if (vaultSnapshot.absoluteCaps !== undefined) {
      // Total cap check - compare totalAssets against absoluteTotalCap
      if (vaultSnapshot.absoluteCaps.totalCap > 0n) {
        if (vaultSnapshot.totalAssets > vaultSnapshot.absoluteCaps.totalCap) {
          errors.push(`TOTAL_CAP_EXCEEDED: assets=${vaultSnapshot.totalAssets}, cap=${vaultSnapshot.absoluteCaps.totalCap}`);
          admitted = false;
        }
      }

      // Per-user cap check (simplified - would need per-user data)
      if (vaultSnapshot.absoluteCaps.perUserCap > 0n && this.policy.maxPerUserCapBps !== undefined) {
        // This is a vault-level check; per-user would be handled differently
        const perUserCapBps = (vaultSnapshot.absoluteCaps.perUserCap * 10000n) / vaultSnapshot.absoluteCaps.totalCap;
        if (perUserCapBps > this.policy.maxPerUserCapBps) {
          // Only warn, not reject - per-user cap is advisory at vault level
          reasons.push(`PER_USER_CAP_HIGH: ${perUserCapBps}bps > ${this.policy.maxPerUserCapBps}bps`);
        }
      }
    }

    // 8. Check dependency group caps
    if (vaultSnapshot.groups !== undefined) {
      for (const group of vaultSnapshot.groups) {
        if (group.cap > 0n && group.exposure > group.cap) {
          errors.push(`GROUP_CAP_EXCEEDED: group=${group.id}, exposure=${group.exposure}, cap=${group.cap}`);
          admitted = false;
        }
      }
    }

    // Build reasons string
    if (admitted) {
      reasons.push('VAULT_POLICY_OK');
      if (vaultSnapshot.rewardReady) reasons.push('REWARD_READY');
      if (vaultSnapshot.routeStatus === 'active') reasons.push('ROUTE_ACTIVE');
    }

    return { admitted, reasons, errors };
  }

  updatePolicy(policy: AdmissionPolicy): void {
    this.policy = policy;
  }
}
