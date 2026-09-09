# SRCLA v0.7 Selection & Release-Gate Implementation Plan (2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make forecast selection answer to the decision it feeds, add the state-space forecast candidate, and rebuild the §11.5 release gate around **sustainability as the primary criterion** — redeemability under stress, capacity discipline, and invariance across vault size, each demonstrated with capital actually at work — with yield scored second and only among policies that are themselves sustainable.

**Paper v0.8 changes this plan's centre of gravity.** The study's proposition is that the highest available yield is frequently not redeemable, so the gate must test redeemability first and absolutely. Task 11 is rewritten accordingly and Task 11b is new. Tasks 6–8 (forecast selection) are unaffected.

**Architecture:** `grid-sweep.ts` stops being decided by a near-constant term: every loss term is standardized across the grid, non-discriminating terms are zero-weighted, and the two decision-focused terms §7.3 already names are computed by running the real decision rule. A fourth forecast candidate forecasts utilization and maps it through the venue's own on-chain IRM. `kernel/gates.ts` scopes safety to SRCLA's runs, measures deployability rather than asserting it, separates ablations from baselines, replaces yield superiority with non-inferiority, and computes the skill window that decides whether a yield criterion is informative at all.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Prisma 5, Jest via `pnpm test:unit`, bigint money (6 dp), rates in WAD (18 dp).

**Spec:** `docs/superpowers/specs/2026-09-09-srcla-v07-movement-rule-design.md` §3.5–3.8
**Paper:** `docs/research/output/srcla-paper.md` v0.7 §7.2, §7.3, §11.2–§11.5, amendments P18–P22.

**Prerequisite:** `docs/superpowers/plans/2026-09-09-srcla-v07-controller.md` must be complete. Task 7 runs the decision rule that plan builds, and Task 9's `h3d` ablation needs the `deploymentHurdle` switch it adds.

## Global Constraints

- **Work only inside `srcla/`.** Contracts, `be/`, `fe/`, `expo-wallet/` are out of scope.
- **Run tests with `pnpm test:unit`, never `npx jest`** (the raw invocation misses the ESM preset and fails five policy suites on `import.meta`, TS1343).
- **`pnpm exec tsc --noEmit` must be clean before every commit.**
- **`pnpm typecheck:scripts` currently fails with 51 pre-existing errors across 6 files.** Do not fix them here and do not let the count grow — record the before/after count in Task 14.
- **Never read a sealed era.** `heldout-c` and `heldout-b` are burned per the paper's third burned-window declaration; `loadEra` refuses sealed tags unless `allowSealed: true`, which has exactly two legitimate callers (the registered run itself). Do not add a third.
- **Prisma 5 here.** `pnpm prisma:push` after schema changes, not `migrate`.
- **`SECONDS_PER_YEAR` is `31_536_000n`** in policy code — not `src/protocols/math.ts`'s `31557600n`.
- **Registered constants live in one place and are imported, never re-declared.** A gate that re-declares a floor the optimiser also uses reinstates exactly the divergence P10 removed.

---

### Task 6: Scale-normalized selection loss (P18, part 1)

The v0.6 loss was 99.84% `downsideRate` — the fraction of residuals below zero, ≈0.5 for any unbiased candidate, so it carries almost no information about candidate quality. Selection was decided in the residue on a 1.27e-7 margin. Standardize every term across the grid and zero-weight any term that does not discriminate.

**Files:**
- Modify: `src/forecast/grid-sweep.ts` (`LOSS_WEIGHTS`, `fitPoint`, and a new grid-level normalization pass)
- Test: `test/unit/forecast/selection-loss.spec.ts` (create)

**Interfaces:**
- Consumes: `SelectionLoss`, `FitPoint`, `GridPoint` from `src/forecast/grid-sweep.ts`.
- Produces:
  - `export interface ScoredPoint { point: GridPoint; fit: FitPoint; normalized: Record<string, number>; total: number; zeroWeighted: string[] }`
  - `export function scoreGrid(fits: ReadonlyArray<{ point: GridPoint; fit: FitPoint }>, opts: { minIqr: number }): ScoredPoint[]`
  - `export const MIN_DISCRIMINATING_IQR = 1e-4`

- [ ] **Step 1: Write the failing test**

Create `test/unit/forecast/selection-loss.spec.ts`:

```typescript
import { scoreGrid, MIN_DISCRIMINATING_IQR } from '../../../src/forecast/grid-sweep.js';

function fit(overrides: Partial<Record<string, number>>) {
  return {
    pointError: 1e-5, coverageDeviation: 1e-5, exceedanceShortfall: 1e-7,
    sharpness: 1e-4, downsideRate: 0.5, turnover: 1, sacrificedReturn: 0,
    total: 0, observations: 1000, achievedCoverage: 0.99,
    ...overrides,
  } as never;
}

describe('P18: scale-normalized selection loss', () => {
  it('zero-weights a term that is constant across the grid', () => {
    const fits = [
      { point: { id: 'p1' } as never, fit: fit({ pointError: 1e-5 }) },
      { point: { id: 'p2' } as never, fit: fit({ pointError: 2e-5 }) },
      { point: { id: 'p3' } as never, fit: fit({ pointError: 3e-5 }) },
    ];
    const scored = scoreGrid(fits, { minIqr: MIN_DISCRIMINATING_IQR });
    // downsideRate is 0.5 everywhere -> no spread -> zero-weighted
    expect(scored[0]!.zeroWeighted).toContain('downsideRate');
  });

  it('a constant term cannot change the ranking', () => {
    const withConst = scoreGrid([
      { point: { id: 'a' } as never, fit: fit({ pointError: 1e-5, downsideRate: 0.5 }) },
      { point: { id: 'b' } as never, fit: fit({ pointError: 9e-5, downsideRate: 0.5 }) },
    ], { minIqr: MIN_DISCRIMINATING_IQR });
    const withOther = scoreGrid([
      { point: { id: 'a' } as never, fit: fit({ pointError: 1e-5, downsideRate: 0.9 }) },
      { point: { id: 'b' } as never, fit: fit({ pointError: 9e-5, downsideRate: 0.9 }) },
    ], { minIqr: MIN_DISCRIMINATING_IQR });
    expect(withConst.map((s) => s.point).map((p) => (p as { id: string }).id))
      .toEqual(withOther.map((s) => s.point).map((p) => (p as { id: string }).id));
  });

  it('a term measured in tiny units does not lose to one measured in large units', () => {
    // exceedanceShortfall ~1e-7, downsideRate ~0.5: after standardization a
    // one-sigma move in either must weigh the same before weights apply.
    const scored = scoreGrid([
      { point: { id: 'a' } as never, fit: fit({ exceedanceShortfall: 1e-7, downsideRate: 0.4 }) },
      { point: { id: 'b' } as never, fit: fit({ exceedanceShortfall: 9e-7, downsideRate: 0.6 }) },
    ], { minIqr: 0 });
    const spread = Math.abs(scored[0]!.normalized['exceedanceShortfall']! - scored[1]!.normalized['exceedanceShortfall']!);
    const spread2 = Math.abs(scored[0]!.normalized['downsideRate']! - scored[1]!.normalized['downsideRate']!);
    expect(Math.abs(spread - spread2)).toBeLessThan(1e-9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit selection-loss`
Expected: FAIL — `scoreGrid` is not exported.

- [ ] **Step 3: Implement grid-level normalization**

