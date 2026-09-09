# SRCLA Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three defects the v0.5 registered evaluation diagnosed — an unregistered no-trade band, an optimiser that does not defend the quantity it is graded on, and a coverage metric that cannot distinguish one dry hour from chronic illiquidity — then re-run on a re-cut, sealed era.

**Architecture:** The load-bearing change is an *alignment*, not a new mechanism: one pure `stressedCoverage` function, used both as a constraint inside `optimize` and as the replay's measurement, replacing two computations that could drift. Around it sit three smaller changes: a widened, registered `k` sweep; a coverage distribution alongside the existing minimum; and a `CAPACITY_INFEASIBLE` gate outcome for a tier no policy could satisfy.

**Tech Stack:** TypeScript (ESM, NodeNext), Prisma 5 + Postgres 16 on `:5433`, ethers v6, Jest (`*.spec.ts`). Run from `srcla/`.

**Spec:** `docs/superpowers/specs/2026-09-09-srcla-release-readiness-design.md`
**Paper:** `docs/research/output/srcla-paper.md` v0.5 → **v0.6**
**Predecessor:** `docs/superpowers/plans/2026-09-08-srcla-paper-conformance-phase4.md`

---

## Global Constraints

- **This is not an attempt to make the gate pass.** §11.5 requires publishing a negative result rather than retuning against held-out data. If these changes do not close the gap, that is the result. No task may tune a value because it moves a gate.
- **`heldout-c` is SEALED and must not be read until Task 12.** `assertNotSealed` enforces it. Everything that fits anything — the grid sweep, the `k` sweep, the artifact freeze — reads `calibration` only.
- **`burned-a` (2025-06-01 → 2026-02-28) is design data** and belongs to no era. It is excluded from fitting and from evaluation alike.
- **Amendments are registered BEFORE the code they justify.** Task 3 (paper v0.6) precedes Tasks 4–11. A registration written after the fact is not a registration.
- **Money is `bigint` in USDC base units (6 dp); rates WAD (1e18) annualized; Aave RAY (1e27); times are seconds.** ESM relative imports carry `.js`.
- **`decide()` and every `steps/*` function stay pure** — no I/O, no `Date.now()`, no randomness.
- **Baseline to preserve:** `srcla` 1273 unit tests + 54 integration, `pnpm exec tsc --noEmit` clean, `pnpm typecheck:scripts` clean apart from the 7 known pre-existing script failures (`anvil-fork-test`, `collect-scheduled`, `phase1-fork-check`, `quarantined/run-evaluation`, `run-evaluation-full`, `run-live-evaluation`, `show-live-apys`).
- **Commit by explicit pathspec** (`git commit -m "..." -- <paths>`); `git add` exact paths only, never `-A`. The working tree carries unrelated user changes to `test/unit/protocols/compound-simulator.spec.ts` and `test/unit/regime/regime.spec.ts` — do not stage them.
- **`docs/` is gitignored**; committing a plan or spec needs `git add -f`.
- **Every commit ends with:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f
  ```

---

## File structure

| Path | Responsibility |
|---|---|
| `src/policy/steps/coverage.ts` | **New.** The single `stressedCoverage` definition. Pure. Consumed by `optimize` (constraint) and `replay` (measurement). |
| `src/policy/steps/optimize.ts` | `feasible()` gains the coverage floor; adds the least-infeasible fallback. |
| `src/evaluation/replay/replay.ts` | `stressedLiquidCoverage` deleted, re-pointed at `coverage.ts`; `ReplayResult` gains the distribution. |
| `src/evaluation/eras.ts` | Re-cut boundaries; `burned-a`; `heldout-c`. |
| `src/evaluation/kernel/gates.ts` | `CAPACITY_INFEASIBLE`; `universeLiquidity` option. |
| `scripts/freeze-artifact.ts` | Widened `k` candidate set. |
| `docs/research/output/srcla-paper.md` | v0.6, amendments P9–P12, second burned-window declaration. |

---

## Task Map

| # | Task | Spec § | Phase |
|---|---|---|---|
| 1 | Finish and verify the extended collection | §3 | 5a |
| 2 | Re-cut the eras; re-stamp `eraTag` | §3 | 5a |
| 3 | Paper → v0.6 with P9–P12 | §4 | 5b |
| 4 | `stressedCoverage` — one pure function | §5.1 | 5c |
| 5 | Re-point the replay at it; delete the duplicate | §5.1 | 5c |
| 6 | Coverage floor inside `optimize` | §5.1 | 5c |
| 7 | Least-infeasible fallback | §5.1 | 5c |
| 8 | Coverage distribution on `ReplayResult` | §5.3 | 5e |
| 9 | `CAPACITY_INFEASIBLE` in the gate | §5.4 | 5e |
| 10 | Widen the `k` candidate set | §5.2 | 5d |
| 11 | Re-freeze the artifact on 443 days, with `--sweep-k` | §5.2 | 5d |
| 12 | Run `heldout-c` + `heldout-b`; regenerate the report | §7 | 5f |

---

### Task 1: Finish and verify the extended collection

The backfill to 2024-03-15 was started during design and logged **1 gap**. A gap is a disclosed hole, never interpolated — but an unexamined one in the calibration era is a hole in what everything else is fitted on.

**Files:**
- Modify: none (verification only)

**Interfaces:**
- Produces: a calibration era with known, characterised coverage.

- [ ] **Step 1: Wait for the run and read its summary**

```bash
cd srcla
until ! pgrep -f "loader.mjs scripts/backfill-history.ts" >/dev/null; do sleep 30; done
grep -E "^\[backfill\] (requested|skipped|persisted|gaps|elapsed)" backfill-extend.log
sed -n '/GAPS/,$p' backfill-extend.log
```

- [ ] **Step 2: Retry the gap**

The backfill is resumable and skips what is already persisted, so re-running retries only the missing origins:

```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' \
  pnpm backfill:history --from 2024-03-15T00:00:00Z --to 2024-08-31T23:00:00Z
```
Expected: `persisted 1`, `gaps 0`. If the gap persists across two retries, it is a genuine archive hole — record its timestamp and reason in the task report and leave it. Do NOT interpolate it.

- [ ] **Step 3: Verify hourly coverage across the whole extended window**

```sql
SELECT date_trunc('month', timestamp)::date AS month,
       count(DISTINCT timestamp) AS origins,
       count(*) FILTER (WHERE "irmKinkRay" IS NULL) AS missing_irm
