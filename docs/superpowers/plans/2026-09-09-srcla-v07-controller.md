# SRCLA v0.7 Controller Implementation Plan (1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SRCLA's binary, horizon-dependent movement gate with two dimensionally-correct hurdles evaluated per leg and executed by partial adjustment, and make the registered artifact carry every quantity the policy reads.

**Architecture:** `src/policy/steps/cost.ts` keeps cost *accounting* but loses the decision. A new `src/policy/steps/hurdles.ts` owns both decisions — a deployment hurdle (cost only) and a rotation hurdle (annualized differential vs amortized cost plus the standard error of the estimated edge). `decide.ts` stops discarding whole target vectors: it diffs into legs, tests each, re-checks feasibility of the survivors, and emits a partial adjustment toward them. `artifact.ts` and `freeze-artifact.ts` are fixed first because every measurement above is read through the artifact and the v0.6 one silently dropped its residual panel.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Prisma 5, Jest via `pnpm test:unit`, bigint money in USDC base units (6 dp), rates in WAD (18 dp).

**Spec:** `docs/superpowers/specs/2026-09-09-srcla-v07-movement-rule-design.md`
**Paper:** `docs/research/output/srcla-paper.md` v0.7 §9.1, amendments P13–P17 and P23.

**Follow-on:** `docs/superpowers/plans/2026-09-09-srcla-v07-evaluation.md` covers P18–P22 and the fork replay. It depends on this plan and must run after it.

## Global Constraints

- **Work only inside `srcla/`.** Contracts, `be/`, `fe/`, `expo-wallet/` are out of scope. The on-chain interface does not change.
- **Run tests with `pnpm test:unit`, never `npx jest`** — the raw invocation misses the ESM preset and fails five policy suites on `import.meta` (TS1343).
- **`pnpm exec tsc --noEmit` must be clean before every commit.**
- **Prisma 5 here**, not the Prisma 7 used in `be/`.
- **Imports use `.js` specifiers** (`from '../types.js'`) even for `.ts` sources — this is an ESM package.
- **Money is `bigint` USDC base units (6 dp). Rates are WAD (18 dp).** Never mix.
- **`SECONDS_PER_YEAR` is `31_536_000n`** (365 days), the value `src/policy/steps/forecast.ts:4` uses. `src/protocols/math.ts:4` exports a *different* value (`31557600n`, 365.25 days) for protocol accrual. Policy-layer code must use the 365-day constant so annualization matches the labels the artifact was fit on. Do not import the protocols one into `src/policy/`.
- **Keep policy modules decorator-free and pure** — no I/O, no `Date.now()`, no unseeded randomness. This is what makes them unit-testable.
- **Do not touch `src/evaluation/quarantined/` or `quarantine/`.**

---

### Task 1: Artifact carries what the policy reads (P23)

The v0.6 registered artifact records `_registration.residualPanelBuilt: true` and contains no `residualPanel`. Two independent leaks: `artifactJsonFor()` never serializes it, and `parseArtifact` never maps it. So `portfolioResidualQuantileFor` silently used the frozen scalar, P2 could not change a ranking, and H6/H7 made byte-identical decisions. Everything later in this plan is measured through the artifact, so this is first.

**Files:**
- Modify: `src/policy/artifact.ts` (the `body` object in `parseArtifact`, ~line 150)
- Modify: `scripts/freeze-artifact.ts` (`artifactJsonFor`, ~line 302; `kBaseArtifact`, ~line 328)
- Modify: `src/policy/types.ts` (add three registered fields to `PolicyArtifact`)
- Test: `test/unit/policy/artifact-completeness.spec.ts` (create)

**Interfaces:**
- Consumes: `PolicyArtifact`, `ResidualPanel` from `src/policy/types.ts`; `parseArtifact` from `src/policy/artifact.ts`.
- Produces: `PolicyArtifact` gains `residualPanel` as a *required* field on a registered artifact, plus `paybackSeconds: number`, `adjustmentRate: number`, `edgeWindowEffective: number`. `parseArtifact(raw, { requireProvisional })` throws on a registered artifact missing any of them.

- [ ] **Step 1: Write the failing test**

Create `test/unit/policy/artifact-completeness.spec.ts`:

```typescript
import { parseArtifact } from '../../../src/policy/artifact.js';

/** A minimal REGISTERED artifact body, every field present. */
function registeredRaw(): Record<string, unknown> {
  return {
    policyVersion: 6,
    horizonSeconds: 1209600,
    coverageTarget: 0.99,
    method: 'rolling',
    methodParams: { windowObservations: 24 },
    residualQuantileWadByMarket: { 'a': '-100000000000000' },
    portfolioResidualQuantileWad: '-100000000000000',
    cashResidualQuantileWadByMarket: { 'a': '-100000000000000' },
    cashLowerBoundQuantileWad: '-100000000000000000',
    minObservations: 30,
    availabilityLagSeconds: 3600,
    noTradeBandK: 1,
    paybackSeconds: 2592000,
    adjustmentRate: 1,
    edgeWindowEffective: 24,
    pinnedConfigDigests: { 'a': '0xdeadbeef' },
    configDigest: 'registered-test',
    residualPanel: { marketIds: ['a'], originsSeconds: [1, 2], rows: [['-1'], ['1']] },
  };
}

describe('registered artifact completeness (P23)', () => {
  it('parses a complete registered artifact and preserves the panel', () => {
    const a = parseArtifact(registeredRaw(), { requireProvisional: false });
    expect(a.residualPanel).toBeDefined();
    expect(a.residualPanel!.marketIds).toEqual(['a']);
    expect(a.residualPanel!.rows).toEqual([[-1n], [1n]]);
    expect(a.paybackSeconds).toBe(2592000);
    expect(a.adjustmentRate).toBe(1);
    expect(a.edgeWindowEffective).toBe(24);
  });

  it('REFUSES a registered artifact with no residual panel', () => {
    const raw = registeredRaw();
    delete raw['residualPanel'];
    expect(() => parseArtifact(raw, { requireProvisional: false }))
      .toThrow(/residualPanel/);
  });

  it('REFUSES a registered artifact with no payback period', () => {
    const raw = registeredRaw();
    delete raw['paybackSeconds'];
    expect(() => parseArtifact(raw, { requireProvisional: false }))
      .toThrow(/paybackSeconds/);
  });

  it('the artifact hash covers the panel', () => {
    const a = parseArtifact(registeredRaw(), { requireProvisional: false });
    const raw2 = registeredRaw();
    (raw2['residualPanel'] as { rows: string[][] }).rows = [['-2'], ['1']];
    const b = parseArtifact(raw2, { requireProvisional: false });
    expect(b.artifactHash).not.toEqual(a.artifactHash);
  });

  it('still allows a PROVISIONAL artifact to omit the panel', () => {
    const raw = registeredRaw();
    delete raw['residualPanel'];
    delete raw['paybackSeconds'];
    delete raw['adjustmentRate'];
    delete raw['edgeWindowEffective'];
    raw['_provisional'] = 'bootstrap; results not citable';
    const a = parseArtifact(raw, { requireProvisional: true });
    expect(a.residualPanel).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit artifact-completeness`
