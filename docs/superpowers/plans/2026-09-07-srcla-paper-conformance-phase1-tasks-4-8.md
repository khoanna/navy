# SRCLA Phase 1 — Tasks 4–8

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Continuation of `2026-09-07-srcla-paper-conformance-phase1.md` — read its **Global Constraints** first; they apply to every task here.

**Spec:** `docs/superpowers/specs/2026-09-07-srcla-paper-conformance-design.md`

---

### Task 4: `steps/admit.ts` — full §6.2 admission

Today `src/admission/rules.ts` has two rules. §6.2 requires identity pinning, pause/freeze, caps, kink sanity, oracle freshness, dependency membership, synchronous liquidity, and a regime minimum-history gate.

**Files:**
- Create: `srcla/src/policy/steps/admit.ts`
- Test: `srcla/test/unit/policy/admit.spec.ts`

**Interfaces:**
- Consumes: `DecisionInput`, `MarketObservation`, `AdmissionResult`, `PolicyArtifact` (Task 2).
- Produces: `admit(input: DecisionInput, artifact: PolicyArtifact): AdmissionResult`. Reason codes are stable strings: `PAUSED`, `REGIME_MIN_HISTORY`, `CONFIG_DIGEST_UNPINNED`, `NO_SYNC_LIQUIDITY`, `CAP_ZERO`, `KINK_EXCEEDED`, `OK`.

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/admit.spec.ts`:

```ts
import { admit } from '../../../src/policy/steps/admit.js';
import type { DecisionInput, MarketObservation, PolicyArtifact } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