FROM "MarketSnapshot" WHERE timestamp >= '2024-03-15' GROUP BY 1 ORDER BY 1;
```
Expected: ~720 origins per full month, 0 missing IRM. A month materially short is a gap to disclose in the manifest, not to fill.

- [ ] **Step 4: Repair digests on the new rows**

The new rows were written by the current decoder, so they already carry `identity|parameters`. Confirm rather than assume:

```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm digests:rewrite
```
Expected: `0 rows still on the combined format`, or a rewrite that leaves one identity per venue.

- [ ] **Step 5: Report, do not commit**

Nothing to commit — this task produces data, not code. Report the origin count, gap count and per-venue identity/regime counts.

---

### Task 2: Re-cut the eras

**Files:**
- Modify: `src/evaluation/eras.ts`
- Test: `test/unit/evaluation/eras.spec.ts`

**Interfaces:**
- Produces: `EraTag` gains `'burned-a'` and `'heldout-c'`; boundaries per spec §3.

- [ ] **Step 1: Write the failing tests**

```ts
// Append to test/unit/evaluation/eras.spec.ts
describe('v0.6 era re-cut', () => {
  it('extends calibration back to the deployment floor', () => {
    expect(eraBounds('calibration').start).toBe('2024-03-15T00:00:00.000Z');
    expect(eraBounds('calibration').days).toBe(443);
  });

  it('declares the former held-out era burned', () => {
    // Read in aggregate while diagnosing v0.5, so it is design data now.
    expect(eraFor(at('2025-06-01T00:00:00Z'))).toBe('burned-a');
    expect(eraFor(at('2026-02-28T12:00:00Z'))).toBe('burned-a');
    expect(REGISTERED_ERAS['burned-a'].sealed).toBe(false);
  });

  it('seals heldout-c as the v0.6 validation era', () => {
    expect(eraFor(at('2026-03-01T00:00:00Z'))).toBe('heldout-c');
    expect(eraFor(at('2026-05-25T23:00:00Z'))).toBe('heldout-c');
    expect(REGISTERED_ERAS['heldout-c'].sealed).toBe(true);
    expect(eraBounds('heldout-c').days).toBe(86);
    expect(() => assertNotSealed('heldout-c', 'grid sweep')).toThrow(/sealed/i);
  });

  it('keeps every burned window out of every sealed era', () => {
    for (const burned of ['burned', 'burned-a'] as const) {
      const b = REGISTERED_ERAS[burned];
      for (const tag of SEALED_ERAS) {
        const e = REGISTERED_ERAS[tag];
        expect(e.endSeconds < b.startSeconds || e.startSeconds > b.endSeconds).toBe(true);
      }
    }
  });

  it("says in heldout-c's role that it is less burned, not pristine", () => {
    expect(REGISTERED_ERAS['heldout-c'].role).toMatch(/less burned, not pristine/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/evaluation/eras.spec.ts --runInBand`
Expected: FAIL — `burned-a` and `heldout-c` are not `EraTag`s.

- [ ] **Step 3: Re-cut the boundaries**

Add both tags to `EraTag` and to `REGISTERED_ERAS` with the spec §3 windows. `heldout-c`'s `role` must contain the phrase *"less burned, not pristine"* and name why it is used anyway — the module header is where a future reader learns this, and the existing eras all carry their rationale there.

Extend the module header's numbered disclosures with a third:

> 3. `heldout-c` is LESS BURNED, NOT PRISTINE. Aggregate statistics spanning it — net APY, worst stressed coverage, total cost and turnover over the whole of former held-out A — were read while diagnosing v0.5. What is known is the era-wide direction, not this period's structure. It is used because the alternative, the 16-day `heldout-b`, is too short and too dominated by a single venue's liquidity failure to adjudicate a yield claim.

- [ ] **Step 4: Verify the no-gap/no-overlap invariant still holds**

The existing test `leaves no gap and no overlap between adjacent eras` asserts `start === prev.end + 1` across all eras. Two new eras must not break it.

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/evaluation/eras.spec.ts --runInBand`
Expected: all pass.

- [ ] **Step 5: Re-stamp `eraTag` on every persisted row**

Boundaries moved, so stored tags are stale:

```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm exec tsx -e "
import { PrismaClient } from '@prisma/client';
import { eraFor } from './src/evaluation/eras.js';
const p = new PrismaClient();
const rows = await p.marketSnapshot.findMany({ select: { id: true, timestamp: true, eraTag: true } });
let changed = 0;
for (const r of rows) {
  const tag = eraFor(Math.floor(r.timestamp.getTime() / 1000));
  if (tag !== r.eraTag) { await p.marketSnapshot.update({ where: { id: r.id }, data: { eraTag: tag } }); changed++; }
}
console.log('restamped', changed, 'of', rows.length);
await p.\$disconnect();"
```

Then confirm the split, **counting rows only — never reading values from a sealed era**:

```sql
SELECT "eraTag", count(DISTINCT timestamp) AS origins, min(timestamp)::date, max(timestamp)::date
FROM "MarketSnapshot" WHERE "eraTag" IS NOT NULL GROUP BY 1 ORDER BY 3;
```
Expected: calibration ~10,632; burned-a ~6,552; heldout-c ~2,064; burned 2,160; heldout-b ~380.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(srcla): re-cut the eras for v0.6

Reading held-out A burned it, so it is redeclared as burned-a design data and
the validation era moves to heldout-c (2026-03-01 -> 2026-05-25, 86d).
Extending the dataset to the deployment floor at 2024-03-12 frees 169 days,
so calibration grows from 365 to 443.

heldout-c is LESS BURNED, NOT PRISTINE, and its role says so: aggregate
statistics spanning it were read while diagnosing v0.5. It is used anyway
because the 16-day heldout-b is too short and too dominated by one venue's
collapse to adjudicate a yield claim.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- src/evaluation/eras.ts test/unit/evaluation/eras.spec.ts
```

---

### Task 3: Paper → v0.6

Registered **before** the code it justifies. A registration written afterwards is not a registration.

**Files:**
- Modify: `docs/research/output/srcla-paper.md`
- Test: `test/unit/evaluation/paper-amendments.spec.ts` (create)

**Interfaces:**
- Produces: paper v0.6 with an `Amendment Record (v0.5 → v0.6)` section carrying P9–P12 and the second burned-window declaration.

- [ ] **Step 1: Write the failing test**

The paper is prose, but four claims in it are load-bearing enough that code depends on them. Pin those.

```ts
// test/unit/evaluation/paper-amendments.spec.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const paper = readFileSync(
  join(process.cwd(), '../docs/research/output/srcla-paper.md'), 'utf8',
);

describe('paper v0.6', () => {
  it('declares version 0.6', () => {
    expect(paper).toMatch(/\*\*Research report version:\*\*\s*0\.6/);
  });

  it('carries an amendment record for v0.5 -> v0.6', () => {
    expect(paper).toContain('Amendment Record (v0.5 → v0.6)');
  });

  it('registers P9 through P12', () => {
    for (const id of ['P9', 'P10', 'P11', 'P12']) {
      expect(paper).toMatch(new RegExp(`\\|\\s*${id}\\s*\\|`));
    }
  });

  it('declares the SECOND burned window and names heldout-c as less burned', () => {
    expect(paper).toContain('2025-06-01');
    expect(paper).toContain('2026-02-28');
    expect(paper).toMatch(/less burned, not pristine/i);
  });

  it('states that CAPACITY-INFEASIBLE does not pass', () => {
    // P12 must not read as gate-softening.
    expect(paper).toMatch(/CAPACITY-INFEASIBLE/);
    expect(paper).toMatch(/does not verify and does not pass/i);
  });

  it('keeps the v0.4 -> v0.5 record rather than replacing it', () => {
    expect(paper).toContain('Amendment Record (v0.4 → v0.5)');
    expect(paper).toMatch(/\|\s*P1\s*\|/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/evaluation/paper-amendments.spec.ts --runInBand`
Expected: FAIL — version is 0.5, no v0.6 record.

- [ ] **Step 3: Amend the paper**

Set version to `0.6`, date `2026-09-09`. Insert an `## Amendment Record (v0.5 → v0.6)` section **immediately after** the existing v0.4→v0.5 record — keep the older record; the amendment lineage is part of the evidence.

Open the new section with the same framing the v0.5 record uses, then the second burned-window declaration verbatim from spec §4.1, then the P9–P12 table verbatim from spec §4.

Add to §11.4 the sentence establishing P11 and P12:

> Stressed liquid coverage is reported as a distribution — minimum, 5th percentile and median over the era's origins — and the gate tests the **minimum**. Where a tier's registered stress demand exceeds the observed worst-case liquidity of the whole admitted venue set, the coverage check reports **CAPACITY-INFEASIBLE**: it **does not verify and does not pass**, and the release gate still blocks. The distinction exists so that "the policy allocated badly" is separable from "no policy could have satisfied this on the admitted venues".

Add to §9.1 the sentence establishing P9:

> Where measured `C_move` is negligible against `k·σ̂` — as it is on Base, where a full three-venue rebalance costs on the order of a hundredth of a cent — the action rule reduces to the no-trade band alone. `k` is therefore not a nuisance parameter: it is the gate. It **must** be registered by a turnover-versus-return sweep over the calibration era before any held-out evaluation, and a value asserted without such a sweep makes every result that depends on it provisional.

- [ ] **Step 4: Run the test**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/evaluation/paper-amendments.spec.ts --runInBand`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add -f docs/research/output/srcla-paper.md
git commit -m "docs(paper): v0.6 — amendments P9-P12 from the v0.5 evaluation

Registered BEFORE the code they justify. P9: where C_move is negligible
against k·sigma the action rule reduces to the no-trade band alone, so k is
the gate and must be swept, not asserted. P10: the optimiser's feasibility
test and §11.4's coverage metric must be one function. P11: coverage is
reported as a distribution, the gate still tests the minimum. P12: a tier
whose stress demand exceeds the venue set's worst-case liquidity reports
CAPACITY-INFEASIBLE, which does not verify and does not pass.

Second burned-window declaration: 2025-06-01 -> 2026-02-28 is design data, and
heldout-c is less burned, not pristine, because aggregate statistics spanning
it were read while diagnosing v0.5.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- test/unit/evaluation/paper-amendments.spec.ts
```

---

### Task 4: `stressedCoverage` — one pure function

**Files:**
- Create: `src/policy/steps/coverage.ts`
- Test: `test/unit/policy/coverage.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export const REGISTERED_STRESS_DEMAND_BPS: readonly number[]; // [500, 1000, 2500, 5000]
  export const REGISTERED_COVERAGE_FLOOR: number;               // 0.99
  export interface CoverageResult {
    worst: number;
    byDemand: Array<{ demandBps: number; ratio: number }>;
    liquidBase: bigint;
  }
  export function stressedCoverage(args: {
    holdings: ReadonlyMap<string, bigint>;
    idleBase: bigint;
    venueCashByMarket: ReadonlyMap<string, bigint>;
    totalAssetsBase: bigint;
    demandBps?: readonly number[];
  }): CoverageResult;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/policy/coverage.spec.ts
import {
  REGISTERED_COVERAGE_FLOOR,
  REGISTERED_STRESS_DEMAND_BPS,
  stressedCoverage,
} from '../../../src/policy/steps/coverage.js';

const M = (o: Record<string, bigint>) => new Map(Object.entries(o));

describe('stressedCoverage', () => {
  it('counts idle as fully liquid', () => {
    const r = stressedCoverage({
      holdings: M({}), idleBase: 1_000_000n,
      venueCashByMarket: M({}), totalAssetsBase: 1_000_000n,
    });
    expect(r.worst).toBe(1);
    expect(r.liquidBase).toBe(1_000_000n);
  });

  it('credits only the venue cash IN EXCESS of our own balance', () => {
    // We hold 500 in a venue with 600 cash: 100 is external, so our
    // conservative exit is min(500, 100) = 100. This is the "assume our own
    // supplied cash is borrowed out" rule §11.4 grades on.
    const r = stressedCoverage({
      holdings: M({ a: 500n }), idleBase: 0n,
      venueCashByMarket: M({ a: 600n }), totalAssetsBase: 500n,
    });
    expect(r.liquidBase).toBe(100n);
  });

  it('credits nothing when the venue holds no more than we do', () => {
    const r = stressedCoverage({
      holdings: M({ a: 500n }), idleBase: 0n,
      venueCashByMarket: M({ a: 500n }), totalAssetsBase: 500n,
    });
    expect(r.liquidBase).toBe(0n);
    expect(r.worst).toBe(0);
  });

  it('caps the credit at our own balance', () => {
    const r = stressedCoverage({
      holdings: M({ a: 100n }), idleBase: 0n,
      venueCashByMarket: M({ a: 10_000n }), totalAssetsBase: 100n,
    });
    expect(r.liquidBase).toBe(100n);
  });

  it('is worst-case over the registered demand set, which the 50% leg dominates', () => {
    const r = stressedCoverage({
      holdings: M({}), idleBase: 250n,
      venueCashByMarket: M({}), totalAssetsBase: 1000n,
    });
    // 250 liquid against demands of 50/100/250/500 -> worst is 250/500 = 0.5
    expect(r.worst).toBeCloseTo(0.5, 12);
    expect(r.byDemand.map((d) => d.demandBps)).toEqual([...REGISTERED_STRESS_DEMAND_BPS]);
  });

  it('returns 1 for an empty vault rather than dividing by zero', () => {
    expect(stressedCoverage({
      holdings: M({}), idleBase: 0n, venueCashByMarket: M({}), totalAssetsBase: 0n,
    }).worst).toBe(1);
  });

  it('registers the floor at the value §11.4 grades', () => {
    expect(REGISTERED_COVERAGE_FLOOR).toBe(0.99);
    expect(REGISTERED_STRESS_DEMAND_BPS).toEqual([500, 1000, 2500, 5000]);
  });

  it('is pure — the same inputs give the same answer', () => {
    const args = {
      holdings: M({ a: 300n, b: 200n }), idleBase: 50n,
      venueCashByMarket: M({ a: 900n, b: 250n }), totalAssetsBase: 1000n,
    };
    expect(stressedCoverage(args)).toEqual(stressedCoverage(args));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/policy/coverage.spec.ts --runInBand`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Port the arithmetic verbatim from `src/evaluation/replay/replay.ts:394-415` — do not re-derive it. The point of this task is that one definition replaces two, so any difference introduced here would defeat it. The header must say why the module exists: the optimiser must be able to evaluate exactly what §11.4 grades.

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/policy/coverage.spec.ts --runInBand`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(policy): one stressed-coverage definition, for both callers

§11.4 grades liquid = idle + sum min(balance, venueCash - balance) against
demands of {5,10,25,50}% of TVL. The optimiser enforced requiredReserve's
stress model instead, which is a different computation -- so SRCLA chose
allocations scoring 0.836 and 0.792 while its own feasibility test called them
feasible. A policy cannot defend a quantity it never evaluates.

Arithmetic ported verbatim from replay.ts rather than re-derived: the whole
point is that one definition replaces two.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- src/policy/steps/coverage.ts test/unit/policy/coverage.spec.ts
```

---

### Task 5: Re-point the replay; delete the duplicate

**Files:**
- Modify: `src/evaluation/replay/replay.ts`
- Test: `test/unit/evaluation/coverage-parity.spec.ts` (create)

**Interfaces:**
- Consumes: `stressedCoverage` from Task 4.
- Removes: `stressedLiquidCoverage` and `STRESS_DEMAND_BPS` from `replay.ts`.

- [ ] **Step 1: Write the parity test**

This is the load-bearing test of the whole plan. It is what stops the two computations drifting apart again.

```ts
// test/unit/evaluation/coverage-parity.spec.ts
import { stressedCoverage } from '../../../src/policy/steps/coverage.js';

/**
 * The property D2 broke: the number the optimiser evaluates and the number the
 * replay measures must be the same number. Asserted on a grid of states rather
 * than one case, because a single fixture agreeing proves nothing about the
 * shape of the two functions.
 */
describe('coverage parity between optimiser and replay', () => {
  it('agrees bit-for-bit across a grid of vault states', () => {
    for (const idle of [0n, 1n, 500n, 100_000n]) {
      for (const a of [0n, 250n, 900n]) {
        for (const cashA of [0n, 300n, 5_000n]) {
          const holdings = new Map([['aave-v3-usdc', a]]);
          const cash = new Map([['aave-v3-usdc', cashA]]);
          const total = idle + a;
          const viaPolicy = stressedCoverage({
            holdings, idleBase: idle, venueCashByMarket: cash, totalAssetsBase: total,
          });
          // The replay must call the same function; if it kept its own copy,
          // this test is where the divergence shows up.
          const viaReplay = stressedCoverage({
            holdings, idleBase: idle, venueCashByMarket: cash, totalAssetsBase: total,
          });
          expect(viaReplay.worst).toBe(viaPolicy.worst);
          expect(viaReplay.liquidBase).toBe(viaPolicy.liquidBase);
        }
      }
    }
  });

  it('replay.ts no longer defines its own coverage function', () => {
    // A grep-style guard: the duplicate must be gone, not merely unused.
    const src = require('fs').readFileSync('src/evaluation/replay/replay.ts', 'utf8');
    expect(src).not.toMatch(/function stressedLiquidCoverage/);
    expect(src).not.toMatch(/const STRESS_DEMAND_BPS/);
    expect(src).toMatch(/from '\.\.\/\.\.\/policy\/steps\/coverage\.js'/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/evaluation/coverage-parity.spec.ts --runInBand`
Expected: FAIL on the second test — `replay.ts` still defines its own.

- [ ] **Step 3: Re-point the replay**

Delete `stressedLiquidCoverage` and `STRESS_DEMAND_BPS` from `replay.ts`. At the call site (currently `const coverage = stressedLiquidCoverage(vault.getState(), snapshot);`) build the two maps from the snapshot and the vault state and call the shared function:

```ts
const coverage = stressedCoverage({
  holdings: vault.getState().strategyBalances,
  idleBase: vault.getState().idleBase,
  venueCashByMarket: new Map(snapshot.snapshots.map((m) => [m.marketId, m.cashBase])),
  totalAssetsBase: vault.getState().totalAssets,
}).worst;
```

If any other module imported `stressedLiquidCoverage`, re-point it too — `grep -rn "stressedLiquidCoverage" src test scripts` before finishing.

- [ ] **Step 4: Verify nothing regressed**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit --runInBand`
Expected: the full suite green. Any replay test asserting a coverage value must produce the same number as before — this is a re-point, not a behaviour change.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(srcla): delete the duplicate coverage definition

replay.ts kept its own stressedLiquidCoverage; policy/steps/coverage.ts is now
the only one, and the replay calls it. The parity test asserts agreement across
a grid of vault states rather than one fixture, because a single case agreeing
says nothing about the shape of two functions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- src/evaluation/replay/replay.ts test/unit/evaluation/coverage-parity.spec.ts
```

---

### Task 6: Coverage floor inside `optimize`

**Files:**
- Modify: `src/policy/steps/optimize.ts` (the `feasible` closure, `src/policy/steps/optimize.ts:308-336`)
- Modify: `src/policy/types.ts` (`PolicyAblations` gains `coverageFloor`)
- Test: `test/unit/policy/optimize-coverage.spec.ts` (create)

**Interfaces:**
- Consumes: `stressedCoverage`, `REGISTERED_COVERAGE_FLOOR` from Task 4.
- Produces: `OptimizeOpts` gains `coverageFloor?: number` (default `REGISTERED_COVERAGE_FLOOR`); `PolicyAblations` gains `coverageFloor?: boolean` so an ablation can remove it.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/policy/optimize-coverage.spec.ts
//
// Fixture shape copied from test/unit/policy/optimize.spec.ts so both suites
// describe the same world. The vault is 10,000 USDC (10_000_000_000n base)
// entirely idle, and the quantum is 1,000 USDC.
import { optimize } from '../../../src/policy/steps/optimize.js';
import { loadBootstrapArtifact } from '../../../src/policy/artifact.js';
import { stressedCoverage } from '../../../src/policy/steps/coverage.js';
import type {
  DecisionInput, MarketObservation, PolicyArtifact, RateCurve,
} from '../../../src/policy/types.js';

const WAD = 10n ** 18n;
const Q = 1_000_000_000n;          // 1,000 USDC quantum
const NAV = 10_000_000_000n;       // 10,000 USDC vault

function market(id: string, over: Partial<MarketObservation> = {}): MarketObservation {
  return {
    marketId: id, adapter: `0x${id}`, protocol: 'aave',
    cash: 10n ** 12n, borrows: 0n, reserves: 0n,
    supplyRateWad: WAD / 100n, utilizationWad: 0n,
    positionBase: 0n, maxDeployableBase: 10n ** 12n, maxWithdrawableBase: 10n ** 12n,
    configDigest: '0xd', regimeId: 'r1', paused: false,
    capBps: 10_000, absoluteCapBase: 10n ** 13n, maxLossBps: 50, dependencyGroupIds: [],
    ...over,
  };
}

const curve = (id: string, rates: bigint[]): RateCurve =>
  ({ marketId: id, quantumBase: Q, points: rates, maxXBase: Q * BigInt(rates.length - 1) });

function input(markets: MarketObservation[]): DecisionInput {
  return {
    origin: { blockNumber: 1, blockHash: '0xb', timestampSeconds: 1_000_000, finalized: true },
    vault: {
      totalAssetsBase: NAV, idleBase: NAV, sharesOutstanding: 10n ** 10n,
      adminReserveBase: 0n, dynamicReserveBase: 0n, minIdleBps: 0,
      paused: false, configurationDigest: '0xv',
    },
    markets, dependencyGroups: [], withdrawals: [],
    gas: { l2BaseFeeWei: 1n, l1BaseFeeWei: 1n, l1BlobBaseFeeWei: 1n,
           ethUsdE8: 350_000_000_000n, usdcUsdE8: 100_000_000n },
    history: [], lastAction: { timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] },
  };
}

const artifact = (): PolicyArtifact => ({
  ...loadBootstrapArtifact(),
  residualQuantileWadByMarket: { a: 0n, b: 0n },
  portfolioResidualQuantileWad: -1_000_000n,
});

const OPTS = { quantumBase: Q, reserveQuantile: 0.95, reserveHorizonSeconds: 604_800 };
const covOf = (target: Map<string, bigint>, markets: MarketObservation[]) => {
  const deployed = [...target.values()].reduce((s, v) => s + v, 0n);
  return stressedCoverage({
    holdings: target, idleBase: NAV - deployed,
    venueCashByMarket: new Map(markets.map((m) => [m.marketId, m.cash])),
    totalAssetsBase: NAV,
  }).worst;
};

describe('optimize — coverage floor', () => {
  it('does not select an allocation the §11.4 metric would score below the floor', () => {
    // One venue whose cash is small relative to what we would deploy, so
    // external cash (cash - our balance) is tiny and exit capacity collapses.
    const ms = [market('a', { cash: 2_000_000_000n })]; // 2,000 USDC of venue cash
    const out = optimize(input(ms), [curve('a', Array(11).fill(WAD / 20n))], artifact(), OPTS);
    expect(covOf(out.target, ms)).toBeGreaterThanOrEqual(0.99);
  });

  it('prefers the deep venue over the thin one at an equal rate', () => {
    // Identical curves; 'b' holds 100x the cash. Making the optimiser evaluate
    // what the gate grades is exactly what should break this tie.
    const ms = [
      market('a', { cash: 2_000_000_000n }),
      market('b', { cash: 200_000_000_000n }),
    ];
    const rates = Array(11).fill(WAD / 20n);
    const out = optimize(input(ms), [curve('a', rates), curve('b', rates)], artifact(), OPTS);
    expect(out.target.get('b') ?? 0n).toBeGreaterThan(out.target.get('a') ?? 0n);
  });

  it('is removed by the coverageFloor ablation, and by nothing else', () => {
    const ms = [market('a', { cash: 2_000_000_000n })];
    const curves = [curve('a', Array(11).fill(WAD / 20n))];
    const withFloor = optimize(input(ms), curves, artifact(), OPTS);
    const without = optimize(input(ms), curves, artifact(), {
      ...OPTS, disable: { coverageFloor: true },
    });
    // The ablation must change the answer -- otherwise H-style ablation of
    // this component would be inert by construction.
    expect([...without.target.entries()]).not.toEqual([...withFloor.target.entries()]);
    expect(covOf(without.target, ms)).toBeLessThan(covOf(withFloor.target, ms));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/policy/optimize-coverage.spec.ts --runInBand`

- [ ] **Step 3: Add the floor to `feasible`**

Inside the `feasible` closure, after the reserve block and before `return true`:

```ts
if (disable.coverageFloor !== true) {
  const deployedTotal = [...candidate.values()].reduce((s, v) => s + v, 0n);
  const cov = stressedCoverage({
    holdings: candidate,
    idleBase: totalAssetsBase - deployedTotal,
    venueCashByMarket: new Map(input.markets.map((m) => [m.marketId, m.cash])),
    totalAssetsBase,
  });
  if (cov.worst < (opts.coverageFloor ?? REGISTERED_COVERAGE_FLOOR)) return false;
}
```

Document at the call site that this floor is **expected to be infeasible at many origins** — it requires paying half of NAV instantly out of exit capacity the venues frequently lack — and that Task 7's fallback, not a softer floor, is what handles that. A floor chosen so that it usually binds would be a floor chosen to look busy.

- [ ] **Step 4: Run the tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/policy --runInBand`
Expected: the new suite passes; existing `optimize` tests still pass. Existing tests that now select a different target because the floor rejects their old answer must be **understood before being updated** — if the floor is rejecting something it should not, that is a bug in this task, not a stale expectation.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(policy): hold the optimiser to the coverage floor it is graded on

optimize's feasible() now evaluates §11.4's own metric and rejects candidates
below 0.99, alongside the existing cap and reserve constraints. Previously the
search could select an allocation the gate would score at 0.79 because nothing
in the search ever computed that number.

The floor is expected to be infeasible at many origins: it requires paying half
of NAV instantly from exit capacity the venues frequently do not have. The next
task's fallback handles that; a softer floor would be one chosen to look busy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- src/policy/steps/optimize.ts src/policy/types.ts test/unit/policy/optimize-coverage.spec.ts
```

---

### Task 7: Least-infeasible fallback

Without this, an origin where no candidate clears the floor produces an empty target and the vault strands in cash — trading the outperformance gate away entirely.

**Files:**
- Modify: `src/policy/steps/optimize.ts`
- Test: `test/unit/policy/optimize-coverage.spec.ts` (extend)

**Interfaces:**
- Produces: `optimize` returns the highest-coverage candidate when none clears the floor; the returned shape is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
it('returns the HIGHEST-COVERAGE candidate when none clears the floor', () => {
  // A universe drier than the floor at every allocation. The optimiser must
  // still deploy: refusing to act would strand the vault in cash forever,
  // which is a worse answer than the best available one.
  // Assert: target is non-empty, and no other reachable candidate has
  // strictly greater coverage.
});

it('never returns a target that violates a HARD constraint to raise coverage', () => {
  // The fallback relaxes the coverage floor ONLY. Caps, dependency groups and
  // the reserve floor still bind -- those are on-chain guardrails, not
  // preferences.
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/policy/optimize-coverage.spec.ts --runInBand`

- [ ] **Step 3: Implement the fallback**

Split `feasible` into `hardFeasible` (caps, dependency groups, reserve, stress scenarios — everything that is an on-chain guardrail) and the coverage floor. Run the greedy search with both; if it yields an empty target, re-run with `hardFeasible` alone while tracking each candidate's coverage, and return the best-coverage candidate among those.

The distinction is the point: **the coverage floor is a preference the optimiser should satisfy when it can; the caps and the reserve are guardrails it must never violate.** Relaxing the wrong one would let the optimiser propose something the vault would reject on chain.

- [ ] **Step 4: Verify**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit --runInBand && pnpm exec tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(policy): fall back to the least-infeasible candidate

At origins where the venues cannot support paying half of NAV instantly, no
candidate clears the coverage floor. Returning an empty target there would
strand the vault in cash and trade the outperformance gate away entirely, so
the optimiser returns the highest-coverage candidate instead.

The fallback relaxes the coverage floor ONLY. Caps, dependency groups and the
reserve floor still bind: those are on-chain guardrails the vault would reject,
not preferences.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- src/policy/steps/optimize.ts test/unit/policy/optimize-coverage.spec.ts
```

---

### Task 8: Coverage distribution

**Files:**
- Modify: `src/evaluation/replay/replay.ts` (`ReplayResult`)
- Modify: `src/evaluation/report/render-markdown.ts`
- Test: `test/unit/evaluation/coverage-distribution.spec.ts` (create)

**Interfaces:**
- Produces: `ReplayResult.coverageDistribution: { min: number; p05: number; median: number }`. Named `coverageDistribution`, NOT `stressedCoverage`: that name already belongs to Task 4's function, and a field and a function sharing it would make every call site ambiguous to read. `minStressedLiquidCoverage` is **retained** — `gates.ts` tests it and this task must not change what the gate reads.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/evaluation/coverage-distribution.spec.ts
import { coverageDistribution } from '../../../src/evaluation/replay/replay.js';

describe('coverageDistribution', () => {
  it('reports min, p05 and median over the origin series', () => {
    const series = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.5];
    const d = coverageDistribution(series);
    expect(d.min).toBe(0.5);
    expect(d.median).toBe(1);
    expect(d.p05).toBeLessThanOrEqual(d.median);
  });

  it('distinguishes ONE dry hour from chronic illiquidity', () => {
    // The whole reason P11 exists: these two score identically on `min`.
    const oneDip = coverageDistribution([...Array(999).fill(1), 0.3]);
    const chronic = coverageDistribution(Array(1000).fill(0.3));
    expect(oneDip.min).toBe(chronic.min);
    expect(oneDip.median).toBeGreaterThan(chronic.median);
    expect(oneDip.p05).toBeGreaterThan(chronic.p05);
  });

  it('returns 1 for an empty series rather than 0', () => {
    // An unmeasured series is not a maximally illiquid one.
    expect(coverageDistribution([])).toEqual({ min: 1, p05: 1, median: 1 });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/evaluation/coverage-distribution.spec.ts --runInBand`

- [ ] **Step 3: Implement and wire**

Export `coverageDistribution(series: readonly number[])` from `replay.ts`, compute it from the per-origin coverages the replay already collects, and add it to `ReplayResult`. **Do not remove `minStressedLiquidCoverage`** — `gates.ts` reads it and Task 9 depends on that being unchanged.

Render all three in the report's results table, with the gate's column clearly the minimum.

- [ ] **Step 4: Verify**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit --runInBand`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(srcla): report stressed coverage as a distribution

minStressedLiquidCoverage is the worst single origin of thousands, so one
market-wide dry hour scores identically to chronic illiquidity. Reporting p05
and median alongside it separates the two.

The gate still tests the minimum. This is a reporting change; the threshold is
not weakened.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- src/evaluation/replay/replay.ts src/evaluation/report/render-markdown.ts test/unit/evaluation/coverage-distribution.spec.ts
```

---

### Task 9: `CAPACITY_INFEASIBLE`

**Files:**
- Modify: `src/evaluation/kernel/gates.ts`
- Modify: `scripts/run-phase4.ts` (supply `universeLiquidity`)
- Test: `test/unit/evaluation/registered-gates.spec.ts` (extend)

**Interfaces:**
- Produces: `RegisteredGateOptions` gains
  ```ts
  universeLiquidity?: { worstTotalCashBase: bigint; observedAtIso: string };
  ```
  Where `(tier * 5000n) / 10_000n > worstTotalCashBase`, the coverage check for that tier reports `passed: null` with a detail naming both figures and the words `CAPACITY_INFEASIBLE`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('§11.4 capacity infeasibility', () => {
  it('names a tier whose stress demand exceeds the venue universe', () => {
    const out = evaluateRegisteredRelease(resultWithLowCoverageAt10M, {
      universeLiquidity: { worstTotalCashBase: 3_617_388_000_000n, observedAtIso: '2026-01-01T00:00:00Z' },
    });
    const check = out.checks.find((c) => c.name.includes('stressed liquid coverage'))!;
    expect(check.detail).toMatch(/CAPACITY_INFEASIBLE/);
    expect(check.detail).toContain('3617388');
  });

  it('does NOT pass — the gate still blocks', () => {
    // P12 must not read as gate-softening. `passed: null` never rolls up.
    const out = evaluateRegisteredRelease(resultWithLowCoverageAt10M, {
      universeLiquidity: { worstTotalCashBase: 3_617_388_000_000n, observedAtIso: '2026-01-01T00:00:00Z' },
    });
    expect(out.pass).toBe(false);
    expect(out.blockedReasons).toContain('Safety: stressed liquid coverage');
  });

  it('still reports a plain FAIL where the tier IS satisfiable', () => {
    // A small tier with poor coverage is a policy failure, not a capacity one.
    const out = evaluateRegisteredRelease(resultWithLowCoverageAt10k, {
      universeLiquidity: { worstTotalCashBase: 100_000_000_000_000n, observedAtIso: '2026-01-01T00:00:00Z' },
    });
    const check = out.checks.find((c) => c.name.includes('stressed liquid coverage'))!;
    expect(check.passed).toBe(false);
    expect(check.detail).not.toMatch(/CAPACITY_INFEASIBLE/);
  });

  it('behaves exactly as before when no universeLiquidity is supplied', () => {
    const out = evaluateRegisteredRelease(resultWithLowCoverageAt10M);
    const check = out.checks.find((c) => c.name.includes('stressed liquid coverage'))!;
    expect(check.passed).toBe(false);
  });
});
```

**Implementer:** build `resultWithLowCoverageAt10M` / `...At10k` using the fixture helpers already in `registered-gates.spec.ts`. Read that file first.

- [ ] **Step 2: Run to confirm failure**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/evaluation/registered-gates.spec.ts --runInBand`

- [ ] **Step 3: Implement**

In `gates.ts`, partition the sub-threshold runs into capacity-infeasible and genuinely-failing. If **any** run is genuinely failing, the check is `false`. If runs are sub-threshold **only** at capacity-infeasible tiers, the check is `null` with a `CAPACITY_INFEASIBLE` detail. Either way it does not verify and the gate blocks — assert this in the comment, because a reader skimming will otherwise take `null` for a pass.

In `run-phase4.ts`, compute `worstTotalCashBase` from the era's own snapshots (minimum over origins of the summed venue cash) and pass it in.

- [ ] **Step 4: Verify**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit --runInBand && pnpm exec tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(srcla): name a tier no policy could have satisfied

The 10M tier needs $5M liquid to meet §11.4's 50%-of-TVL demand against a
worst-case venue universe of $3.6M. That is arithmetic about §2.1's locked
venue set, not a property of the policy, and scoring it as a policy failure
conflates the two.

CAPACITY_INFEASIBLE does NOT verify and does NOT pass -- it contributes `null`
exactly as NOT PRODUCED does, and the gate still blocks. It only separates
'the policy allocated badly' from 'no policy could have satisfied this'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- src/evaluation/kernel/gates.ts scripts/run-phase4.ts test/unit/evaluation/registered-gates.spec.ts
```

---

### Task 10: Widen the `k` candidate set

**Files:**
- Modify: `scripts/freeze-artifact.ts` (`K_CANDIDATES`)
- Test: `test/unit/forecast/k-candidates.spec.ts` (create)

**Interfaces:**
- Produces: `K_CANDIDATES = [0, 0.05, 0.1, 0.25, 0.5, 1, 2]`, exported so the test can read it.

- [ ] **Step 1: Write the failing test**

```ts
import { K_CANDIDATES } from '../../../scripts/freeze-artifact.js';

describe('P8 no-trade band candidates', () => {
  it('searches BELOW the previous grid, where the evidence points', () => {
    // The old grid's smallest non-zero value, 0.25, already blocked 99.28% of
    // moves on the calibration era. A grid whose whole non-zero range is
    // saturated cannot find an optimum.
    expect(K_CANDIDATES).toContain(0.05);
    expect(K_CANDIDATES).toContain(0.1);
    expect(Math.min(...K_CANDIDATES.filter((k) => k > 0))).toBeLessThanOrEqual(0.05);
  });

  it('keeps 0 as a legitimate outcome', () => {
    // k=0 means the band earns nothing on this data. That is a finding about
    // P8, to be reported, not an error to be excluded.
    expect(K_CANDIDATES).toContain(0);
  });

  it('is sorted ascending, so ties break toward the smaller band', () => {
    expect([...K_CANDIDATES].sort((a, b) => a - b)).toEqual([...K_CANDIDATES]);
  });
});
```

If `freeze-artifact.ts` is not importable from a test (it is a script with a top-level `main()`), move `K_CANDIDATES` into `src/policy/registered.ts` and import it from both. Prefer that — a registered constant belongs in `src/`, not in a script.

- [ ] **Step 2: Run to confirm failure**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit/forecast/k-candidates.spec.ts --runInBand`

- [ ] **Step 3: Widen the grid**

- [ ] **Step 4: Verify**

Run: `NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest test/unit --runInBand && pnpm typecheck:scripts`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(srcla): search the no-trade band where the evidence points

The old grid's smallest non-zero k, 0.25, already blocked 99.28% of moves on
the calibration era -- its entire non-zero range was saturated, so the sweep
could not locate an optimum. Adds 0.05 and 0.1.

k=0 stays a legitimate outcome: it means the band earns nothing on this data,
which is a finding about P8 to be reported rather than an error to exclude.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- src/policy/registered.ts scripts/freeze-artifact.ts test/unit/forecast/k-candidates.spec.ts
```

---

### Task 11: Re-freeze the artifact on 443 days

**Files:**
- Modify: `config/registered-artifact.json` (regenerated)

**Interfaces:**
- Consumes: everything from Tasks 2, 4, 6, 7, 10.
- Produces: a registered artifact fit on `calibration` alone, with `k` registered or explicitly `INCONCLUSIVE`.

- [ ] **Step 1: Re-freeze WITH the sweep**

The sweep now runs the coverage-constrained optimiser, so its `k` ranking reflects the algorithm that will actually be evaluated. Expect roughly an hour.

```bash
cd srcla
rm -f config/registered-artifact.json
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' \
  nohup pnpm phase4:freeze --sweep-k > freeze-v06.log 2>&1 &
```

Watch the **node worker** PID (`pgrep -f "loader.mjs scripts/freeze-artifact.ts"`), not the wrapper — the wrapper exits early and a watcher on it reports a false completion.

- [ ] **Step 2: Read the sweep table before accepting it**

The log prints net APY, turnover and rebalance count per `k`. Check that the chosen value is a genuine optimum and not the edge of a saturated grid: if the best `k` is the smallest candidate, the grid is still too narrow and must be widened again before proceeding.

- [ ] **Step 3: Verify the artifact is registered, not provisional**

```bash
grep -c '_provisional' config/registered-artifact.json   # expect 0
python3 -c "import json;d=json.load(open('config/registered-artifact.json'));r=d['_registration'];print('k',d['noTradeBandK'],'resolved',r['noTradeBandKResolved']);print('era',r['calibrationEra']);print('sealed not read:',r['sealedErasNotRead'])"
```
Expected: calibration era `2024-03-15 → 2025-05-31`, 443 days; `sealedErasNotRead` contains `heldout-c` and `heldout-b`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(srcla): re-freeze the registered artifact for v0.6

Fit on the 443-day calibration era, with the coverage-constrained optimiser in
place, so the k sweep ranks the algorithm that will actually be evaluated.
k is registered by the sweep rather than asserted -- or reported INCONCLUSIVE
with its table, which is a result and not a gap.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f" -- config/registered-artifact.json
```

---

### Task 12: Run `heldout-c` and `heldout-b`

**This is the moment the sealed data is opened.** Everything that fits anything must already be committed. A result that prompts a change to the artifact, the grid or `k` is a **new registration on a new era**, not a retune.

**Files:**
- Modify: `SRCLA-REPORT.md`, `SRCLA-REPORT.json` (regenerated at the repo root)

- [ ] **Step 1: Run both eras**

```bash
cd srcla
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' \
  nohup pnpm phase4:run --eras heldout-c,heldout-b > phase4-v06.log 2>&1 &
```
Roughly 90 minutes: `heldout-c` is 2,064 origins × 15 policies × 4 tiers, plus `heldout-b`.

- [ ] **Step 2: Verify both records reproduce**

```bash
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm evaluation:verify evaluation-heldout-c.json
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm evaluation:verify evaluation-heldout-b.json
```
Expected: `VERIFIED` for both. A result hash that does not re-derive fails §11.5 regardless of what the gate said.

- [ ] **Step 3: Read the gate output honestly**

Record, per era: which checks pass, which fail, which are `NOT PRODUCED` or `CAPACITY_INFEASIBLE`, SRCLA's net APY against each deployable baseline at each tier, the coverage distribution, and which ablations are inert.

**Do not tune anything in response to these numbers.** If SRCLA still loses on yield, or coverage still fails at 1M, that is the finding. §11.1's fork replay remains `NOT PRODUCED`, so the gate cannot pass in any case — the achievable outcome is a FAIL with fewer and better-understood causes.

- [ ] **Step 4: Commit the report**

```bash
git add SRCLA-REPORT.md SRCLA-REPORT.json
git commit -m "feat(srcla): the v0.6 registered evaluation on heldout-c

<fill in: the actual verdict, the actual numbers>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016KXi2riEacocX5ifipzS7f"
```

- [ ] **Step 5: Write the outcome document**

`docs/superpowers/plans/2026-09-09-srcla-release-readiness-outcome.md`, in the form of `2026-09-07-srcla-phase1-outcome.md`: what closed, what remains open, and every ruling made during execution with its reason and the cost if wrong.

---

## Exit criteria

- [ ] Calibration era holds ~10,632 origins over 443 days; any gap is characterised, not interpolated
- [ ] `heldout-c` is sealed; `assertNotSealed` throws for it, asserted by test
- [ ] Paper is v0.6 and carries P9–P12 plus the second burned-window declaration
- [ ] `grep -rn "function stressedLiquidCoverage" src/` returns nothing — one definition only
- [ ] The optimiser's coverage verdict and the replay's measurement agree bit-for-bit across a grid of states
- [ ] No candidate clearing the floor yields the highest-coverage candidate, never an empty target
- [ ] `CAPACITY_INFEASIBLE` appears in a gate result and `pass` is still `false`
- [ ] `config/registered-artifact.json` has no `_provisional`; `k` is registered or explicitly `INCONCLUSIVE`
- [ ] Both run records verify; `SRCLA-REPORT.{md,json}` regenerated
- [ ] `pnpm test:unit` green against the 1273 baseline with every delta accounted for; `tsc` clean

## Self-review notes

- **Spec coverage:** §3 → Tasks 1–2; §4 → Task 3; §5.1 → Tasks 4–7; §5.2 → Tasks 10–11; §5.3 → Task 8; §5.4 → Task 9; §7 → Task 12.
- **Ordering rationale:** Task 3 before all code, so amendments are registered rather than retrospective. Task 4 before 5–7 (they consume it). Task 5 before 6, so the duplicate is gone before a second caller appears. Task 7 immediately after 6, because 6 alone can strand the vault. Task 10 before 11 (11 runs the widened grid). Task 12 last — it opens the seal.
- **Known to remain failing:** §11.1's fork replay is out of scope and blocks regardless; P4/P5 may stay inert; the 1M tier's coverage may not recover. Each is a finding to report, not a task to add.
- **Largest risk:** Tasks 6 and 10 push in opposite directions — a lower `k` trades more and concentrates, the coverage floor pushes toward liquidity. Whether they net out is empirical and must not be resolved by tuning on `heldout-c`.
