# SRCLA Release Readiness — Design

**Date:** 2026-09-09
**Baseline commit:** `e239e557` (the v0.5 registered evaluation, verdict FAIL)
**Status:** Design approved in brainstorming; awaiting spec review
**Paper:** `docs/research/output/srcla-paper.md` v0.5 → **v0.6**
**Predecessor:** `docs/superpowers/specs/2026-09-07-srcla-paper-conformance-design.md` (Phases 1–4, complete)

## 1. Problem

The v0.5 registered evaluation ran to completion on 267 days of sealed held-out
data and returned **FAIL** on both eras. Four of nine §11.5 checks passed;
five did not.

| §11.5 check | held-out A | held-out B |
|---|---|---|
| Every registered tier ran | PASS | PASS |
| Every policy ran at every tier | PASS | PASS |
| Calibrated artifact | PASS | PASS |
| Safety: withdrawal success | PASS (100%, 60 runs) | PASS (100%, 60 runs) |
| Safety: stressed liquid coverage | **FAIL** | **FAIL** |
| No inert ablation | **FAIL** | **FAIL** |
| Statistically distinguishable | **FAIL** | **FAIL** |
| Outperforms every deployable baseline | **FAIL** | **FAIL** |
| §11.1 pinned-prestate fork replay | NOT PRODUCED | NOT PRODUCED |

`FAIL` is a legitimate outcome — §11.5 requires publishing one rather than
retuning against held-out data. This spec is not an attempt to make the gate
pass. It closes three defects the evaluation *diagnosed*, each of which is a
flaw in the specification or the implementation rather than a property of the
market.

### 1.1 The three diagnosed defects

**D1 — The movement gate is defending a cost that does not exist.**
Measured over 267 days at the 10,000 USDC tier:

| Policy | Turnover (× NAV) | Rebalances | Total cost | Cost drag |
|---|---|---|---|---|
| SRCLA | 6× | 301 | **$0.01** | 0.02 bps/yr |
| B1 | 182× | 3,825 | **$0.13** | 0.17 bps/yr |

§9.1's threshold is `max(C_move, k·σ)`. With `k = 1.0` the band is ≈ $50 on a
500,000 USDC move against a measured `C_move` of ≈ $0.0001 — five orders of
magnitude apart. **The eleven-term cost model never binds; the gate is
entirely the no-trade band.** SRCLA forfeited ~20 bps/yr (4.180% against B1's
4.376%) suppressing 3,825 rebalances to 301, to save $0.12.

`k = 1.0` is not a calibrated value. `config/bootstrap-artifact.json` states
it "carries no such registration and was never swept". One unregistered
constant is the single largest measured contributor to the outperformance
failure.

**D2 — The optimiser does not defend the quantity the gate measures.**
§11.4 grades

```
liquid   = idle + Σ_i min(balance_i, max(0, venueCash_i − balance_i))
coverage = min over demands {5,10,25,50}% of TVL of (liquid / demand)
```

The optimiser enforces `requiredReserve`'s stress model and rejects
stress-infeasible candidates. That is a *different computation*. SRCLA
selected allocations scoring 0.836 at the 1M tier and 0.792 at 10M while its
own feasibility test reported them acceptable. A policy cannot defend a
quantity it never evaluates.

**D3 — Two of the paper's own amendments are inert.**
H6 and H7 — the structural liquidity cap (P5) and the liquidity-adjusted
objective (P4) — made byte-identical decisions to SRCLA across all 267 days of
held-out A. They were derived from the burned window's pathology (Moonwell
quoting 86.26% APR at 100.04% utilisation holding $6,163). On ordinary market
data those conditions do not arise, so the caps sit above whatever the
optimiser selects and never bind. The statistical-distinguishability check
fails downstream, because a paired test against a byte-identical policy is
degenerate.

### 1.2 What is NOT a defect

