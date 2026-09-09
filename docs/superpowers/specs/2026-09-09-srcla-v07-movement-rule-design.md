# SRCLA v0.7 — Movement Rule and Release Criterion

**Date:** 2026-09-09
**Status:** Design, approved
**Paper:** `docs/research/output/srcla-paper.md` v0.7, amendments P13–P23 (commit `e8f7474a`)
**Predecessor:** `docs/superpowers/plans/2026-09-09-srcla-release-readiness-outcome.md`

## 1. Why

The v0.6 registered evaluation returned `FAIL` on both sealed eras. The
release-readiness outcome attributed it to the §9.1 no-trade band and to `k`
being unregistered. That attribution was right about the location and wrong
about the cause: `k`'s *value* was never the problem, the band's *form* was.

Re-measured on the calibration era only (Appendix D of the paper), the causal
chain is:

1. §7.3's selection loss was 99.84% `downsideRate` — a statistic ≈0.5 for any
   unbiased candidate — and omitted the turnover and sacrificed-return terms
   §7.3 already promised. Horizon selection came down to a 1.27e-7 margin.
2. Residual dispersion is near-flat in the horizon (×1.19 at 14d, where
   independent increments predict ×3.74) because the label is a *mean* rate over
   the window. Expected horizon return is linear in H. Signal-to-noise is
   therefore 1.5–2.6 at H=1d and 15.8–24.6 at H=14d.
3. A threshold stated in horizon-return units inherits that scaling. The v0.6
   rule's implied hurdle was **7.74% APY at H=1d** and 0.66% at H=14d, against
   venue means of 4.86–6.13%.
4. So the gate never opened. SRCLA made 1 and 0 rebalances on the two eras.
5. Which produced four of the five gate failures: no outperformance, no
   statistical distinguishability (degenerate difference series), inert
   ablations, and coverage failures attributed to SRCLA that belonged to
   baselines.

Two further defects compound it: the gate is binary over the whole target
vector, and deploying idle cash is priced as a rotation. Measured, the second
costs **494 bps/yr** against **18–43 bps/yr** for all rotation alpha combined.

And one outright bug: the registered artifact records `residualPanelBuilt:
true` but carries no panel — `freeze-artifact.ts`'s `artifactJsonFor()` never
serializes it and `artifact.ts`'s `parseArtifact` never reads it — so P2's
weight-dependent portfolio quantile and P8's dispersion silently used a frozen
scalar. That is the mechanical cause of the inert-ablation failure.

## 2. Scope