Expected: FAIL — `residualPanel` is `undefined` after parsing, and no field is required.

- [ ] **Step 3: Add the three registered fields to the type**

In `src/policy/types.ts`, inside `PolicyArtifact`, after `noTradeBandK`:

```typescript
  /**
   * §9.1's registered payback period, in seconds. A move must repay its own
   * movement cost within this window at the conservative bound. Registered
   * jointly with `noTradeBandK` and `adjustmentRate` by the turnover-vs-return
   * sweep (paper P15, P18).
   */
  paybackSeconds: number;
  /** §9.1.4's partial-adjustment rate lambda, in (0, 1]. */
  adjustmentRate: number;
  /**
   * HAC-adjusted effective sample size of the estimation window, used as the
   * denominator of the edge standard error (§9.1.3). Overlapping horizons make
   * the nominal observation count an overstatement, so this is NOT
   * `methodParams.windowObservations`.
   */
  edgeWindowEffective: number;
```

- [ ] **Step 4: Make the loader require them**

In `src/policy/artifact.ts`, inside `parseArtifact`, add a panel parser above the `body` object:

```typescript
function parsePanel(raw: unknown, required: boolean): ResidualPanel | undefined {
  if (raw === undefined || raw === null) {
    if (required) {
      throw new Error(
        'registered artifact is missing residualPanel: P2 and P9.1.3 both read it, and a ' +
        'silent fallback to portfolioResidualQuantileWad is the v0.6 defect P23 removes',
      );
    }
    return undefined;
  }
  const p = raw as { marketIds: string[]; originsSeconds: number[]; rows: string[][] };
  return {
    marketIds: p.marketIds,
    originsSeconds: p.originsSeconds,
    rows: p.rows.map((r) => r.map((v) => BigInt(v))),
  };
}
```

Then in `body`, replacing nothing and adding after `noTradeBandK`:

```typescript
    ...(requireProvisional
      ? {
          paybackSeconds: (raw['paybackSeconds'] as number) ?? 0,
          adjustmentRate: (raw['adjustmentRate'] as number) ?? 1,
          edgeWindowEffective: (raw['edgeWindowEffective'] as number) ?? 1,
        }
      : {
          paybackSeconds: need(raw['paybackSeconds'], 'paybackSeconds') as number,
          adjustmentRate: need(raw['adjustmentRate'], 'adjustmentRate') as number,
          edgeWindowEffective: need(raw['edgeWindowEffective'], 'edgeWindowEffective') as number,
        }),
    ...(parsePanel(raw['residualPanel'], !requireProvisional) !== undefined
      ? { residualPanel: parsePanel(raw['residualPanel'], !requireProvisional)! }
      : {}),
```

`requireProvisional` is `true` only for the bootstrap artifact, so a registered artifact takes the strict branch. `computeArtifactHash(body)` now sees the panel because it is part of `body`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:unit artifact-completeness`
Expected: PASS, 5 tests.

- [ ] **Step 6: Make the freezer write what the loader now demands**

In `scripts/freeze-artifact.ts`, inside `artifactJsonFor`, after `noTradeBandK: k,`:

```typescript
      paybackSeconds: PAYBACK_SECONDS,
      adjustmentRate: ADJUSTMENT_RATE,
      edgeWindowEffective: effectiveWindow(chosen.row.point, horizon),
      ...(panel !== undefined
        ? {
            residualPanel: {
              marketIds: panel.marketIds,
              originsSeconds: panel.originsSeconds,
              rows: panel.rows.map((r) => r.map((v) => v.toString())),
            },
          }
        : {}),
```

Add near the top of the file:

```typescript
/** Registered until the P18 sweep resolves them (see the plan's open registrations). */
const PAYBACK_SECONDS = 30 * 24 * 60 * 60;
const ADJUSTMENT_RATE = 1;

/**
 * Overlapping horizons mean W consecutive labels carry far less than W
 * independent observations. The registered deflation is the Newey-West style
 * ratio of the window to the overlap factor, floored at 1.
 */
function effectiveWindow(point: { methodParams: Record<string, number>; horizonSeconds: number }, horizonSeconds: number): number {
  const w = point.methodParams['windowObservations'] ?? 24;
  const overlap = Math.max(1, horizonSeconds / 3600);
  return Math.max(1, w / overlap);
}
```

Then simplify `kBaseArtifact` — the panel now arrives through the JSON, so the manual spread is dead:

```typescript
    const kBaseArtifact: PolicyArtifact = parseArtifact(artifactJsonFor(1.0), { requireProvisional: false });
```

- [ ] **Step 7: Verify the round trip**

Add to `test/unit/policy/artifact-completeness.spec.ts`:

```typescript
  it('a panel round-trips through string serialization without loss', () => {
    const raw = registeredRaw();
    (raw['residualPanel'] as { rows: string[][] }).rows = [
      ['-106084734766695'], ['51437739289824'],
    ];
    const a = parseArtifact(raw, { requireProvisional: false });
    expect(a.residualPanel!.rows[0]![0]).toBe(-106084734766695n);
    expect(a.residualPanel!.rows[1]![0]).toBe(51437739289824n);
  });
```

Run: `pnpm test:unit artifact-completeness` → PASS, 6 tests.
Run: `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/policy/types.ts src/policy/artifact.ts scripts/freeze-artifact.ts test/unit/policy/artifact-completeness.spec.ts
git commit -m "fix(policy): registered artifact carries every field the policy reads (P23)