**The 10M tier is not satisfiable on release-one's venue set.** Worst-case
total withdrawable cash across all three venues during held-out A was
**$3,617,388**, against an average of $89,029,229. A 10M vault must hold $5M
liquid to meet §11.4's 50%-of-TVL demand. No allocation policy can do that
when the entire universe holds $3.6M. This is arithmetic about §2.1's locked
venue set, not a property of SRCLA.

**`minStressedLiquidCoverage` is the worst single origin of 6,408.** One hour
of market-wide dryness sets the score for the whole era. That is defensible
for a safety property but today it is indistinguishable from chronic
illiquidity.

## 2. Goals and non-goals

### Goals

1. `k` is registered by measurement, not asserted.
2. The optimiser's liquidity feasibility test and §11.4's coverage metric are
   the same function.
3. Coverage is reported richly enough to distinguish a one-hour dip from
   chronic illiquidity, **without weakening the gate**.
4. A tier that no policy could satisfy is named as such rather than scored as
   a policy failure.
5. The improved algorithm is validated on an era that was not used to design
   it, with the contamination that does exist declared.

### Non-goals

- **Making the gate pass.** §11.5 requires publishing `FAIL` rather than
  retuning. If the changes below do not close the gap, that is the result.
- **Redesigning P4/P5.** They are inert today; whether they remain inert once
  the optimiser defends coverage directly (D2) is an empirical question.
  Redesigning two mechanisms on speculation is exactly the over-engineering
  this spec should avoid. Re-evaluate after measuring.
- **Wiring §11.1's fork replay.** Still unwired, still NOT PRODUCED, still
  blocking. It is a phase of its own (68 Anvil forks) and is out of scope.
- Adding venues beyond Aave V3 / Compound III / Moonwell. §2.1 locks release one.

## 3. Era re-cut

Reading held-out A burned it. The dataset is extended backwards to the earliest
block at which all seven required contracts exist — **2024-03-12**, verified by
binary search (`Comet` USDC has no code before block 11,707,031) — which frees
169 days and lets every boundary move back.

| Era | Window | Days | Role |
|---|---|---|---|
| `calibration` | 2024-03-15 → 2025-05-31 | 443 | The only data anything may be fit on. Up from 365. |
| `burned-a` | 2025-06-01 → 2026-02-28 | 273 | **Newly declared burned.** Former held-out A, read while diagnosing v0.5. |
| `heldout-c` | 2026-03-01 → 2026-05-25 | 86 | **Sealed.** Validates the v0.6 algorithm. |
| `burned` | 2026-05-26 → 2026-08-23 | 90 | §4.1's original burn. Unchanged. |
| `heldout-b` | 2026-08-24 → present | 16+ | Sealed. Unchanged. |

### 3.1 The contamination that remains, declared

`heldout-c` is **less burned, not pristine**. The aggregate statistics read
while diagnosing v0.5 — net APY, worst coverage, total cost, turnover — span
the whole of former held-out A, including 2026-03-01 → 2026-05-25. What is
known is the era-wide direction, not this period's structure.

It is used anyway because the alternative is worse: `heldout-b` is 16 days and
~77% of it is a single venue's liquidity collapse, which cannot adjudicate a
yield claim. The caveat travels with every number drawn from `heldout-c`, in
the paper and in the report.

## 4. Paper amendments (v0.5 → v0.6)

| ID | Amendment | Section | Evidence |
|---|---|---|---|
| **P9** | Where `C_move ≪ k·σ` the movement gate reduces to the no-trade band alone; `k` must be registered by a turnover-vs-return sweep, never asserted | §9.1 | SRCLA's measured movement cost over 267d: $0.01 (0.02 bps/yr). B1 at 182× NAV turnover: $0.13 (0.17 bps/yr). At `k=1.0` the band is ≈$50 on a 500k move against `C_move` ≈$0.0001. SRCLA forfeited ~20 bps/yr to save $0.12 |
| **P10** | The optimiser's liquidity feasibility test and §11.4's coverage metric are the same function | §8.2, §11.4 | SRCLA scored 0.836 @1M and 0.792 @10M while its own stress test reported the allocation feasible |
| **P11** | Stressed coverage is reported as a distribution (min, p05, median). **The gate remains on the minimum.** | §11.4 | The metric is the worst of 6,408 origins. Worst-case universe cash $3.6M against a $89M average — one dry hour sets the score |
| **P12** | Where a tier's registered stress demand exceeds observed worst-case universe liquidity, the coverage check reports **CAPACITY-INFEASIBLE** | §11.1, §11.4 | The 10M tier needs $5M liquid against a $3.6M worst-case universe |

