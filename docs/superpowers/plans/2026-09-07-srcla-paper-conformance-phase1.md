# SRCLA Paper Conformance — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four divergent SRCLA implementations with one pure decision kernel that the live service actually runs, and make on-chain staged-plan execution work at all.

**Architecture:** A pure function `decide(input, artifact) -> DecisionOutput` composes seven steps over modules that already exist but are unreachable. Two thin drivers call it — the live scheduler and (in Phase 4) the evaluation replay — so the paper's equal-information requirement holds by construction. All look-ahead protection lives in the single `DecisionInput` constructor.

**Tech Stack:** TypeScript (ESM, NodeNext), Fastify 4, **Prisma 5** (not 7 — that is `be/`), ethers v6, jest with `ts-jest/presets/default-esm`, Foundry for the fork checkpoint.

**Spec:** `docs/superpowers/specs/2026-09-07-srcla-paper-conformance-design.md`

## Global Constraints

- **Chain:** Base, chainId `8453`. Sole asset Circle native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals).
- **Registered forecast horizons:** 1, 7, 14 days (`86400`, `604800`, `1209600` seconds). **Not 30 days** — `src/forecast/types.ts` currently declares `2592000` and is wrong.
- **Registered coverage targets:** `0.90`, `0.95`, `0.99`.
- **Vault tiers:** 10 000 / 100 000 / 1 000 000 / 10 000 000 USDC.
- **Cadence:** snapshot every 15 min; decision hourly.
- **Burned window:** `2026-05-26 → 2026-08-23` is design data and must sit in the **calibration** era, never held-out.
- **`decide()` is pure:** no I/O, no `Date.now()`, no `Math.random()`, no clients. Time comes from `input.origin.timestampSeconds` only.
- **ESM imports** must carry the `.js` specifier (`import { x } from './y.js'`) — jest `moduleNameMapper` strips it.
- **Test files** are `*.spec.ts` (jest `testMatch: ['**/*.spec.ts']`). Unit tests live under `test/unit/**`, integration under `test/integration/**`.
- **Money is `bigint`** in USDC base units throughout. Rates are WAD (1e18) unless a module documents RAY (1e27).
- **Action kind encoding** must match `NavyVaultSRCLA.ActionKind`: `Deploy=0, Divest=1, Harvest=2, EmergencyExit=3`. `VaultTypes.ActionKind` is an inverted duplicate (`Divest=0, Deploy=1`) — never use it.
- Run all commands from `srcla/` unless stated otherwise.

## Task Map

| # | Task | Closes |
|---|---|---|
| 1 | Paper v0.5 amendment | §4 of spec |
| 2 | `policy/registered.ts` + `policy/types.ts` | F-horizon conflict, S10 |
| 3 | `policy/input.ts` — look-ahead barrier | F4, §5.2 |
| 4 | `steps/admit.ts` | S11 |
| 5 | `steps/simulate.ts` — rate curves | S2 |
| 6 | `policy/artifact.ts` + `steps/forecast.ts` | S3 |
| 7 | `steps/reserve.ts` — P3 | S4 |
| 8 | `steps/optimize.ts` — P2/P4/P5 + real enumeration | S5, S8 |
| 9 | `steps/cost.ts` — 11 terms + P8 band | S6 |
| 10 | `steps/plan.ts` — staged plan + domain leaves | S9 |
| 11 | `policy/decide.ts` — compose + deterministic hash | S7, S10 |
| 12 | Prisma schema — raw IRM fields + new models | §5.4 |
| 13 | Rewire scheduler; delete stubs and dead barrels | S1, S12 |
| 14 | KeeperExecutor real headers + domain leaves | E1, E2, E3 |
| 15 | §10.3 execution loop + stale-plan recovery | E4, E5 |
| 16 | Anvil fork end-to-end checkpoint | Phase 1 exit |

---

### Task 1: Amend the paper to v0.5

The artifact must be frozen **before** any calibration touches data, so this is first.

**Files:**
- Modify: `docs/research/output/srcla-paper.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the registered values Task 2 encodes in `registered.ts` — horizons `{1,7,14}` days, coverages `{0.90,0.95,0.99}`, tiers `{10e3,100e3,1e6,10e6}` USDC, ablations `H1..H7`, era boundary rule.

- [ ] **Step 1: Bump the header**

Change the version and date lines at the top of the file:

```markdown
**Research report version:** 0.5