The v0.6 artifact recorded residualPanelBuilt: true and carried no
panel - artifactJsonFor never serialized it and parseArtifact never
mapped it - so P2's weight-dependent portfolio quantile and P8's
dispersion silently used a frozen scalar. A registered artifact now
fails to load rather than degrading, and the hash covers the panel."
```

---

### Task 2: Movement cost attributed by leg (P14)

`movementCostBase` charges `impactBps`, `slippageBps` and `mevBps` against the whole notional, including lending deposits and withdrawals. A supply or withdraw executes at the protocol index: no quoted price, no spread, no sandwich surface. The rate consequence of size is already priced by §6.1's post-deposit curve, so charging bps as well double-counts it. Those two terms belong to the §9.4 Uniswap route.

Measured effect: `C_move` on a rebalance falls from ~8 bps of notional to gas-only.

**Files:**
- Modify: `src/policy/steps/cost.ts` (`movementCostBase`, ~line 122–205)
- Test: `test/unit/policy/cost.spec.ts` (extend)

**Interfaces:**
- Consumes: `Move` (`{ adapter, amountBase, kind: 'deploy'|'divest'|'harvest' }`), `CostParams`, `DecisionInput` from Task 0 state (unchanged).
- Produces: `movementCostBase(input, moves, p)` unchanged in signature. `terms.impact` and `terms.slippageMev` are now computed on harvest notional only. All eleven `MOVE_COST_TERMS` names remain.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/policy/cost.spec.ts`:

```typescript
describe('P14: movement cost attributed by leg', () => {
  it('charges no impact or slippage to a lending deposit', () => {
    const moves = [{ adapter: 'a', amountBase: 1_000_000_000_000n, kind: 'deploy' as const }];
    const { terms } = movementCostBase(baseInput(), moves, baseParams());
    expect(terms['impact']).toBe(0n);
    expect(terms['slippageMev']).toBe(0n);
    expect(terms['entry']).toBeGreaterThan(0n);
  });

  it('charges no impact or slippage to a lending withdrawal', () => {
    const moves = [{ adapter: 'a', amountBase: 1_000_000_000_000n, kind: 'divest' as const }];
    const { terms } = movementCostBase(baseInput(), moves, baseParams());
    expect(terms['impact']).toBe(0n);
    expect(terms['slippageMev']).toBe(0n);
    expect(terms['exit']).toBeGreaterThan(0n);
  });

  it('still charges impact and slippage to a harvest swap', () => {
    const moves = [{ adapter: 'a', amountBase: 1_000_000_000_000n, kind: 'harvest' as const }];
    const { terms } = movementCostBase(baseInput(), moves, baseParams());
    expect(terms['impact']).toBeGreaterThan(0n);
    expect(terms['slippageMev']).toBeGreaterThan(0n);
  });

  it('a lending plan and a harvest plan of equal notional differ by exactly impact + slippage', () => {
    const n = 1_000_000_000_000n;
    const lend = movementCostBase(baseInput(), [{ adapter: 'a', amountBase: n, kind: 'deploy' }], baseParams());
    const harv = movementCostBase(baseInput(), [{ adapter: 'a', amountBase: n, kind: 'harvest' }], baseParams());
    const bpsPart = harv.terms['impact']! + harv.terms['slippageMev']!;
    expect(bpsPart).toBeGreaterThan(0n);
    // the harvest also carries approve/reset + swap gas; isolate the bps terms
    expect(lend.terms['impact']! + lend.terms['slippageMev']!).toBe(0n);
  });
});
```

If `baseInput()` and `baseParams()` do not already exist in that file, reuse whatever fixture builders the existing `cost.spec.ts` tests use; do not invent new ones.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit policy/cost`
Expected: FAIL — `terms.impact` is non-zero for a deploy.

- [ ] **Step 3: Implement the attribution**

In `src/policy/steps/cost.ts`, replace the single `bpsOf` helper and the two term entries:

```typescript
  // P14 - impact, slippage and MEV are properties of the §9.4 Uniswap route.
  // A lending supply/withdraw executes at the protocol index: there is no
  // quoted price to slip against and no sandwich surface, and the rate effect
  // of size is already priced by §6.1's post-deposit curve. Charging bps here
  // as well both invents a cost and double-counts that curve.
  const swapNotional = moves
    .filter((m) => m.kind === 'harvest')
    .reduce((s, m) => s + m.amountBase, 0n);
  const bpsOfSwap = (bps: number) => (swapNotional * BigInt(bps)) / 10_000n;
```

and in `terms`:

```typescript
    impact: bpsOfSwap(p.impactBps),
    slippageMev: bpsOfSwap(p.slippageBps + p.mevBps),
```

Leave every other term, `C_failure`'s `executionSoFar` basis, and `C_buffer`'s ordering untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit policy/cost`
Expected: PASS. Some pre-existing assertions in `cost.spec.ts` and `cost-turnover-trim.spec.ts` may encode the old 8 bps figure. Where they do, update the *expected number* and add a one-line comment naming P14 — do not weaken an assertion into a range.

Run: `pnpm test:unit` (full suite) and fix any other suite that pinned the old cost.

- [ ] **Step 5: Commit**

```bash
git add src/policy/steps/cost.ts test/unit/policy/
git commit -m "fix(policy): charge impact and slippage to the swap leg only (P14)

A lending deposit or withdrawal executes at the protocol index - no
quoted price, no spread, no sandwich surface - and the rate effect of
size is already priced by the post-deposit curve. Charging 8 bps of
notional to it invented a cost and double-counted that curve."
```

---

### Task 3: The two hurdles (P13, P15, P16)

Replace the horizon-return comparison and the `k*sigma` band with two rules stated in annualized rate units. This is the load-bearing change: at the v0.6 artifact the old rule demanded 7.74% APY before idle USDC could be deployed, against venue means of 4.86–6.13%.

**Files:**
- Create: `src/policy/steps/hurdles.ts`
- Test: `test/unit/policy/hurdles.spec.ts` (create)
- Modify: `src/policy/steps/cost.ts` — delete `noTradeBandBase` (moved), keep `movementCostBase`, `reversalChurnBase`, `signedDeltas` and the brakes.

**Interfaces:**
- Consumes: `movementCostBase` from `src/policy/steps/cost.ts`; `rateAt` from `src/policy/steps/simulate.ts`; `PolicyArtifact`, `RateCurve`, `DecisionInput` from `src/policy/types.ts`.
- Produces:
  - `export interface LegVerdict { kind: 'deploy' | 'rotate'; marketId: string; fromMarketId: string | null; amountBase: bigint; clears: boolean; edgeWad: bigint; hurdleWad: bigint; costHurdleWad: bigint; significanceWad: bigint; reason: string }`
  - `export function annualLowerBound(curve: RateCurve, artifact: PolicyArtifact, marketId: string, xBase: bigint): bigint`
  - `export function edgeStandardErrorWad(artifact: PolicyArtifact, i: string, j: string): bigint`
  - `export function deployClears(input, artifact, curve, marketId, amountBase, p): LegVerdict`
  - `export function rotateClears(input, artifact, curveTo, curveFrom, toId, fromId, amountBase, p): LegVerdict`