Add to `src/forecast/grid-sweep.ts`:

```typescript
/**
 * A term whose interquartile range across the grid is below this cannot rank
 * candidates and is reported as a diagnostic with zero weight. P18: the v0.6
 * loss was 99.84% `downsideRate`, a quantity ~0.5 for any unbiased candidate,
 * so selection was decided in the residue on a 1.27e-7 margin.
 */
export const MIN_DISCRIMINATING_IQR = 1e-4;

export interface ScoredPoint {
  point: GridPoint;
  fit: FitPoint;
  normalized: Record<string, number>;
  total: number;
  zeroWeighted: string[];
}

const LOSS_TERMS = [
  'pointError', 'coverageDeviation', 'exceedanceShortfall',
  'sharpness', 'downsideRate', 'turnover', 'sacrificedReturn',
] as const;

/**
 * Standardize each term across the grid (z-score on the grid's own spread),
 * then weight. A term is standardized BEFORE weighting so a weight expresses
 * a preference rather than an accident of units.
 */
export function scoreGrid(
  fits: ReadonlyArray<{ point: GridPoint; fit: FitPoint }>,
  opts: { minIqr: number },
): ScoredPoint[] {
  const stats: Record<string, { mean: number; sd: number; iqr: number }> = {};
  for (const term of LOSS_TERMS) {
    const xs = fits.map((f) => (f.fit.loss as unknown as Record<string, number>)[term] ?? 0);
    const mean = xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, xs.length - 1)) || 1;
    const sorted = xs.slice().sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
    stats[term] = { mean, sd, iqr: q(0.75) - q(0.25) };
  }
  const zeroWeighted = LOSS_TERMS.filter((t) => stats[t]!.iqr < opts.minIqr);

  return fits
    .map(({ point, fit }) => {
      const normalized: Record<string, number> = {};
      let total = 0;
      for (const term of LOSS_TERMS) {
        const raw = (fit.loss as unknown as Record<string, number>)[term] ?? 0;
        const z = (raw - stats[term]!.mean) / stats[term]!.sd;
        normalized[term] = z;
        if (zeroWeighted.includes(term)) continue;
        total += (LOSS_WEIGHTS as unknown as Record<string, number>)[term]! * z;
      }
      return { point, fit, normalized, total, zeroWeighted: [...zeroWeighted] };
    })
    .sort((a, b) => a.total - b.total);
}
```

Extend `LOSS_WEIGHTS` with `turnover: 2.0` and `sacrificedReturn: 3.0` and extend `SelectionLoss` with those two fields (Task 7 populates them; until then they are `0` for every candidate, so the IQR rule zero-weights them automatically — which is the correct behaviour for a term nothing has measured yet).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit selection-loss`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/forecast/grid-sweep.ts test/unit/forecast/selection-loss.spec.ts
git commit -m "feat(forecast): scale-normalize the selection loss and drop non-discriminating terms (P18)

Every term is standardized across the grid before weighting, and a term
whose interquartile range across the grid is below the registered
threshold is reported as a diagnostic with zero weight. downsideRate
falls out on this data, which is correct: it does not discriminate."
```

---

### Task 7: Decision-focused loss terms (P18, part 2)

§7.3 has always named turnover and sacrificed return among its seven loss terms; the implementation carried five. Without them no forecast-accuracy statistic can observe that a candidate horizon leaves the movement rule unable to act — which is exactly what v0.6 could not see.

**Files:**
- Create: `src/forecast/decision-score.ts`
- Modify: `src/forecast/grid-sweep.ts` (populate the two terms)
- Modify: `scripts/freeze-artifact.ts` (call the scorer; record the subsample rule)
- Test: `test/unit/forecast/decision-score.spec.ts` (create)

**Interfaces:**
- Consumes: `decide` from `src/policy/decide.ts`; `planLegs` from `src/policy/steps/legs.ts` (controller plan, Task 4); `DecisionInput` builders from `src/evaluation/kernel/decision-input.ts`.
- Produces:
  - `export interface DecisionScore { turnover: number; sacrificedReturn: number; rebalances: number; originsScored: number }`
  - `export function scoreCandidateDecisions(origins, artifact, opts, subsample: { everyNth: number }): DecisionScore`

- [ ] **Step 1: Write the failing test**

Create `test/unit/forecast/decision-score.spec.ts`:

```typescript
import { scoreCandidateDecisions } from '../../../src/forecast/decision-score.js';

describe('P18: decision-focused loss terms', () => {
  it('a candidate whose hurdle never opens scores maximal sacrificed return', () => {
    const blocked = scoreCandidateDecisions(origins(), artifactThatNeverTrades(), opts(), { everyNth: 1 });
    const trading = scoreCandidateDecisions(origins(), artifactThatTrades(), opts(), { everyNth: 1 });
    expect(blocked.rebalances).toBe(0);
    expect(blocked.sacrificedReturn).toBeGreaterThan(trading.sacrificedReturn);
  });

  it('a candidate that churns scores high turnover', () => {
    const churn = scoreCandidateDecisions(origins(), artifactThatChurns(), opts(), { everyNth: 1 });
    const steady = scoreCandidateDecisions(origins(), artifactThatTrades(), opts(), { everyNth: 1 });
    expect(churn.turnover).toBeGreaterThan(steady.turnover);
  });

  it('the subsample rule is deterministic and reported', () => {
    const a = scoreCandidateDecisions(origins(), artifactThatTrades(), opts(), { everyNth: 4 });
    const b = scoreCandidateDecisions(origins(), artifactThatTrades(), opts(), { everyNth: 4 });
    expect(a).toEqual(b);
    expect(a.originsScored).toBeLessThan(origins().length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit decision-score`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scorer**

Create `src/forecast/decision-score.ts`:

```typescript
/**
 * §7.3's two decision-focused loss terms, computed by running the REGISTERED
 * DECISION RULE over the calibration era under a candidate artifact.
 *
 * This is what couples the forecast to its consumer. v0.6 selected a horizon
 * on forecast accuracy alone and the winning horizon left the movement rule
 * unable to act; no accuracy statistic can see that.
 *
 * DETERMINISTIC: the subsample is every Nth origin in time order, never a
 * random draw, and `everyNth` is recorded in the artifact's registration.
 */
import { decide } from '../policy/decide.js';
import type { DecideOpts } from '../policy/decide.js';
import type { DecisionInput, PolicyArtifact } from '../policy/types.js';

export interface DecisionScore {
  /** Total notional moved, as a multiple of vault NAV. */
  turnover: number;
  /**
   * Return foregone by hurdle rejections: at each origin, the annualised
   * conservative gain of the target the optimiser wanted minus that of the
   * position actually held, accumulated over the era and expressed as APY.
   */
  sacrificedReturn: number;
  rebalances: number;
  originsScored: number;
}

export function scoreCandidateDecisions(
  origins: readonly DecisionInput[],
  artifact: PolicyArtifact,
  opts: DecideOpts,
  subsample: { everyNth: number },
): DecisionScore {
  const n = Math.max(1, Math.round(subsample.everyNth));
  let turnover = 0, sacrificed = 0, rebalances = 0, scored = 0;

  for (let i = 0; i < origins.length; i += n) {
    const input = origins[i]!;
    const out = decide(input, artifact, opts);
    scored += 1;
    const nav = Number(input.vault.totalAssetsBase);
    if (nav <= 0) continue;

    if (out.action === 'rebalance') {
      rebalances += 1;
      let moved = 0n;
      for (const leg of out.costGate.legs ?? []) if (leg.clears) moved += leg.amountBase;
      turnover += Number(moved) / nav;
    }

    // Sacrificed return: what the blocked legs would have added, at the
    // conservative bound, annualised. A candidate whose hurdle never opens
    // accumulates the whole available edge here.
    for (const leg of out.costGate.legs ?? []) {
      if (leg.clears) continue;
      sacrificed += (Number(leg.edgeWad) / 1e18) * (Number(leg.amountBase) / nav);
    }
  }

  return {
    turnover,
    sacrificedReturn: scored === 0 ? 0 : sacrificed / scored,
    rebalances,
    originsScored: scored,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit decision-score`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire it into the sweep**