**Date:** 2026-09-07
```

- [ ] **Step 2: Insert the Amendment Record**

Add immediately after the **Keywords** line, before `## 1. Introduction`:

```markdown
## Amendment Record (v0.4 → v0.5)

Version 0.4 specified an architecture that had not been evaluated. `SRCLA-REPORT.md`
v2.0 evaluated it and returned a negative result. Eight amendments follow from that
record. They are registered here, before the held-out evaluation of v0.5 is run.

**Burned-window declaration.** The window `2026-05-26 → 2026-08-23` was inspected
while diagnosing v0.4. It is therefore design data. It lies inside the calibration
era of the v0.5 dataset and must never appear in the held-out era. Any result that
violates this is rejected under §2.2.

| ID | Amendment | Section | Evidence |
|---|---|---|---|
| P1 | Residual quantile becomes per-venue and is solved to hit the registered coverage target | §7.1, §7.2 | Best candidate reached 94.44% pooled; per-venue Compound 100%, Moonwell 94.87%, Aave 88.46%. All nine candidates used q=5% regardless of target; 99% was never evaluated |
| P2 | Objective maximises a portfolio-level lower bound, not a sum of marginal bounds | §8.2 | H2 measured the marginal-sum form as pure yield cost with no measurable risk reduction |
| P3 | Withdrawal-demand quantile is netted against executable venue exits | §8.1 | H4 produced identical results at every tier — the reserve never bound above the admin floor |
| P4 | Objective contribution is weighted by conservatively exitable fraction | §8.2 | Moonwell quoted 86.26% APR on 2026-07-21 at 100.04% utilisation holding $6,163 cash |
| P5 | Effective exposure limit gains a structural liquidity cap | §6.1 | The report's conclusion: the protections that bound were structural, not forecast-dependent |
| P6 | Venue free cash gains a registered lower prediction bound | §7.2 | Feeds P3's exit term and P4's exitable fraction |
| P7 | B2 is reserve-matched; the unconstrained form is retained as a diagnostic | §11.2 | The report had to introduce "B2r" mid-evaluation because B2 held no reserve |
| P8 | Action rule gains an uncertainty-driven no-trade band; cadence/horizon relationship stated | §9.1 | Movement cost is ~$0.0105 per rebalance yet H3 still helped by 0.06–0.09 pp — the gain is churn suppression |
```

- [ ] **Step 3: Apply the eight in-place edits**

§6.1 — replace the sentence "Its effective exposure limit is the minimum of these applicable bounds." with:

```markdown
Its effective exposure limit is the minimum of these applicable bounds together with a
structural liquidity cap $c_i^{\mathrm{liquidity}}$, a deterministic function of the
venue's free cash and utilisation that decreases toward zero as the venue approaches
its kink. The liquidity cap requires no forecast and binds independently of one.
```

§7.1 — replace `q_{\alpha,t}` with `q_{\alpha,i,t}` in the displayed equation and the sentence introducing it, and append:

```markdown
The quantile is indexed by market because venues differ in rate smoothness: a single
pooled quantile that covers a volatile series over-covers a smooth one and vice versa.
The quantile is *solved* so that realised calibration-era coverage attains the
registered target, rather than fixed at a nominal value with coverage reported after.
```

§7.2 — after the sentence listing the grid, append:

```markdown
The registered grid is the full cross product of the three methods, the three
horizons, the three coverage targets, and each method's parameter set, evaluated per
venue. A second registered target is calibrated with the same machinery: a lower
prediction bound on the venue's withdrawable cash over the horizon, which supplies
$e_{i,s}$ in §8.1 and the exitable fraction in §8.2.
```

§8.1 — replace the displayed `I_t^{required}` equation with:

```markdown
$$
I_t^{\mathrm{required}}(x)=
\max\left(I^{\mathrm{floor}},\;
Q_\beta(W_H)-\sum_i\min(x_i,e_i^{\mathrm{cons}}),\;
\max_s\{D_s-E_s(x)\}\right).
$$
```

§8.2 — replace the `w^*` objective with:

```markdown
$$
w^*=\arg\max_w\;\left[\hat\mu_p(w)+q^p_{\alpha}(w)\right],
\qquad
\hat\mu_p(w)=\sum_i \phi_i\,w_i\,\hat\mu_{i,t,H}(w_iV_t),
$$

where $q^p_\alpha(w)$ is a calibrated lower quantile of *portfolio* horizon residuals
under weights $w$, and $\phi_i=\min(x_i,e_i^{\mathrm{cons}})/x_i$ is the
conservatively exitable fraction of the position. Summing marginal lower bounds would
assume every venue realises its $\alpha$-quantile simultaneously; the portfolio
residual does not. Weighting by $\phi_i$ prevents value that cannot be withdrawn from
earning rank.
```