- [ ] **Step 1: Write the failing test**

Create `test/unit/policy/hurdles.spec.ts`:

```typescript
import { annualLowerBound, deployClears, rotateClears } from '../../../src/policy/steps/hurdles.js';

const WAD = 10n ** 18n;
const pct = (x: number) => BigInt(Math.round(x * 1e16)); // percent -> WAD fraction

describe('P13/P15/P16 hurdles', () => {
  it('deploys idle cash into a 5% venue at realistic gas', () => {
    const v = deployClears(idleInput(), artifact({ payback: 30 }), flatCurve(pct(5)), 'a', 1_000_000_000_000n, params());
    expect(v.clears).toBe(true);
  });

  it('refuses to deploy into a venue whose conservative bound is negative', () => {
    const v = deployClears(idleInput(), artifact({ payback: 30 }), flatCurve(pct(0.01)), 'a', 1_000_000_000_000n, params());
    expect(v.clears).toBe(false);
  });

  it('the deployment decision does not depend on the forecast horizon', () => {
    const amounts = 1_000_000_000_000n;
    const at = (h: number) =>
      deployClears(idleInput(), artifact({ payback: 30, horizonSeconds: h }), flatCurve(pct(5)), 'a', amounts, params()).clears;
    expect(at(86400)).toBe(at(604800));
    expect(at(604800)).toBe(at(1209600));
  });

  it('the rotation decision does not depend on the forecast horizon', () => {
    const at = (h: number) =>
      rotateClears(
        deployedInput(), artifact({ payback: 30, horizonSeconds: h }),
        flatCurve(pct(9)), flatCurve(pct(4)), 'a', 'b', 1_000_000_000_000n, params(),
      ).clears;
    expect(at(86400)).toBe(at(604800));
    expect(at(604800)).toBe(at(1209600));
  });

  it('a 5pp differential clears the rotation hurdle; a 1bp one does not', () => {
    const big = rotateClears(deployedInput(), artifact({ payback: 30 }), flatCurve(pct(9)), flatCurve(pct(4)), 'a', 'b', 1_000_000_000_000n, params());
    const tiny = rotateClears(deployedInput(), artifact({ payback: 30 }), flatCurve(pct(4.01)), flatCurve(pct(4)), 'a', 'b', 1_000_000_000_000n, params());
    expect(big.clears).toBe(true);
    expect(tiny.clears).toBe(false);
  });

  it('the rotation hurdle falls as movement cost falls', () => {
    const cheap = rotateClears(deployedInput(), artifact({ payback: 30 }), flatCurve(pct(9)), flatCurve(pct(4)), 'a', 'b', 1_000_000_000_000n, params({ gasPerAction: 1n }));
    const dear = rotateClears(deployedInput(), artifact({ payback: 30 }), flatCurve(pct(9)), flatCurve(pct(4)), 'a', 'b', 1_000_000_000_000n, params({ gasPerAction: 10_000_000n }));
    expect(cheap.costHurdleWad).toBeLessThan(dear.costHurdleWad);
  });

  it('the significance hurdle shrinks as the effective window grows', () => {
    const narrow = rotateClears(deployedInput(), artifact({ payback: 30, edgeWindowEffective: 4 }), flatCurve(pct(9)), flatCurve(pct(4)), 'a', 'b', 1_000_000_000_000n, params());
    const wide = rotateClears(deployedInput(), artifact({ payback: 30, edgeWindowEffective: 400 }), flatCurve(pct(9)), flatCurve(pct(4)), 'a', 'b', 1_000_000_000_000n, params());
    expect(wide.significanceWad).toBeLessThan(narrow.significanceWad);
  });

  it('annualLowerBound subtracts the horizon quantile ANNUALISED', () => {
    // q = -1.061e-4 over 1 day annualises to -3.87pp; over 14 days to -0.277pp
    const oneDay = annualLowerBound(flatCurve(pct(5)), artifact({ horizonSeconds: 86400 }), 'a', 0n);
    const fortnight = annualLowerBound(flatCurve(pct(5)), artifact({ horizonSeconds: 1209600 }), 'a', 0n);
    expect(fortnight).toBeGreaterThan(oneDay);
  });
});
```

Write `artifact()`, `flatCurve()`, `idleInput()`, `deployedInput()` and `params()` as local fixture builders at the top of the file. `artifact()` must return a `PolicyArtifact` whose `residualQuantileWadByMarket` is `{ a: -106084734766695n, b: -51437739289824n }` — the measured calibration values — and whose `residualPanel` has at least four rows so the correlation term is defined.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit policy/hurdles`
Expected: FAIL — `src/policy/steps/hurdles.js` does not exist.

- [ ] **Step 3: Implement the module**

Create `src/policy/steps/hurdles.ts`:

```typescript
/**
 * §9.1's two movement hurdles, both in ANNUALISED rate units (WAD).
 *
 * v0.4-v0.6 compared a horizon-return gain against `max(C_move, k*sigma)`.
 * That made the economic threshold a function of the forecast horizon:
 * measured dispersion is near-flat in H while expected horizon return is
 * linear, so the implied hurdle ran 7.74% APY at H=1d and 0.66% at H=14d.
 * It also charged forecast dispersion twice - once in the objective's lower
 * bound and again as the band - and it treated deploying idle cash as though
 * it were a round trip. P13, P15 and P16 fix all three.
 *
 * PURE: no I/O, no clock, no randomness.
 * UNITS: rates WAD (18 dp); money bigint USDC base units (6 dp).
 */
import { movementCostBase, type CostParams, type Move } from './cost.js';
import { rateAt } from './simulate.js';
import type { DecisionInput, PolicyArtifact, RateCurve } from '../types.js';

const WAD = 10n ** 18n;
/** 365 days. Matches steps/forecast.ts, NOT protocols/math.ts's 365.25. */
const SECONDS_PER_YEAR = 31_536_000n;

