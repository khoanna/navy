/**
 * §9.1's turnover cap must TRIM a move, not veto it.
 *
 * The veto had two consequences serious enough to invalidate the whole
 * evaluation, both observed on the real dataset before this was fixed:
 * a cold start could never resolve (100% cash proposes ~94% of NAV, is
 * refused, and the next origin finds the same 100% cash), and it broke
 * §11.1's equal envelope, because B0 and B4 never run through the cost gate
 * at all while every other policy wears the brake.
 */
import {
  clampToTurnoverBudget,
  remainingTurnoverBase,
} from '../../../src/policy/steps/cost.js';
import type { DecisionInput } from '../../../src/policy/types.js';

const params = {
  cooldownSeconds: 0,
  minTurnoverBps: 0,
  maxTurnoverBps: 5000,
  turnoverWindowSeconds: 86_400,
  reversalWindowSeconds: 86_400,
  reversalAllowanceBps: 10_000,
  slippageBps: 0,
  mevBps: 0,
  impactBps: 0,
  failureRateBps: 0,
  bufferBps: 0,
  gasPerAction: 0n,
  planGasOverhead: 0n,
  actionDispatchGas: 0n,
} as never;

const inputWith = (totalAssets: bigint, used: bigint): DecisionInput =>
  ({
    vault: { totalAssetsBase: totalAssets },
    lastAction: { turnoverWindowBase: used, timestampSeconds: null, recentMoves: [] },
  }) as unknown as DecisionInput;

describe('remainingTurnoverBase', () => {
  it('is the cap less what the window has already moved', () => {
    expect(remainingTurnoverBase(inputWith(1_000_000n, 0n), params)).toBe(500_000n);
    expect(remainingTurnoverBase(inputWith(1_000_000n, 200_000n), params)).toBe(300_000n);
  });

  it('is zero, never negative, once the window is full', () => {
    expect(remainingTurnoverBase(inputWith(1_000_000n, 500_000n), params)).toBe(0n);
    expect(remainingTurnoverBase(inputWith(1_000_000n, 900_000n), params)).toBe(0n);
  });
});

describe('clampToTurnoverBudget', () => {
  const current = new Map([['a', 0n], ['b', 0n]]);

  it('passes a move that already fits through untouched', () => {
    const target = new Map([['a', 100n], ['b', 100n]]);
    expect(clampToTurnoverBudget(current, target, 500n)).toEqual(target);
  });

  it('TRIMS an oversized move instead of refusing it — the cold-start case', () => {
    // 100% cash wanting to deploy 940k of a 1M vault against a 500k budget.
    const cur = new Map([['a', 0n], ['b', 0n]]);
    const target = new Map([['a', 640_000n], ['b', 300_000n]]);
    const out = clampToTurnoverBudget(cur, target, 500_000n);
    const moved = [...out.values()].reduce((s, v) => s + v, 0n);
    expect(moved).toBeGreaterThan(0n);
    expect(moved).toBeLessThanOrEqual(500_000n);
  });

  it('never trims to ABOVE the budget', () => {
    for (const budget of [1n, 7n, 999n, 123_456n, 499_999n]) {
      const target = new Map([['a', 640_000n], ['b', 300_000n]]);
      const out = clampToTurnoverBudget(current, target, budget);
      let notional = 0n;
      for (const [k, v] of out) {
        const d = v - (current.get(k) ?? 0n);
        notional += d < 0n ? -d : d;
      }
      expect(notional).toBeLessThanOrEqual(budget);
    }
  });

  it('preserves the direction and relative mix of the target', () => {
    const target = new Map([['a', 800_000n], ['b', 200_000n]]);
    const out = clampToTurnoverBudget(current, target, 500_000n);
    // 'a' was 4x 'b' in the target and must remain so after trimming.
    expect(out.get('a')!).toBe(400_000n);
    expect(out.get('b')!).toBe(100_000n);
  });

  it('trims a DIVEST in the same proportion, not only a deploy', () => {
    const cur = new Map([['a', 1_000_000n]]);
    const target = new Map([['a', 0n]]);
    const out = clampToTurnoverBudget(cur, target, 400_000n);
    expect(out.get('a')!).toBe(600_000n);
  });

  it('holds position when the window is exhausted', () => {
    const target = new Map([['a', 640_000n], ['b', 300_000n]]);
    expect(clampToTurnoverBudget(current, target, 0n)).toEqual(current);
  });

  it('is idempotent once the move fits', () => {
    const target = new Map([['a', 800_000n], ['b', 200_000n]]);
    const once = clampToTurnoverBudget(current, target, 500_000n);
    expect(clampToTurnoverBudget(current, once, 500_000n)).toEqual(once);
  });

  it('lets a cold start COMPLETE over successive windows', () => {
    // The property the veto destroyed: repeated application converges on the
    // target rather than standing still forever.
    let holdings = new Map([['a', 0n], ['b', 0n]]);
    const target = new Map([['a', 640_000n], ['b', 300_000n]]);
    for (let i = 0; i < 6; i++) {
      holdings = clampToTurnoverBudget(holdings, target, 500_000n);
    }
    expect(holdings.get('a')!).toBeGreaterThan(600_000n);
    expect(holdings.get('b')!).toBeGreaterThan(280_000n);
  });
});