§9.1 — replace "The economic action rule is: $G_H>C_{\mathrm{move}}$." with:

```markdown
The economic action rule is:

$$
G_H>\max\left(C_{\mathrm{move}},\;k\hat\sigma\right).
$$

The second term is a no-trade band scaled by forecast dispersion. On a low-fee chain
$C_{\mathrm{move}}$ is small enough that it alone does not suppress churn, and
repeated entry and exit incur self-impact and reversal risk that execution cost does
not capture. Decisions are evaluated hourly while the forecast horizon is measured in
days; the band, not the cadence, governs how often capital actually moves.
```

§11.2 — change the B2 row to:

```markdown
| B2 | Use post-deposit capacity curves without uncertainty treatment, holding the same reserve as SRCLA. |
| B2u | B2 without any reserve. Retained as a labelled diagnostic; not a deployable comparator. |
```

§11.3 — replace the H1–H5 bullet list with:

```markdown
- **H1—capacity:** remove post-deposit simulation; rank on displayed rate.
- **H2—uncertainty:** remove calibrated lower bounds; use the point forecast.
- **H3—cost:** remove the complete-cost gate and the no-trade band.
- **H4—liquidity:** remove the dynamic reserve and stress feasibility; admin floor only.
- **H5—dependency:** remove shared-dependency caps.
- **H6—structural liquidity cap:** remove $c_i^{\mathrm{liquidity}}$.
- **H7—liquidity-adjusted objective:** remove the $\phi_i$ weighting.

Each hypothesis removes only its named component while holding other information,
delays, costs, and rules fixed.
```

- [ ] **Step 4: Update Appendix B**

Replace the "Forecast candidates", "Lower-bound coverage candidates" and "Rebalance" rows and add three:

```markdown
| Forecast candidates | Rolling horizon distribution; exponentially weighted residual model; fixed direct-horizon ARX — full cross product with horizons and coverage targets, per venue |
| Lower-bound coverage candidates | 90%, 95%, 99%; quantile solved to attain the target |
| Second forecast target | Venue withdrawable-cash lower bound |
| Objective | Portfolio-level lower bound, liquidity-weighted |
| Structural liquidity cap | Active; decreases toward zero near the venue kink |
| Rebalance | Staged, expiring, ordered actions with complete-cost gate, turnover gate, and uncertainty no-trade band |
| Evaluation tiers | 10,000; 100,000; 1,000,000; 10,000,000 USDC |
```

- [ ] **Step 5: Verify no stale references remain**

Run: `grep -n "q_{\\\\alpha,t}\|G_H>C_{\\\\mathrm{move}}\|H5—dependency" docs/research/output/srcla-paper.md`
Expected: only the `H5—dependency` line from the new list; no `q_{\alpha,t}` without the `i` index, no bare `G_H>C_move` rule.

Run: `grep -c "Amendment Record" docs/research/output/srcla-paper.md`
Expected: `1`

- [ ] **Step 6: Commit**

```bash
git add -f docs/research/output/srcla-paper.md
git commit -m "docs(paper): amend SRCLA specification to v0.5

Eight pre-registered amendments (P1-P8) motivated by the negative result in
SRCLA-REPORT v2.0, plus H6/H7 ablations for the two new components and the
burned-window declaration that keeps the 2026-05-26..08-23 window in the
calibration era.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 2: Registered constants and core types

**Files:**
- Create: `srcla/src/policy/registered.ts`
- Create: `srcla/src/policy/types.ts`
- Modify: `srcla/src/forecast/types.ts` (fix the 30-day horizon)
- Test: `srcla/test/unit/policy/registered.spec.ts`

**Interfaces:**
- Consumes: the registered values from Task 1.
- Produces:
  - `REGISTERED_HORIZONS_SECONDS: readonly [86400, 604800, 1209600]`
  - `REGISTERED_COVERAGE_TARGETS: readonly [0.90, 0.95, 0.99]`
  - `REGISTERED_TIERS_BASE: readonly bigint[]`
  - `ABLATION_IDS: readonly ['H1'..'H7']`
  - `type HorizonSeconds = 86400 | 604800 | 1209600`
  - `interface DecisionInput`, `interface DecisionOutput`, `interface PolicyArtifact`, `interface RateCurve`, `interface MarketObservation`

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/registered.spec.ts`:

