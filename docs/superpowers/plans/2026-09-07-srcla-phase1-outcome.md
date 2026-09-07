# SRCLA Phase 1 — Outcome, Open Gaps and Runbook

**Date:** 2026-09-07  ·  **Branch:** `feat/srcla-paper-conformance`  ·  **Commits:** `95e8e14..c1d1cc9b` (36)
**Plan:** `docs/superpowers/plans/2026-09-07-srcla-paper-conformance-phase1.md`
**Spec:** `docs/superpowers/specs/2026-09-07-srcla-paper-conformance-design.md`

Final whole-branch review: **READY** after one fix wave. 721 tests, `tsc` clean.

## Open gaps carried out of Phase 1

These are real and named. None is a surprise; each was ruled on deliberately.

| # | Gap | Why it was not closed |
|---|---|---|
| 1 | **Collector supplies no market data** — `snapshot-collector.ts` hardcodes `supplyRate/utilization/cash = 0n`. Every rate curve is flat. | Needs protocol-specific live-chain reads. Phase 1 makes it REFUSE (`NO_MARKET_DATA`) instead of emitting a plausible HOLD. **This is the single biggest thing standing between the kernel and a real decision.** |
| 2 | **`persistForecastLabel` has no caller** — `input.history` is permanently empty, so `REGIME_MIN_HISTORY` can never pass. | Second admission blocker, independent of pinned digests. Needs a label-writing path. |
| 3 | **Fork checkpoint never run** — `pnpm phase1:check` is written, typechecked, reviewed for signature correctness; never executed. | Needs Anvil + fresh deploy + funded vault. Not provisioned. See runbook. |
| 4 | **Schema never validated against Postgres** — `prisma db push` and the persistence round-trip never ran. | No database on :5433. Additive-only and reviewed as push-safe, but unproven. |
| 5 | **§10.3 reconcile is narrower than the paper** — checks plan-cursor/plan-cleared, not balance deltas and events. `verifyChain` covers live config, not sender-nonce/chain identity. | Writing untested chain-reading code blind is what produced the `submitPlan` encoding bug. Defer to the fork work. |
| 6 | **§6.2 oracle-freshness admission check unimplemented** | No field carries an oracle round/staleness. A rule reading a field nothing populates would always pass — a fake check, worse than an absent one. |
| 7 | **Four of five gas/price inputs are placeholders** | No oracle wired. Execution is guard-blocked until real values are supplied. |
| 8 | **Execution lock is an unconfigured sentinel** that throws | No durable store. Fails closed by design. |
| 9 | **6 of 7 pre-existing `scripts/` have type errors** | Pre-existing, exposed by the new `typecheck:scripts` gate. Untriaged, out of scope. |
| 10 | **`POST /v1/internal/trigger` is a mutation on the read API** | Paper §10.2 forbids it; spec §10 relocates it to a loopback operator listener in Phase 3. |

## Operator runbook — running the Phase 1 exit gate

```bash
anvil --fork-url https://mainnet.base.org --code-size-limit 100000   # :8545
cd contract && forge script script/DeployNavyVaultSRCLA.s.sol --fork-url http://127.0.0.1:8545 --broadcast
#   -> copy the new addresses into srcla/.env.anvil (they change every redeploy)
forge script script/FundVaultAnvil.s.sol --fork-url http://127.0.0.1:8545 --broadcast
#   -> srcla Postgres on :5433, then: cd srcla && pnpm prisma:push
export KEEPER_PRIVATE_KEY=<key holding ALLOCATOR_ROLE>
#   -> set the four SRCLA_REAL_* price vars, or accept the pricing-guard block
cd srcla && source .env.anvil && pnpm phase1:check
```

Read the `RESULT:` banner. Only **BROKEN** exits non-zero; **EXECUTED**, **HOLD** and **BLOCKED** are distinguished in the banner text.

## Rulings made during execution

Extracted verbatim from the execution ledger. Each records the decision, the reason, and the cost if wrong.