export interface LegVerdict {
  kind: 'deploy' | 'rotate';
  marketId: string;
  fromMarketId: string | null;
  amountBase: bigint;
  clears: boolean;
  /** annualised: the bound for a deploy, the differential for a rotation */
  edgeWad: bigint;
  hurdleWad: bigint;
  costHurdleWad: bigint;
  significanceWad: bigint;
  reason: string;
}

/**
 * §7's conservative bound expressed as an ANNUAL rate. The artifact's
 * quantile is a horizon-return quantile, so annualising it is what makes the
 * hurdle horizon-free: a bound that subtracts a near-constant from a linearly
 * growing quantity is not comparable across horizons until both are annual.
 */
export function annualLowerBound(
  curve: RateCurve,
  artifact: PolicyArtifact,
  marketId: string,
  xBase: bigint,
): bigint {
  const q = artifact.residualQuantileWadByMarket[marketId] ?? 0n;
  if (q > 0n) throw new Error(`residual quantile for ${marketId} must be <= 0, got ${q}`);
  const annualQ = (q * SECONDS_PER_YEAR) / BigInt(artifact.horizonSeconds);
  return rateAt(curve, xBase) + annualQ;
}

/** Sample standard deviation of one venue's residual column, in WAD. */
function columnSigma(artifact: PolicyArtifact, marketId: string): bigint {
  const panel = artifact.residualPanel;
  if (panel === undefined) return 0n;
  const k = panel.marketIds.indexOf(marketId);
  if (k < 0 || panel.rows.length < 2) return 0n;
  const col = panel.rows.map((r) => r[k] ?? 0n);
  const n = BigInt(col.length);
  const mean = col.reduce((s, v) => s + v, 0n) / n;
  let acc = 0n;
  for (const v of col) acc += ((v - mean) * (v - mean)) / WAD;
  return isqrt((acc / (n - 1n)) * WAD);
}

/** Pearson correlation of two residual columns, in WAD. */
function columnCorr(artifact: PolicyArtifact, i: string, j: string): bigint {
  const panel = artifact.residualPanel;
  if (panel === undefined) return 0n;
  const a = panel.marketIds.indexOf(i);
  const b = panel.marketIds.indexOf(j);
  if (a < 0 || b < 0 || panel.rows.length < 2) return 0n;
  const ca = panel.rows.map((r) => r[a] ?? 0n);
  const cb = panel.rows.map((r) => r[b] ?? 0n);
  const n = BigInt(ca.length);
  const ma = ca.reduce((s, v) => s + v, 0n) / n;
  const mb = cb.reduce((s, v) => s + v, 0n) / n;
  let cov = 0n, va = 0n, vb = 0n;
  for (let t = 0; t < ca.length; t++) {
    cov += ((ca[t]! - ma) * (cb[t]! - mb)) / WAD;
    va += ((ca[t]! - ma) * (ca[t]! - ma)) / WAD;
    vb += ((cb[t]! - mb) * (cb[t]! - mb)) / WAD;
  }
  const denom = isqrt(va * WAD) * isqrt(vb * WAD);
  if (denom === 0n) return 0n;
  return (cov * WAD * WAD) / denom;
}

/** Integer square root for non-negative bigints (Newton). */
function isqrt(v: bigint): bigint {
  if (v <= 0n) return 0n;
  let x = v, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + v / x) / 2n; }
  return x;
}

/**
 * §9.1.3's SE[dl_ij], annualised. This is the sampling error of an ESTIMATED
 * DIFFERENCE, not the predictive quantile of one horizon outcome - the two
 * answer different questions and v0.6 used the second where the first belongs.
 */
export function edgeStandardErrorWad(artifact: PolicyArtifact, i: string, j: string): bigint {
  const si = columnSigma(artifact, i);
  const sj = columnSigma(artifact, j);
  const rho = columnCorr(artifact, i, j);
  const varDiff = (si * si) / WAD + (sj * sj) / WAD - (2n * rho * si * sj) / (WAD * WAD);
  const w = BigInt(Math.max(1, Math.round(artifact.edgeWindowEffective)));
  const horizonSe = isqrt(((varDiff > 0n ? varDiff : 0n) / w) * WAD);
  return (horizonSe * SECONDS_PER_YEAR) / BigInt(artifact.horizonSeconds);
}

function lendingCost(input: DecisionInput, moves: Move[], p: CostParams): bigint {
  return movementCostBase(input, moves, p).totalBase;
}

/**
 * §9.1.2 - idle capital deploys when its conservative bound repays the
 * movement cost within the registered payback period. NO dispersion term:
 * the bound already carries it, and the counterfactual (idle) is certain.
 */
export function deployClears(
  input: DecisionInput,
  artifact: PolicyArtifact,
  curve: RateCurve,
  marketId: string,
  amountBase: bigint,
  p: CostParams,
): LegVerdict {
  const ell = annualLowerBound(curve, artifact, marketId, amountBase);
  const cost = lendingCost(input, [{ adapter: marketId, amountBase, kind: 'deploy' }], p);
  const gain = (ell * BigInt(artifact.paybackSeconds) * amountBase) / (SECONDS_PER_YEAR * WAD);
  const costHurdleWad = amountBase === 0n ? 0n
    : (cost * WAD * SECONDS_PER_YEAR) / (amountBase * BigInt(artifact.paybackSeconds));
  const clears = gain > cost;
  return {
    kind: 'deploy', marketId, fromMarketId: null, amountBase, clears,
    edgeWad: ell, hurdleWad: costHurdleWad, costHurdleWad, significanceWad: 0n,
    reason: clears ? 'DEPLOY_CLEARS' : `DEPLOY_BLOCKED: bound ${ell} <= hurdle ${costHurdleWad}`,
  };
}

/**
 * §9.1.3 - a rotation clears when the annualised differential exceeds the
 * amortised round-trip cost plus k standard errors of the estimated edge.
 */