```ts
import {
  REGISTERED_HORIZONS_SECONDS,
  REGISTERED_COVERAGE_TARGETS,
  REGISTERED_TIERS_BASE,
  ABLATION_IDS,
  BURNED_WINDOW,
} from '../../../src/policy/registered.js';

describe('registered policy constants (paper Appendix B)', () => {
  it('uses horizons of 1, 7 and 14 days', () => {
    expect(REGISTERED_HORIZONS_SECONDS).toEqual([86_400, 604_800, 1_209_600]);
  });

  it('uses coverage targets of 90, 95 and 99 percent', () => {
    expect(REGISTERED_COVERAGE_TARGETS).toEqual([0.9, 0.95, 0.99]);
  });

  it('uses tiers of 10k, 100k, 1M and 10M USDC in base units', () => {
    expect(REGISTERED_TIERS_BASE).toEqual([
      10_000_000_000n,
      100_000_000_000n,
      1_000_000_000_000n,
      10_000_000_000_000n,
    ]);
  });

  it('registers seven ablations', () => {
    expect(ABLATION_IDS).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']);
  });

  it('records the burned window that must stay in the calibration era', () => {
    expect(BURNED_WINDOW.startIso).toBe('2026-05-26T00:00:00.000Z');
    expect(BURNED_WINDOW.endIso).toBe('2026-08-23T23:59:59.999Z');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- registered`
Expected: FAIL — `Cannot find module '../../../src/policy/registered.js'`

- [ ] **Step 3: Write `registered.ts`**

```ts
/**
 * Machine-readable mirror of srcla-paper.md Appendix B (v0.5).
 * Changing a value here without amending the paper is a conformance break.
 */

export const REGISTERED_HORIZONS_SECONDS = [86_400, 604_800, 1_209_600] as const;
export type HorizonSeconds = (typeof REGISTERED_HORIZONS_SECONDS)[number];

export const REGISTERED_COVERAGE_TARGETS = [0.9, 0.95, 0.99] as const;
export type CoverageTarget = (typeof REGISTERED_COVERAGE_TARGETS)[number];

export const REGISTERED_METHODS = ['rolling', 'ew-residual', 'arx'] as const;
export type ForecastMethod = (typeof REGISTERED_METHODS)[number];

/** §11.1 — exactly these four, in USDC base units (6 decimals). */
export const REGISTERED_TIERS_BASE = [
  10_000_000_000n,
  100_000_000_000n,
  1_000_000_000_000n,
  10_000_000_000_000n,
] as const;

export const ABLATION_IDS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'] as const;
export type AblationId = (typeof ABLATION_IDS)[number];

export const BASELINE_IDS = ['B0', 'B1', 'B2', 'B2u', 'B3', 'B4', 'B5'] as const;
export type BaselineId = (typeof BASELINE_IDS)[number];

export const SNAPSHOT_CADENCE_SECONDS = 900;
export const DECISION_CADENCE_SECONDS = 3600;

/**
 * Window inspected while diagnosing v0.4. It is design data: the manifest must
 * place it inside the calibration era and never inside held-out.
 */
export const BURNED_WINDOW = {
  startIso: '2026-05-26T00:00:00.000Z',
  endIso: '2026-08-23T23:59:59.999Z',
} as const;
```

- [ ] **Step 4: Write `types.ts`**