**P12 is not gate-softening.** `CAPACITY-INFEASIBLE` does not verify and does
not pass; the overall gate still blocks, exactly as the existing `null` /
NOT PRODUCED outcome does. It only distinguishes "the policy allocated badly"
from "no policy could have satisfied this".

### 4.1 Second burned-window declaration

To be added to the paper verbatim:

> The window `2025-06-01 → 2026-02-28` was inspected while diagnosing v0.5 and
> is therefore design data. Additionally, **aggregate statistics spanning
> `2026-03-01 → 2026-05-25` were read** — net APY, worst stressed coverage,
> total cost and turnover over the whole of the former held-out era. That era
> (`heldout-c`) is therefore *less burned, not pristine*, and every result
> drawn from it carries this caveat. It is used because the alternative, the
> 16-day `heldout-b`, is too short and too dominated by a single venue's
> liquidity failure to adjudicate a yield claim.

## 5. Architecture

### 5.1 One coverage function, two callers (P10)

The change with the most leverage is an *alignment*, not a new mechanism.

```
srcla/src/policy/steps/coverage.ts
  stressedCoverage(holdings, idleBase, venueCashByMarket, totalAssetsBase,
                   demandBps): { worst: number; byDemand: Array<{bps, ratio}> }
```

Pure, no I/O. Two callers:

- **`optimize`** — evaluates it on each candidate and rejects those below the
  **coverage floor**, alongside the existing cap and reserve constraints. The
  floor is a registered constant defaulting to **0.99**, the same value §11.4's
  gate tests, so the optimiser is held to the standard it is graded against.
  `demandBps` defaults to §8.1's registered set `{500, 1000, 2500, 5000}`.
- **`replay`** — measures it, exactly as today.

`src/evaluation/replay/replay.ts#stressedLiquidCoverage` is deleted and its
call site re-pointed, so there is one definition rather than two that can
drift. This is the same discipline the Phase 1–4 work applied to `decide()`:
the evaluated quantity and the deployed quantity must be one program.

**On the floor's severity.** At 0.99 against a 50%-of-TVL demand the
constraint will be infeasible at many origins, because it requires the vault to
be able to pay half its NAV instantly from exit capacity that the venues
frequently do not have. That is intended: the floor states the standard, and
§5.1's fallback decides what to do when the standard is unreachable. A softer
floor chosen so that it usually binds would be a floor chosen to look busy.

**Why this is expected to help:** the optimiser currently maximises the
portfolio lower bound subject to constraints that do not include the graded
quantity. Adding it as a constraint makes the search prefer allocations that
keep exit capacity — holding more idle, or preferring a deep venue over a thin
one at equal rate — which is precisely the trade §11.4 grades.

**Why it may not be enough:** the binding demand is 50% of TVL at the worst
single origin. If the universe is dry at that origin, no feasible candidate
exists and the constraint cannot be satisfied by reallocating. The optimiser
must then fall back to the least-infeasible candidate rather than refusing to
act. That fallback is part of this design, not an afterthought: refusing to
allocate when no candidate clears the floor would strand the vault in cash.

### 5.2 Registered `k` (P9)

`scripts/freeze-artifact.ts --sweep-k` already exists and runs SRCLA through
the replay once per candidate. It is currently opt-in because it costs ~50
minutes on a 365-day era; on 443 days it will cost more.

Changes:
- The sweep runs on `calibration` only, as it does today.
- The candidate set widens downward: `{0, 0.05, 0.1, 0.25, 0.5, 1, 2}`. The
  measured evidence says the optimum is far below 1.0, and the current grid's
  smallest non-zero value (0.25) already blocks 99.28% of moves.
