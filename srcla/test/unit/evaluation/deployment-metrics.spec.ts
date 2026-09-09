/**
 * §11.4 deployment metrics: the diagnostic that would have identified the
 * v0.6 defect (a policy that never deployed) from the run record alone.
 */
import {
  accumulateCensus,
  accumulateGateCensus,
  capitalAtWork,
  deploymentLatency,
} from '../../../src/evaluation/replay/deployment-metrics.js';
import type { LegVerdict } from '../../../src/policy/steps/hurdles.js';
import type { CostGateResult } from '../../../src/policy/types.js';

const deployBlocked: LegVerdict = {
  kind: 'deploy',
  marketId: 'a',
  fromMarketId: null,
  amountBase: 1n,
  clears: false,
  edgeWad: 0n,
  hurdleWad: 0n,
  costHurdleWad: 0n,
  significanceWad: 0n,
  reason: 'DEPLOY_BLOCKED: x',
};

describe('§11.4 deployment metrics', () => {
  describe('accumulateCensus', () => {
    it('counts a block by its reason code', () => {
      const c = accumulateCensus([deployBlocked]);
      expect(c['DEPLOY_BLOCKED']).toBe(1);
    });

    it('drops the prior param — signature is (verdicts, into = {})', () => {
      // R5: no third-argument "prior" list. `into` alone carries state across
      // calls, and each call takes exactly one origin's verdicts.
      const into: Record<string, number> = {};
      accumulateCensus([deployBlocked], into);
      accumulateCensus([deployBlocked], into);
      expect(into['DEPLOY_BLOCKED']).toBe(2);
    });

    it('does not count a cleared leg as a block', () => {
      const cleared: LegVerdict = { ...deployBlocked, clears: true, reason: 'DEPLOY_CLEARS' };
      const c = accumulateCensus([cleared]);
      expect(c['DEPLOY_CLEARS']).toBeUndefined();
      expect(Object.keys(c)).toHaveLength(0);
    });

    it('surfaces SIGNIFICANCE_UNAVAILABLE as its own category even on a clearing rotation', () => {
      // hurdles.ts#rotateClears appends the suffix regardless of `clears` —
      // it names a degeneracy in how the edge was priced (the residual panel
      // did not cover both venues), not a blocked leg.
      const rotate: LegVerdict = {
        kind: 'rotate',
        marketId: 'b',
        fromMarketId: 'a',
        amountBase: 1n,
        clears: true,
        edgeWad: 5n,
        hurdleWad: 3n,
        costHurdleWad: 3n,
        significanceWad: 0n,
        reason: 'ROTATE_CLEARS; SIGNIFICANCE_UNAVAILABLE',
      };
      const c = accumulateCensus([rotate]);
      expect(c['SIGNIFICANCE_UNAVAILABLE']).toBe(1);
      // A cleared leg still is not a block, suffix or not.
      expect(Object.keys(c)).toEqual(['SIGNIFICANCE_UNAVAILABLE']);
    });

    it('also counts SIGNIFICANCE_UNAVAILABLE on a blocked rotation, alongside the block code', () => {
      const rotate: LegVerdict = {
        kind: 'rotate',
        marketId: 'b',
        fromMarketId: 'a',
        amountBase: 1n,
        clears: false,
        edgeWad: 1n,
        hurdleWad: 3n,
        costHurdleWad: 3n,
        significanceWad: 0n,
        reason: 'ROTATE_BLOCKED: edge 1 <= hurdle 3; SIGNIFICANCE_UNAVAILABLE',
      };
      const c = accumulateCensus([rotate]);
      expect(c['ROTATE_BLOCKED']).toBe(1);
      expect(c['SIGNIFICANCE_UNAVAILABLE']).toBe(1);
    });

    it('an unpaired divest is unconditional and never counted as a block', () => {
      const divest: LegVerdict = {
        kind: 'divest',
        marketId: 'a',
        fromMarketId: null,
        amountBase: 1n,
        clears: true,
        edgeWad: 0n,
        hurdleWad: 0n,
        costHurdleWad: 0n,
        significanceWad: 0n,
        reason: 'DIVEST_TO_IDLE: no economic hurdle applies to reducing exposure',
      };
      expect(Object.keys(accumulateCensus([divest]))).toHaveLength(0);
    });
  });

  describe('accumulateGateCensus', () => {
    const baseGate: CostGateResult = {
      passed: false,
      reason: 'REVERSAL_ALLOWANCE: round-trip churn 5 over 604800s exceeds 3',
      legs: [],
      backedOff: false,
    };

    it('does not count a passing gate', () => {
      const c = accumulateGateCensus({ ...baseGate, passed: true, reason: 'HURDLES_CLEARED' });
      expect(Object.keys(c)).toHaveLength(0);
    });

    it('counts a brake fired on the full target under its own code', () => {
      const c = accumulateGateCensus(baseGate);
      expect(c['REVERSAL_ALLOWANCE']).toBe(1);
      expect(c['BACKOFF_THEN_REVERSAL_ALLOWANCE']).toBeUndefined();
    });

    it('distinguishes the SAME brake firing after a divest-only backoff', () => {
      // Ruling R2: decide() can back off to the risk-reducing (divest-only)
      // subset when the full sub-target is infeasible, then still have a
      // churn brake fire on that reduced vector. `reason` alone is
      // 'REVERSAL_ALLOWANCE: ...' either way — indistinguishable from the
      // full-target case above without `backedOff`.
      const c = accumulateGateCensus({ ...baseGate, backedOff: true });
      expect(c['BACKOFF_THEN_REVERSAL_ALLOWANCE']).toBe(1);
      expect(c['REVERSAL_ALLOWANCE']).toBeUndefined();
    });

    it('does not count HURDLES_CLEARED_DIVEST_ONLY — a successful backoff is not a block', () => {
      const c = accumulateGateCensus({
        passed: true,
        reason: 'HURDLES_CLEARED_DIVEST_ONLY',
        legs: [],
        backedOff: true,
      });
      expect(Object.keys(c)).toHaveLength(0);
    });

    it('merges into the same record accumulateCensus writes', () => {
      const into: Record<string, number> = {};
      accumulateCensus([deployBlocked], into);
      accumulateGateCensus({ ...baseGate, backedOff: true }, into);
      expect(into).toEqual({ DEPLOY_BLOCKED: 1, BACKOFF_THEN_REVERSAL_ALLOWANCE: 1 });
    });
  });

  describe('capitalAtWork', () => {
    it('capital at work is zero for an all-idle run and one for a fully deployed run', () => {
      expect(capitalAtWork([{ idleBase: 100n, deployedBase: 0n }])).toBe(0);
      expect(capitalAtWork([{ idleBase: 0n, deployedBase: 100n }])).toBe(1);
      expect(capitalAtWork([{ idleBase: 50n, deployedBase: 50n }])).toBeCloseTo(0.5);
    });

    it('is the time-average across a series, not just the last point', () => {
      const series = [
        { idleBase: 100n, deployedBase: 0n },
        { idleBase: 0n, deployedBase: 100n },
      ];
      expect(capitalAtWork(series)).toBeCloseTo(0.5);
    });

    it('returns 0 for an empty series, not NaN', () => {
      expect(capitalAtWork([])).toBe(0);
    });

    it('treats a zero-NAV origin as zero rather than dividing by zero', () => {
      expect(capitalAtWork([{ idleBase: 0n, deployedBase: 0n }])).toBe(0);
    });
  });

  describe('deploymentLatency', () => {
    it('is null when the run never deploys', () => {
      expect(deploymentLatency([{ deployedBase: 0n }, { deployedBase: 0n }])).toBeNull();
    });

    it('is the index of the first origin with a positive deployed balance', () => {
      expect(
        deploymentLatency([{ deployedBase: 0n }, { deployedBase: 0n }, { deployedBase: 5n }]),
      ).toBe(2);
    });

    it('is 0 when the very first origin is already deployed', () => {
      expect(deploymentLatency([{ deployedBase: 5n }])).toBe(0);
    });
  });
});