```ts
import type { HorizonSeconds, CoverageTarget, ForecastMethod } from './registered.js';

/** Raw protocol state at one finalised origin, in native integer units. */
export interface MarketObservation {
  marketId: string;
  adapter: string;
  protocol: 'aave' | 'compound' | 'moonwell';
  cash: bigint;
  borrows: bigint;
  reserves: bigint;
  supplyRateWad: bigint;
  utilizationWad: bigint;
  /** Vault position currently held in this venue. */
  positionBase: bigint;
  /** Live protocol headroom: max additional assets deployable. */
  maxDeployableBase: bigint;
  /** Conservative same-transaction exit, min(position, protocol cash). */
  maxWithdrawableBase: bigint;
  configDigest: string;
  regimeId: string;
  paused: boolean;
  capBps: number;
  absoluteCapBase: bigint;
  maxLossBps: number;
  dependencyGroupIds: string[];
}

/** A completed, availability-lagged training observation. */
export interface CompletedLabel {
  marketId: string;
  regimeId: string;
  originSeconds: number;
  horizonSeconds: HorizonSeconds;
  /** Origin + horizon; must be <= decision origin to be usable. */
  horizonEndSeconds: number;
  /** When the outcome became readable off-chain. */
  availableAtSeconds: number;
  realizedReturnWad: bigint;
  realizedMinCashBase: bigint;
}

export interface WithdrawalObservation {
  timestampSeconds: number;
  assetsBase: bigint;
}

export interface GasObservation {
  l2BaseFeeWei: bigint;
  l1BaseFeeWei: bigint;
  l1BlobBaseFeeWei: bigint;
  ethUsdE8: bigint;
  usdcUsdE8: bigint;
}

export interface DecisionInput {
  origin: {
    blockNumber: number;
    blockHash: string;
    timestampSeconds: number;
    finalized: true;
  };
  vault: {
    totalAssetsBase: bigint;
    idleBase: bigint;
    sharesOutstanding: bigint;
    adminReserveBase: bigint;
    dynamicReserveBase: bigint;
    minIdleBps: number;
    paused: boolean;
    configurationDigest: string;
  };
  markets: MarketObservation[];
  dependencyGroups: Array<{ id: string; capBps: number; absoluteCapBase: bigint; members: string[] }>;
  withdrawals: WithdrawalObservation[];
  gas: GasObservation;
  /** Only completed and availability-lagged labels reach here. */
  history: CompletedLabel[];
  lastAction: { timestampSeconds: number | null; turnoverWindowBase: bigint };
}

/** Piecewise-linear conservative rate curve over allocation x. */
export interface RateCurve {
  marketId: string;
  quantumBase: bigint;
  /** points[k] is the post-deposit supply rate at x = k * quantumBase. */
  points: bigint[];
  /** Largest x with a defined point. */
  maxXBase: bigint;
}

export interface PolicyArtifact {
  artifactHash: string;
  policyVersion: number;
  horizonSeconds: HorizonSeconds;
  coverageTarget: CoverageTarget;
  method: ForecastMethod;
  methodParams: Record<string, number>;
  /** P1: residual quantile per market id, all <= 0 in WAD. */
  residualQuantileWadByMarket: Record<string, bigint>;
  /** P2: portfolio residual quantile, <= 0 in WAD. */
  portfolioResidualQuantileWad: bigint;
  minObservations: number;
  availabilityLagSeconds: number;
  /** P8 band multiplier. */
  noTradeBandK: number;
  configDigest: string;
}

export interface AdmissionResult {
  eligible: string[];
  reasons: Array<{ marketId: string; code: string; passed: boolean; detail: string }>;
}

export interface ReserveResult {
  requiredBase: bigint;
  floorBase: bigint;
  netDemandQuantileBase: bigint;
  stressShortfallBase: bigint;
  scenarioFeasible: Array<{ scenario: string; feasible: boolean; shortfallBase: bigint }>;
}

export interface CostGateResult {
  passed: boolean;
  reason: string;
  gainBase: bigint;
  moveCostBase: bigint;
  bandBase: bigint;
  terms: Record<string, bigint>;
}

export interface PlanDraft {
  planId: string;
  decisionHash: string;
  merkleRoot: string;
  actions: Array<{
    index: number;
    kind: 0 | 1 | 2 | 3;
    adapter: string;
    amountBase: bigint;
    minOutBase: bigint;
    dataHash: string;
    proof: string[];
  }>;
  header: {
    planId: bigint;
    policyVersion: bigint;
    createdAt: bigint;
    expiresAt: bigint;
    actionCount: bigint;
    snapshotBlockNumber: bigint;
    snapshotHash: string;
    decisionHash: string;
    configurationDigest: string;
    reserve: bigint;
    minFinalAssets: bigint;
    maxRecognizedLoss: bigint;
    turnoverLimit: bigint;
  };
}

export interface DecisionOutput {
  snapshotHash: string;
  decisionHash: string;
  admission: AdmissionResult;
  curves: RateCurve[];
  lowerBounds: Array<{ marketId: string; muWad: bigint; lowerWad: bigint; exitableFraction: number }>;
  reserve: ReserveResult;
  target: Map<string, bigint>;
  enumeration: { regretBps: bigint; enumerated: number; passed: boolean } | null;
  costGate: CostGateResult;
  plan: PlanDraft | null;
  action: 'rebalance' | 'hold';
  reasons: string[];
}
```