In `scripts/freeze-artifact.ts`, for each grid point, build a candidate artifact and call `scoreCandidateDecisions(origins, candidate, decideOpts, { everyNth: SELECTION_SUBSAMPLE })` with

```typescript
/**
 * Registered selection subsample. The full replay runs ONCE for the winner;
 * the grid is ranked on every Nth origin. The v0.6 k-sweep reached 0 of 7
 * candidates in 65 minutes without this (release-readiness ruling F15), and
 * this plan makes each grid point strictly more expensive.
 */
const SELECTION_SUBSAMPLE = 12;
```

Write `turnover` and `sacrificedReturn` into each point's `SelectionLoss`, then rank with `scoreGrid`. Record `selectionSubsample: SELECTION_SUBSAMPLE` and `selectionMargin` in `_registration`.

- [ ] **Step 6: Add the near-tie rule**

```typescript
/** Below this normalized-total margin, the lexical tie-break is NOT used. */
const MIN_SELECTION_MARGIN = 1e-3;

function resolveNearTie(scored: ScoredPoint[]): ScoredPoint {
  const [best, runnerUp] = scored;
  if (runnerUp === undefined || runnerUp.total - best!.total >= MIN_SELECTION_MARGIN) return best!;
  // Resolve on the economic terms alone.
  const econ = (s: ScoredPoint) =>
    s.normalized['turnover']! * 2.0 + s.normalized['sacrificedReturn']! * 3.0;
  if (Math.abs(econ(best!) - econ(runnerUp)) >= MIN_SELECTION_MARGIN) {
    return econ(best!) < econ(runnerUp) ? best! : runnerUp;
  }
  // Still tied: take the LONGER horizon. §7.1 - signal-to-noise rises with H,
  // so the shorter choice carries strictly more estimation risk.
  return best!.point.horizonSeconds >= runnerUp.point.horizonSeconds ? best! : runnerUp;
}
```

Run: `pnpm test:unit && pnpm exec tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/forecast/decision-score.ts src/forecast/grid-sweep.ts scripts/freeze-artifact.ts test/unit/forecast/decision-score.spec.ts
git commit -m "feat(forecast): decision-focused selection terms and near-tie rule (P18)

Turnover and sacrificed return are computed by running the registered
decision rule over the calibration era, on a registered subsample. A
near-tie is resolved on the economic terms and then toward the longer
horizon, never on a lexical tie-break in the seventh decimal."
```

---

### Task 8: State-space forecast candidate (P19)

One-day persistence explains 75.8% / 91.8% / 91.5% of utilization variance against −20.6% / 43.0% / 4.2% for the rates those utilizations produce. The rate is a kinked, governance-reparameterized function of a smooth bounded state, and every parameter of that function is already stored per origin.

**Files:**
- Create: `src/forecast/state-space.ts`
- Modify: `src/forecast/grid-sweep.ts` (`meanForecast` dispatch, `ForecastMethod` union)
- Modify: `src/policy/types.ts` (`ForecastMethod` gains `'state-space'`)
- Test: `test/unit/forecast/state-space.spec.ts` (create)

**Interfaces:**
- Consumes: `irmBaseRateWad`, `irmKinkRay`, `irmSlopeLowWad`, `irmSlopeHighWad`, `irmOptimalUtilizationRay`, `reserveFactorBps`, `utilizationE18` from `MarketSnapshot`.
- Produces:
  - `export interface IrmParams { baseRateWad: bigint; kinkRay: bigint; slopeLowWad: bigint; slopeHighWad: bigint; reserveFactorBps: number }`
  - `export function supplyRateAt(utilizationWad: bigint, irm: IrmParams): bigint`
  - `export function forecastUtilization(history: readonly bigint[], params: { halfLifeObservations: number }): bigint`
  - `export function stateSpaceForecast(history, irm, params, observedRange: { minWad: bigint; maxWad: bigint }): bigint`

- [ ] **Step 1: Write the failing test**

Create `test/unit/forecast/state-space.spec.ts`:

```typescript
import { supplyRateAt, forecastUtilization, stateSpaceForecast } from '../../../src/forecast/state-space.js';

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;

const comet = {
  baseRateWad: 0n,
  kinkRay: (RAY * 90n) / 100n,          // Compound Base USDC: 90%, NOT the 80% placeholder
  slopeLowWad: (WAD * 36n) / 1000n,     // ~3.6%
  slopeHighWad: (WAD * 30n) / 100n,
  reserveFactorBps: 0,
};

describe('P19: state-space forecast', () => {
  it('reproduces the kinked curve below, at and above the kink', () => {
    const below = supplyRateAt((WAD * 50n) / 100n, comet);
    const atKink = supplyRateAt((WAD * 90n) / 100n, comet);
    const above = supplyRateAt((WAD * 95n) / 100n, comet);
    expect(below).toBeLessThan(atKink);
    expect(atKink).toBeLessThan(above);
    // slope above the kink is strictly steeper
    const slopeBelow = atKink - below;
    const slopeAbove = above - atKink;
    expect(slopeAbove * 10n).toBeGreaterThan(slopeBelow);
  });

  it('mean-reverts utilization toward the window mean', () => {
    const flat = Array<bigint>(48).fill((WAD * 70n) / 100n);
    expect(forecastUtilization(flat, { halfLifeObservations: 24 })).toBe((WAD * 70n) / 100n);
    const spiked = [...flat, (WAD * 99n) / 100n];
    const f = forecastUtilization(spiked, { halfLifeObservations: 24 });
    expect(f).toBeGreaterThan((WAD * 70n) / 100n);
    expect(f).toBeLessThan((WAD * 99n) / 100n);   // reverts, does not chase
  });

  it('REFUSES to extrapolate outside the observed utilization range', () => {
    const hist = Array<bigint>(48).fill((WAD * 70n) / 100n);
    const out = stateSpaceForecast(hist, comet, { halfLifeObservations: 24 },
      { minWad: (WAD * 60n) / 100n, maxWad: (WAD * 75n) / 100n });
    const clampedAtMax = supplyRateAt((WAD * 75n) / 100n, comet);
    expect(out).toBeLessThanOrEqual(clampedAtMax);
  });

  it('a governance reparameterization changes the map, not the state history', () => {
    const hist = Array<bigint>(48).fill((WAD * 70n) / 100n);
    const steeper = { ...comet, slopeLowWad: comet.slopeLowWad * 2n };
    const a = stateSpaceForecast(hist, comet, { halfLifeObservations: 24 }, { minWad: 0n, maxWad: WAD });
    const b = stateSpaceForecast(hist, steeper, { halfLifeObservations: 24 }, { minWad: 0n, maxWad: WAD });
    expect(b).toBeGreaterThan(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit state-space`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/forecast/state-space.ts` with `supplyRateAt` reproducing the kinked curve exactly (`rate = base + slopeLow*u` below the kink; `base + slopeLow*kink + slopeHigh*(u - kink)` above, then `* (1 - reserveFactor)`), `forecastUtilization` as an exponentially weighted level with the registered half-life, and `stateSpaceForecast` composing them with a hard clamp to `observedRange`.

**Read the IRM parameters from the snapshot columns, never from `DEFAULT_*_CONFIG`.** Those placeholders assert an 80% kink and a 6.25% low slope; Compound's real Base USDC values are 90% and ~3.60%.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit state-space`
Expected: PASS, 4 tests.