```text
Ruling: T8 must import rateAt from ./simulate.js and delete the local rateAtHorizon duplicate.
  Why: optimize -> forecast -> simulate is acyclic, so the stated cycle does not exist; the
  duplicate is verbatim logic duplication the review rubric treats as a defect.
  Cost if wrong: if a real cycle appears, T8 reverts to a local helper (one small edit).
--
Ruling: implementers MUST stage and commit by explicit pathspec (`git commit -- <paths>`),
  never `git add -A` or a bare `git commit`.
  Why: 7 files of the user's pre-session work are staged in the index (De-cuong.pdf,
  image.png, be/src/vault/vault-apy.service.spec.ts, srcla/src/{index,http/routes,
--
Ruling: T13's plan text says `git add -A src test`; overridden to explicit pathspec per above.
  Cost if wrong: none; strictly narrower.

Ruling: T12 and T16 have external prerequisites (Postgres :5433; Anvil fork + deployed
  addresses). If unavailable, the implementer reports BLOCKED rather than stubbing;
  I will park the task and continue, since T13-T15 do not depend on T12's migration
  having been applied to a live database.
--
Ruling: the plan is split across 3 files, so task-brief creates 3 workspaces. ONE ledger
  lives in .../2026-09-07-srcla-paper-conformance-phase1/ and briefs from the companion
  workspaces are copied into it. The two companion workspace dirs are scratch only.
  Cost if wrong: none; purely organisational.
--
  Ruling: reviewer's finding 4 (k and sigma-hat undefined in the new action rule) upgraded
  Minor -> Important. Why: Task 9 implements this band (noTradeBandK / sigma from the
  artifact's portfolio residual quantile) and cannot do so from an undefined symbol; a
  spec that names a term it never defines is not reproducible.
--
Ruling: PolicyArtifact.pinnedConfigDigests will be added in Task 2 rather than Task 4.
  Why: Task 2 creates src/policy/types.ts and Task 4's only change to it is adding this
  one field; splitting it makes Task 4 reopen a file it does not otherwise own and forces
  its tests to use `as unknown as PolicyArtifact` casts. Task 4 Step 4 becomes a
--
  Ruling: reviewer upheld in full; the plan's own test suite is the defect.
  The randomized "never admits a future label" test is vacuous - with lag=600 and
  i in [0,199] every label is rejected, so kept is always [] and the assertion loop
  never executes. It would pass against an arbitrarily broken predicate. Neither
--
  Ruling: ADD the dependency-membership rule now (DEPENDENCY_UNREGISTERED) - the data
  already exists on MarketObservation/DecisionInput, so it is a real check.
  Cost if wrong: one extra reason code nobody trips.
  Ruling: DO NOT add an oracle-freshness rule in this task, despite paper 6.2 naming it.
  Why: no field in MarketObservation carries an oracle round or staleness, so the rule
  would either always pass (a fake check - worse than an absent one, because it looks
  like coverage) or always fail (blocking every venue). Deferred to the task that
--
  Ruling: Compound annualization fix in simulate.ts stands.
  Ruling: Moonwell IS in scope despite being pre-existing and in a file this task does not
  own. Why: one of only three venues; an information-free curve corrupts optimiser
  ranking over a third of the universe and invalidates the H1 capacity ablation, which
  is the one component SRCLA-REPORT v2.0 found actually earns its keep (+1.33pp at 10M).
--
  Ruling: do NOT restructure all three simulators onto one unit convention - cleaner but
  out of scope and would break existing tests. Instead the convention is made explicit
  (comment block) and pinned by a continuity test across all three protocols.
  Cost if wrong: the inconsistency survives into Phase 2+ and must be normalised later.
--
  Ruling: reopen Task 5 for a second fix round.
  Why: the whole point of this task is that a large deposit measurably lowers the
  attainable rate. A constant simulator makes the optimiser (Task 8) rank venues on
  base rate alone and renders the capacity machinery decorative - while every test
--
  Ruling: add a MATERIALITY test using explicit test-local IRM parameters, not
  DefaultConfigs, so it pins the model rather than a config constant; it must fail
  against the old slopes.
  Ruling: add optional MarketObservation.irmParams as the seam for live on-chain
  parameters, since paper 6.3-6.5 requires the LIVE registered rate strategy and
  hardcoded defaults are non-conformant even once the slopes are sane. Do not populate
  it here; the collector task owns that.
--
  Ruling: acceptable for Phase 1 - irmParams is unpopulated so nothing can hit it yet,
  and Aave needs its own params variant rather than a Compound-shaped one.
  DEFERRED: Aave-shaped irmParams variant, owed by the collector task that populates
  the seam. Recorded so that task cannot silently produce an ignored override.
--
  Ruling: fix the Important finding. The empty-map fallback is the ONLY path the shipped
  bootstrap artifact exercises (it ships residualQuantileWadByMarket: {}), so it is
  today's live production behaviour, yet the test helper always injects a 2-entry map
  and never reaches it. Safe by hand-analysis is not the same as protected.
--
  Ruling: do NOT change the fallback behaviour - both reviewer and I judge it correct.
  Documentation plus coverage only.
Task 6: fix round 1/5 dispatched - 2 findings (fallback-path tests incl. one using the
  real shipped artifact; comment explaining the deliberate portfolio-quantile fallback)
--
  Ruling: fix the quantile scale as part of Task 11 (decide.ts), the first task that runs
  the whole kernel end to end and would hit both. Not Task 8's to fix - it correctly
  stayed out of Task 6's file.
  Cost if wrong: Task 16's exit gate requires observing a real on-chain execution and
--
  Ruling: Task 11's brief contains ANOTHER vacuous test of the same family - "emits a
  plan whose header carries a non-zero snapshot hash when it rebalances" is wrapped in
  `if (out.action === 'rebalance')`, so it passes silently when nothing is deployed.
  Must be made unconditional when Task 11 runs.
--
  Ruling: reviewer's finding 1 (Important) is a REPORT undercount, not a code defect -
  a 6th fixture ("prefers the venue with the higher lower bound", capBps 5000->6000)
  was also substantively repaired but omitted from the implementer's tally. Recording
  the corrected count here rather than spending a fix round editing an SDD artifact
--
  Ruling: fix to a blob-based model and add an ANCHOR test pinning pure-execution cost to
  the measured order of magnitude (<$0.10 for 3 actions), which must fail against the
  old formula.
  Why: this gate decides whether a rebalance happens at all. A 259x cost overstatement
--
  Ruling: leave impact and slippageMev alone - bps-of-notional modelling overlays,
  correctly scaled, not measured gas.
Task 9: fix round 1/5 dispatched - 3 findings (blob L1 model, anchor test, re-derive the
  two repaired fixtures in case they leaned on the inflated cost)
--
  Ruling: restructure so C_L2 is plan-level overhead (submission + per-action dispatch)
  and C_exit/C_entry/C_claim are the protocol-call gas. The paper lists them as
  separate components, so they must measure different things.
  Cost if wrong: cost is understated instead of overstated, making the gate too
--
  Ruling: add a NON-OVERLAP test (no term equals the sum of others). This is the guard
  whose absence let a duplicated term pass a total==sum check. Must fail pre-fix.
  Ruling: STRIKE my "L1 data cost must be non-zero" requirement. Reviewer confirmed the
  implementer's reading - at the 1-wei protocol floor the value is below six-decimal
  USDC resolution, so zero is economically correct and does not recur at realistic blob
  fees. My constraint was carried over from the calldata model without re-examination.
--
  Ruling: fix all five findings.
  Finding 2 is the substantive one: the encoding parity tests recompute "expected" with
  the same AbiCoder call the implementation uses, so they prove self-consistency, not
  correctness - they cannot catch a shared ABI misunderstanding. The Merkle tests are
--
  Ruling: carry as a HARD REQUIREMENT in Task 14's dispatch and an explicit check in its
  review, rather than restructuring now for a witness/token type-level chokepoint.
  Why: Task 14 is the only consumer, so a chokepoint would be over-engineering for one
  call site; but the requirement must be explicit rather than left to a comment.
--
  Ruling: durable guard is a NO-NETWORK ROUND-TRIP TEST through the REAL PlanExecutor -
  build calldata via the real path, decode with the same ABI, assert every header field
  round-trips. Must be confirmed failing against the broken encoding first.
  Cost if wrong: none; it is a pure encoding test needing no chain.
  Ruling: harvest MUST be gated (reviewer and I agree) - its minOut and route economics
  are exactly the price-dependent risk the guard exists for. emergencyExit stays
  UNGATED - correct, it is an admin incident lever and blocking it because a price feed
  is a placeholder would be backwards. The implementer had these as a pair; they are
--
  Ruling: delete dead execute/executePlan/executeWithRecovery - unreachable, but they
  submit through the weak executeAction with empty proof and minOut=0.
Task 14: fix round 1/5 dispatched - Critical encoding fix + round-trip test, missing
  preflight conditions, dead-path deletion, harvest gating
--
  Ruling: wire it NOW, tightly scoped. executePlanDraft keeps guard-first behaviour and
  header preflight; only the ACTION LOOP moves into runSubmissionLoop. Chain-facing deps
  wire to real executor methods. acquireLock/persistIntent/releaseLock become REQUIRED
  injected deps rather than defaulting to no-ops - a silent no-op lock is worse than no
--
  Ruling: do NOT implement a Prisma-backed lock or start a database. Define the interface;
  the caller provides the implementation.
  Two further test gaps the implementer's own mutation review missed, both Important:
  mocks ignore the planId argument entirely (a swapped or dropped planId passes all 9
--
  Ruling: DEFER both, do not fix now. Building balance-delta reconciliation requires
  reading token balances before and after each action - chain-reading code I cannot test
  without a fork. Writing it blind is exactly what produced the submitPlan encoding bug
  that 19 mocked tests missed. Execution is blocked regardless by the fail-loud lock
--
Ruling: ONE fix wave per the skill, then one scoped re-review, then adjudicate residuals.
Final fix wave: dispatched
```