- [ ] **Step 5: Fix the contradictory horizon type**

In `srcla/src/forecast/types.ts` replace the first line:

```ts
import type { HorizonSeconds } from '../policy/registered.js';
export type { HorizonSeconds };
```

Delete the old `export type HorizonSeconds = 86400 | 604800 | 2592000;`.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test:unit -- registered && pnpm exec tsc --noEmit`
Expected: registered.spec PASS. `tsc` may report errors where `2592000` was used — fix each to `1209600`.

- [ ] **Step 7: Commit**

```bash
git add src/policy/registered.ts src/policy/types.ts src/forecast/types.ts test/unit/policy/registered.spec.ts
git commit -m "feat(policy): registered constants and decision-core types

Encodes paper v0.5 Appendix B as a single source of truth and fixes the
forecast horizon contradiction: types.ts declared a 30-day horizon while
horizon-grid.ts and the paper specify 14.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

### Task 3: `buildDecisionInput` — the single look-ahead barrier

This is the load-bearing correctness guarantee for the whole evaluation. Every driver must construct its `DecisionInput` here.

**Files:**
- Create: `srcla/src/policy/input.ts`
- Test: `srcla/test/unit/policy/input.spec.ts`

**Interfaces:**
- Consumes: `DecisionInput`, `CompletedLabel`, `MarketObservation`, `PolicyArtifact` from Task 2.
- Produces:
  - `buildDecisionInput(raw: RawOrigin, artifact: PolicyArtifact): DecisionInput`
  - `interface RawOrigin` — the unfiltered material, including `allLabels: CompletedLabel[]`
  - `filterUsableLabels(all: CompletedLabel[], originSeconds: number, artifact: PolicyArtifact, regimeByMarket: Record<string,string>): CompletedLabel[]`

- [ ] **Step 1: Write the failing test**

Create `srcla/test/unit/policy/input.spec.ts`:

```ts
import { filterUsableLabels } from '../../../src/policy/input.js';
import type { CompletedLabel, PolicyArtifact } from '../../../src/policy/types.js';

const ORIGIN = 1_000_000;

const artifact = {
  availabilityLagSeconds: 600,
  minObservations: 1,
} as unknown as PolicyArtifact;

function label(over: Partial<CompletedLabel>): CompletedLabel {
  return {
    marketId: 'aave',
    regimeId: 'r1',
    originSeconds: ORIGIN - 100_000,
    horizonSeconds: 86_400,
    horizonEndSeconds: ORIGIN - 10_000,
    availableAtSeconds: ORIGIN - 5_000,
    realizedReturnWad: 1n,
    realizedMinCashBase: 1n,
    ...over,
  };
}

describe('filterUsableLabels — no-look-ahead barrier', () => {
  const regimes = { aave: 'r1' };

  it('keeps a label whose horizon ended and lag elapsed', () => {
    const kept = filterUsableLabels([label({})], ORIGIN, artifact, regimes);
    expect(kept).toHaveLength(1);
  });

  it('drops a label whose horizon has not ended', () => {
    const future = label({ horizonEndSeconds: ORIGIN + 1 });
    expect(filterUsableLabels([future], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('drops a label whose horizon ended exactly at origin but is not yet available', () => {
    const notYet = label({ horizonEndSeconds: ORIGIN, availableAtSeconds: ORIGIN + 1 });
    expect(filterUsableLabels([notYet], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('drops a label whose availability lag has not elapsed', () => {
    const lagged = label({ horizonEndSeconds: ORIGIN - 100, availableAtSeconds: ORIGIN - 100 });
    expect(filterUsableLabels([lagged], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('drops a label from a superseded configuration regime', () => {
    const stale = label({ regimeId: 'r0' });
    expect(filterUsableLabels([stale], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('never admits a label from the future under randomised input', () => {
    const labels = Array.from({ length: 200 }, (_, i) =>
      label({ horizonEndSeconds: ORIGIN - 100 + i, availableAtSeconds: ORIGIN - 100 + i })
    );
    for (const kept of filterUsableLabels(labels, ORIGIN, artifact, regimes)) {
      expect(kept.horizonEndSeconds).toBeLessThanOrEqual(ORIGIN);
      expect(kept.availableAtSeconds + artifact.availabilityLagSeconds).toBeLessThanOrEqual(ORIGIN);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test:unit -- input`