- [ ] **Step 5: Register the candidate**

Add `'state-space'` to `ForecastMethod` in `src/policy/types.ts`, dispatch it in `meanForecast`, and add its parameter axis (`halfLifeObservations` ∈ {12, 24, 72}) to the registered grid. It competes on the same loss and wins only if it wins.

- [ ] **Step 6: Commit**

```bash
git add src/forecast/state-space.ts src/forecast/grid-sweep.ts src/policy/types.ts test/unit/forecast/state-space.spec.ts
git commit -m "feat(forecast): state-space utilization candidate through the exact IRM (P19)

Forecast the smooth bounded state and apply the protocol's own map,
rather than forecasting the kinked governance-reparameterized output.
Measured one-day persistence R2: utilization 0.758/0.918/0.915 against
rate -0.206/0.430/0.042. Registered, not mandated - it enters the same
grid and wins only if it wins."
```

---

### Task 9: Safety scoping, measured deployability, H3d (P20)

On the v0.6 secondary era every stressed-coverage violation belonged to a baseline or an ablation and none to SRCLA, yet the gate recorded them as SRCLA's failure. And B1/B2/B2u earned 39% while holding 0.878 coverage against the 0.99 floor SRCLA obeyed, then counted as comparators SRCLA had to beat.

**Files:**
- Modify: `src/evaluation/kernel/gates.ts` (the safety check ~line 230, the comparison loop ~line 280)
- Modify: `src/evaluation/kernel/registry.ts` (add `h3d`)
- Test: `test/unit/evaluation/registered-gates.spec.ts` (extend)