In scope: `srcla/src/policy`, `srcla/src/forecast`, `srcla/src/evaluation`, and
`srcla/scripts/freeze-artifact.ts`. Out of scope: contracts (the on-chain
guardrails are unaffected — every change here narrows or redirects what the
allocator proposes, never what the vault permits), `be/`, `fe/`,
`expo-wallet/`, and universe expansion (paper §13's named next phase).

The on-chain interface is unchanged. `submitPlan` still receives a target
vector and a reserve; only the off-chain derivation of that vector changes.

## 3. Design

### 3.1 Artifact completeness (P23) — do this first

Everything else is measured through the artifact, so an artifact that silently
drops fields makes every later measurement unreadable.

- `artifactJsonFor()` in `scripts/freeze-artifact.ts` serializes `residualPanel`
  alongside every other field.
- `parseArtifact` in `src/policy/artifact.ts` maps `residualPanel` into the
  parsed body, and `computeArtifactHash` covers it.
- A registered (non-provisional) artifact missing any field the policy reads
  **fails to load**. No silent fallback. The frozen-scalar path stays only for
  the bootstrap artifact, which is `_provisional` and cannot be cited.
- New registered fields: `payback` ($T_{\mathrm{pay}}$), `adjustmentRate`
  ($\lambda$), and `edgeWindowEffective` ($W_{\mathrm{eff}}$).

### 3.2 Movement cost by leg (P14)

`movementCostBase` in `src/policy/steps/cost.ts` takes the leg kind into
account. `impact` and `slippageMev` are computed on `harvest` notional only;
`deploy` and `divest` notional contributes gas, failure and buffer.

This is not a tuning change. A lending supply/withdraw executes at the
protocol index — no quoted price, no spread, no sandwich surface — and the rate
consequence of size is already priced by the §6.1 post-deposit curve, so
charging bps as well double-counts it. `MOVE_COST_TERMS` keeps all eleven
names; the lending legs contribute zero to two of them.

Expected effect: `C_move` on a rebalance falls from ~8 bps of notional to
gas-only, which is what §9.1 always claimed it was.

### 3.3 Two hurdles, in annualized units (P13, P15, P16)

Replace `noTradeBandBase` and the single `costGate` threshold with two rules in
a new `src/policy/steps/hurdles.ts`, keeping `cost.ts` for cost accounting only.

**Deployment** (idle → venue), per venue `i`, amount `m`:

```
deployClears(i, m) :=  ell_i * (payback / YEAR) * m  >  lendingCost(m)
```

No dispersion term. `ell_i` is already the §7 lower bound at the registered
coverage.

**Rotation** (venue `j` → venue `i`), amount `m`:

```
rotateClears(i, j, m) :=
    (ell_i - ell_j)  >  lendingCost(m)/m * (YEAR/payback)  +  k * se(i, j)

se(i, j) := sqrt( (sigma_i^2 + sigma_j^2 - 2*rho_ij*sigma_i*sigma_j) / W_eff )
```

`sigma`, `rho` and `W_eff` come from the artifact's residual panel — the same
panel §3.1 restores, which is why that task is first. Both sides are annualized
rates, so neither rule references `horizonSeconds`.

### 3.4 Per-leg evaluation and partial adjustment (P17)

`decide.ts` currently discards the whole target when `costGate` fails. Replace
with:

1. Diff `target` against `current` into legs.
2. Evaluate each leg against its own hurdle (deploy legs → §3.3 deployment;
   divest/deploy pairs → §3.3 rotation, matched in a registered order).
3. Form the sub-target from the surviving legs.
4. **Re-check feasibility** of the sub-target against §8.1's reserve and §8.2's
   caps — a subset of a feasible target need not be feasible. On failure, take
   the largest feasible subset in the registered ordering.
5. Emit `x + lambda * (x_sub - x)`.

The aggregate brakes — cooldown, min/max turnover, reversal allowance — stay
where they are and continue to gate the *plan*, not the legs.

`CostGateResult` becomes a per-leg record so §11.4's hurdle-block census can be
rendered from it. This is the diagnostic that would have identified the v0.6
defect from the run record alone.

### 3.5 Decision-focused forecast selection (P18)

In `src/forecast/grid-sweep.ts`:

- Standardize each loss term across the candidate grid before weighting.
- Zero-weight any term whose interquartile range across the grid is below a
  registered threshold, and report it as a diagnostic. `downsideRate` will fall
  out this way on this data, which is the correct outcome — it does not
  discriminate.
- Add `turnover` and `sacrificedReturn`, computed by running the registered
  decision rule (§3.3–3.4) over the calibration era under each candidate
  artifact. This is the expensive part and the reason the k-sweep timed out in
  v0.6 (ruling F15); see §5.
- Record the selection margin in the artifact. Below the registered threshold,
  resolve on the economic terms; if still tied, take the longer horizon.

### 3.6 State-space forecast candidate (P19)

New `src/forecast/state-space.ts`: a mean-reverting level model on utilization,
mapped through the venue's exact IRM using the `irm*` columns already stored per
origin. It enters the same grid, is scored by the same loss, and wins only if it
wins.

Measured motivation: one-day persistence R² for utilization is 0.758 / 0.918 /
0.915 against −0.206 / 0.430 / 0.042 for the rate. The map must refuse to
extrapolate outside the utilization range observed within the current
configuration regime.

### 3.7 Evaluation protocol (P20–P22, P24–P28)

**Paper v0.8 reorders this section's priorities.** Sustainability, not yield, is
the primary criterion; yield is scored only among sustainable comparators. The
mechanics below are unchanged in kind but change in what they gate.

`src/evaluation/kernel/gates.ts`, in gate order:

1. **Demonstration floor (P25) — first.** Time-weighted capital-at-work below
   the registered floor → every sustainability criterion reports
   `NOT DEMONSTRATED`. Without this, B0 (all idle) is the study's most
   sustainable policy and v0.6's SRCLA passes at the tier where it earned
   0.000%. This single check is what keeps the reframing honest.
2. **Completeness and reproducibility**, including the fork replay (§3.8).
3. **Sustainability (P24, P26) — primary, absolute, per tier.** S1
   redeemability (withdrawal success + time-to-full-exit), S2 stressed
   coverage, S3 capacity discipline (venue-stress contribution, displayed-vs-realized
   gap), S4 continuity, S5 **scale invariance — every tier independently, never
   an average**. Scoped to SRCLA's runs; comparator outcomes are computed
   identically, reported, and govern admissibility at step 4 (P20).
4. **Yield among sustainable policies (P27).** Non-inferiority, one-sided at
   registered `delta`, HAC plus block bootstrap. A comparator that failed step 3
   at that tier is excluded. All excluded → `NO SUSTAINABLE COMPARATOR`.
5. **The price of unsustainability (P27).** Per excluded policy per tier:
   realized return, criterion broken, margin. This is a *published result*, not
   a diagnostic — it is the paper's headline quantity.

Unchanged from the v0.7 design:

- **Ablations leave the baseline comparison.** H1–H7 and H3d are scored in a
  separate §11.3 table with `INERT` / positive / **negative contribution**
  verdicts.
- **Skill window** = B5 − best *sustainable* baseline, computed before step 4.
  Inside `delta`: a *superiority* claim reports `NOT INFORMATIVE`; a
  *non-inferiority* pass is published with the window and a weak-evidence
  disclosure. Opposite directions, separate branches. **It can never touch
  steps 1–3** — yield can be beyond reach, redeemability cannot.
- **Forecast gate runs.** `release-gates.ts`'s `evaluateForecastGate` is
  currently dead code with only spec-file callers; it is replaced by a
  registered implementation invoked by the harness and rendered by the report.
  `evaluatePolicyGate` — the weaker duplicate the operator proposal-review
  endpoint uses — is re-pointed at `kernel/gates.ts` so one definition governs.

Three new metrics (P28) feed S1 and S3 and must be computed in the replay:
time-to-full-exit, venue-stress contribution, and the displayed-versus-realized
yield gap.

New registry entry `h3d`: remove the deployment hurdle only, retaining the
rotation hurdle. v0.6's H3 removed both and could not report which it measured.

§11.4 metrics gain capital-at-work fraction, deployment latency, idle drag, and
the hurdle-block census.

### 3.8 Fork replay (§11.1)

`src/evaluation/fork-runner.ts` is wired to the harness so the §11.5
completeness check can verify rather than report `NOT PRODUCED`. It blocks the
gate unconditionally today regardless of anything above.

## 4. Testing

Follows the repo's existing split: plain-TS logic is unit-tested; nothing here
touches a screen or a chain SDK, so all of it is unit-testable.

- **Hurdles**: table-driven cases at the measured artifact values, asserting the
  *implied APY thresholds* rather than internal intermediates — the property
  that failed in v0.6 is expressible directly as "idle deploys at 5% APY".
- **Horizon independence**: the same scenario at H = 1d, 7d and 14d must produce
  the same hurdle decision. This is the regression test for the whole class.
- **Cost attribution**: a deploy-only plan and a harvest-only plan of equal
  notional must differ by exactly the impact and slippage terms.
- **Per-leg**: a two-leg target where one leg fails must execute the other, and
  must re-check feasibility of the survivor.
- **Artifact completeness**: a registered artifact missing `residualPanel` must
  throw, not fall back. A round-trip through freeze → parse must preserve every
  field and the hash must change when the panel changes.
- **Gate scoping**: a run where only a *baseline* breaches coverage must PASS
  the safety check and exclude that baseline. A run where SRCLA breaches must
  FAIL.
- **Skill window**: a narrow window must make a superiority claim
  `NOT INFORMATIVE` and must *not* alter the non-inferiority verdict.
- **Selection loss**: a grid where one term is constant must give that term zero
  weight; a grid where the accuracy-optimal candidate has ruinous turnover must
  not select it.

Golden-vector tests for the state-space map against the protocols' own
`getSupplyRate` at below-kink, at-kink and above-kink utilizations.

## 5. Known risks

**The decision-focused loss is expensive.** Ruling F15 records that the v0.6
`k` sweep reached 0 of 7 candidates in 65 minutes because every candidate
evaluation computed coverage. §3.5 makes each grid point run a full decision
replay, which is strictly more work. Mitigation: the replay used for *selection*
runs on a registered subsample of origins with the subsample rule registered in
the artifact, and the full replay runs once for the winner. If that is still
too slow the sweep is staged — accuracy terms prune the grid, economic terms
rank the survivors — and the staging is registered before it is used.

**Nothing here can be validated on held-out data yet.** heldout-c and heldout-b
are burned (paper's third burned-window declaration). The registered evaluation
of v0.7 runs when a fresh era sealed after commit `e8f7474a` reaches the
registered minimum length; heldout-b grows ~30 days a month. Until then the
only evidence is calibration-era, and the report must say so.

**Expected outcome is not a PASS.** Even with all of the above, the fork replay
must be wired (§3.8) or §11.5 blocks, and the skill window on three venues is
18–43 bps, so the yield criterion will report a non-inferiority pass with a
weak-evidence disclosure rather than a superiority result. That is the designed
outcome, not a shortfall.

**The sustainability claim is currently untested, not established.** Appendix E
of the paper records that SRCLA never breached redeemability on either v0.6
era — but it earned 0.000% at every tier on one of them, so under the new
demonstration floor that record reports `NOT DEMONSTRATED` rather than a pass.
The controller work in the companion plan is what makes the claim testable; the
gate work here is what will test it. Neither on its own produces a result, and
the implementation must not be described as if it did.

## 6. Open decisions for the paper owner

These are registrations, not code choices, and each must be fixed before the
freeze:

1. `delta`, the non-inferiority margin.
2. `payback` ($T_{\mathrm{pay}}$) — swept jointly with `k` and `lambda`, but the
   sweep's grid is a registration.
3. The minimum length of the fresh sealed era before v0.8 may be evaluated.
4. The registered leg-ordering used when a sub-target is infeasible.
5. Whether the selection subsample in §5 is acceptable, or whether the grid
   shrinks instead.
6. **The demonstration floor (P25)** — the time-weighted capital-at-work below
   which a run proves nothing. It must exceed what a cash-holding policy
   achieves and sit below what a fully deployed policy achieves net of the idle
   reserve; with `minIdleBps` at 500 the mechanical ceiling is 0.95. A floor of
   0.80 is the working suggestion, and it is a registration, not a tuning knob.
7. **The time-to-full-exit bound (P28/S1)** — how many origins a complete
   redemption may take before redeemability is considered failed.
8. **The venue-stress contribution bound (P28/S3)** — the share of a venue's
   utilization the vault may itself account for. This is the knob that encodes
   "do not create the congestion you will then suffer".