Expected: FAIL — `Cannot find module '../../../src/policy/input.js'`

- [ ] **Step 3: Implement `input.ts`**

```ts
import type {
  CompletedLabel,
  DecisionInput,
  GasObservation,
  MarketObservation,
  PolicyArtifact,
  WithdrawalObservation,
} from './types.js';

export interface RawOrigin {
  origin: DecisionInput['origin'];
  vault: DecisionInput['vault'];
  markets: MarketObservation[];
  dependencyGroups: DecisionInput['dependencyGroups'];
  withdrawals: WithdrawalObservation[];
  gas: GasObservation;
  /** Unfiltered label store. Never pass this to decide() directly. */
  allLabels: CompletedLabel[];
  lastAction: DecisionInput['lastAction'];
}

/**
 * §7.3 — only an outcome whose horizon has fully ended and whose availability
 * lag has passed may train a forecast at origin t, and data from a superseded
 * configuration regime may not train the current one.
 *
 * This is the sole gate. Both the live driver and the replay driver construct
 * their DecisionInput here, so neither can see the future by construction.
 */
export function filterUsableLabels(
  all: CompletedLabel[],
  originSeconds: number,
  artifact: PolicyArtifact,
  currentRegimeByMarket: Record<string, string>
): CompletedLabel[] {
  return all.filter((l) => {
    if (l.horizonEndSeconds > originSeconds) return false;
    if (l.availableAtSeconds + artifact.availabilityLagSeconds > originSeconds) return false;
    const currentRegime = currentRegimeByMarket[l.marketId];
    if (currentRegime !== undefined && l.regimeId !== currentRegime) return false;
    return true;
  });
}

export function buildDecisionInput(raw: RawOrigin, artifact: PolicyArtifact): DecisionInput {
  const regimeByMarket: Record<string, string> = {};
  for (const m of raw.markets) regimeByMarket[m.marketId] = m.regimeId;

  const history = filterUsableLabels(
    raw.allLabels,
    raw.origin.timestampSeconds,
    artifact,
    regimeByMarket
  );

  // Withdrawal demand is also an observation and obeys the same barrier.
  const withdrawals = raw.withdrawals.filter(
    (w) => w.timestampSeconds <= raw.origin.timestampSeconds
  );

  return {
    origin: raw.origin,
    vault: raw.vault,
    markets: [...raw.markets].sort((a, b) => (a.marketId < b.marketId ? -1 : 1)),
    dependencyGroups: [...raw.dependencyGroups].sort((a, b) => (a.id < b.id ? -1 : 1)),
    withdrawals,
    gas: raw.gas,
    history,
    lastAction: raw.lastAction,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test:unit -- input`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/policy/input.ts test/unit/policy/input.spec.ts
git commit -m "feat(policy): single look-ahead barrier in buildDecisionInput

Only completed, availability-lagged, regime-matched labels reach decide().
Both the live driver and the evaluation replay must construct DecisionInput
through this function, so neither can observe the future.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ATW8jiYbW47r4Ke6gQDwSK"
```

---

## Remaining Phase 1 tasks

Tasks 4–16 follow the same TDD shape. They are specified in the companion file to keep each document reviewable:

**`docs/superpowers/plans/2026-09-07-srcla-paper-conformance-phase1-tasks-4-8.md`, then `...-tasks-9-16.md`**

That split is deliberate — Tasks 1–3 establish the paper, the vocabulary, and the correctness barrier that every later task depends on, and they are independently reviewable before the seven steps get built on top of them.

## Self-Review Notes

- **Spec coverage:** Tasks 1–16 map to spec §4 (Task 1), §5.1–5.3 (Tasks 2–11), §5.4 (Tasks 11–12), §6.4 (Tasks 14–15), and the Phase 1 checkpoint (Task 16). Spec §6.1–6.3 (contracts), §7 (rewards), §8 (forecast grid/loss/walk-forward), §9 (evaluation) and §10 (be/expo) are Phases 2–4 and get their own plans.
- **Deferred deliberately:** the forecast *grid sweep* that produces a `PolicyArtifact` is Phase 4; Task 6 ships a provisional bootstrap artifact, clearly labelled, so Phase 1 can run end to end.
- **Known follow-up for Phase 2:** delete `VaultTypes.ActionKind`, whose `Divest=0, Deploy=1` numbering inverts the vault's own enum.