export function rotateClears(
  input: DecisionInput,
  artifact: PolicyArtifact,
  curveTo: RateCurve,
  curveFrom: RateCurve,
  toId: string,
  fromId: string,
  amountBase: bigint,
  p: CostParams,
): LegVerdict {
  const edge = annualLowerBound(curveTo, artifact, toId, amountBase)
    - annualLowerBound(curveFrom, artifact, fromId, 0n);
  const cost = lendingCost(input, [
    { adapter: fromId, amountBase, kind: 'divest' },
    { adapter: toId, amountBase, kind: 'deploy' },
  ], p);
  const costHurdleWad = amountBase === 0n ? 0n
    : (cost * WAD * SECONDS_PER_YEAR) / (amountBase * BigInt(artifact.paybackSeconds));
  const kFixed = BigInt(Math.round(artifact.noTradeBandK * 1_000_000));
  const significanceWad = (edgeStandardErrorWad(artifact, toId, fromId) * kFixed) / 1_000_000n;
  const hurdleWad = costHurdleWad + significanceWad;
  const clears = edge > hurdleWad;
  return {
    kind: 'rotate', marketId: toId, fromMarketId: fromId, amountBase, clears,
    edgeWad: edge, hurdleWad, costHurdleWad, significanceWad,
    reason: clears ? 'ROTATE_CLEARS' : `ROTATE_BLOCKED: edge ${edge} <= hurdle ${hurdleWad}`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit policy/hurdles`
Expected: PASS, 8 tests.

- [ ] **Step 5: Delete the superseded band**

Remove `noTradeBandBase` from `src/policy/steps/cost.ts` and its import of `portfolioResidualQuantileFor`. `portfolio-quantile.ts` stays — §8.2's objective still uses it; only §9.1's use is gone.

Run: `pnpm exec tsc --noEmit` and fix the callers it names (they are `costGate` and its tests; Task 4 replaces `costGate` entirely, so for now leave a compile-passing stub that throws `new Error('costGate superseded by hurdles.ts; see Task 4')` and delete the tests that exercised the band).

- [ ] **Step 6: Commit**

```bash
git add src/policy/steps/hurdles.ts src/policy/steps/cost.ts test/unit/policy/hurdles.spec.ts
git commit -m "feat(policy): two movement hurdles in annualised units (P13, P15, P16)

Deployment is gated on cost alone; rotation on an annualised
differential against a registered payback period plus k standard
errors of the ESTIMATED EDGE. Both sides are annual rates, so neither
rule reads horizonSeconds - which is what made the v0.6 hurdle swing
from 7.74% APY at H=1d to 0.66% at H=14d."
```

---

### Task 4: Per-leg evaluation and partial adjustment (P17)

`decide.ts` currently calls one `costGate` over the whole target and returns `hold` when it fails, discarding everything. That structure produced 1 and 0 rebalances on the two v0.6 held-out eras. Replace it with per-leg evaluation, a feasibility re-check on the survivors, and a partial adjustment toward them.

**Files:**
- Create: `src/policy/steps/legs.ts`
- Modify: `src/policy/decide.ts` (~lines 336–352, the `gate` block)
- Modify: `src/policy/types.ts` (`CostGateResult` gains `legs`)
- Test: `test/unit/policy/legs.spec.ts` (create), `test/unit/policy/decide.spec.ts` (extend)

**Interfaces:**
- Consumes: `LegVerdict`, `deployClears`, `rotateClears` from Task 3; `stressedCoverage` from `src/policy/steps/coverage.ts`; `optimize`'s feasibility predicate.
- Produces:
  - `export function planLegs(current, target, input, artifact, curves, p): LegVerdict[]`
  - `export function survivingTarget(current, target, verdicts): Map<string, bigint>`
  - `export function partialAdjust(current, sub, lambda: number): Map<string, bigint>`
  - `CostGateResult` gains `legs: LegVerdict[]`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/policy/legs.spec.ts`:

```typescript
import { planLegs, survivingTarget, partialAdjust } from '../../../src/policy/steps/legs.js';

describe('P17 per-leg evaluation and partial adjustment', () => {
  it('executes the leg that clears when another leg does not', () => {
    const current = new Map([['a', 0n], ['b', 1_000_000_000n]]);
    const target = new Map([['a', 5_000_000_000n], ['b', 0n]]);
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    const clearing = verdicts.filter((v) => v.clears);
    expect(clearing.length).toBeGreaterThan(0);
    const sub = survivingTarget(current, target, verdicts);
    expect(sub.get('a')).toBeGreaterThan(0n);
  });

  it('NEVER returns the empty target when at least one leg clears', () => {
    const current = new Map([['a', 0n], ['b', 0n]]);
    const target = new Map([['a', 5_000_000_000n], ['b', 1n]]);
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    const sub = survivingTarget(current, target, verdicts);
    expect([...sub.values()].some((v) => v > 0n)).toBe(true);
  });

  it('returns the current position unchanged when no leg clears', () => {
    const current = new Map([['a', 1_000_000_000n]]);
    const target = new Map([['a', 1_000_000_001n]]); // 1 base unit: cannot repay gas
    const verdicts = planLegs(current, target, input(), artifact(), curves(), params());
    expect(verdicts.every((v) => !v.clears)).toBe(true);
    expect(survivingTarget(current, target, verdicts)).toEqual(current);
  });

  it('partialAdjust at lambda=1 reaches the sub-target exactly', () => {
    const cur = new Map([['a', 0n], ['b', 1_000_000n]]);
    const sub = new Map([['a', 4_000_000n], ['b', 0n]]);
    expect(partialAdjust(cur, sub, 1)).toEqual(sub);
  });

  it('partialAdjust at lambda=0.5 moves halfway and conserves total', () => {
    const cur = new Map([['a', 0n], ['b', 1_000_000n]]);
    const sub = new Map([['a', 1_000_000n], ['b', 0n]]);
    const out = partialAdjust(cur, sub, 0.5);
    expect(out.get('a')).toBe(500_000n);
    expect(out.get('b')).toBe(500_000n);
    const totalBefore = [...cur.values()].reduce((s, v) => s + v, 0n);
    const totalAfter = [...out.values()].reduce((s, v) => s + v, 0n);
    expect(totalAfter).toBe(totalBefore);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit policy/legs`
Expected: FAIL — `src/policy/steps/legs.js` does not exist.

- [ ] **Step 3: Implement `legs.ts`**

```typescript
/**
 * §9.1.4 - the target is diffed into legs, each leg meets its own hurdle, the
 * survivors are re-checked for feasibility, and the executed move is a partial
 * adjustment toward them.
 *
 * v0.6 evaluated one gate over the whole vector and returned HOLD on failure.
 * Constantinides' no-trade region is exited by trading TO ITS BOUNDARY and
 * Garleanu-Pedersen's optimal policy is partial adjustment toward an aim; the
 * all-or-nothing form is the one structure both results exclude.
 *
 * PURE. UNITS: bigint USDC base units.
 */
import { deployClears, rotateClears, type LegVerdict } from './hurdles.js';
import type { CostParams } from './cost.js';
import type { DecisionInput, PolicyArtifact, RateCurve } from '../types.js';

/**
 * Deploy legs are idle -> venue. Rotation legs pair each divest with the
 * largest remaining deploy, in descending amount then ascending market id -
 * the registered ordering, so two runs on the same input pair identically.
 */
export function planLegs(
  current: Map<string, bigint>,
  target: Map<string, bigint>,
  input: DecisionInput,
  artifact: PolicyArtifact,
  curves: RateCurve[],
  p: CostParams,
): LegVerdict[] {
  const ids = [...new Set([...current.keys(), ...target.keys()])].sort();
  const ups: Array<{ id: string; amt: bigint }> = [];
  const downs: Array<{ id: string; amt: bigint }> = [];
  for (const id of ids) {
    const d = (target.get(id) ?? 0n) - (current.get(id) ?? 0n);
    if (d > 0n) ups.push({ id, amt: d });
    else if (d < 0n) downs.push({ id, amt: -d });
  }
  const byAmount = (a: { id: string; amt: bigint }, b: { id: string; amt: bigint }) =>
    a.amt === b.amt ? a.id.localeCompare(b.id) : (b.amt > a.amt ? 1 : -1);
  ups.sort(byAmount);
  downs.sort(byAmount);

  const curveOf = (id: string) => curves.find((c) => c.marketId === id)!;
  const out: LegVerdict[] = [];

  // Pair divests against deploys first: those are rotations.
  let di = 0;
  for (const up of ups) {
    let remaining = up.amt;
    while (remaining > 0n && di < downs.length) {
      const down = downs[di]!;
      const m = remaining < down.amt ? remaining : down.amt;
      out.push(rotateClears(input, artifact, curveOf(up.id), curveOf(down.id), up.id, down.id, m, p));
      remaining -= m;
      down.amt -= m;
      if (down.amt === 0n) di++;
    }
    // Whatever is left is funded from idle: a deployment, not a rotation.
    if (remaining > 0n) {
      out.push(deployClears(input, artifact, curveOf(up.id), up.id, remaining, p));
    }
  }
  return out;
}

/** The position implied by executing only the legs that cleared. */
export function survivingTarget(
  current: Map<string, bigint>,
  _target: Map<string, bigint>,
  verdicts: readonly LegVerdict[],
): Map<string, bigint> {
  const out = new Map(current);
  for (const v of verdicts) {
    if (!v.clears) continue;
    out.set(v.marketId, (out.get(v.marketId) ?? 0n) + v.amountBase);
    if (v.fromMarketId !== null) {
      out.set(v.fromMarketId, (out.get(v.fromMarketId) ?? 0n) - v.amountBase);
    }
  }
  return out;
}

/**
 * x <- x + lambda*(sub - x), rounded so the total is conserved exactly: the
 * largest remainder takes the rounding dust, otherwise a partial adjustment
 * can mint or burn base units.
 */
export function partialAdjust(
  current: Map<string, bigint>,
  sub: Map<string, bigint>,
  lambda: number,
): Map<string, bigint> {
  if (lambda >= 1) return new Map(sub);
  const scale = BigInt(Math.round(lambda * 1_000_000));
  const ids = [...new Set([...current.keys(), ...sub.keys()])].sort();
  const out = new Map<string, bigint>();
  let drift = 0n;
  for (const id of ids) {
    const c = current.get(id) ?? 0n;
    const s = sub.get(id) ?? 0n;
    const moved = c + ((s - c) * scale) / 1_000_000n;
    out.set(id, moved);
    drift += moved - c;
  }
  if (drift !== 0n && ids.length > 0) {
    const fix = ids[0]!;
    out.set(fix, (out.get(fix) ?? 0n) - drift);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit policy/legs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into `decide.ts`**

Replace the `const gate = ...` block (~line 338) and the `if (!gate.passed) return finish(...)` that follows:

```typescript
  const verdicts = disable.costGate === true
    ? []
    : planLegs(current, target, input, artifact, curves, opts.cost);

  // H3d: remove the DEPLOYMENT hurdle only, keeping the rotation hurdle.
  const effective = disable.deploymentHurdle === true
    ? verdicts.map((v) => (v.kind === 'deploy' ? { ...v, clears: true, reason: 'DEPLOY_HURDLE_ABLATED' } : v))
    : verdicts;

  const sub = disable.costGate === true
    ? target
    : survivingTarget(current, target, effective);

  // A subset of a feasible target need not be feasible: re-check the reserve
  // and the caps before committing to it.
  const feasibleSub = reFeasible(input, sub, reserve, opts) ? sub : current;

  const executed = partialAdjust(current, feasibleSub, artifact.adjustmentRate);

  const gate: CostGateResult = {
    passed: !sameTarget(executed, current),
    reason: disable.costGate === true ? 'COST_GATE_ABLATED'
      : effective.some((v) => v.clears) ? 'HURDLES_CLEARED' : 'ALL_LEGS_BLOCKED',
    gainBase: 0n, moveCostBase: 0n, bandBase: 0n, terms: {},
    legs: effective,
  };
  if (!gate.passed) {
    reasons.push(`HURDLES: ${gate.reason}`);
    return finish({ admission, curves, lowerBounds, reserve, target, enumeration, costGate: gate });
  }
```

Then use `executed` — not `target` — everywhere `target` fed `buildPlan` below. Add `reFeasible` as a small local helper that re-runs the same reserve requirement and cap checks `optimize` already applies, and `sameTarget` as a map equality check. Add `'deploymentHurdle'` to the `PolicyAblation` union in `src/policy/steps/optimize.ts`.

Keep the aggregate brakes — cooldown, min/max turnover, reversal allowance — evaluated on `executed` before the plan is built, exactly where `costGate` used to apply them.

- [ ] **Step 6: Add the decide-level regression test**

Append to `test/unit/policy/decide.spec.ts`:

```typescript
it('P17: deploys into the venue that clears even when another leg does not', () => {
  const out = decide(twoVenueIdleInput(), registeredArtifact(), DEFAULT_DECIDE_OPTS);
  expect(out.action).toBe('rebalance');
  expect(out.costGate.legs.some((l) => l.clears)).toBe(true);
});

it('P17: a blocked leg does not discard a clearing one', () => {
  const out = decide(oneGoodOneBadInput(), registeredArtifact(), DEFAULT_DECIDE_OPTS);
  expect(out.action).toBe('rebalance');
});
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm test:unit`
Expected: PASS. Suites that asserted the old all-or-nothing behaviour will fail; update them to assert the new per-leg behaviour and name P17 in a comment. Do not delete a test to make it pass.

Run: `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 8: Commit**

```bash
git add src/policy/steps/legs.ts src/policy/decide.ts src/policy/types.ts src/policy/steps/optimize.ts test/unit/policy/
git commit -m "feat(policy): per-leg hurdles and partial adjustment (P17)

decide() no longer discards the whole target when one leg fails its
hurdle. Legs are tested individually, the survivors are re-checked for
feasibility, and the executed move is x + lambda*(sub - x). Adds the
deploymentHurdle ablation switch for H3d."
```

---

### Task 5: Hurdle census and deployment metrics (§11.4)

The v0.6 run record could not distinguish "allocated badly" from "did not allocate". Persist the per-leg verdicts and derive the four deployment metrics from them so the next run diagnoses itself.

**Files:**
- Modify: `src/policy/types.ts` (`DecisionOutput` — `costGate.legs` already added in Task 4; nothing further)
- Modify: `src/evaluation/replay/*.ts` — accumulate the census across origins
- Modify: `src/evaluation/kernel/harness.ts` — add the four metrics to `PolicyRunResult`
- Test: `test/unit/evaluation/deployment-metrics.spec.ts` (create)

**Interfaces:**
- Consumes: `LegVerdict[]` on `CostGateResult` from Task 4.
- Produces: `PolicyRunResult.replay` gains `capitalAtWorkFraction: number`, `deploymentLatencyOrigins: number | null`, `idleDragApy: number | null`, `hurdleBlocks: Record<string, number>`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/evaluation/deployment-metrics.spec.ts`:

```typescript
import { accumulateCensus, capitalAtWork } from '../../../src/evaluation/replay/deployment-metrics.js';

describe('§11.4 deployment metrics', () => {
  it('counts a block by its reason code', () => {
    const c = accumulateCensus([], [
      { kind: 'deploy', marketId: 'a', fromMarketId: null, amountBase: 1n, clears: false,
        edgeWad: 0n, hurdleWad: 0n, costHurdleWad: 0n, significanceWad: 0n, reason: 'DEPLOY_BLOCKED: x' },
    ]);
    expect(c['DEPLOY_BLOCKED']).toBe(1);
  });

  it('capital at work is zero for an all-idle run and one for a fully deployed run', () => {
    expect(capitalAtWork([{ idleBase: 100n, deployedBase: 0n }])).toBe(0);
    expect(capitalAtWork([{ idleBase: 0n, deployedBase: 100n }])).toBe(1);
    expect(capitalAtWork([{ idleBase: 50n, deployedBase: 50n }])).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit deployment-metrics`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/evaluation/replay/deployment-metrics.ts`**

```typescript
/**
 * §11.4's deployment metrics. The v0.6 run record reported a policy that never
 * deployed as though its only defect were a low return; no metric separated
 * "allocated badly" from "did not allocate". PURE.
 */
import type { LegVerdict } from '../../policy/steps/hurdles.js';

/** Reason-code prefix -> count, across every origin of a run. */
export function accumulateCensus(
  prior: readonly LegVerdict[],
  verdicts: readonly LegVerdict[],
  into: Record<string, number> = {},
): Record<string, number> {
  for (const v of [...prior, ...verdicts]) {
    if (v.clears) continue;
    const code = v.reason.split(':')[0]!.trim();
    into[code] = (into[code] ?? 0) + 1;
  }
  return into;
}

export function capitalAtWork(series: ReadonlyArray<{ idleBase: bigint; deployedBase: bigint }>): number {
  if (series.length === 0) return 0;
  let num = 0;
  for (const s of series) {
    const total = s.idleBase + s.deployedBase;
    num += total === 0n ? 0 : Number((s.deployedBase * 1_000_000n) / total) / 1_000_000;
  }
  return num / series.length;
}

/** Origins elapsed before the first admitted deployment; null if never. */
export function deploymentLatency(series: ReadonlyArray<{ deployedBase: bigint }>): number | null {
  const i = series.findIndex((s) => s.deployedBase > 0n);
  return i < 0 ? null : i;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit deployment-metrics`
Expected: PASS, 2 tests.

- [ ] **Step 5: Thread it through the replay and harness**

In the replay loop, accumulate `accumulateCensus` per origin and record `{ idleBase, deployedBase }`. In `harness.ts`, add the four fields to `PolicyRunResult.replay` and populate them. `idleDragApy` is the difference between this run's net APY and the same policy's net APY with `deploymentHurdle` disabled — which is exactly H3d, so read it from the H3d run when present and leave it `null` otherwise.

Run: `pnpm test:unit && pnpm exec tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/evaluation/replay/deployment-metrics.ts src/evaluation/ test/unit/evaluation/deployment-metrics.spec.ts
git commit -m "feat(eval): deployment metrics and the hurdle-block census (§11.4)

Capital-at-work, deployment latency, idle drag and a per-reason census
of blocked legs. This is the diagnostic that would have identified the
v0.6 defect from the run record alone."
```

---

## Self-Review Notes

**Spec coverage.** §3.1 → Task 1. §3.2 → Task 2. §3.3 → Task 3. §3.4 → Task 4. §3.5–3.8 → the follow-on plan. §11.4 metrics → Task 5.

**Deferred to the follow-on plan** (`2026-09-09-srcla-v07-evaluation.md`): P18 selection loss, P19 state-space candidate, P20–P22 release gate, forecast-gate wiring, fork replay, and the re-freeze. Do not attempt them here.

**Registrations still open** (spec §6, paper owner's call — needed before the re-freeze in the follow-on plan, not before these five tasks): `delta`, the `payback`/`k`/`lambda` sweep grid, the minimum sealed-era length, and whether the selection subsample is acceptable. Task 1 ships `PAYBACK_SECONDS = 30 days` and `ADJUSTMENT_RATE = 1` as placeholders *in the freezer* — they are registered values, so the follow-on plan's sweep replaces them and the artifact records what was swept.

**Type consistency.** `LegVerdict` is defined in Task 3 and consumed in Tasks 4 and 5 under the same name and shape. `CostGateResult.legs` is added in Task 4 and read in Task 5. `deploymentHurdle` joins `PolicyAblation` in Task 4 and is used by H3d in the follow-on plan.