**Interfaces:**
- Consumes: `PolicyRunResult`, `RegisteredEvaluationResult` from `src/evaluation/kernel/harness.ts`; `REGISTERED_COVERAGE_FLOOR` from `src/policy/steps/coverage.ts`.
- Produces:
  - `export function admissibleComparators(atTier: readonly PolicyRunResult[], minStressed: number, minWithdrawal: number): { admissible: PolicyRunResult[]; excluded: Array<{ id: string; breach: string }> }`
  - Gate check names unchanged in spelling so report snapshots stay comparable.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/evaluation/registered-gates.spec.ts`:

```typescript
describe('P20: safety is scoped to SRCLA; deployability is measured', () => {
  it('PASSES the safety check when only a BASELINE breaches coverage', () => {
    const out = runResult({
      srcla: { minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1 },
      b1: { minStressedLiquidCoverage: 0.878, withdrawalSuccessRate: 1 },
    });
    const gate = runRegisteredGate(out, {});
    const safety = gate.checks.find((c) => c.name.startsWith('Safety: stressed'));
    expect(safety!.passed).toBe(true);
    expect(safety!.detail).toMatch(/b1/);   // reported, not silent
  });

  it('FAILS the safety check when SRCLA breaches coverage', () => {
    const out = runResult({ srcla: { minStressedLiquidCoverage: 0.9, withdrawalSuccessRate: 1 } });
    const gate = runRegisteredGate(out, {});
    expect(gate.checks.find((c) => c.name.startsWith('Safety: stressed'))!.passed).toBe(false);
  });

  it('EXCLUDES a coverage-breaching baseline from the comparison set', () => {
    const out = runResult({
      srcla: { minStressedLiquidCoverage: 1.0, realizedNetApy: 0.05 },
      b1: { minStressedLiquidCoverage: 0.878, realizedNetApy: 0.39 },
    });
    const gate = runRegisteredGate(out, {});
    expect(gate.comparisons.some((c) => c.baselineId === 'b1')).toBe(false);
  });

  it('reports NO ADMISSIBLE COMPARATOR when every baseline is excluded', () => {
    const out = runResult({
      srcla: { minStressedLiquidCoverage: 1.0 },
      b1: { minStressedLiquidCoverage: 0.5 }, b2: { minStressedLiquidCoverage: 0.5 },
      b3: { minStressedLiquidCoverage: 0.5 }, b4: { minStressedLiquidCoverage: 0.5 },
      b0: { minStressedLiquidCoverage: 0.5 },
    });
    const gate = runRegisteredGate(out, {});
    const yield_ = gate.checks.find((c) => c.name.startsWith('Non-inferior'));
    expect(yield_!.passed).toBeNull();
    expect(yield_!.detail).toMatch(/NO ADMISSIBLE COMPARATOR/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit registered-gates`
Expected: FAIL — the safety check still ranges over all runs.

- [ ] **Step 3: Implement**

In `gates.ts`, filter the safety check's population to `r.policy.id === SRCLA_POLICY.id`, and report every other policy's breaches in the same `detail` string prefixed `reported (not gating):`. Add `admissibleComparators` and use it to build the comparison set, replacing the static `!b.policy.deployable` filter with `deployable && admissible`.

- [ ] **Step 4: Add H3d to the registry**

```typescript
  {
    id: 'h3d',
    name: 'H3d deployment hurdle',
    paperDefinition: 'remove §9.1.2\'s deployment hurdle, retaining §9.1.3\'s rotation hurdle.',
    section: '11.3',
    deployable: true,
    shape: 'kernel',
    disable: { deploymentHurdle: true },
  },
```

v0.6's H3 removed both hurdles and could not report which effect it had measured. The two differ by an order of magnitude — 494 bps against 18–43.

- [ ] **Step 5: Run tests**

Run: `pnpm test:unit registered-gates`
Expected: PASS. Update the required-run count assertions for the new policy.

- [ ] **Step 6: Commit**

```bash
git add src/evaluation/kernel/gates.ts src/evaluation/kernel/registry.ts test/unit/evaluation/registered-gates.spec.ts
git commit -m "fix(eval): scope safety to SRCLA, measure deployability, add H3d (P20)

A comparator's safety breach is reported and excludes it from the
comparison set; it never fails SRCLA's gate. A policy exempt from a
constraint the candidate must obey measures the constraint's cost, not
the candidate's skill."
```

---

### Task 10: Ablations leave the baseline comparison (P21, part 1)

An ablation that beats SRCLA is a finding about the removed component — which is what §11.3 exists to report. Folding it into the baseline criterion turned the single most informative diagnostic in the v0.6 run into an undifferentiated gate failure.

**Files:**
- Modify: `src/evaluation/kernel/gates.ts`
- Modify: `src/evaluation/report/render-markdown.ts`
- Test: `test/unit/evaluation/registered-gates.spec.ts` (extend)

**Interfaces:**
- Produces: `export interface AblationContribution { policyId: string; tier: string; contributionPp: number; verdict: 'POSITIVE' | 'NEGATIVE' | 'INERT' }` and `export function ablationContributions(out): AblationContribution[]`.

- [ ] **Step 1: Write the failing test**

```typescript
describe('P21: ablations are §11.3 evidence, not §11.2 comparators', () => {
  it('an ablation is not in the baseline comparison set', () => {
    const gate = runRegisteredGate(runResult({ srcla: {}, h3: { realizedNetApy: 0.39 } }), {});
    expect(gate.comparisons.some((c) => c.baselineId.startsWith('h'))).toBe(false);
  });

  it('an ablation that beats SRCLA is reported as a NEGATIVE contribution', () => {
    const out = runResult({ srcla: { realizedNetApy: 0.008 }, h3: { realizedNetApy: 0.034 } });
    const contribs = ablationContributions(out);
    const h3 = contribs.find((c) => c.policyId === 'h3')!;
    expect(h3.verdict).toBe('NEGATIVE');
    expect(h3.contributionPp).toBeLessThan(0);
  });

  it('a byte-identical ablation is INERT, not a contribution of either sign', () => {
    const out = runResult({ srcla: { realizedNetApy: 0.05 }, h5: { realizedNetApy: 0.05, inertVsSrcla: true } });
    expect(ablationContributions(out).find((c) => c.policyId === 'h5')!.verdict).toBe('INERT');
  });
});
```

- [ ] **Step 2–4: Run, implement, re-run**

Run `pnpm test:unit registered-gates` → FAIL → implement `ablationContributions`, exclude `shape: 'kernel'` ablation ids from `comparisons`, render a §11.3 table → PASS.

Keep the existing "No inert ablation" check: an inert ablation still fails the gate, because a run in which a component provably did nothing has not tested that component.

- [ ] **Step 5: Commit**

```bash
git add src/evaluation/kernel/gates.ts src/evaluation/report/render-markdown.ts test/unit/evaluation/registered-gates.spec.ts
git commit -m "feat(eval): separate ablation contributions from baseline comparison (P21)

An ablation that beats SRCLA is a NEGATIVE contribution finding about
the removed component, reported in the §11.3 table. It is no longer
counted as a baseline SRCLA failed to beat."
```

---

### Task 10b: The sustainability gate (P24, P25, P26, P28)

This is the primary release criterion under paper v0.8 and the reason the study
exists. Sustainability is scored **per policy per tier**, absolutely, and behind
a demonstration floor — because a vault holding idle cash passes every
redeemability test and has proven nothing. On the v0.6 data SRCLA held 1.000
stressed coverage at all four tiers on both eras *while realizing 0.000% on one
of them*; that must report `NOT DEMONSTRATED`, not a pass.

**Files:**
- Create: `src/evaluation/kernel/sustainability.ts`
- Create: `src/evaluation/replay/sustainability-metrics.ts`
- Modify: `src/evaluation/kernel/gates.ts`, `src/evaluation/kernel/harness.ts`, `src/evaluation/report/render-markdown.ts`
- Test: `test/unit/evaluation/sustainability.spec.ts` (create)

**Interfaces:**
- Consumes: `PolicyRunResult` from `harness.ts`; `capitalAtWork` from the controller plan's Task 5.
- Produces:
  - `export const REGISTERED_DEMONSTRATION_FLOOR = 0.80`
  - `export const REGISTERED_MAX_EXIT_ORIGINS = 24`
  - `export const REGISTERED_MAX_VENUE_STRESS_SHARE = 0.25`
  - `export interface SustainabilityVerdict { policyId: string; tier: string; demonstrated: boolean; s1: boolean | null; s2: boolean | null; s3: boolean | null; s4: boolean | null; sustainable: boolean | null; breach: string | null }`
  - `export function sustainabilityAtTier(run: PolicyRunResult): SustainabilityVerdict`
  - `export function scaleInvariant(verdicts: readonly SustainabilityVerdict[]): boolean | null`
  - `export function timeToFullExit(series, stress): number | null`
  - `export function venueStressContribution(series): Record<string, number>`
  - `export function displayedVsRealizedGap(series): number`

- [ ] **Step 1: Write the failing test**

Create `test/unit/evaluation/sustainability.spec.ts`:

```typescript
import {
  sustainabilityAtTier, scaleInvariant, REGISTERED_DEMONSTRATION_FLOOR,
} from '../../../src/evaluation/kernel/sustainability.js';

describe('P25: sustainability must be demonstrated while deployed', () => {
  it('an all-idle run reports NOT DEMONSTRATED, not a pass', () => {
    const v = sustainabilityAtTier(run({ capitalAtWorkFraction: 0, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1 }));
    expect(v.demonstrated).toBe(false);
    expect(v.sustainable).toBeNull();          // null, never true
  });

  it("v0.6 SRCLA's perfect coverage at 0.000% return does NOT pass", () => {
    const v = sustainabilityAtTier(run({ capitalAtWorkFraction: 0.02, realizedNetApy: 0, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1 }));
    expect(v.sustainable).toBeNull();
    expect(v.breach).toMatch(/NOT DEMONSTRATED/);
  });

  it('a deployed run holding the floor is sustainable', () => {
    const v = sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1, exitOrigins: 3, venueStressShare: 0.1 }));
    expect(v.demonstrated).toBe(true);
    expect(v.sustainable).toBe(true);
  });

  it('a deployed run breaching coverage is NOT sustainable and names the criterion', () => {
    const v = sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 0.878, withdrawalSuccessRate: 1 }));
    expect(v.sustainable).toBe(false);
    expect(v.breach).toMatch(/S2/);
  });

  it('a run that cannot fully exit inside the bound fails S1 even at perfect coverage', () => {
    const v = sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1, exitOrigins: 500 }));
    expect(v.sustainable).toBe(false);
    expect(v.breach).toMatch(/S1/);
  });

  it('a run that itself causes most of a venue\'s utilization fails S3', () => {
    const v = sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1, venueStressShare: 0.8 }));
    expect(v.sustainable).toBe(false);
    expect(v.breach).toMatch(/S3/);
  });
});