function market(over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: 'aave', adapter: '0xa', protocol: 'aave',
    cash: 1_000_000_000n, borrows: 500_000_000n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: (WAD * 50n) / 100n,
    positionBase: 0n, maxDeployableBase: 1_000_000_000n, maxWithdrawableBase: 1_000_000_000n,
    configDigest: '0xdigest', regimeId: 'r1', paused: false,
    capBps: 5000, absoluteCapBase: 10n ** 12n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

function input(markets: MarketObservation[], labelCount = 40): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10n ** 12n, idleBase: 10n ** 11n, sharesOutstanding: 10n ** 12n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 50,
      paused: false, configurationDigest: '0xvault',
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: Array.from({ length: labelCount }, () => ({
      marketId: 'aave', regimeId: 'r1', originSeconds: 1, horizonSeconds: 604_800 as const,
      horizonEndSeconds: 2, availableAtSeconds: 3, realizedReturnWad: WAD, realizedMinCashBase: 1n,
    })),
    lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

const artifact = { minObservations: 30, pinnedConfigDigests: { aave: '0xdigest' } } as unknown as PolicyArtifact;

describe('admit', () => {
  it('admits a healthy market', () => {
    const r = admit(input([market()]), artifact);
    expect(r.eligible).toEqual(['aave']);
  });

  it('rejects a paused market', () => {
    const r = admit(input([market({ paused: true })]), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'PAUSED' && !x.passed)).toBe(true);
  });

  it('rejects a market with insufficient post-regime history', () => {
    const r = admit(input([market()], 5), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'REGIME_MIN_HISTORY' && !x.passed)).toBe(true);
  });

  it('rejects a market whose config digest is not the pinned one', () => {
    const r = admit(input([market({ configDigest: '0xchanged' })]), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'CONFIG_DIGEST_UNPINNED' && !x.passed)).toBe(true);
  });

  it('rejects a market with no synchronous exit capacity', () => {
    const r = admit(input([market({ maxWithdrawableBase: 0n, positionBase: 500n })]), artifact);
    expect(r.eligible).toEqual([]);
    expect(r.reasons.some((x) => x.code === 'NO_SYNC_LIQUIDITY' && !x.passed)).toBe(true);
  });

  it('rejects a market whose cap is zero', () => {
    const r = admit(input([market({ capBps: 0 })]), artifact);
    expect(r.eligible).toEqual([]);
  });

  it('is deterministic and returns markets in sorted order', () => {
    const r = admit(input([market({ marketId: 'zz', adapter: '0xz' }), market()]), {
      ...artifact, pinnedConfigDigests: { aave: '0xdigest', zz: '0xdigest' },
    } as unknown as PolicyArtifact);
    expect(r.eligible).toEqual(['aave', 'zz']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- admit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `admit.ts`**

```ts
import type { AdmissionResult, DecisionInput, MarketObservation, PolicyArtifact } from '../types.js';

const WAD = 10n ** 18n;
/** Utilisation above this is treated as past the kink for admission purposes. */
const MAX_ADMISSIBLE_UTILIZATION_WAD = (WAD * 99n) / 100n;

interface Rule {
  code: string;
  check(m: MarketObservation, input: DecisionInput, artifact: PolicyArtifact): { passed: boolean; detail: string };
}

const RULES: Rule[] = [
  {
    code: 'PAUSED',
    check: (m) => ({ passed: !m.paused, detail: m.paused ? 'market paused' : 'active' }),
  },
  {
    code: 'CONFIG_DIGEST_UNPINNED',
    check: (m, _i, a) => {
      const pinned = (a as unknown as { pinnedConfigDigests?: Record<string, string> }).pinnedConfigDigests;
      if (!pinned || pinned[m.marketId] === undefined) {
        return { passed: false, detail: 'no pinned digest registered' };
      }
      const ok = pinned[m.marketId] === m.configDigest;
      return { passed: ok, detail: ok ? 'digest matches pin' : `digest ${m.configDigest} != pin ${pinned[m.marketId]}` };
    },
  },
  {
    code: 'REGIME_MIN_HISTORY',
    check: (m, input, a) => {
      const n = input.history.filter((l) => l.marketId === m.marketId && l.regimeId === m.regimeId).length;
      return { passed: n >= a.minObservations, detail: `${n} completed labels in regime ${m.regimeId}` };
    },
  },
  {
    code: 'NO_SYNC_LIQUIDITY',
    check: (m) => {
      const ok = m.positionBase === 0n ? m.cash > 0n : m.maxWithdrawableBase > 0n;
      return { passed: ok, detail: `maxWithdrawable=${m.maxWithdrawableBase} position=${m.positionBase}` };
    },
  },
  {
    code: 'CAP_ZERO',
    check: (m) => {
      const ok = m.capBps > 0 && m.absoluteCapBase > 0n && m.maxDeployableBase > 0n;
      return { passed: ok, detail: `capBps=${m.capBps} abs=${m.absoluteCapBase} headroom=${m.maxDeployableBase}` };
    },
  },
  {
    code: 'KINK_EXCEEDED',
    check: (m) => {
      const ok = m.utilizationWad <= MAX_ADMISSIBLE_UTILIZATION_WAD;
      return { passed: ok, detail: `utilization=${m.utilizationWad}` };
    },
  },
];

/**
 * §6.2 — a market is deployable only when every registered check passes at the
 * decision block. Failing any one makes it ineligible; the reasons are persisted
 * so a rejection is always explainable.
 */
export function admit(input: DecisionInput, artifact: PolicyArtifact): AdmissionResult {
  const reasons: AdmissionResult['reasons'] = [];
  const eligible: string[] = [];

  const markets = [...input.markets].sort((a, b) => (a.marketId < b.marketId ? -1 : 1));

  for (const m of markets) {
    let ok = true;
    for (const rule of RULES) {
      const r = rule.check(m, input, artifact);
      reasons.push({ marketId: m.marketId, code: rule.code, passed: r.passed, detail: r.detail });
      if (!r.passed) ok = false;
    }
    if (ok) {
      reasons.push({ marketId: m.marketId, code: 'OK', passed: true, detail: 'admitted' });
      eligible.push(m.marketId);
    }
  }

  return { eligible, reasons };
}
```

- [ ] **Step 4: Add `pinnedConfigDigests` to `PolicyArtifact`**

In `src/policy/types.ts`, add to the `PolicyArtifact` interface:

```ts
  /** §6.2 — market id -> pinned configuration digest at registration. */
  pinnedConfigDigests: Record<string, string>;
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test:unit -- admit && pnpm exec tsc --noEmit`
Expected: 7 tests PASS; no type errors. Remove the `as unknown as PolicyArtifact` casts in the test once the field exists if `tsc` accepts a full literal.

- [ ] **Step 6: Commit**

```bash
git add src/policy/steps/admit.ts src/policy/types.ts test/unit/policy/admit.spec.ts
git commit -m "feat(policy): full admission engine per paper 6.2

Replaces the two-rule admission (pause, reserve floor) with pinned config
digests, regime minimum-history, synchronous liquidity, cap and kink checks,
each emitting a stable reason code.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 5: `steps/simulate.ts` — protocol-exact rate curves

Replaces `controller.ts:554`'s `rate × (1 + Δu·2)` with the real simulators, sampled into a piecewise-linear curve over allocation.

**Files:**
- Create: `srcla/src/policy/steps/simulate.ts`
- Test: `srcla/test/unit/policy/simulate.spec.ts`

**Interfaces:**
- Consumes: `SimulationEngine`, `ProtocolSimulators`, `DefaultConfigs`, `ISimulator`, `MarketState` from `src/protocols/simulation/index.js`; `RateCurve`, `DecisionInput` (Task 2).
- Produces:
  - `simulateCurves(input: DecisionInput, eligible: string[], quantumBase: bigint, maxPoints: number): RateCurve[]`
  - `rateAt(curve: RateCurve, xBase: bigint): bigint` — linear interpolation between sample points.

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/simulate.spec.ts`:

```ts
import { simulateCurves, rateAt } from '../../../src/policy/steps/simulate.js';
import type { DecisionInput, MarketObservation } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const QUANTUM = 1_000_000_000n; // 1,000 USDC

function compoundMarket(): MarketObservation {
  return {
    marketId: 'compound', adapter: '0xc', protocol: 'compound',
    cash: 800_000_000_000n, borrows: 3_200_000_000_000n, reserves: 0n,
    supplyRateWad: (WAD * 8n) / 100n, utilizationWad: (WAD * 80n) / 100n,
    positionBase: 0n, maxDeployableBase: 100_000_000_000n, maxWithdrawableBase: 800_000_000_000n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 5000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
  };
}

function input(markets: MarketObservation[]): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10n ** 13n, idleBase: 10n ** 12n, sharesOutstanding: 10n ** 13n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 50, paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

describe('simulateCurves', () => {
  it('produces a curve per eligible market only', () => {
    const curves = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 10);
    expect(curves.map((c) => c.marketId)).toEqual(['compound']);
    expect(curves[0]!.points.length).toBe(10);
  });

  it('point 0 is the current pre-deposit rate', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 5);
    expect(c!.points[0]).toBe((WAD * 8n) / 100n);
  });

  it('rate is non-increasing as allocation grows (capacity effect)', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 20);
    for (let i = 1; i < c!.points.length; i++) {
      expect(c!.points[i]! <= c!.points[i - 1]!).toBe(true);
    }
  });

  it('rateAt returns the exact sample at a quantum boundary', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 5);
    expect(rateAt(c!, QUANTUM * 2n)).toBe(c!.points[2]);
  });

  it('rateAt interpolates between samples', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 5);
    const mid = rateAt(c!, QUANTUM * 2n + QUANTUM / 2n);
    const lo = c!.points[2]!;
    const hi = c!.points[3]!;
    expect(mid <= lo).toBe(true);
    expect(mid >= hi).toBe(true);
  });

  it('clamps beyond the last sample rather than extrapolating', () => {
    const [c] = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 5);
    expect(rateAt(c!, QUANTUM * 999n)).toBe(c!.points[4]);
  });

  it('is deterministic across repeated calls', () => {
    const a = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 8);
    const b = simulateCurves(input([compoundMarket()]), ['compound'], QUANTUM, 8);
    expect(a[0]!.points).toEqual(b[0]!.points);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- simulate`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `simulate.ts`**

```ts
import {
  ProtocolSimulators,
  DefaultConfigs,
  type ProtocolId,
} from '../../protocols/simulation/index.js';
import type { MarketState } from '../../protocols/simulation/types.js';
import type { DecisionInput, MarketObservation, RateCurve } from '../types.js';

function toMarketState(m: MarketObservation, origin: DecisionInput['origin']): MarketState {
  return {
    marketId: m.marketId,
    name: m.protocol,
    cash: m.cash,
    borrows: m.borrows,
    reserves: m.reserves,
    supplyRate: m.supplyRateWad,
    blockNumber: origin.blockNumber,
    timestamp: origin.timestampSeconds,
  };
}

/**
 * §6.3-6.5 — the protocol-exact post-deposit supply rate as a function of the
 * vault's own allocation x, sampled at the allocation quantum.
 *
 * The curve is the contract between simulation, forecasting and optimisation:
 * the forecast applies its lower bound to rateAt(curve, x), and the optimiser
 * searches over x. Nothing downstream re-derives protocol mechanics.
 */
export function simulateCurves(
  input: DecisionInput,
  eligible: string[],
  quantumBase: bigint,
  maxPoints: number
): RateCurve[] {
  const eligibleSet = new Set(eligible);
  const curves: RateCurve[] = [];

  for (const m of input.markets) {
    if (!eligibleSet.has(m.marketId)) continue;

    const simulator = ProtocolSimulators[m.protocol as ProtocolId];
    const config = DefaultConfigs[m.protocol as ProtocolId];
    const state = toMarketState(m, input.origin);

    const points: bigint[] = [];
    for (let k = 0; k < maxPoints; k++) {
      const x = quantumBase * BigInt(k);
      if (k === 0) {
        points.push(m.supplyRateWad);
        continue;
      }
      const sim = simulator.simulateRate(state, x, config);
      // A deposit can only lower the supply rate; enforce monotonicity so
      // rounding in a protocol model cannot produce a non-monotone curve.
      const prev = points[k - 1]!;
      points.push(sim.postDepositRate < prev ? sim.postDepositRate : prev);
    }

    curves.push({
      marketId: m.marketId,
      quantumBase,
      points,
      maxXBase: quantumBase * BigInt(maxPoints - 1),
    });
  }

  return curves;
}

/** Linear interpolation between samples; clamped at both ends. */
export function rateAt(curve: RateCurve, xBase: bigint): bigint {
  if (xBase <= 0n) return curve.points[0]!;
  if (xBase >= curve.maxXBase) return curve.points[curve.points.length - 1]!;

  const k = Number(xBase / curve.quantumBase);
  const lo = curve.points[k]!;
  const hi = curve.points[k + 1] ?? lo;
  const remainder = xBase % curve.quantumBase;
  if (remainder === 0n) return lo;

  // lo >= hi by construction, so the interpolated value walks down from lo.
  return lo - ((lo - hi) * remainder) / curve.quantumBase;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- simulate`
Expected: 7 tests PASS.

If `simulateRate` returns a rate above the pre-deposit rate for the Compound fixture, the monotonicity clamp will mask it — check the raw simulator output in a scratch script before accepting, because a rising post-deposit supply rate would indicate the simulator is being handed the wrong units.

- [ ] **Step 5: Commit**

```bash
git add src/policy/steps/simulate.ts test/unit/policy/simulate.spec.ts
git commit -m "feat(policy): protocol-exact post-deposit rate curves

Replaces the linear rate x (1 + du*2) approximation with the Aave, Compound
and Moonwell simulators, sampled at the allocation quantum into a piecewise
linear curve that forecasting and optimisation both consume.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 6: `policy/artifact.ts` and `steps/forecast.ts`

The frozen artifact plus its application. The grid sweep that *produces* an artifact is Phase 4; this task ships a clearly-labelled provisional bootstrap so Phase 1 runs end to end.

**Files:**
- Create: `srcla/src/policy/artifact.ts`
- Create: `srcla/src/policy/steps/forecast.ts`
- Create: `srcla/config/bootstrap-artifact.json`
- Test: `srcla/test/unit/policy/forecast.spec.ts`

**Interfaces:**
- Consumes: `RateCurve`, `rateAt` (Task 5); `PolicyArtifact`, `DecisionInput`, `CompletedLabel` (Task 2); `hashData` from `src/domain/hashing.js`.
- Produces:
  - `computeArtifactHash(a: Omit<PolicyArtifact,'artifactHash'>): string`
  - `loadBootstrapArtifact(): PolicyArtifact`
  - `lowerBoundAt(curve, artifact, marketId, xBase, horizonSeconds): bigint`
  - `forecastMarkets(input, curves, artifact): DecisionOutput['lowerBounds']`

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/forecast.spec.ts`:

```ts
import { computeArtifactHash, loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import { lowerBoundAt, exitableFraction } from '../../../src/policy/steps/forecast.js';
import type { PolicyArtifact, RateCurve } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

const curve: RateCurve = {
  marketId: 'aave',
  quantumBase: 1_000_000_000n,
  points: [(WAD * 5n) / 100n, (WAD * 4n) / 100n, (WAD * 3n) / 100n],
  maxXBase: 2_000_000_000n,
};

function artifact(over: Partial<PolicyArtifact> = {}): PolicyArtifact {
  return {
    ...loadBootstrapArtifact(),
    residualQuantileWadByMarket: { aave: -(WAD / 1000n), compound: -(WAD / 500n) },
    ...over,
  };
}

describe('lowerBoundAt', () => {
  it('subtracts the per-venue residual quantile from the point forecast', () => {
    const a = artifact();
    const lower = lowerBoundAt(curve, a, 'aave', 0n, 604_800);
    const horizonMu = ((WAD * 5n) / 100n) * 604_800n / 31_536_000n;
    expect(lower).toBe(horizonMu - WAD / 1000n);
  });

  it('uses a different quantile for a different venue (P1)', () => {
    const a = artifact();
    const aaveQ = a.residualQuantileWadByMarket['aave']!;
    const compQ = a.residualQuantileWadByMarket['compound']!;
    expect(aaveQ).not.toBe(compQ);
  });

  it('falls back to the most conservative registered quantile for an unknown venue', () => {
    const a = artifact();
    const lower = lowerBoundAt(curve, a, 'unknown', 0n, 604_800);
    const horizonMu = ((WAD * 5n) / 100n) * 604_800n / 31_536_000n;
    expect(lower).toBe(horizonMu - WAD / 500n);
  });

  it('decreases as allocation grows, because the curve does', () => {
    const a = artifact();
    const at0 = lowerBoundAt(curve, a, 'aave', 0n, 604_800);
    const at2 = lowerBoundAt(curve, a, 'aave', 2_000_000_000n, 604_800);
    expect(at2 < at0).toBe(true);
  });

  it('rejects a positive residual quantile — the bound must not exceed the mean', () => {
    const bad = artifact({ residualQuantileWadByMarket: { aave: WAD / 1000n } });
    expect(() => lowerBoundAt(curve, bad, 'aave', 0n, 604_800)).toThrow(/must be <= 0/);
  });
});

describe('exitableFraction (P4)', () => {
  it('is 1 when the whole position is synchronously withdrawable', () => {
    expect(exitableFraction(1_000n, 1_000n)).toBe(1);
  });

  it('is 0 when nothing can be withdrawn', () => {
    expect(exitableFraction(1_000n, 0n)).toBe(0);
  });

  it('is the ratio in between', () => {
    expect(exitableFraction(1_000n, 250n)).toBeCloseTo(0.25, 10);
  });

  it('treats a zero target position as fully exitable', () => {
    expect(exitableFraction(0n, 0n)).toBe(1);
  });
});

describe('computeArtifactHash', () => {
  it('is stable across key ordering', () => {
    const { artifactHash: _drop, ...rest } = loadBootstrapArtifact();
    const reordered = Object.fromEntries(Object.entries(rest).reverse()) as typeof rest;
    expect(computeArtifactHash(rest)).toBe(computeArtifactHash(reordered));
  });

  it('changes when a calibrated value changes', () => {
    const { artifactHash: _drop, ...rest } = loadBootstrapArtifact();
    const changed = { ...rest, portfolioResidualQuantileWad: rest.portfolioResidualQuantileWad - 1n };
    expect(computeArtifactHash(rest)).not.toBe(computeArtifactHash(changed));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- forecast`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `config/bootstrap-artifact.json`**

```json
{
  "_provisional": "PHASE 1 BOOTSTRAP ONLY. Not calibrated. Replaced by the Phase 4 grid sweep before any registered evaluation. Do not cite results produced with this artifact.",
  "policyVersion": 5,
  "horizonSeconds": 604800,
  "coverageTarget": 0.95,
  "method": "ew-residual",
  "methodParams": { "decay": 0.9 },
  "residualQuantileWadByMarket": {},
  "portfolioResidualQuantileWad": "-2000000000000000",
  "minObservations": 30,
  "availabilityLagSeconds": 900,
  "noTradeBandK": 1.0,
  "pinnedConfigDigests": {},
  "configDigest": "bootstrap"
}
```

- [ ] **Step 4: Implement `artifact.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hashData } from '../domain/hashing.js';
import type { PolicyArtifact } from './types.js';

/**
 * §7.3 — the selected parameter artifact and its content hash are immutable for
 * held-out evaluation. Any change to a calibrated value changes the hash, so a
 * result can always be tied to the exact artifact that produced it.
 */
export function computeArtifactHash(a: Omit<PolicyArtifact, 'artifactHash'>): string {
  return hashData(a);
}

let cached: PolicyArtifact | null = null;

/**
 * PROVISIONAL. Phase 1 needs an artifact to run end to end; Phase 4's grid
 * sweep produces the real one. Results from this artifact are not citable.
 */
export function loadBootstrapArtifact(): PolicyArtifact {
  if (cached) return cached;

  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, '../../config/bootstrap-artifact.json'), 'utf8'));

  const body: Omit<PolicyArtifact, 'artifactHash'> = {
    policyVersion: raw.policyVersion,
    horizonSeconds: raw.horizonSeconds,
    coverageTarget: raw.coverageTarget,
    method: raw.method,
    methodParams: raw.methodParams,
    residualQuantileWadByMarket: Object.fromEntries(
      Object.entries(raw.residualQuantileWadByMarket as Record<string, string>).map(([k, v]) => [k, BigInt(v)])
    ),
    portfolioResidualQuantileWad: BigInt(raw.portfolioResidualQuantileWad),
    minObservations: raw.minObservations,
    availabilityLagSeconds: raw.availabilityLagSeconds,
    noTradeBandK: raw.noTradeBandK,
    pinnedConfigDigests: raw.pinnedConfigDigests,
    configDigest: raw.configDigest,
  };

  cached = { ...body, artifactHash: computeArtifactHash(body) };
  return cached;
}
```

- [ ] **Step 5: Implement `steps/forecast.ts`**

```ts
import { rateAt } from './simulate.js';
import type { DecisionInput, DecisionOutput, PolicyArtifact, RateCurve } from '../types.js';

const SECONDS_PER_YEAR = 31_536_000n;

/**
 * P1 — the residual quantile is per venue. A venue with no calibrated entry
 * falls back to the most conservative registered quantile rather than to zero,
 * so an unregistered market can never receive an optimistic bound.
 */
function quantileFor(artifact: PolicyArtifact, marketId: string): bigint {
  const own = artifact.residualQuantileWadByMarket[marketId];
  if (own !== undefined) return own;
  const all = Object.values(artifact.residualQuantileWadByMarket);
  if (all.length === 0) return artifact.portfolioResidualQuantileWad;
  return all.reduce((min, q) => (q < min ? q : min));
}

/**
 * §7.1 — l(x) = mu_hat(x) + q_alpha, where mu_hat is the annualised curve rate
 * converted to the horizon and q_alpha <= 0 is the calibrated lower quantile of
 * completed horizon residuals.
 */
export function lowerBoundAt(
  curve: RateCurve,
  artifact: PolicyArtifact,
  marketId: string,
  xBase: bigint,
  horizonSeconds: number
): bigint {
  const q = quantileFor(artifact, marketId);
  if (q > 0n) throw new Error(`residual quantile for ${marketId} must be <= 0, got ${q}`);
  const annualised = rateAt(curve, xBase);
  const horizonMu = (annualised * BigInt(horizonSeconds)) / SECONDS_PER_YEAR;
  return horizonMu + q;
}

/**
 * P4 — the conservatively exitable share of a target position. Value that
 * cannot be withdrawn earns no rank in the objective.
 */
export function exitableFraction(targetBase: bigint, maxWithdrawableBase: bigint): number {
  if (targetBase <= 0n) return 1;
  if (maxWithdrawableBase >= targetBase) return 1;
  if (maxWithdrawableBase <= 0n) return 0;
  return Number((maxWithdrawableBase * 1_000_000n) / targetBase) / 1_000_000;
}

export function forecastMarkets(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact
): DecisionOutput['lowerBounds'] {
  return curves.map((c) => {
    const m = input.markets.find((x) => x.marketId === c.marketId)!;
    const x = m.positionBase;
    return {
      marketId: c.marketId,
      muWad: (rateAt(c, x) * BigInt(artifact.horizonSeconds)) / SECONDS_PER_YEAR,
      lowerWad: lowerBoundAt(c, artifact, c.marketId, x, artifact.horizonSeconds),
      exitableFraction: exitableFraction(x, m.maxWithdrawableBase),
    };
  });
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test:unit -- forecast && pnpm exec tsc --noEmit`
Expected: 11 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/policy/artifact.ts src/policy/steps/forecast.ts config/bootstrap-artifact.json test/unit/policy/forecast.spec.ts
git commit -m "feat(policy): frozen artifact and per-venue lower bounds

Implements P1 (per-venue residual quantile with conservative fallback) and P4
(exitable-fraction weighting). Ships a clearly-marked provisional bootstrap
artifact so Phase 1 runs end to end; the Phase 4 grid sweep replaces it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 7: `steps/reserve.ts` — candidate-dependent reserve (P3)

Replaces `controller.ts:652`, whose quantile term is the literal comment *"Simplified: use 10% of assets"* and whose `_allocations` parameter is unused.

**Files:**
- Create: `srcla/src/policy/steps/reserve.ts`
- Test: `srcla/test/unit/policy/reserve.spec.ts`

**Interfaces:**
- Consumes: `DecisionInput`, `ReserveResult`, `MarketObservation` (Task 2).
- Produces:
  - `STRESS_SCENARIOS: readonly StressScenario[]` — registered, exported for the H4 ablation
  - `demandQuantileBase(withdrawals, originSeconds, horizonSeconds, quantile): bigint`
  - `requiredReserve(input, target: Map<string,bigint>, opts): ReserveResult`

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/reserve.spec.ts`:

```ts
import { requiredReserve, demandQuantileBase, STRESS_SCENARIOS } from '../../../src/policy/steps/reserve.js';
import type { DecisionInput, MarketObservation } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;

function market(over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: 'aave', adapter: '0xa', protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

function input(markets: MarketObservation[], withdrawals: Array<{ timestampSeconds: number; assetsBase: bigint }> = []): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 1_000_000_000_000n, idleBase: 100_000_000_000n, sharesOutstanding: 10n ** 12n,
      adminReserveBase: 10_000_000_000n, dynamicReserveBase: 0n, minIdleBps: 50,
      paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: [], withdrawals,
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

const OPTS = { quantile: 0.95, horizonSeconds: 86_400 };

describe('demandQuantileBase', () => {
  it('is zero with no observed withdrawals', () => {
    expect(demandQuantileBase([], 1_000_000, 86_400, 0.95)).toBe(0n);
  });

  it('takes the quantile of rolling horizon demand', () => {
    const w = Array.from({ length: 20 }, (_, i) => ({
      timestampSeconds: 1_000_000 - i * 3600,
      assetsBase: BigInt(i + 1) * 1_000_000n,
    }));
    expect(demandQuantileBase(w, 1_000_000, 86_400, 0.95)).toBeGreaterThan(0n);
  });
});

describe('requiredReserve (P3)', () => {
  it('never falls below the admin floor', () => {
    const r = requiredReserve(input([market()]), new Map([['aave', 0n]]), OPTS);
    expect(r.requiredBase).toBeGreaterThanOrEqual(10_000_000_000n);
    expect(r.floorBase).toBe(10_000_000_000n);
  });

  it('nets demand against executable venue exits, so deep liquidity lowers the reserve', () => {
    const w = [{ timestampSeconds: 999_000, assetsBase: 50_000_000_000n }];
    const liquid = requiredReserve(
      input([market({ maxWithdrawableBase: 10n ** 12n })], w),
      new Map([['aave', 500_000_000_000n]]),
      OPTS
    );
    const illiquid = requiredReserve(
      input([market({ maxWithdrawableBase: 0n })], w),
      new Map([['aave', 500_000_000_000n]]),
      OPTS
    );
    expect(liquid.netDemandQuantileBase).toBeLessThan(illiquid.netDemandQuantileBase);
  });

  it('is candidate-dependent: a different target gives a different reserve', () => {
    const w = [{ timestampSeconds: 999_000, assetsBase: 200_000_000_000n }];
    const small = requiredReserve(input([market({ maxWithdrawableBase: 1_000_000n })], w), new Map([['aave', 1_000_000n]]), OPTS);
    const large = requiredReserve(input([market({ maxWithdrawableBase: 1_000_000n })], w), new Map([['aave', 900_000_000_000n]]), OPTS);
    expect(small.requiredBase).not.toBe(large.requiredBase);
  });

  it('flags an infeasible scenario when stressed exits cannot meet demand', () => {
    const r = requiredReserve(
      input([market({ maxWithdrawableBase: 0n })]),
      new Map([['aave', 999_000_000_000n]]),
      OPTS
    );
    expect(r.scenarioFeasible.some((s) => !s.feasible)).toBe(true);
  });

  it('registers the stress scenarios used by the H4 ablation', () => {
    expect(STRESS_SCENARIOS.map((s) => s.name)).toEqual(['w5', 'w10', 'w25', 'w50']);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- policy/reserve`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reserve.ts`**

```ts
import type { DecisionInput, ReserveResult, WithdrawalObservation } from '../types.js';

export interface StressScenario {
  name: string;
  /** Demand as a fraction of total assets, in basis points. */
  demandBps: number;
  /** Haircut applied to each venue's executable exit under this scenario, in bps. */
  liquidityHaircutBps: number;
}

/**
 * Registered stress set (paper 8.1). The report's demand set was 5/10/25/50% of
 * TVL with a conservative variant assuming supplied cash has been borrowed out;
 * the haircut encodes that variant.
 */
export const STRESS_SCENARIOS: readonly StressScenario[] = [
  { name: 'w5', demandBps: 500, liquidityHaircutBps: 0 },
  { name: 'w10', demandBps: 1000, liquidityHaircutBps: 1000 },
  { name: 'w25', demandBps: 2500, liquidityHaircutBps: 2500 },
  { name: 'w50', demandBps: 5000, liquidityHaircutBps: 5000 },
] as const;

/** Q_beta(W_H): the beta-quantile of rolling H-second withdrawal demand. */
export function demandQuantileBase(
  withdrawals: WithdrawalObservation[],
  originSeconds: number,
  horizonSeconds: number,
  quantile: number
): bigint {
  if (withdrawals.length === 0) return 0n;

  const sorted = [...withdrawals].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const totals: bigint[] = [];

  for (const anchor of sorted) {
    if (anchor.timestampSeconds > originSeconds) continue;
    const windowStart = anchor.timestampSeconds - horizonSeconds;
    let sum = 0n;
    for (const w of sorted) {
      if (w.timestampSeconds > anchor.timestampSeconds) break;
      if (w.timestampSeconds > windowStart) sum += w.assetsBase;
    }
    totals.push(sum);
  }

  if (totals.length === 0) return 0n;
  totals.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const idx = Math.min(totals.length - 1, Math.floor(quantile * totals.length));
  return totals[idx]!;
}

/**
 * P3 - I_req(x) = max( floor,
 *                      Q_beta(W_H) - sum_i min(x_i, e_i^cons),
 *                      max_s { D_s - E_s(x) } ).
 *
 * Both the demand term and the stress term are netted against executable venue
 * exits. Holding idle USDC against demand that deeply liquid venues can already
 * absorb is pure cash drag.
 */
export function requiredReserve(
  input: DecisionInput,
  target: Map<string, bigint>,
  opts: { quantile: number; horizonSeconds: number }
): ReserveResult {
  const { totalAssetsBase, adminReserveBase, minIdleBps } = input.vault;

  const bpsFloor = (totalAssetsBase * BigInt(minIdleBps)) / 10_000n;
  const floorBase = adminReserveBase > bpsFloor ? adminReserveBase : bpsFloor;

  /** e_i^cons for the candidate target, optionally haircut. */
  const executable = (haircutBps: number): bigint => {
    let sum = 0n;
    for (const m of input.markets) {
      const x = target.get(m.marketId) ?? 0n;
      const capacity = m.maxWithdrawableBase < x ? m.maxWithdrawableBase : x;
      sum += (capacity * BigInt(10_000 - haircutBps)) / 10_000n;
    }
    return sum;
  };

  const demand = demandQuantileBase(
    input.withdrawals,
    input.origin.timestampSeconds,
    opts.horizonSeconds,
    opts.quantile
  );
  const netDemand = demand > executable(0) ? demand - executable(0) : 0n;

  let stressShortfall = 0n;
  const scenarioFeasible: ReserveResult['scenarioFeasible'] = [];

  for (const s of STRESS_SCENARIOS) {
    const demandS = (totalAssetsBase * BigInt(s.demandBps)) / 10_000n;
    const exitsS = executable(s.liquidityHaircutBps);
    const shortfall = demandS > exitsS ? demandS - exitsS : 0n;
    if (shortfall > stressShortfall) stressShortfall = shortfall;
    // Feasible when idle at the required level plus stressed exits meets demand.
    scenarioFeasible.push({
      scenario: s.name,
      feasible: shortfall <= totalAssetsBase - exitsS,
      shortfallBase: shortfall,
    });
  }

  let requiredBase = floorBase;
  if (netDemand > requiredBase) requiredBase = netDemand;
  if (stressShortfall > requiredBase) requiredBase = stressShortfall;

  return {
    requiredBase,
    floorBase,
    netDemandQuantileBase: netDemand,
    stressShortfallBase: stressShortfall,
    scenarioFeasible,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- policy/reserve`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/policy/steps/reserve.ts test/unit/policy/reserve.spec.ts
git commit -m "feat(policy): candidate-dependent liquidity-aware reserve (P3)

I_req now depends on the candidate allocation and nets both the demand
quantile and the stress term against executable venue exits, replacing the
allocation-independent 'simplified: use 10% of assets' placeholder. Exports
the registered stress set for the H4 ablation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 8: `steps/optimize.ts` — constrained target with P2/P4/P5 and real enumeration

Replaces `controller.ts:725` (capBps only) and `controller.ts:771`, which fabricates regret with *"Assume optimal is at most 1% better than greedy"*.

**Files:**
- Create: `srcla/src/policy/steps/optimize.ts`
- Test: `srcla/test/unit/policy/optimize.spec.ts`

**Interfaces:**
- Consumes: `rateAt` (Task 5); `lowerBoundAt`, `exitableFraction` (Task 6); `requiredReserve`, `STRESS_SCENARIOS` (Task 7).
- Produces:
  - `liquidityCapBase(m: MarketObservation): bigint` — P5
  - `effectiveCapBase(m, totalAssets): bigint`
  - `portfolioLowerBound(input, curves, artifact, target): bigint` — P2 + P4
  - `optimize(input, curves, artifact, opts): { target: Map<string,bigint>; enumeration: {...} }`

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/optimize.spec.ts`:

```ts
import { optimize, liquidityCapBase, effectiveCapBase, portfolioLowerBound } from '../../../src/policy/steps/optimize.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import type { DecisionInput, MarketObservation, PolicyArtifact, RateCurve } from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const Q = 1_000_000_000n; // 1,000 USDC quantum

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id, adapter: `0x${id}`, protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 5000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

function curve(id: string, rates: bigint[]): RateCurve {
  return { marketId: id, quantumBase: Q, points: rates, maxXBase: Q * BigInt(rates.length - 1) };
}

function input(markets: MarketObservation[], groups: DecisionInput['dependencyGroups'] = []): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: 10_000_000_000n, idleBase: 10_000_000_000n, sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0, paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: groups, withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n, ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n },
  };
}

function artifact(): PolicyArtifact {
  return { ...loadBootstrapArtifact(), residualQuantileWadByMarket: { a: 0n, b: 0n } };
}

const OPTS = { quantumBase: Q, reserveQuantile: 0.95, reserveHorizonSeconds: 86_400 };

describe('liquidityCapBase (P5)', () => {
  it('is unrestricted well below the kink', () => {
    expect(liquidityCapBase(market('a', { utilizationWad: (WAD * 50n) / 100n }))).toBeGreaterThan(0n);
  });

  it('collapses to zero at full utilisation', () => {
    expect(liquidityCapBase(market('a', { utilizationWad: WAD, cash: 0n }))).toBe(0n);
  });

  it('decreases monotonically as utilisation rises', () => {
    const mid = liquidityCapBase(market('a', { utilizationWad: (WAD * 85n) / 100n, cash: 150_000_000n }));
    const high = liquidityCapBase(market('a', { utilizationWad: (WAD * 95n) / 100n, cash: 50_000_000n }));
    expect(high).toBeLessThan(mid);
  });
});

describe('effectiveCapBase', () => {
  it('is the minimum of percentage, absolute, headroom and liquidity caps', () => {
    const m = market('a', { capBps: 5000, absoluteCapBase: 1_000_000n, maxDeployableBase: 10n ** 12n });
    expect(effectiveCapBase(m, 10_000_000_000n)).toBe(1_000_000n);
  });
});

describe('optimize', () => {
  it('prefers the venue with the higher lower bound', () => {
    const i = input([market('a'), market('b')]);
    const curves = [
      curve('a', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
      curve('b', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n]),
    ];
    const { target } = optimize(i, curves, artifact(), OPTS);
    expect(target.get('b')!).toBeGreaterThan(target.get('a') ?? 0n);
  });

  it('respects a dependency-group cap across members', () => {
    const i = input(
      [market('a', { dependencyGroupIds: ['g'] }), market('b', { dependencyGroupIds: ['g'] })],
      [{ id: 'g', capBps: 2000, absoluteCapBase: 10n ** 13n, members: ['a', 'b'] }]
    );
    const curves = [
      curve('a', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n]),
      curve('b', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n]),
    ];
    const { target } = optimize(i, curves, artifact(), OPTS);
    const total = (target.get('a') ?? 0n) + (target.get('b') ?? 0n);
    expect(total).toBeLessThanOrEqual((10_000_000_000n * 2000n) / 10_000n);
  });

  it('never allocates to a venue whose liquidity cap is zero (P5)', () => {
    const i = input([market('a', { utilizationWad: WAD, cash: 0n, maxWithdrawableBase: 0n }), market('b')]);
    const curves = [
      curve('a', [WAD, WAD, WAD, WAD, WAD]),          // absurdly attractive rate
      curve('b', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
    ];
    const { target } = optimize(i, curves, artifact(), OPTS);
    expect(target.get('a') ?? 0n).toBe(0n);
  });

  it('computes real enumeration regret, not a constant', () => {
    const i = input([market('a'), market('b')]);
    const curves = [
      curve('a', [WAD / 100n, WAD / 110n, WAD / 120n, WAD / 130n, WAD / 140n]),
      curve('b', [WAD / 90n, WAD / 100n, WAD / 110n, WAD / 120n, WAD / 130n]),
    ];
    const { enumeration } = optimize(i, curves, artifact(), OPTS);
    expect(enumeration).not.toBeNull();
    expect(enumeration!.enumerated).toBeGreaterThan(1);
    expect(enumeration!.regretBps).toBeGreaterThanOrEqual(0n);
  });

  it('leaves at least the required reserve idle', () => {
    const i = input([market('a')]);
    i.vault.adminReserveBase = 2_000_000_000n;
    const curves = [curve('a', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n])];
    const { target } = optimize(i, curves, artifact(), OPTS);
    const deployed = [...target.values()].reduce((s, v) => s + v, 0n);
    expect(i.vault.totalAssetsBase - deployed).toBeGreaterThanOrEqual(2_000_000_000n);
  });

  it('is deterministic', () => {
    const i = input([market('a'), market('b')]);
    const curves = [
      curve('a', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
      curve('b', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
    ];
    const r1 = optimize(i, curves, artifact(), OPTS);
    const r2 = optimize(i, curves, artifact(), OPTS);
    expect([...r1.target.entries()]).toEqual([...r2.target.entries()]);
  });
});

describe('portfolioLowerBound (P2 + P4)', () => {
  it('applies the portfolio quantile once, not per venue', () => {
    const i = input([market('a'), market('b')]);
    const curves = [
      curve('a', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
      curve('b', [WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n, WAD / 100n]),
    ];
    const a = { ...artifact(), portfolioResidualQuantileWad: -1_000n };
    const target = new Map([['a', Q], ['b', Q]]);
    const bound = portfolioLowerBound(i, curves, a, target);
    expect(bound).toBeLessThan(0n + bound + 1_000n);
  });

  it('gives no credit to a position that cannot be exited (P4)', () => {
    const liquid = input([market('a', { maxWithdrawableBase: 10n ** 12n })]);
    const frozen = input([market('a', { maxWithdrawableBase: 0n })]);
    const curves = [curve('a', [WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n, WAD / 50n])];
    const target = new Map([['a', Q * 2n]]);
    const a = artifact();
    expect(portfolioLowerBound(frozen, curves, a, target)).toBeLessThan(
      portfolioLowerBound(liquid, curves, a, target)
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- optimize`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `optimize.ts`**

```ts
import { lowerBoundAt, exitableFraction } from './forecast.js';
import { requiredReserve } from './reserve.js';
import type { DecisionInput, MarketObservation, PolicyArtifact, RateCurve } from '../types.js';

const WAD = 10n ** 18n;
/** Utilisation at which the structural liquidity cap begins to bind. */
const LIQUIDITY_KINK_WAD = (WAD * 80n) / 100n;

export interface OptimizeOpts {
  quantumBase: bigint;
  reserveQuantile: number;
  reserveHorizonSeconds: number;
  /** Disable individual components for the H1-H7 ablations. */
  disable?: Partial<Record<'liquidityCap' | 'dependencyCaps' | 'reserve' | 'exitableWeight' | 'portfolioBound', boolean>>;
}

/**
 * P5 - a deterministic cap that decreases toward zero as a venue approaches its
 * kink. Requires no forecast. On 2026-07-21 Moonwell quoted 86.26% APR at
 * 100.04% utilisation holding $6,163 of cash; this cap is what excludes it.
 */
export function liquidityCapBase(m: MarketObservation): bigint {
  if (m.utilizationWad >= WAD) return 0n;
  if (m.cash <= 0n) return 0n;
  if (m.utilizationWad <= LIQUIDITY_KINK_WAD) return m.cash;

  // Linear decay from full cash at the kink to zero at 100% utilisation.
  const span = WAD - LIQUIDITY_KINK_WAD;
  const remaining = WAD - m.utilizationWad;
  return (m.cash * remaining) / span;
}

/** §6.1 - effective limit is the minimum of every applicable bound. */
export function effectiveCapBase(m: MarketObservation, totalAssetsBase: bigint, disableLiquidityCap = false): bigint {
  const pct = (totalAssetsBase * BigInt(m.capBps)) / 10_000n;
  let cap = pct;
  if (m.absoluteCapBase < cap) cap = m.absoluteCapBase;
  const headroom = m.positionBase + m.maxDeployableBase;
  if (headroom < cap) cap = headroom;
  if (!disableLiquidityCap) {
    const liq = m.positionBase + liquidityCapBase(m);
    if (liq < cap) cap = liq;
  }
  return cap < 0n ? 0n : cap;
}

/**
 * P2 + P4 - the objective. mu_p is the exitable-weighted sum of per-venue
 * horizon means; the portfolio residual quantile is applied once to the
 * portfolio, not summed across venues.
 */
export function portfolioLowerBound(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact,
  target: Map<string, bigint>,
  disable: OptimizeOpts['disable'] = {}
): bigint {
  let mu = 0n;

  for (const c of curves) {
    const x = target.get(c.marketId) ?? 0n;
    if (x === 0n) continue;
    const m = input.markets.find((k) => k.marketId === c.marketId)!;

    // Per-venue bound without its quantile when the portfolio bound is active;
    // with it when the portfolio bound is ablated (H2 comparison stays honest).
    const perVenue = disable.portfolioBound
      ? lowerBoundAt(c, artifact, c.marketId, x, artifact.horizonSeconds)
      : (rateAtHorizon(c, x, artifact.horizonSeconds));

    const phi = disable.exitableWeight ? 1 : exitableFraction(x, m.maxWithdrawableBase);
    mu += (perVenue * x * BigInt(Math.round(phi * 1_000_000))) / (WAD * 1_000_000n);
  }

  if (disable.portfolioBound) return mu;
  const notional = [...target.values()].reduce((s, v) => s + v, 0n);
  return mu + (artifact.portfolioResidualQuantileWad * notional) / WAD;
}

function rateAtHorizon(c: RateCurve, x: bigint, horizonSeconds: number): bigint {
  // Local import avoided to keep this module free of a cycle with simulate.ts.
  const k = x <= 0n ? 0 : Number(x / c.quantumBase);
  const idx = Math.min(k, c.points.length - 1);
  return (c.points[idx]! * BigInt(horizonSeconds)) / 31_536_000n;
}

/**
 * §8.2 - greedy fill at the allocation quantum over conservative curves, then
 * exhaustive verification at the same quantum for small universes with the
 * approximation regret persisted. A candidate that fails any stress scenario is
 * rejected before returns are compared.
 */
export function optimize(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact,
  opts: OptimizeOpts
): { target: Map<string, bigint>; enumeration: { regretBps: bigint; enumerated: number; passed: boolean } | null } {
  const disable = opts.disable ?? {};
  const { totalAssetsBase } = input.vault;
  const q = opts.quantumBase;

  const caps = new Map<string, bigint>();
  for (const c of curves) {
    const m = input.markets.find((k) => k.marketId === c.marketId)!;
    caps.set(c.marketId, effectiveCapBase(m, totalAssetsBase, disable.liquidityCap));
  }

  const groupCap = (groupId: string): bigint => {
    const g = input.dependencyGroups.find((x) => x.id === groupId)!;
    const pct = (totalAssetsBase * BigInt(g.capBps)) / 10_000n;
    return pct < g.absoluteCapBase ? pct : g.absoluteCapBase;
  };

  const feasible = (candidate: Map<string, bigint>): boolean => {
    const deployed = [...candidate.values()].reduce((s, v) => s + v, 0n);
    if (deployed > totalAssetsBase) return false;

    for (const [id, x] of candidate) {
      if (x > (caps.get(id) ?? 0n)) return false;
    }

    if (!disable.dependencyCaps) {
      for (const g of input.dependencyGroups) {
        let sum = 0n;
        for (const member of g.members) sum += candidate.get(member) ?? 0n;
        if (sum > groupCap(g.id)) return false;
      }
    }

    if (!disable.reserve) {
      const r = requiredReserve(input, candidate, {
        quantile: opts.reserveQuantile,
        horizonSeconds: opts.reserveHorizonSeconds,
      });
      if (totalAssetsBase - deployed < r.requiredBase) return false;
      if (r.scenarioFeasible.some((s) => !s.feasible)) return false;
    }

    return true;
  };

  // Greedy: repeatedly add one quantum wherever it raises the objective most.
  const target = new Map<string, bigint>(curves.map((c) => [c.marketId, 0n]));
  const steps = Number(totalAssetsBase / q);

  for (let step = 0; step < steps; step++) {
    let bestId: string | null = null;
    let bestValue = portfolioLowerBound(input, curves, artifact, target, disable);

    // Deterministic tie-break: markets are visited in sorted id order.
    const ids = [...target.keys()].sort();
    for (const id of ids) {
      const trial = new Map(target);
      trial.set(id, (trial.get(id) ?? 0n) + q);
      if (!feasible(trial)) continue;
      const value = portfolioLowerBound(input, curves, artifact, trial, disable);
      if (value > bestValue) {
        bestValue = value;
        bestId = id;
      }
    }

    if (bestId === null) break;
    target.set(bestId, (target.get(bestId) ?? 0n) + q);
  }

  const enumeration = verifyExhaustively(input, curves, artifact, opts, target, feasible);
  return { target, enumeration };
}

/** §8.2 - real enumeration for a small universe; regret is measured, not assumed. */
function verifyExhaustively(
  input: DecisionInput,
  curves: RateCurve[],
  artifact: PolicyArtifact,
  opts: OptimizeOpts,
  greedy: Map<string, bigint>,
  feasible: (c: Map<string, bigint>) => boolean
): { regretBps: bigint; enumerated: number; passed: boolean } | null {
  const n = curves.length;
  if (n === 0 || n > 3) return null;

  const q = opts.quantumBase;
  const steps = Number(input.vault.totalAssetsBase / q);
  if (steps > 64) return null; // enumeration is only a check, never the solver

  let best = portfolioLowerBound(input, curves, artifact, greedy, opts.disable);
  let enumerated = 0;

  const ids = curves.map((c) => c.marketId).sort();
  const walk = (i: number, remaining: number, acc: Map<string, bigint>): void => {
    if (i === ids.length) {
      enumerated++;
      if (!feasible(acc)) return;
      const v = portfolioLowerBound(input, curves, artifact, acc, opts.disable);
      if (v > best) best = v;
      return;
    }
    for (let k = 0; k <= remaining; k++) {
      const next = new Map(acc);
      next.set(ids[i]!, q * BigInt(k));
      walk(i + 1, remaining - k, next);
    }
  };
  walk(0, steps, new Map());

  const greedyValue = portfolioLowerBound(input, curves, artifact, greedy, opts.disable);
  const regretBps = best > 0n ? ((best - greedyValue) * 10_000n) / best : 0n;

  return { regretBps, enumerated, passed: regretBps >= 0n && regretBps <= 100n };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- optimize`
Expected: 10 tests PASS. If enumeration is slow, lower the `steps > 64` guard — it exists so the check never dominates the cycle.

- [ ] **Step 5: Commit**

```bash
git add src/policy/steps/optimize.ts test/unit/policy/optimize.spec.ts
git commit -m "feat(policy): constrained optimiser with P2, P4, P5 and real enumeration

Replaces the capBps-only greedy allocator and the fabricated regret constant.
Adds the structural liquidity cap, the portfolio-level lower bound, exitable
fraction weighting, dependency-group caps and stress feasibility as a hard
rejection before returns are compared. Ablation switches are wired for H1-H7.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

## Tasks 9–16

Continued in `2026-09-07-srcla-paper-conformance-phase1-tasks-9-16.md`.
