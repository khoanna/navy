import { MarketSnapshot } from '../domain/snapshots.js';
import { bigintGt } from '../domain/units.js';

export interface RuleResult {
  passed: boolean;
  reason: string;
}

export function reserveFloorRule(
  snapshot: MarketSnapshot,
  minReserveBps: bigint
): RuleResult {
  const minReserve = (snapshot.totalAssetsBase * minReserveBps) / 10000n;

  if (bigintGt(snapshot.idleBase, minReserve)) {
    return { passed: true, reason: 'RESERVE_OK' };
  }

  return {
    passed: false,
    reason: `RESERVE_BELOW_MIN: idle=${snapshot.idleBase}, min=${minReserve}`,
  };
}

export function pauseRule(snapshot: MarketSnapshot): RuleResult {
  if (snapshot.paused) {
    return { passed: false, reason: 'MARKET_PAUSED' };
  }
  return { passed: true, reason: 'NOT_PAUSED' };
}