describe('P26: scale invariance is a criterion, not an average', () => {
  it('B4 - sustainable at 1M, breaching at 10M - is NOT scale invariant', () => {
    const vs = [
      sustainabilityAtTier(run({ tier: '1000000000000', capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1 })),
      sustainabilityAtTier(run({ tier: '10000000000000', capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 0.590, withdrawalSuccessRate: 1 })),
    ];
    expect(scaleInvariant(vs)).toBe(false);
  });

  it('three passing tiers and one NOT DEMONSTRATED is null, never true', () => {
    const vs = [
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1 })),
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1 })),
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1 })),
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.0, minStressedLiquidCoverage: 1.0, withdrawalSuccessRate: 1 })),
    ];
    expect(scaleInvariant(vs)).toBeNull();
  });

  it('averaging cannot rescue a breach: 3 x 1.000 and 1 x 0.000 is not sustainable', () => {
    const vs = [1.0, 1.0, 1.0, 0.0].map((c) =>
      sustainabilityAtTier(run({ capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: c, withdrawalSuccessRate: 1 })));
    expect(scaleInvariant(vs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit sustainability`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/evaluation/kernel/sustainability.ts`**

```typescript
/**
 * Paper §11.5 parts 1 and 3 - the PRIMARY release criterion.
 *
 * The study's proposition is that the highest available yield is frequently
 * not redeemable. Sustainability is therefore scored first, absolutely, and
 * per tier; yield is scored afterwards and only among policies that pass here.
 *
 * P25 is why `demonstrated` gates everything: a vault holding idle cash
 * satisfies every redeemability test and has proven nothing. On the v0.6 data
 * SRCLA held 1.000 coverage at every tier on both eras while realizing 0.000%
 * on one of them - a perfect score that must not read as a pass.
 *
 * PURE. Three-valued throughout: `null` is NOT DEMONSTRATED and never a pass.
 */
import type { PolicyRunResult } from './harness.js';

/** Time-weighted capital-at-work below which a run proves nothing. */
export const REGISTERED_DEMONSTRATION_FLOOR = 0.80;
/** Origins a complete redemption may take before S1 fails. */
export const REGISTERED_MAX_EXIT_ORIGINS = 24;
/** Share of a venue's utilization the vault may itself account for. */
export const REGISTERED_MAX_VENUE_STRESS_SHARE = 0.25;
export const REGISTERED_MIN_WITHDRAWAL_SUCCESS = 0.99;

export interface SustainabilityVerdict {
  policyId: string;
  tier: string;
  demonstrated: boolean;
  s1: boolean | null;
  s2: boolean | null;
  s3: boolean | null;
  s4: boolean | null;
  sustainable: boolean | null;
  breach: string | null;
}

export function sustainabilityAtTier(run: PolicyRunResult): SustainabilityVerdict {
  const r = run.replay;
  const tier = run.tier.toString();
  const demonstrated = (r.capitalAtWorkFraction ?? 0) >= REGISTERED_DEMONSTRATION_FLOOR;

  if (!demonstrated) {
    return {
      policyId: run.policy.id, tier, demonstrated: false,
      s1: null, s2: null, s3: null, s4: null, sustainable: null,
      breach: `NOT DEMONSTRATED: capital at work ${(r.capitalAtWorkFraction ?? 0).toFixed(3)} ` +
        `< ${REGISTERED_DEMONSTRATION_FLOOR}; a vault holding idle cash is trivially redeemable`,
    };
  }

  const s1 = (r.withdrawalSuccessRate ?? 0) >= REGISTERED_MIN_WITHDRAWAL_SUCCESS
    && (r.timeToFullExitOrigins ?? 0) <= REGISTERED_MAX_EXIT_ORIGINS;
  const s2 = r.minStressedLiquidCoverage >= 0.99;
  const s3 = Math.max(0, ...Object.values(r.venueStressContribution ?? {})) <= REGISTERED_MAX_VENUE_STRESS_SHARE;
  const s4 = (r.policyViolations ?? 0) === 0;

  const failed: string[] = [];
  if (!s1) failed.push('S1 redeemability');
  if (!s2) failed.push(`S2 stressed coverage ${r.minStressedLiquidCoverage.toFixed(3)}`);
  if (!s3) failed.push('S3 capacity discipline');
  if (!s4) failed.push('S4 continuity');

  return {
    policyId: run.policy.id, tier, demonstrated: true, s1, s2, s3, s4,
    sustainable: failed.length === 0,
    breach: failed.length === 0 ? null : failed.join('; '),
  };
}

/**
 * P26 - every tier independently. A per-tier pass does NOT aggregate: B4 held
 * 1.000 coverage at 1M and 0.590 at 10M on the same era with an identical
 * return, and no metric averaged over tiers can see that.
 */
export function scaleInvariant(verdicts: readonly SustainabilityVerdict[]): boolean | null {
  if (verdicts.length === 0) return null;
  if (verdicts.some((v) => v.sustainable === false)) return false;   // a breach dominates
  if (verdicts.some((v) => v.sustainable === null)) return null;     // then absence
  return true;
}
```

Note the ordering inside `scaleInvariant`: a demonstrated breach at any tier
outranks a `NOT DEMONSTRATED` at another, because a proven failure is a
stronger fact than a missing measurement.

- [ ] **Step 4: Implement the three metrics**

Create `src/evaluation/replay/sustainability-metrics.ts` with `timeToFullExit`
(origins required to redeem 100% of NAV executing only same-transaction exits
the venues could honour, `null` if never), `venueStressContribution` (per venue,
the vault's share of that venue's utilization, time-weighted) and
`displayedVsRealizedGap` (advertised rate at deployment minus realized return
over the holding period). Add all three plus `policyViolations` to
`PolicyRunResult.replay` and populate them in the replay.

- [ ] **Step 5: Run tests**

Run: `pnpm test:unit sustainability`
Expected: PASS, 9 tests.

- [ ] **Step 6: Wire into the gate in the paper's order**

In `gates.ts`, restructure `runRegisteredGate` so the checks are emitted in
§11.5's order: **Demonstration → Completeness → Sustainability → Yield →
Price of unsustainability**. The sustainability check is scoped to SRCLA
(`policy.id === SRCLA_POLICY.id`); comparator verdicts are computed identically
and stored for Task 11's admissibility filter and Task 11b's counterexample
table. Emit one check per criterion so the report names which one failed.

Run: `pnpm test:unit registered-gates && pnpm exec tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/evaluation/kernel/sustainability.ts src/evaluation/replay/sustainability-metrics.ts src/evaluation/ test/unit/evaluation/sustainability.spec.ts
git commit -m "feat(eval): sustainability as the primary release criterion (P24-P26, P28)

Redeemability, capacity discipline, continuity and scale invariance,
scored per policy per tier behind a demonstration floor. A vault
holding idle cash passes every redeemability test and has proven
nothing, so capital-at-work below the floor reports NOT DEMONSTRATED
and never a pass - which is what v0.6's SRCLA would have reported at
the tier where it scored 1.000 coverage on a 0.000% return.

Scale invariance does not aggregate: B4 held 1.000 at 1M and 0.590 at
10M on the same era with an identical return."
```

---

### Task 11: Non-inferiority among sustainable policies, and the skill window (P21 part 2, P22, P27)

Measured on the calibration era, all reallocation skill in this universe is worth 18–43 bps/yr while failing to deploy costs 494. A superiority criterion over that window measures estimation noise. Replace it with non-inferiority **against sustainable comparators only**, publish every excluded policy's return as the measured price of unsustainability (P27), and compute the skill window that says whether either yield statement means anything.

The exclusion is the paper's positive evidence, not a technicality: B1 earned 39.16% at the 10k tier on `heldout-b` holding 0.878 coverage against a 0.99 floor. Under v0.6 that figure was recorded as SRCLA's failure to compete. Under v0.8 it is the headline.

**Files:**
- Modify: `src/evaluation/kernel/gates.ts`
- Modify: `src/evaluation/metrics/significance.ts` (add the one-sided non-inferiority test)
- Test: `test/unit/evaluation/non-inferiority.spec.ts` (create)

**Interfaces:**
- Consumes: `pairedHacTTest`, `movingBlockBootstrap` from `src/evaluation/metrics/significance.ts`.
- Produces:
  - `export const REGISTERED_NONINFERIORITY_MARGIN = 0.0043` (43 bps — the measured zero-cost skill window; **replace with the paper owner's registered δ before the freeze**)
  - `export function nonInferiorityTest(srclaReturns, baselineReturns, margin): PairedTestResult`
  - `export function skillWindow(atTier, sustainable): { windowApy: number; hindsightApy: number; bestBaselineApy: number; informative: boolean }`
  - `export interface Counterexample { policyId: string; tier: string; realizedNetApy: number; criterion: string; margin: number }`
  - `export function unsustainabilityPrice(atTier, srcla, verdicts): Counterexample[]`

Comparator admissibility comes from Task 10b's `sustainabilityAtTier`, not from a static `deployable` flag and not from a bare coverage comparison.

- [ ] **Step 1: Write the failing test**

```typescript
describe('P22: skill window governs the two yield criteria in OPPOSITE directions', () => {
  it('a narrow window makes a SUPERIORITY claim NOT INFORMATIVE', () => {
    const gate = runRegisteredGate(narrowWindowRun({ claimYieldSuperiority: true }), {});
    const sup = gate.checks.find((c) => c.name.startsWith('Superiority: yield'));
    expect(sup!.passed).toBeNull();
    expect(sup!.detail).toMatch(/NOT INFORMATIVE/);
  });

  it('a narrow window does NOT excuse the non-inferiority test', () => {
    const gate = runRegisteredGate(narrowWindowRun({ srclaWorseThanBaseline: true }), {});
    const ni = gate.checks.find((c) => c.name.startsWith('Non-inferior'));
    expect(ni!.passed).toBe(false);          // still scored, still fails
    expect(ni!.detail).toMatch(/weak evidence/);   // and disclosed
  });

  it('non-inferiority passes when SRCLA trails by less than the margin', () => {
    const t = nonInferiorityTest(seriesAt(0.0500), seriesAt(0.0510), 0.0043);
    expect(t.usable).toBe(true);
    expect(t.pValue).toBeLessThan(0.05);
  });

  it('non-inferiority fails when SRCLA trails by more than the margin', () => {
    const t = nonInferiorityTest(seriesAt(0.0000), seriesAt(0.2495), 0.0043);
    expect(t.pValue).toBeGreaterThan(0.05);
  });
});

describe('P27: an unsustainable policy is a counterexample, not a comparator', () => {
  it('excludes a coverage-breaching baseline from the yield comparison', () => {
    const gate = runRegisteredGate(runResult({
      srcla: { capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, realizedNetApy: 0.05 },
      b1: { capitalAtWorkFraction: 0.95, minStressedLiquidCoverage: 0.878, realizedNetApy: 0.3916 },
    }), {});
    expect(gate.comparisons.some((c) => c.baselineId === 'b1')).toBe(false);
  });

  it('publishes the excluded policy as a priced counterexample', () => {
    const out = runResult({
      srcla: { capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0, realizedNetApy: 0.05 },
      b1: { capitalAtWorkFraction: 0.95, minStressedLiquidCoverage: 0.878, realizedNetApy: 0.3916 },
    });
    const prices = unsustainabilityPrice(out.results, srclaOf(out), verdictsOf(out));
    const b1 = prices.find((p) => p.policyId === 'b1')!;
    expect(b1.realizedNetApy).toBeCloseTo(0.3916);
    expect(b1.criterion).toMatch(/S2/);
    expect(b1.margin).toBeCloseTo(0.99 - 0.878, 3);
  });

  it('reports NO SUSTAINABLE COMPARATOR when every baseline breached', () => {
    const gate = runRegisteredGate(runResult({
      srcla: { capitalAtWorkFraction: 0.92, minStressedLiquidCoverage: 1.0 },
      b0: { minStressedLiquidCoverage: 0.5, capitalAtWorkFraction: 0.9 },
      b1: { minStressedLiquidCoverage: 0.5, capitalAtWorkFraction: 0.9 },
      b2: { minStressedLiquidCoverage: 0.5, capitalAtWorkFraction: 0.9 },
      b3: { minStressedLiquidCoverage: 0.5, capitalAtWorkFraction: 0.9 },
      b4: { minStressedLiquidCoverage: 0.5, capitalAtWorkFraction: 0.9 },
    }), {});
    const ni = gate.checks.find((c) => c.name.startsWith('Non-inferior'));
    expect(ni!.passed).toBeNull();
    expect(ni!.detail).toMatch(/NO SUSTAINABLE COMPARATOR/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit non-inferiority`
Expected: FAIL — `nonInferiorityTest` does not exist.

- [ ] **Step 3: Implement**

`nonInferiorityTest` shifts the paired difference series by `+margin` and runs the existing one-sided HAC test against the null "SRCLA is worse by at least the margin". `skillWindow` computes `B5 − max(admissible baseline APY)`.

Wire into the gate: rename the "Outperforms every deployable baseline" check to **"Non-inferior to every sustainable baseline"**, filtered by Task 10b's verdicts; add a separate **"Superiority: yield"** check that is `null`/`NOT INFORMATIVE` when the window is within the margin, and only otherwise scored; add **"Price of unsustainability"** as a reported (never gating) section rendered from `unsustainabilityPrice`. Append the weak-evidence disclosure to the non-inferiority detail when the window is narrow.

**Three separations must hold.** (1) A narrow window makes superiority unprovable and non-inferiority *trivially easier*; converting both to `NOT INFORMATIVE` would excuse SRCLA from a test it can pass. (2) The skill window may never touch the demonstration, completeness or sustainability checks — yield can be beyond reach, redeemability cannot. (3) The counterexample table never gates; it reports.

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit non-inferiority` → PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/evaluation/kernel/gates.ts src/evaluation/metrics/significance.ts test/unit/evaluation/non-inferiority.spec.ts
git commit -m "feat(eval): non-inferiority plus the skill window (P21, P22)

Yield superiority becomes non-inferiority at a registered margin
against admissible comparators only. The skill window - bounded
hindsight minus the best admissible baseline - makes a superiority
claim NOT INFORMATIVE when it is narrow, and makes a non-inferiority
pass a disclosed weak result. Opposite directions, separate branches."
```

---

### Task 12: Run the forecast gate; unify the duplicate policy gate

`evaluateForecastGate` in `src/evaluation/release-gates.ts` has callers only in its own spec file, so half of what §11.5 has required since v0.4 has never been evaluated. `evaluatePolicyGate` in the same file is a weaker duplicate that the loopback operator endpoint uses — B0 only, a hardcoded Sharpe ≥ 0.5, one p-value — reinstating the optimiser/grader divergence P10 removed.

**Files:**
- Create: `src/evaluation/kernel/forecast-gate.ts`
- Modify: `src/evaluation/kernel/harness.ts`, `src/evaluation/report/render-markdown.ts`
- Modify: `src/evaluation/proposal-evaluator.ts` (re-point at `kernel/gates.ts`)
- Delete: `evaluateForecastGate` / `evaluatePolicyGate` from `src/evaluation/release-gates.ts`
- Test: `test/unit/evaluation/forecast-gate.spec.ts` (create)

**Interfaces:**
- Produces: `export function runForecastGate(artifact, labels, opts): RegisteredGateResult` with checks: per-venue achieved coverage vs target, Kupiec unconditional coverage, Christoffersen independence, label completeness, regime purity, availability-lag barrier, every registered grid point present, selection margin above the registered threshold, and artifact reproducibility including P23 completeness.

- [ ] **Step 1: Write the failing test**

```typescript
describe('§11.5 forecast gate', () => {
  it('FAILS when achieved coverage misses the target', () => {
    const g = runForecastGate(artifactWithCoverage(0.88), labels(), {});
    expect(g.checks.find((c) => c.name.startsWith('Per-venue coverage'))!.passed).toBe(false);
  });
  it('FAILS when the artifact is missing a field the policy reads (P23)', () => {
    const g = runForecastGate(artifactMissingPanel(), labels(), {});
    expect(g.checks.find((c) => c.name.startsWith('Artifact completeness'))!.passed).toBe(false);
  });
  it('FAILS when the selection margin is below the registered threshold', () => {
    const g = runForecastGate(artifactWithMargin(1.27e-7), labels(), {});
    expect(g.checks.find((c) => c.name.startsWith('Selection margin'))!.passed).toBe(false);
  });
  it('PASSES a well-formed registered artifact', () => {
    expect(runForecastGate(goodArtifact(), labels(), {}).pass).toBe(true);
  });
});
```

- [ ] **Step 2–4:** Run → FAIL → implement → PASS. Render the forecast gate in `SRCLA-REPORT.md` above the policy gate.

- [ ] **Step 5: Commit**

```bash
git add src/evaluation/kernel/forecast-gate.ts src/evaluation/ test/unit/evaluation/forecast-gate.spec.ts
git commit -m "feat(eval): run the forecast gate; one policy-gate definition (§11.5)

evaluateForecastGate had callers only in its own spec file, so half of
§11.5 was never evaluated. The weaker duplicate policy gate the
operator endpoint used is re-pointed at kernel/gates.ts."
```

---

### Task 13: Wire the pinned-prestate fork replay (§11.1)

`src/evaluation/fork-runner.ts` is a scaffold nothing calls, so the gate reports `NOT PRODUCED` and blocks unconditionally — regardless of everything above.

**Files:**
- Modify: `src/evaluation/fork-runner.ts`, `src/evaluation/kernel/harness.ts`
- Test: `test/integration/fork-replay.spec.ts` (create, gated on an env var)

**Interfaces:**
- Consumes: `ForkReplayResult` from `src/evaluation/kernel/gates.ts` (already defined).
- Produces: `export async function runForkReplays(plans, opts: { rpcUrl: string; prestateBlock: number }): Promise<ForkReplayResult[]>`.

- [ ] **Step 1:** Write an integration test gated on `NAVY_FORK_E2E=1` that pins one prestate block, replays one policy's proposed actions, and asserts `executed === true`.

- [ ] **Step 2:** Run without the env var → skipped. With Anvil forked from Base and a deployed vault → PASS.

- [ ] **Step 3:** Feed `forkResults` into `runRegisteredGate`. The check must still report `NOT PRODUCED` when no replay was supplied — absence stays failure.

- [ ] **Step 4: Commit**

```bash
git add src/evaluation/fork-runner.ts src/evaluation/kernel/harness.ts test/integration/fork-replay.spec.ts
git commit -m "feat(eval): wire the §11.1 pinned-prestate fork replay

The scaffold now has a caller, so the §11.5 completeness check can
verify rather than reporting NOT PRODUCED and blocking unconditionally."
```

---

### Task 14: Re-freeze and verify on the calibration era

**Files:** none created. This task runs commands and commits their output.

- [ ] **Step 1: Confirm the seal is intact**

```bash
cd srcla
grep -rn "allowSealed" src/ | grep -v spec
```
Expected: exactly two callers, both the registered run. If there is a third, stop and report it.

- [ ] **Step 2: Re-freeze**

```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm exec tsx scripts/freeze-artifact.ts
```
Expect ~1h. Confirm the artifact now contains `residualPanel`, `paybackSeconds`, `adjustmentRate`, `edgeWindowEffective`, a `selectionMargin` above `MIN_SELECTION_MARGIN`, and `selectionSubsample`.

- [ ] **Step 3: Verify the controller behaves as designed on calibration data**

Run the decision rule over the calibration era with the new artifact, at **all four tiers**, and assert:
- capital-at-work fraction above `REGISTERED_DEMONSTRATION_FLOOR` at every tier — without this nothing else counts (P25);
- stressed coverage at or above 0.99 at every tier *while* above that floor — this is the pairing v0.6 never achieved;
- rebalance count between 1 and ~50 (it did not churn);
- the hurdle-block census shows rotation blocks, not deployment blocks.

The second assertion is the whole experiment in miniature. v0.6 could hold coverage or deploy, never both; if the calibration run cannot do both either, stop and report that before touching a sealed era.

Record the numbers in the commit message. **These are calibration-era figures and must be labelled as such in any report — they are not evidence of held-out sustainability.**

- [ ] **Step 4: Confirm no regression in the script typecheck count**

```bash
pnpm typecheck:scripts 2>&1 | grep -cE "^scripts/.*error"
```
Expected: 51 or fewer. These are pre-existing.

- [ ] **Step 5: Full suite**

```bash
pnpm test:unit && pnpm test:integration && pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add config/registered-artifact.json
git commit -m "feat(srcla): re-freeze the registered artifact under v0.7

Fit on the calibration era only. Carries the residual panel, the
payback period, the adjustment rate and the effective edge window, and
records the selection margin and subsample. No sealed era was read."
```

---

## Self-Review Notes

**Spec coverage.** §3.5 → Tasks 6–7. §3.6 → Task 8. §3.7 → Tasks 9, 10, **10b**, 11, 12. §3.8 → Task 13. The re-freeze the spec implies → Task 14.

**Task order matters.** 10b (sustainability) must precede 11 (yield), because 11's comparator admissibility is 10b's verdict. Running them in the other order reproduces v0.6's mistake of deciding comparability from a static flag.

**Placeholder scan.** `REGISTERED_NONINFERIORITY_MARGIN`, `PAYBACK_SECONDS`, `ADJUSTMENT_RATE`, `SELECTION_SUBSAMPLE`, `MIN_SELECTION_MARGIN`, `REGISTERED_DEMONSTRATION_FLOOR`, `REGISTERED_MAX_EXIT_ORIGINS` and `REGISTERED_MAX_VENUE_STRESS_SHARE` ship with concrete values so the code runs and the tests are real. Each is a **registration** the paper owner must confirm (spec §6, items 1–8) before the artifact is cited, and each is recorded in `_registration` so the artifact testifies to what was used. That is deliberate, not a TODO. The demonstration floor is the most consequential of the eight: set it too low and "safe by inaction" passes, too high and the reserve itself fails the gate.

**Type consistency.** `ScoredPoint` (Task 6) is consumed by `resolveNearTie` (Task 7). `DecisionScore` (Task 7) populates the two new `SelectionLoss` fields declared in Task 6. `IrmParams` (Task 8) is local to the forecast layer. `admissibleComparators` (Task 9) feeds `skillWindow` (Task 11). `deploymentHurdle` comes from the controller plan's Task 4 and is used by `h3d` in Task 9. `ForkReplayResult` (Task 13) already exists in `gates.ts` and is not redefined.

**Expected outcome.** Even with all fifteen tasks complete, a registered run cannot PASS until a fresh era sealed after the v0.8 paper commit reaches the registered minimum length. On a three-venue universe the yield criterion will report a non-inferiority pass carrying a weak-evidence disclosure rather than a superiority result — the designed outcome of P22, not a shortfall.

**What a PASS would mean under v0.8.** Not that SRCLA earned the most. That SRCLA, with capital genuinely at work above the demonstration floor, stayed redeemable at every vault size across a sealed era, while the policies that outearned it did not — and that the report published exactly what that cost. No run has yet produced that pairing: v0.6 could hold coverage or deploy, never both.