- The selection rule is unchanged: best realised net APY, ties broken toward
  the smaller band, `INCONCLUSIVE` when the spread is under 0.001 pp.
- `k = 0` remains a legitimate outcome and means "the band earns nothing on
  this data" — it must be reported as a finding, not silently adopted.

### 5.3 Coverage distribution (P11)

`ReplayResult` gains `stressedCoverage: { min, p05, median }`, computed over
the per-origin series it already produces. The gate continues to test `min`.
The report prints all three.

### 5.4 Capacity infeasibility (P12)

`evaluateRegisteredRelease` gains an optional `universeLiquidity` input: the
worst-case total venue cash observed over the era. Where
`0.5 × tier > universeLiquidity.worst`, the coverage check for that tier
reports `CAPACITY_INFEASIBLE` with the two figures, and contributes `null`
(does not verify) rather than `false`.

## 6. Testing

Following the repository's convention: plain-TypeScript logic unit-tested;
chain and UI verified by `tsc`, `forge test`, and gated integration runs.

**Load-bearing tests.**

- *One coverage function*: a golden case where `optimize`'s feasibility verdict
  and `replay`'s measurement agree bit-for-bit. This is the property D2 breaks;
  asserting it prevents the two from drifting apart again.
- *Least-infeasible fallback*: when no candidate clears the coverage floor, the
  optimiser returns the highest-coverage candidate rather than an empty target.
  A test with a universe drier than the floor must not produce a stranded vault.
- *`k` sweep honesty*: a synthetic dataset where every `k` scores identically
  must report `INCONCLUSIVE` and keep the registered default, never pick a
  winner from noise.
- *`CAPACITY_INFEASIBLE` does not pass*: a gate result containing one must have
  `pass === false`.
- *Era guard*: `heldout-c` is sealed; `assertNotSealed` throws for it, and
  `burned-a` is in neither the calibration nor any held-out era.

**Further coverage.** The coverage distribution's percentiles; the widened `k`
grid; the second burned-window declaration's presence in the paper; the
optimiser's behaviour at the exact coverage floor boundary.

## 7. Phasing

One branch, continuing `feat/srcla-paper-conformance`.

| Phase | Contents | Checkpoint |
|---|---|---|
| **5a** | Extend the dataset to 2024-03-15; re-cut eras; re-stamp `eraTag`; declare the second burned window | `heldout-c` sealed and non-empty; `burned-a` in no era |
| **5b** | Paper → v0.6 with P9–P12 (**first**, before anything is fit) | Amendment record carries all four with evidence |
| **5c** | One coverage function, both callers; least-infeasible fallback | Optimiser and replay agree bit-for-bit |
| **5d** | Widened `k` sweep on the 443-day calibration era; re-freeze the artifact | `k` registered or `INCONCLUSIVE`, with its table |
| **5e** | Coverage distribution; `CAPACITY_INFEASIBLE` | Gate still blocks; cause named correctly |
| **5f** | Run `heldout-c` and `heldout-b`; regenerate the report | Reproducible PASS or FAIL |

5b before 5c–5e is not ceremony: the amendments must be registered before the
code they justify is written, or the registration is retrospective.

## 8. Risks

**The gates may still fail, and the changes may trade one failure for another.**
Lowering `k` makes SRCLA trade more, which concentrates it in whichever venue
is hot and may *worsen* coverage; §5.1's constraint pushes the other way.
Whether they net out is empirical. §11.5 forbids resolving it by tuning on
`heldout-c`.

**`heldout-c` is 86 days.** Roughly a third of the statistical power of the era
it replaces, and partially contaminated (§3.1). A marginal result on it should
be read as marginal.

**P4/P5 may remain inert**, in which case the "No inert ablation" check keeps
failing and the honest conclusion is that two of the paper's amendments do not
earn their place on ordinary market data.

**The venue universe may simply be too small.** If 1M also proves
capacity-infeasible, the finding is about §2.1's locked venue set, and the
answer is a scope change to the paper rather than a change to the algorithm.
