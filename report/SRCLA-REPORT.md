# SRCLA Evaluation Report

**Generated:** 2026-09-13T08:20:27.612Z · **Code:** `deae84084edd026baf3baf64902ca6403dc1bdfa` · **Artifact:** `694cf86f6f7363f2f76a19ce66781ae82311ab1cbd2b7220b3aab94bda8223cf`

> Regenerated from `src/evaluation/report/`. It supersedes every earlier version of this file, which was produced by an untracked `evaluation-v2/*.mjs` harness that is not the code this repository ships.

## What this study claims — and what it does not

This report evaluates **sustainability**, not yield superiority. The claim under test is that SRCLA remains **redeemable, liquid and within its own limits at every registered scale**, while earning a rate that is **not materially worse** than a baseline that is itself sustainable at that scale.

The motivation is that the highest advertised APY is frequently the least redeemable one. A rate is quoted on a venue at a utilization the quote itself helped create; a depositor large enough to move that utilization is a depositor who cannot leave without moving it back. §11.4 measures three quantities that a yield table cannot show: how long a full exit takes, how much of a venue the vault itself became, and how far the **displayed** rate sat above the rate actually **realized**.

Concretely, this report does **not** claim, and must not be cited as claiming:

- that SRCLA earns the highest return among the policies evaluated;
- that a policy excluded from the yield comparison was outperformed — it was excluded for **breaching a sustainability criterion SRCLA is held to**, and its return is published in full as the measured price of that breach;
- that any figure here describes real user redemption behaviour (withdrawals are a registered schedule — see below).

The release decision therefore reads in §11.5's order: **demonstration → completeness → sustainability → yield**. A run that is not sustainable at every registered tier does not reach the yield question at all, however well it scored on it.

## Verdict

> **DO NOT RELEASE.** At least one registered era blocked at least one §11.5 gate. The blocking checks are itemised below and evidenced in full further down.

### `heldout-c` — 86d, 2064 origins

**Forecast gate: FAIL**

- Kupiec unconditional coverage — aave-v3-usdc
- Kupiec unconditional coverage — compound-v3-usdc
- Kupiec unconditional coverage — moonwell-usdc

**Policy gate: FAIL**

- §11.1 pinned-prestate fork replay
- Non-inferior to every sustainable baseline (margin 43.0 bps)

### `heldout-b` — open-ended, 413 origins

**Forecast gate: FAIL**

- Kupiec unconditional coverage — aave-v3-usdc
- Kupiec unconditional coverage — compound-v3-usdc
- Per-venue coverage — moonwell-usdc
- Kupiec unconditional coverage — moonwell-usdc
- Christoffersen conditional coverage — moonwell-usdc

**Policy gate: FAIL**

- Demonstration: sustainability was demonstrated while deployed
- §11.1 pinned-prestate fork replay
- Safety: stressed liquid coverage
- Sustainability S1: complete exit within the registered bound
- Sustainability S3: venue-stress share (utilization-ceiling clause NOT EVALUATED)
- Sustainability S4: action validity (§11.5 violation classes NOT EVALUATED)
- Sustainability: scale invariance across every registered tier (P26)

A `FAIL` here is a result, not an error. §11.5 requires publishing a negative result rather than retuning against held-out data, and nothing in this run was retuned after a sealed era was opened.

## Read this before citing any number

### Registered eras

| Era | Start | End | Days | Sealed |
|---|---|---|---|---|
| `calibration` | 2024-03-15 | 2025-05-31 | 443 | — |
| `burned-a` | 2025-06-01 | 2026-02-28 | 273 | — |
| `heldout-c` | 2026-03-01 | 2026-05-25 | 86 | **sealed** |
| `burned` | 2026-05-26 | 2026-08-23 | 90 | — |
| `heldout-b` | 2026-08-24 | open | open | **sealed** |

An era with an End of `open` grows with the live collector; its effective end is whenever collection last ran, reported per era in the measured-coverage table below.

Each era's registered role, in full — none of this is abbreviated, because the caveats are the point:

- `calibration` — The ONLY data any artifact, quantile, grid point or no-trade band may be fit on. 443 days, extended back to the deployment floor for v0.6.
- `burned-a` — Former PRIMARY held-out era (was heldout-a). Its aggregate statistics were read while diagnosing v0.5, which burned it under paper §2.2 -- it is design data now, not held-out. Excluded from fitting and from evaluation alike, same as `burned`.
- `heldout-c` — v0.6 VALIDATION era, 86 days. Sealed until the registered run. LESS BURNED, NOT PRISTINE -- see disclosure 3. Used because heldout-b alone is too short and too dominated by one venue's liquidity failure to adjudicate a yield claim.
- `burned` — Paper §4.1 DESIGN DATA. Read and reasoned about while deriving amendments P1-P8, so it is in neither the calibration nor a held-out era. Excluded from fitting and from evaluation alike. See disclosure 1.
- `heldout-b` — SECONDARY held-out era, chronologically after everything including the burned window, and growing with the live collector. Low power; reported for temporal purity, not for significance.

**Three deviations are disclosed, not buried:**

1. Paper §4.1 says the burned window "lies inside the calibration era". Here it lies in **neither** era. Putting it in calibration would place fitting data *after* `heldout-c` in time, inverting walk-forward order and creating exactly the look-ahead §7.3 forbids. Excluding it satisfies §4.1's purpose — the window must never be held-out — strictly more than including it would. This is a paper-owner decision.
2. `heldout-c` (Mar–May 2026) **precedes** the burned window in time. The amendments P1–P8 and the code were designed with knowledge of May–Aug 2026, so a designer who knew the later period could in principle have chosen mechanisms that suit the earlier one. `heldout-b` is chronologically after everything, including the burned window, and carries no such caveat — but it is only 16 days. **Both sealed eras are reported: `heldout-c` for what statistical power exists, `heldout-b` for temporal purity. Neither alone is sufficient.**
3. `heldout-c` is **less burned, not pristine.** It was carved out of the era this project called held-out A in v0.5. That era's *aggregate* statistics — net APY, worst stressed coverage, total cost and turnover — were read while diagnosing v0.5, which is why the remainder of it is now `burned-a` and is reported by nothing. What was learned is that era's overall direction, not this 86-day period's structure, so `heldout-c` is weaker evidence than a never-seen era would be and stronger than `burned-a`. It is used because `heldout-b` alone cannot adjudicate a yield claim.

### Withdrawals are a registered schedule, not observed

`withdrawalSource` = `registered-schedule`. The Navy vault has no Base mainnet history, so §8.1's `W_H` has no real series over this window and `Q_β(W_H)` is computed against a registered schedule. No claim in this report is evidence about real user redemption behaviour.

### Quantities the decision needs that the dataset does not carry

- per-venue absoluteCapBase / maxLossBps / dependencyGroupIds
- dependency group registry (id, capBps, absoluteCapBase, members)
- protocol supply-cap headroom (maxDeployableBase)
- vault adminReserveBase / minIdleBps

Each is supplied as a registered constant, never inferred from data. Gas and oracle observations are **no longer** on this list: they are measured per origin from the block header, the OP-Stack GasPriceOracle and the two Chainlink feeds (series digest `0x0dea1516387012faeeddeb7cb5d44a8858e71ceec7da511b6899dbdec9f6c555`).

### Known archive-read inconsistencies

The archive is read from Base mainnet at historical blocks, and a historical read can be wrong in ways a gap check does not catch. Every such defect found is listed here with its measured magnitude, whether or not it changes a result.

- **31 spurious single-hour Aave regime boundaries** survive in the `burned` (17 rows) and `heldout-c` (14 rows) eras. Each is an isolated one-hour flip of `irmSlopeLowWad` (450 bps → 460 bps → 450 bps) at an IDENTICAL block number and an identical strategy address, reverting at the next hourly sample — the signature of an inconsistent archive read against a lagging RPC replica, not of governance action. The controls are direct: `burned-a` shows zero such flips, and calibration's 1,082 Aave regime changes are 100% genuine rate-model ADDRESS swaps with zero same-address flicker. Measured effect on the Aave rate-model mean absolute error is 5.8e-4 percentage points. The rows were NOT re-read: the magnitude is immaterial to every reported result, and re-reading archive data once a sealed era is open is itself a hazard. Disclosed, not repaired.
- An earlier account of this defect — that Aave V3.2 mutates rate parameters in place — was WRONG and is retracted. Row-level diffing showed isolated same-block, same-address flicker, which no in-place governance mutation produces.

### Reproducibility caveats

- **THIS IS NOT A CLEAN PRE-REGISTERED TEST OF `heldout-c`, and must not be cited as one.** An earlier registered run opened both sealed eras and returned FAIL. Its results then informed two changes made before this run: a re-specification of P1's uncertainty term, and a revision of four release thresholds. `heldout-c` has therefore INFORMED THE DESIGN and is design data by §2.2's own standard. This run is a CONFIRMATORY RE-RUN. The only era carrying no design knowledge of this controller is a future one.
- The mitigating facts, stated so a reader can weigh them rather than take the above as boilerplate: P1's re-specification was derived from CALIBRATION-era measurements only (per-band forecast-error dispersion), it is stricter than what it replaces above 6.90% APY, and it was chosen before its effect on any sealed era was known. The threshold revisions were NOT: each is justified on its own terms below, but each was made after seeing which checks blocked.
- **Revised release thresholds** (previous → current): demonstration floor 0.80 → 0.70; S2 stressed coverage 0.99 → 0.95; regime purity zero-tolerance → a 10% share; "no inert ablation" from BLOCKING to REPORTED. The non-inferiority margin was left at 43 bps precisely because raising it could only have been justified by the result it would produce. S2's grading floor was also SEPARATED from the constant the optimiser filters candidate allocations with, so relaxing the release bar does not silently relax the controller's own safety filter.
- **Decision hashes from this version are not comparable to v0.6 ones.** The hashed decision component is now `legs` where it was a permanently-constant empty `costs` object, and the bootstrap `artifactHash` moved. An externally recorded decision hash from before this change will not reproduce; that is a documented format change rather than evidence of non-determinism.
- **P36 — the movement hurdles now read the relative bound. This change is POST-HOC and is disclosed under P32.** P29 made the uncertainty haircut multiplicative in the optimiser's objective, but §9.1.2/§9.1.3's hurdles kept computing `rate + q_abs·year/H` from the absolute map — −4.09 pp (Aave), −2.11 pp (Compound) and −3.12 pp (Moonwell) annualised at the registered 1-day horizon — so a vault large enough to compress a venue's post-deposit rate below that haircut could not deploy into it at all. The defect was FOUND by reading the previous run's `heldout-c` ablation rows, where H3d restored capital at work at ten million. It is justified by P29's own calibration-era measurements and by conformance to §7.1, not by any held-out number. Its go/no-go was a calibration-era sweep (2025-03-03 → 2025-05-31, sixteen vault sizes) with three criteria fixed before it ran. Two passed: stressed coverage held at 1.000 at every size, and net APY at or below one million USDC moved by +0.3 to +1.4 bps. The third — capital at work and net APY no lower after the change at every size of $3M or more, with no tolerance — FAILED at $3M, $5M, $6.5M, $8M and $10M, by at most 0.72 percentage points of capital at work and 1.4 bps of APY (mean APY change at $3M or more: −0.03 bps). That window never exhibited the ten-million collapse (capital at work was already at least 0.917 before the change), so it could test for harm but not for benefit. **The repository owner overrode the failed criterion after seeing these numbers; that override is itself post-hoc.** The frozen artifact is unchanged (same hash, no refit). H2's switch now also removes the hurdle's haircut, which changes H2 and B3. Both sealed eras are therefore CONFIRMATORY RE-RUNS for P36.

## The registered forecast artifact

Fit on the calibration era only (2024-03-15 → 2025-05-31, 443d). Selected by the registered grid: **state-space**, horizon **1d**, coverage target **0.99**.

Per-venue achieved coverage (amendment P1 — the quantile is solved per venue to the target):

| Venue | Achieved coverage |
|---|---|
| `aave-v3-usdc` | 99.00% |
| `compound-v3-usdc` | 99.00% |
| `moonwell-usdc` | 99.00% |

**P8's `k` did not resolve.** The sweep was inconclusive, so `k` — the standard-error scalar in §9.1.3's rotation hurdle, formerly the `k*sigma` no-trade band's multiplier — remains at 1 as a registered default and every P8 result is provisional. A value chosen because it moves a gate would not be a registration.

### Freeze provenance

A registered artifact is frozen before any sealed era is opened and is never refit afterwards. How this one came to be frozen, and against what:

- The artifact was frozen by `pnpm phase4:freeze` against the corrected archive — the one in which every venue rate map reproduces chain and per-origin IRM attribution is present for all five eras. It selects `state-space` at a 1-day horizon on a selection margin of 0.4095 over the runner-up, so the choice is not a coin flip between near-ties.
- P1's residual quantile is carried in RELATIVE form (`relativeResidualQuantileWadByMarket`: aave -0.369, compound -0.260, moonwell -0.342), applied as `mu * (1 + q)` rather than `mu + q`. The absolute map is retained and still reported. The re-specification was derived from CALIBRATION-era measurements alone — the 5% lower quantile of absolute forecast error varies 2.9x-5.9x across utilization bands while the relative error varies 1.8x-2.9x and tracks the level being forecast — and it is STRICTER than the absolute form above 6.90% APY, looser only below it.
- P8's significance multiplier `k` did NOT resolve on the calibration sweep and is carried at its registered default. Every result that depends on it is provisional.

## Dataset and provenance

Every figure below is read directly from **Base mainnet** (chainId **8453**) at historical blocks, never simulated or assumed. Each hourly origin is one Multicall3 `aggregate3` batch against `0xcA11bde05977b3631167028862bE2a173976CA11`, calling Compound III Comet, the Aave V3 Pool and the Moonwell mToken directly rather than through the Navy adapters, which have no Base mainnet history of their own. **A venue that could not be read at an origin is recorded as a gap and never interpolated** — a missing observation stays missing rather than being filled from a neighbour.

### Per-era dataset coverage (measured, not declared)

The registered era boundaries above are what was *declared*; this table is what the archive actually *holds* for each — derived from every `MarketSnapshot` row's own `blockNumber` and `timestamp`, not from the boundary dates.

| Era | First date | Last date | First block | Last block | Origins | Days | Sealed |
|---|---|---|---|---|---|---|---|
| `calibration` | 2024-03-15 | 2025-05-31 | 11,835,726 | 30,971,526 | 10,632 | 443 | — |
| `burned-a` | 2025-06-01 | 2026-02-28 | 30,973,326 | 42,765,126 | 6,552 | 273 | — |
| `heldout-c` | 2026-03-01 | 2026-05-25 | 42,766,926 | 46,480,326 | 2,064 | 86 | **sealed** |
| `burned` | 2026-05-26 | 2026-08-23 | 46,482,126 | 50,368,326 | 2,160 | 90 | — |
| `heldout-b` | 2026-08-24 | 2026-09-10 | 50,370,126 | 51,111,726 | 413 | 17 | **sealed** |

### Venue registry

The three allowlisted yield venues, and the asset moved between them. Addresses are verified on-chain, not copied from memory. Rate figures are the observed Comet/Aave/Moonwell supply rate at every origin over the evaluated era(s), annualized.

| Venue | Market ID | Contract address | APY min | APY mean | APY max | Config regimes | IRM contracts |
|---|---|---|---|---|---|---|---|
| Aave V3 Pool | `aave-v3-usdc` | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | 2.31% | 3.06% | 13.05% | 4 | 1 |
| Compound III Comet | `compound-v3-usdc` | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | 2.19% | 3.79% | 14.41% | 1 | 1 |
| Moonwell mUSDC | `moonwell-usdc` | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` | 1.79% | 12.16% | 97.10% | 5 | 5 |

**Asset:** Circle native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals — the one unified USDC across every venue above.

### Measured execution-cost inputs

Gas and oracle values are **measured per origin, not assumed**: the L2 base fee comes from each block's own header; L1 fee parameters come from the OP-Stack GasPriceOracle predeploy at `0x420000000000000000000000000000000000000F`; ETH/USD and USDC/USD come from Chainlink at `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` and `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B` respectively. Ranges below are the min/max actually observed over each evaluated era, not a registered constant.

| Era | Observations | L2 base fee (wei) | L1 base fee (wei) | ETH/USD | USDC/USD | Gas-series digest |
|---|---|---|---|---|---|---|
| `heldout-c` | 2,088 | 5,000,000–83,554,996 | 24,660,517–14,616,020,080 | $1,839.6041–$2,451.6109 | $0.9997–$1.00 | `0x0dea1516387012faeeddeb7cb5d44a8858e71ceec7da511b6899dbdec9f6c555` |
| `heldout-b` | 437 | 5,000,000–3,427,489,358 | 34,783,083–5,127,002,769 | $2,367.1784–$2,534.7721 | $0.9998–$1.00 | `0xb76522b6823c9d60cc4e5e0d12bca0f645392ccf373373caf8f477fef7a94260` |


## Results — era `heldout-c`

2064 origins. Manifest `c75428629fcc200e73b9549e9087cf6cdd58ea17c8830ea570487a07615e1fa4`, dataset `230b5c117b8b7f3809f2b42dac014e0f1d6ace6e1a39e8d7b3658a06fda80640`, result `5787aef99afad5bcedcacda328c1169f55808587b8edf09ea14bb4cf3d4f90ee`. Reproduce with `pnpm run evaluation:verify`.

### Figures

Vault size is on a logarithmic axis in all three: the registered tiers span three decades, and a linear axis compresses 10k, 100k and 1M into the first tenth of the width — which is exactly the range where the controller behaves well.

![figures/SRCLA-FIG1-apy-by-vault-size-heldout-c.svg](figures/SRCLA-FIG1-apy-by-vault-size-heldout-c.svg)

**Figure 1 — Net APY by vault size.** Read this together with Figure 2: a yield curve alone cannot distinguish a policy that earns well from one that earns well by becoming unredeemable. Computed on every 3rd origin of the era over 16 vault sizes; §11.1's four registered tiers are unchanged and remain the only sizes any gate is scored on.

![figures/SRCLA-FIG2-coverage-by-vault-size-heldout-c.svg](figures/SRCLA-FIG2-coverage-by-vault-size-heldout-c.svg)

**Figure 2 — Stressed liquid coverage by vault size.** This is the paper's proposition in one picture. The policies that sit highest in Figure 1 at the largest vault size are the ones that fall to the bottom here. Computed on every 3rd origin of the era over 16 vault sizes; §11.1's four registered tiers are unchanged and remain the only sizes any gate is scored on.

![figures/SRCLA-FIG3-capital-at-work-by-vault-size-heldout-c.svg](figures/SRCLA-FIG3-capital-at-work-by-vault-size-heldout-c.svg)

**Figure 3 — Capital at work by vault size.** Figure 1's yield decline is explained here rather than by worse execution: where a line falls, the vault is holding cash rather than earning a lower rate. Computed on every 3rd origin of the era over 16 vault sizes; §11.1's four registered tiers are unchanged and remain the only sizes any gate is scored on.

### Sustainability — the primary release criterion (§11.5)

Demonstration floor: capital at work >= **0.7**. Below it a run is trivially redeemable and demonstrates nothing, so every criterion reports **ND** (NOT DEMONSTRATED) and no sustainability claim may be drawn from it.

**What S3 and S4 do NOT cover.** Two of §11.5 part 3's clauses are not measured by this run, and the columns are named for what they measure rather than for the clause:

- **S3** grades only the venue-stress bound. §11.5 S3's first clause — that the vault's own deposits do not push a venue past its **registered utilization ceiling** — is **NOT EVALUATED**. A PASS in that column is not evidence about the ceiling.
- **S4** grades **action validity**: no deploy into a paused or absent venue, and no divest from a venue holding nothing. §11.5 S4's named classes — **cap, dependency, reserve and loss violations, and unrecoverable plan state** — are **NOT EVALUATED**. A PASS in that column is not evidence that no cap or reserve was breached.

| Tier | Demonstrated | S1 redeem | S2 coverage | S3 venue stress | S4 action validity | Verdict | Net APY | Breach |
|---|---|---|---|---|---|---|---|---|
| 10,000 | yes | PASS | PASS | PASS | PASS | **SUSTAINABLE** | 3.254% | — |
| 100,000 | yes | PASS | PASS | PASS | PASS | **SUSTAINABLE** | 3.259% | — |
| 1,000,000 | yes | PASS | PASS | PASS | PASS | **SUSTAINABLE** | 3.195% | — |
| 10,000,000 | yes | PASS | PASS | PASS | PASS | **SUSTAINABLE** | 2.547% | — |

**Scale invariance (P26):** sustainable at EVERY registered tier.

### The price of unsustainability (§11.5 part 3)

These policies are **not comparators**. Each is a counterexample: the return below is what the policy earned while failing a criterion SRCLA is held to, i.e. the measured price of unsustainability rather than a benchmark SRCLA had to beat.

| Policy | Tier | Net APY | Displayed − realized | Verdict | Why |
|---|---|---|---|---|---|
| `b0` | 10,000 | 0.000% | 0.000% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%) |
| `b0` | 100,000 | 0.000% | 0.000% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%) |
| `b0` | 1,000,000 | 0.000% | 0.000% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%) |
| `b0` | 10,000,000 | 0.000% | 0.000% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%) |
| `b1` | 10,000,000 | 3.255% | 0.092% | **BREACH** | S2 stressed coverage 0.151 vs floor 0.950 (short by 0.799) |
| `b4` | 10,000,000 | 3.627% | -0.131% | **BREACH** | S2 stressed coverage 0.000 vs floor 0.950 (short by 0.950) |
| `b5` | 10,000 | 3.463% | 0.096% | **BREACH** | S2 stressed coverage 0.800 vs floor 0.950 (short by 0.150) |
| `b5` | 100,000 | 3.472% | 0.088% | **BREACH** | S2 stressed coverage 0.800 vs floor 0.950 (short by 0.150) |
| `b5` | 1,000,000 | 3.473% | 0.087% | **BREACH** | S2 stressed coverage 0.800 vs floor 0.950 (short by 0.150) |
| `h2` | 1,000,000 | 3.150% | 0.110% | **BREACH** | S2 stressed coverage 0.808 vs floor 0.950 (short by 0.142) |

### Why capital sits idle — attributed to a component, not guessed

Capital at work is what decides the demonstration check, and a bare number cannot say WHICH mechanism withheld the capital. Every registered ablation removes exactly one component, so the row-to-row difference below attributes the idleness. **An ablation that does not move the number exonerates its component** — that is a finding too, and it rules out the explanations a reader would otherwise reach for.

| Policy | Removes | 10,000 | 100,000 | 1,000,000 | 10,000,000 |
|---|---|---|---|---|---|
| `srcla` | _nothing — the full controller_ | **0.941** | **0.941** | **0.940** | **0.796** |
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.941 | 0.941 | 0.941 | 0.847 | **← restores deployment**
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.941 | 0.941 | 0.941 | 0.776 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P | 0.943 | 0.943 | 0.942 | 0.766 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.941 | 0.941 | 0.940 | 0.800 |
| `h5` | remove shared-dependency caps. | 0.941 | 0.941 | 0.940 | 0.796 |
| `h6` | remove c_i^liquidity. | 0.941 | 0.941 | 0.940 | 0.801 |
| `h7` | remove the phi_i weighting. | 0.941 | 0.941 | 0.938 | 0.818 |
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 0.941 | 0.941 | 0.940 | 0.796 |


### The capacity frontier — was the tier beyond the venues, or was the capacity declined?

Idle capital has two opposite explanations — the venues could not absorb the tier, or the policy declined capacity that was available — and they carry opposite verdicts. The discriminating evidence is the other policies at the SAME tier. Rows are sorted by how much each deployed; read down until stressed coverage collapses. **That is the frontier.** A policy sitting well below it with coverage intact was not constrained by the market.

**Tier 10,000 USDC**

| Policy | Capital at work | Stressed coverage (min) | Full exit | Net APY | Displayed − realized |
|---|---|---|---|---|---|
| `b4` | 0.996 | 100.000% | 0 | 3.625% | -0.129% |
| `b2u` | 0.987 | 100.000% | 0 | 3.334% | -0.057% |
| `b1` | 0.945 | 100.000% | 0 | 3.366% | 0.100% |
| `h3` | 0.943 | 100.000% | 0 | 3.210% | 0.106% |
| `h2` | 0.941 | 100.000% | 0 | 3.175% | 0.120% |
| `b5` | 0.941 | 80.033% | 1 | 3.463% | 0.096% |
| `h1` | 0.941 | 100.000% | 0 | 3.405% | 0.085% |
| **`srcla`** | 0.941 | 100.000% | 0 | 3.254% | 0.102% |
| `h4` | 0.941 | 100.000% | 0 | 3.254% | 0.102% |
| `h5` | 0.941 | 100.000% | 0 | 3.254% | 0.102% |
| `h6` | 0.941 | 100.000% | 0 | 3.254% | 0.102% |
| `h7` | 0.941 | 100.000% | 0 | 3.254% | 0.102% |
| `h3d` | 0.941 | 100.000% | 0 | 3.254% | 0.102% |
| `b2` | 0.934 | 100.000% | 0 | 3.168% | 0.132% |
| `b3` | 0.925 | 100.000% | 0 | 3.115% | 0.174% |
| `b0` | 0.000 | 100.000% | 0 | 0.000% | 0.000% |

**Tier 100,000 USDC**

| Policy | Capital at work | Stressed coverage (min) | Full exit | Net APY | Displayed − realized |
|---|---|---|---|---|---|
| `b4` | 0.996 | 100.000% | 0 | 3.627% | -0.131% |
| `b2u` | 0.987 | 100.000% | 0 | 3.356% | -0.078% |
| `b1` | 0.945 | 100.000% | 0 | 3.392% | 0.073% |
| `h3` | 0.943 | 100.000% | 0 | 3.220% | 0.078% |
| `h2` | 0.941 | 100.000% | 0 | 3.186% | 0.109% |
| `b5` | 0.941 | 80.005% | 1 | 3.472% | 0.088% |
| `h1` | 0.941 | 100.000% | 0 | 3.414% | 0.077% |
| **`srcla`** | 0.941 | 100.000% | 0 | 3.259% | 0.096% |
| `h4` | 0.941 | 100.000% | 0 | 3.259% | 0.096% |
| `h5` | 0.941 | 100.000% | 0 | 3.259% | 0.096% |
| `h6` | 0.941 | 100.000% | 0 | 3.259% | 0.096% |
| `h7` | 0.941 | 100.000% | 0 | 3.259% | 0.096% |
| `h3d` | 0.941 | 100.000% | 0 | 3.259% | 0.096% |
| `b2` | 0.934 | 100.000% | 0 | 3.189% | 0.110% |
| `b3` | 0.925 | 100.000% | 0 | 3.126% | 0.164% |
| `b0` | 0.000 | 100.000% | 0 | 0.000% | 0.000% |

**Tier 1,000,000 USDC**

| Policy | Capital at work | Stressed coverage (min) | Full exit | Net APY | Displayed − realized |
|---|---|---|---|---|---|
| `b4` | 0.996 | 100.000% | 0 | 3.627% | -0.131% |
| `b2u` | 0.987 | 100.000% | 0 | 3.315% | -0.064% |
| `b1` | 0.945 | 100.000% | 0 | 3.395% | 0.071% |
| `b2` | 0.943 | 100.000% | 0 | 3.231% | 0.080% |
| `h3` | 0.942 | 100.000% | 0 | 3.215% | 0.081% |
| `b5` | 0.941 | 79.994% | 1 | 3.473% | 0.087% |
| `h2` | 0.941 | 80.843% | 1 | 3.150% | 0.110% |
| `h1` | 0.941 | 100.000% | 0 | 3.359% | 0.080% |
| **`srcla`** | 0.940 | 100.000% | 0 | 3.195% | 0.102% |
| `h4` | 0.940 | 100.000% | 0 | 3.195% | 0.102% |
| `h5` | 0.940 | 100.000% | 0 | 3.195% | 0.102% |
| `h6` | 0.940 | 100.000% | 0 | 3.195% | 0.102% |
| `h3d` | 0.940 | 100.000% | 0 | 3.195% | 0.102% |
| `h7` | 0.938 | 100.000% | 0 | 3.232% | 0.110% |
| `b3` | 0.923 | 100.000% | 0 | 3.094% | 0.174% |
| `b0` | 0.000 | 100.000% | 0 | 0.000% | 0.000% |

**Tier 10,000,000 USDC**

| Policy | Capital at work | Stressed coverage (min) | Full exit | Net APY | Displayed − realized |
|---|---|---|---|---|---|
| `b4` | 0.996 | 0.000% | 2 | 3.627% | -0.131% |
| `b1` | 0.941 | 15.136% | 1 | 3.255% | 0.092% |
| `b2u` | 0.929 | 96.373% | 1 | 3.048% | 0.128% |
| `b5` | 0.849 | 100.000% | 0 | 2.793% | 0.404% |
| `h1` | 0.847 | 100.000% | 0 | 2.770% | 0.405% |
| `b3` | 0.828 | 100.000% | 0 | 2.653% | 0.467% |
| `h7` | 0.818 | 100.000% | 0 | 2.648% | 0.503% |
| `b2` | 0.808 | 100.000% | 0 | 2.594% | 0.514% |
| `h6` | 0.801 | 100.000% | 0 | 2.567% | 0.558% |
| `h4` | 0.800 | 100.000% | 0 | 2.550% | 0.559% |
| **`srcla`** | 0.796 | 100.000% | 0 | 2.547% | 0.573% |
| `h5` | 0.796 | 100.000% | 0 | 2.547% | 0.573% |
| `h3d` | 0.796 | 100.000% | 0 | 2.547% | 0.573% |
| `h2` | 0.776 | 100.000% | 0 | 2.446% | 0.628% |
| `h3` | 0.766 | 97.656% | 1 | 2.491% | 0.686% |
| `b0` | 0.000 | 100.000% | 0 | 0.000% | 0.000% |


### Per-policy results

`stressedLiquidCoverage` is measured every origin; the §11.5 gate tests only the **minimum** over the whole run, so one market-wide dry hour scores identically to chronic illiquidity. The p05 and median columns below distinguish the two — neither is what the gate tests.

§11.4's three sustainability measurements are reported per policy per tier in the same table. **Full exit** is the origins needed to redeem 100% of NAV from the run's worst coverage origin, executing only same-transaction exits — a LOWER BOUND, because each origin's capacity is read from a replay in which the vault did not exit, and marked `censored` where the era ended before the bound could be tested (a missing measurement, not a failure). **Max venue share** is the largest fraction of a venue the vault itself was, at any origin. **Displayed − realized** is the deployed-weighted advertised rate minus what the vault actually kept.

#### Tier 10,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Full exit (origins, lower bound) | Max venue share | Displayed − realized | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 3.254% | 22 | 17,780 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.000% | — |
| `b1` | 11.2 | 3.366% | 102 | 207,249 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.100% | — |
| `b2` | 11.2 | 3.168% | 90 | 181,310 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.132% | — |
| `b2u` | 11.2 | 3.334% | 561 | 160,441 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -0.057% | — |
| `b3` | 11.2 | 3.115% | 53 | 16,166 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.174% | — |
| `b4` | 11.2 | 3.625% | 1896 | 13,613 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -0.129% | — |
| `b5` | 11.2 | 3.463% | 41 | 20,747 | 0 | 100.0% | 80.033% | 100.000% | 100.000% | 1 | — | 0.096% | — |
| `h1` | 11.3 | 3.405% | 38 | 26,343 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.085% | — |
| `h2` | 11.3 | 3.175% | 51 | 14,805 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.120% | — |
| `h3` | 11.3 | 3.210% | 103 | 162,830 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.106% | — |
| `h4` | 11.3 | 3.254% | 22 | 17,780 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | — |
| `h5` | 11.3 | 3.254% | 22 | 17,780 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | **INERT** |
| `h6` | 11.3 | 3.254% | 22 | 17,780 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | **INERT** |
| `h7` | 11.3 | 3.254% | 22 | 17,780 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | **INERT** |
| `h3d` | 11.3 | 3.254% | 22 | 17,780 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | — |

#### Tier 100,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Full exit (origins, lower bound) | Max venue share | Displayed − realized | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 3.259% | 21 | 177,798 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.096% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.000% | — |
| `b1` | 11.2 | 3.392% | 102 | 2,072,524 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.073% | — |
| `b2` | 11.2 | 3.189% | 93 | 1,817,121 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.110% | — |
| `b2u` | 11.2 | 3.356% | 562 | 1,604,410 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -0.078% | — |
| `b3` | 11.2 | 3.126% | 53 | 161,662 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.164% | — |
| `b4` | 11.2 | 3.627% | 1896 | 136,131 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -0.131% | — |
| `b5` | 11.2 | 3.472% | 44 | 207,810 | 0 | 100.0% | 80.005% | 100.000% | 100.000% | 1 | — | 0.088% | — |
| `h1` | 11.3 | 3.414% | 38 | 263,580 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.077% | — |
| `h2` | 11.3 | 3.186% | 51 | 148,050 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.109% | — |
| `h3` | 11.3 | 3.220% | 114 | 1,540,414 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.078% | — |
| `h4` | 11.3 | 3.259% | 21 | 177,798 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.096% | — |
| `h5` | 11.3 | 3.259% | 21 | 177,798 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.096% | **INERT** |
| `h6` | 11.3 | 3.259% | 21 | 177,798 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.096% | **INERT** |
| `h7` | 11.3 | 3.259% | 21 | 177,798 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.096% | **INERT** |
| `h3d` | 11.3 | 3.259% | 21 | 177,798 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.096% | — |

#### Tier 1,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Full exit (origins, lower bound) | Max venue share | Displayed − realized | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 3.195% | 18 | 1,934,516 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.000% | — |
| `b1` | 11.2 | 3.395% | 102 | 20,725,278 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.071% | — |
| `b2` | 11.2 | 3.231% | 132 | 22,001,945 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.080% | — |
| `b2u` | 11.2 | 3.315% | 383 | 21,117,372 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -0.064% | — |
| `b3` | 11.2 | 3.094% | 47 | 1,940,929 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.174% | — |
| `b4` | 11.2 | 3.627% | 1896 | 1,361,313 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -0.131% | — |
| `b5` | 11.2 | 3.473% | 44 | 2,077,817 | 0 | 100.0% | 79.994% | 100.000% | 100.000% | 1 | — | 0.087% | — |
| `h1` | 11.3 | 3.359% | 41 | 3,421,053 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.080% | — |
| `h2` | 11.3 | 3.150% | 41 | 1,558,710 | 0 | 100.0% | 80.843% | 100.000% | 100.000% | 1 | — | 0.110% | — |
| `h3` | 11.3 | 3.215% | 124 | 17,628,668 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.081% | — |
| `h4` | 11.3 | 3.195% | 18 | 1,934,516 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | — |
| `h5` | 11.3 | 3.195% | 18 | 1,934,516 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | **INERT** |
| `h6` | 11.3 | 3.195% | 18 | 1,934,516 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | **INERT** |
| `h7` | 11.3 | 3.232% | 28 | 2,090,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.110% | — |
| `h3d` | 11.3 | 3.195% | 18 | 1,934,516 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.102% | — |

#### Tier 10,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Full exit (origins, lower bound) | Max venue share | Displayed − realized | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 2.547% | 113 | 68,306,293 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.573% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.000% | — |
| `b1` | 11.2 | 3.255% | 97 | 219,342,324 | 1 | 100.0% | 15.136% | 78.585% | 100.000% | 1 | — | 0.092% | — |
| `b2` | 11.2 | 2.594% | 108 | 213,745,023 | 1 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.514% | — |
| `b2u` | 11.2 | 3.048% | 108 | 277,688,307 | 1 | 100.0% | 96.373% | 100.000% | 100.000% | 1 | — | 0.128% | — |
| `b3` | 11.2 | 2.653% | 101 | 52,281,868 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.467% | — |
| `b4` | 11.2 | 3.627% | 1896 | 13,613,128 | 0 | 100.0% | 0.000% | 0.000% | 88.894% | 2 | — | -0.131% | — |
| `b5` | 11.2 | 2.793% | 81 | 38,909,337 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.404% | — |
| `h1` | 11.3 | 2.770% | 78 | 38,308,998 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.405% | — |
| `h2` | 11.3 | 2.446% | 106 | 66,154,063 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.628% | — |
| `h3` | 11.3 | 2.491% | 99 | 151,854,367 | 0 | 100.0% | 97.656% | 100.000% | 100.000% | 1 | — | 0.686% | — |
| `h4` | 11.3 | 2.550% | 102 | 72,498,719 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.559% | — |
| `h5` | 11.3 | 2.547% | 113 | 68,306,293 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.573% | **INERT** |
| `h6` | 11.3 | 2.567% | 104 | 67,550,374 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.558% | — |
| `h7` | 11.3 | 2.648% | 144 | 62,351,346 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.503% | — |
| `h3d` | 11.3 | 2.547% | 113 | 68,306,293 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.573% | — |

### The skill window (P22) — is either yield statement informative?

Registered non-inferiority margin: **43.0 bps** annualized (`REGISTERED_NONINFERIORITY_MARGIN`, an **unconfirmed** registration the paper owner must confirm before the freeze). The window below is bounded hindsight minus the best SUSTAINABLE baseline — the entire return reallocation could have earned.

| Tier | Bounded hindsight (B5) | Best sustainable baseline | its net APY | Skill window | Superiority resolvable? |
|---|---|---|---|---|---|
| 10,000 | 3.463% | b4 | 3.625% | -16.2 bps | **NOT INFORMATIVE** |
| 100,000 | 3.472% | b4 | 3.627% | -15.5 bps | **NOT INFORMATIVE** |
| 1,000,000 | 3.473% | b4 | 3.627% | -15.4 bps | **NOT INFORMATIVE** |
| 10,000,000 | 2.793% | b3 | 2.653% | 14.0 bps | **NOT INFORMATIVE** |

A window narrower than the margin means **no policy could have demonstrated yield superiority at this resolution**, so the superiority line is reported NOT INFORMATIVE and gates nothing. It does **not** excuse the non-inferiority test: a narrow window makes non-inferiority *easier*, so a pass there is disclosed as weak evidence of allocation quality — deploy-and-hold would satisfy it too. The window never touches the demonstration, completeness or sustainability checks: yield can be beyond reach, redeemability cannot.

### SRCLA against each deployable baseline

**Non-inferiority** is §11.5's yield criterion: one-sided at a 43.0 bps annualized margin, HAC-corrected, and cross-checked by a seeded moving-block bootstrap that may downgrade a pass to UNRESOLVED but may never upgrade a failure. The two-sided p and the bootstrap CI are **reported diagnostics** and gate nothing.

| Tier | Baseline | SRCLA | Baseline | Non-inferior (43.0 bps) | one-sided p | two-sided HAC p | bootstrap 95% CI of difference |
|---|---|---|---|---|---|---|---|
| 10,000 | `b1` | 3.254% | 3.366% | NON-INFERIOR | 0.0000 | 0.0006 | [-1.93e-7, -4.47e-8] |
| 10,000 | `b2` | 3.254% | 3.168% | NON-INFERIOR | 0.0000 | 0.0583 | [-2.72e-9, 2.11e-7] |
| 10,000 | `b3` | 3.254% | 3.115% | NON-INFERIOR | 0.0000 | 0.0000 | [8.91e-8, 2.07e-7] |
| 10,000 | `b4` | 3.254% | 3.625% | NON-INFERIOR | 0.0005 | 0.0000 | [-4.64e-7, -3.49e-7] |
| 100,000 | `b1` | 3.259% | 3.392% | NON-INFERIOR | 0.0000 | 0.0000 | [-2.17e-7, -6.98e-8] |
| 100,000 | `b2` | 3.259% | 3.189% | NON-INFERIOR | 0.0000 | 0.1245 | [-2.12e-8, 1.94e-7] |
| 100,000 | `b3` | 3.259% | 3.126% | NON-INFERIOR | 0.0000 | 0.0000 | [8.35e-8, 2.01e-7] |
| 100,000 | `b4` | 3.259% | 3.627% | NON-INFERIOR | 0.0003 | 0.0000 | [-4.60e-7, -3.46e-7] |
| 1,000,000 | `b1` | 3.195% | 3.395% | NON-INFERIOR | 0.0000 | 0.0000 | [-2.87e-7, -1.51e-7] |
| 1,000,000 | `b2` | 3.195% | 3.231% | NON-INFERIOR | 0.0000 | 0.2282 | [-1.05e-7, 3.69e-8] |
| 1,000,000 | `b3` | 3.195% | 3.094% | NON-INFERIOR | 0.0000 | 0.0000 | [5.82e-8, 1.57e-7] |
| 1,000,000 | `b4` | 3.195% | 3.627% | **INFERIOR** | 0.2802 | 0.0000 | [-5.32e-7, -4.16e-7] |
| 10,000,000 | `b2` | 2.547% | 2.594% | NON-INFERIOR | 0.0000 | 0.2511 | [-1.55e-7, 6.06e-8] |
| 10,000,000 | `b3` | 2.547% | 2.653% | NON-INFERIOR | 0.0000 | 0.0013 | [-2.05e-7, -3.13e-8] |

## Ablation contributions

Each row below removes exactly one component from SRCLA (§11.3) and reports what that component was measured to be worth: `contribution = SRCLA net APY − ablation net APY` at the same tier. **Positive** means removing the component made the policy worse — the component was earning its keep. **Negative** means removing it made the policy BETTER — the component cost more than it earned on this data.

#### Tier 10,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 3.254% | 3.405% | **-0.151 pp** | 38 | 22 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 3.254% | 3.175% | +0.079 pp | 51 | 22 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles. | 3.254% | 3.210% | +0.044 pp | 103 | 22 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 3.254% | 3.254% | +0.000 pp | 22 | 22 |
| `h5` | remove shared-dependency caps. | 3.254% | 3.254% | **INERT** (identical decisions — not a measured contribution) | 22 | 22 |
| `h6` | remove c_i^liquidity. | 3.254% | 3.254% | **INERT** (identical decisions — not a measured contribution) | 22 | 22 |
| `h7` | remove the phi_i weighting. | 3.254% | 3.254% | **INERT** (identical decisions — not a measured contribution) | 22 | 22 |
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 3.254% | 3.254% | +0.000 pp | 22 | 22 |

#### Tier 100,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 3.259% | 3.414% | **-0.154 pp** | 38 | 21 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 3.259% | 3.186% | +0.073 pp | 51 | 21 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles. | 3.259% | 3.220% | +0.040 pp | 114 | 21 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 3.259% | 3.259% | +0.000 pp | 21 | 21 |
| `h5` | remove shared-dependency caps. | 3.259% | 3.259% | **INERT** (identical decisions — not a measured contribution) | 21 | 21 |
| `h6` | remove c_i^liquidity. | 3.259% | 3.259% | **INERT** (identical decisions — not a measured contribution) | 21 | 21 |
| `h7` | remove the phi_i weighting. | 3.259% | 3.259% | **INERT** (identical decisions — not a measured contribution) | 21 | 21 |
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 3.259% | 3.259% | +0.000 pp | 21 | 21 |

#### Tier 1,000,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 3.195% | 3.359% | **-0.164 pp** | 41 | 18 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 3.195% | 3.150% | +0.045 pp | 41 | 18 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles. | 3.195% | 3.215% | **-0.021 pp** | 124 | 18 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 3.195% | 3.195% | +0.000 pp | 18 | 18 |
| `h5` | remove shared-dependency caps. | 3.195% | 3.195% | **INERT** (identical decisions — not a measured contribution) | 18 | 18 |
| `h6` | remove c_i^liquidity. | 3.195% | 3.195% | **INERT** (identical decisions — not a measured contribution) | 18 | 18 |
| `h7` | remove the phi_i weighting. | 3.195% | 3.232% | **-0.037 pp** | 28 | 18 |
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 3.195% | 3.195% | +0.000 pp | 18 | 18 |

#### Tier 10,000,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 2.547% | 2.770% | **-0.223 pp** | 78 | 113 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 2.547% | 2.446% | +0.101 pp | 106 | 113 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles. | 2.547% | 2.491% | +0.056 pp | 99 | 113 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 2.547% | 2.550% | **-0.004 pp** | 102 | 113 |
| `h5` | remove shared-dependency caps. | 2.547% | 2.547% | **INERT** (identical decisions — not a measured contribution) | 113 | 113 |
| `h6` | remove c_i^liquidity. | 2.547% | 2.567% | **-0.020 pp** | 104 | 113 |
| `h7` | remove the phi_i weighting. | 2.547% | 2.648% | **-0.101 pp** | 144 | 113 |
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 2.547% | 2.547% | +0.000 pp | 113 | 113 |

> **Negative contribution: removing the component helped, not hurt.** This is the report's most important measured signal — the component cost more than it earned on this data.
>
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 10,000 USDC: contribution **-0.151 pp**.
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 100,000 USDC: contribution **-0.154 pp**.
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 1,000,000 USDC: contribution **-0.164 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles.) at tier 1,000,000 USDC: contribution **-0.021 pp**.
> - `h7` (remove the phi_i weighting.) at tier 1,000,000 USDC: contribution **-0.037 pp**.
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 10,000,000 USDC: contribution **-0.223 pp**.
> - `h4` (remove the dynamic reserve and stress feasibility; admin floor only.) at tier 10,000,000 USDC: contribution **-0.004 pp**.
> - `h6` (remove c_i^liquidity.) at tier 10,000,000 USDC: contribution **-0.020 pp**.
> - `h7` (remove the phi_i weighting.) at tier 10,000,000 USDC: contribution **-0.101 pp**.


### §11.5 forecast gate

**FAIL** — blocked on: Kupiec unconditional coverage — aave-v3-usdc; Kupiec unconditional coverage — compound-v3-usdc; Kupiec unconditional coverage — moonwell-usdc

| Verdict | Role | Check | Detail |
|---|---|---|---|
| PASS | gates | Per-venue coverage — aave-v3-usdc | achieved 100.00% against target 99.00% (tolerance 1.00pp, floor 98.00%) on 2290 out-of-sample residuals, q=-1.1195e-4 |
| **FAIL** | gates | Kupiec unconditional coverage — aave-v3-usdc | LR_uc 46.0305, p 0.0000 < 0.05 — breach rate 0.00% against expected 1.00% |
| PASS | gates | Christoffersen conditional coverage — aave-v3-usdc | LR_cc 2.0302 (LR_ind 0.0000), p 0.3624 >= 0.05 on 101 non-overlapping windows |
| PASS | gates | Per-venue coverage — compound-v3-usdc | achieved 100.00% against target 99.00% (tolerance 1.00pp, floor 98.00%) on 2754 out-of-sample residuals, q=-5.7725e-5 |
| **FAIL** | gates | Kupiec unconditional coverage — compound-v3-usdc | LR_uc 55.3572, p 0.0000 < 0.05 — breach rate 0.00% against expected 1.00% |
| PASS | gates | Christoffersen conditional coverage — compound-v3-usdc | LR_cc 2.3116 (LR_ind 0.0000), p 0.3148 >= 0.05 on 115 non-overlapping windows |
| PASS | gates | Per-venue coverage — moonwell-usdc | achieved 100.00% against target 99.00% (tolerance 1.00pp, floor 98.00%) on 2694 out-of-sample residuals, q=-8.5493e-5 |
| **FAIL** | gates | Kupiec unconditional coverage — moonwell-usdc | LR_uc 54.1512, p 0.0000 < 0.05 — breach rate 0.00% against expected 1.00% |
| PASS | gates | Christoffersen conditional coverage — moonwell-usdc | LR_cc 2.2714 (LR_ind 0.0000), p 0.3212 >= 0.05 on 113 non-overlapping windows |
| PASS | gates | Label completeness | worst venue aave-v3-usdc at 100.00% of 2784 origins (floor 99.00%); aave-v3-usdc 100.00%, compound-v3-usdc 100.00%, moonwell-usdc 100.00% |
| PASS | gates | Regime purity | 433 of 8352 label windows straddle a regime change (5.18%, tolerance 10%): aave-v3-usdc@1769691600 (aave:0xa238dd80c259a72e81d7e4664a9801593f98d1c5\|0x86ab1c62a8bf868e1b3e1ab87d587aba6fbcbdc5:7500000000000000:900000000000000000000000000:50000000000000000:100000000000000000:active -> aave:0xa238dd80c259a72e81d7e4664a9801593f98d1c5\|0x86ab1c62a8bf868e1b3e1ab87d587aba6fbcbdc5:0:900000000000000000000000000:50000000000000000:100000000000000000:active at 1769778000, inside [origin, origin+H]); aave-v3-usdc@1769695200… |
| PASS | gates | Availability-lag barrier | all 8352 labels are readable no earlier than origin + 86400s + 900s lag |
| PASS | gates | Registered grid points present | swept 36, scorable 36, registered grid 36 |
| PASS | gates | Selection margin | margin 6.4198e-1 against the registered floor 1e-3 |
| PASS | gates | Artifact reproducibility | content hash re-derives from the artifact body: 694cf86f6f7363f2f76a19ce66781ae82311ab1cbd2b7220b3aab94bda8223cf |
| PASS | gates | Calibrated artifact | artifact is registered, not provisional |
| PASS | gates | Artifact completeness (P23) | the artifact carries every field the policy reads |

Coverage is recomputed OUT OF SAMPLE. The artifact's per-venue quantile was solved to hit the target on the calibration era, so its in-sample coverage is true by construction and says nothing; what follows is the same quantile measured against the labels this era produced. Christoffersen's independence test runs on a stream thinned to NON-OVERLAPPING horizon windows — consecutive labels share most of their window, so on the raw stream the test would reject clustering the sampling grid created rather than clustering the forecast did.

| Venue | Residuals | Achieved coverage | Exceedances | Kupiec p | Christoffersen p | Non-overlapping windows |
|---|---|---|---|---|---|---|
| aave-v3-usdc | 2290 | 100.00% | 0 | 0.0000 | 0.3624 | 101 |
| compound-v3-usdc | 2754 | 100.00% | 0 | 0.0000 | 0.3148 | 115 |
| moonwell-usdc | 2694 | 100.00% | 0 | 0.0000 | 0.3212 | 113 |

### §11.5 policy gate

| Verdict | Role | Check | Detail |
|---|---|---|---|
| PASS | gates | Demonstration: sustainability was demonstrated while deployed | capital at work >= 0.7 across all 4 SRCLA runs |
| PASS | gates | Every registered tier ran | all 4 of §11.1's tiers |
| PASS | gates | Every registered policy ran at every tier | all 64 required (policy, tier) runs |
| PASS | gates | Calibrated artifact | 694cf86f6f7363f2f76a19ce66781ae82311ab1cbd2b7220b3aab94bda8223cf |
| **FAIL** | gates | §11.1 pinned-prestate fork replay | did not execute on fork: b4@10000000000 (b4@10000000000 REFUSED BY THE CHAIN: the vault reverted the plan: transaction execution reverted (action="sendTransaction", data=null, reason=null, invocation=null, revert=null, transaction={ "data": "", "from": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "to": "0xEBBb24079B6fd4c26d84C2f1c66f4377Fb6B7C0e" }, receipt={ "_type": "TransactionReceipt", "blobGasPrice": "1", "blobGasUsed": null, "blockHash": "0x3830298412b757f30bf6afa6cc78e6fbf78a9372e14731f08baa46de29882642", "blockNumber": 51207219, "contractAddress": null, "cumulativeGasUsed": "302961",… |
| PASS | gates | Safety: withdrawal success measured and met | >= 99% across 4 SRCLA runs |
| PASS | gates | Safety: stressed liquid coverage | >= 0.95 across 4 SRCLA runs reported (not gating): b5@10000000000 0.800, b5@100000000000 0.800, b5@1000000000000 0.800, h2@1000000000000 0.808, b1@10000000000000 0.151, b4@10000000000000 0.000 |
| PASS | gates | Sustainability S1: complete exit within the registered bound | withdrawals filled and full exit within 24 origins across all 4 SRCLA runs |
| PASS | gates | Sustainability S3: venue-stress share (utilization-ceiling clause NOT EVALUATED) | no venue share above 0.25 at any origin. NOT EVALUATED: §11.5 S3's first clause — that the vault's own deposits do not push a venue past its registered utilization ceiling — is not measured by this run; only the venue-stress bound is across all 4 SRCLA runs |
| PASS | gates | Sustainability S4: action validity (§11.5 violation classes NOT EVALUATED) | no invalid action over any run (a deploy into a paused or absent venue, or a divest from a venue holding nothing). NOT EVALUATED: §11.5 S4 also names cap, dependency, reserve and loss violations and unrecoverable plan state; none of those five is measured by this run across all 4 SRCLA runs |
| PASS | gates | Sustainability: scale invariance across every registered tier (P26) | sustainable at all 4 tiers measured |
| **FAIL** | reported | No inert ablation | reported (not gating): these made byte-identical decisions to SRCLA: h5, h6, h7 — any delta attributed to the component each removes is noise |
| **FAIL** | reported | Diagnostic: statistical distinguishability from every sustainable baseline | b2@10000000000 p=0.058, b2@100000000000 p=0.124, b2@1000000000000 p=0.228, b2@10000000000000 p=0.251 |
| **FAIL** | gates | Non-inferior to every sustainable baseline (margin 43.0 bps) | inferior by more than the margin: b4@1000000000000 SRCLA 3.195% vs 3.627% (one-sided p=0.280) POWER DISCLOSURE — the skill window is inside the 43.0 bps margin at 4 of 4 tiers (10000000000: bounded hindsight 3.463% − best sustainable baseline b4 3.625% = -16.2 bps vs a 43.0 bps margin; 100000000000: bounded hindsight 3.472% − best sustainable baseline b4 3.627% = -15.5 bps vs a 43.0 bps margin; 1000000000000: bounded hindsight 3.473% − best sustainable baseline b4 3.627% = -15.4 bps vs a 43.0 bps margin; 10000000000000: bounded hindsight 2.793% − best sustainable baseline b3 2.653% = 14.0 bps… |
| PASS | gates | Price of unsustainability published | b0@10000000000 0.000% (displayed−realized 0.000pp) — NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%); b5@10000000000 3.463% (displayed−realized 0.096pp) — S2 stressed coverage 0.800 vs floor 0.950 (short by 0.150); b0@100000000000 0.000% (displayed−realized 0.000pp) — NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%); b5@100000000000 3.472% (displayed−realized… |

## Results — era `heldout-b`

413 origins. Manifest `3b87c83fea2729ae03761fa56b1601022cd788d81b592fc32037d51d177f19ee`, dataset `c00f5a0d165bdd7158d1c2c557095952446ff04063bfb5081d50873627e02807`, result `4a6bbc0b1866083e76be6c7f3ce895ade3593a71cc3ad4a8b07edb9b7a00944c`. Reproduce with `pnpm run evaluation:verify`.

### Figures

Vault size is on a logarithmic axis in all three: the registered tiers span three decades, and a linear axis compresses 10k, 100k and 1M into the first tenth of the width — which is exactly the range where the controller behaves well.

![figures/SRCLA-FIG1-apy-by-vault-size-heldout-b.svg](figures/SRCLA-FIG1-apy-by-vault-size-heldout-b.svg)

**Figure 1 — Net APY by vault size.** Read this together with Figure 2: a yield curve alone cannot distinguish a policy that earns well from one that earns well by becoming unredeemable. **WARNING: moonwell-usdc held ZERO withdrawable cash for 29% of this era (peak 90% APY, unwithdrawable). Returns below are annualized from 17 days and are NOT attainable yield.** Computed on every 3rd origin of the era over 16 vault sizes; §11.1's four registered tiers are unchanged and remain the only sizes any gate is scored on.

![figures/SRCLA-FIG2-coverage-by-vault-size-heldout-b.svg](figures/SRCLA-FIG2-coverage-by-vault-size-heldout-b.svg)

**Figure 2 — Stressed liquid coverage by vault size.** This is the paper's proposition in one picture. The policies that sit highest in Figure 1 at the largest vault size are the ones that fall to the bottom here. Computed on every 3rd origin of the era over 16 vault sizes; §11.1's four registered tiers are unchanged and remain the only sizes any gate is scored on.

![figures/SRCLA-FIG3-capital-at-work-by-vault-size-heldout-b.svg](figures/SRCLA-FIG3-capital-at-work-by-vault-size-heldout-b.svg)

**Figure 3 — Capital at work by vault size.** Figure 1's yield decline is explained here rather than by worse execution: where a line falls, the vault is holding cash rather than earning a lower rate. Computed on every 3rd origin of the era over 16 vault sizes; §11.1's four registered tiers are unchanged and remain the only sizes any gate is scored on.

### Sustainability — the primary release criterion (§11.5)

Demonstration floor: capital at work >= **0.7**. Below it a run is trivially redeemable and demonstrates nothing, so every criterion reports **ND** (NOT DEMONSTRATED) and no sustainability claim may be drawn from it.

**What S3 and S4 do NOT cover.** Two of §11.5 part 3's clauses are not measured by this run, and the columns are named for what they measure rather than for the clause:

- **S3** grades only the venue-stress bound. §11.5 S3's first clause — that the vault's own deposits do not push a venue past its **registered utilization ceiling** — is **NOT EVALUATED**. A PASS in that column is not evidence about the ceiling.
- **S4** grades **action validity**: no deploy into a paused or absent venue, and no divest from a venue holding nothing. §11.5 S4's named classes — **cap, dependency, reserve and loss violations, and unrecoverable plan state** — are **NOT EVALUATED**. A PASS in that column is not evidence that no cap or reserve was breached.

| Tier | Demonstrated | S1 redeem | S2 coverage | S3 venue stress | S4 action validity | Verdict | Net APY | Breach |
|---|---|---|---|---|---|---|---|---|
| 10,000 | yes | PASS | **FAIL** | PASS | PASS | **BREACH** | 34.457% | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| 100,000 | yes | PASS | **FAIL** | PASS | PASS | **BREACH** | 34.463% | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| 1,000,000 | yes | PASS | PASS | PASS | PASS | **SUSTAINABLE** | 29.051% | — |
| 10,000,000 | **NOT DEMONSTRATED** | **ND** | **ND** | **ND** | **ND** | **NOT DEMONSTRATED** | 5.856% | NOT DEMONSTRATED: capital at work 0.391 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 5.856%) |

**Scale invariance (P26):** **NOT scale invariant** — a breach at any tier is a breach, and no average over tiers may stand in for it.

### The price of unsustainability (§11.5 part 3)

These policies are **not comparators**. Each is a counterexample: the return below is what the policy earned while failing a criterion SRCLA is held to, i.e. the measured price of unsustainability rather than a benchmark SRCLA had to beat.

| Policy | Tier | Net APY | Displayed − realized | Verdict | Why |
|---|---|---|---|---|---|
| `b0` | 10,000 | 0.000% | 0.000% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%) |
| `b0` | 100,000 | 0.000% | 0.000% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%) |
| `b0` | 1,000,000 | 0.000% | 0.000% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%) |
| `b0` | 10,000,000 | 0.000% | 0.000% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%) |
| `b1` | 10,000,000 | 7.422% | 0.572% | **BREACH** | S2 stressed coverage 0.842 vs floor 0.950 (short by 0.108) |
| `b2` | 10,000,000 | 4.054% | 2.865% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.578 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 4.054%) |
| `b3` | 10,000 | 34.248% | -2.696% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `b3` | 100,000 | 34.251% | -2.699% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `b3` | 1,000,000 | 32.930% | 10.130% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.668 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 32.930%) |
| `b3` | 10,000,000 | 9.192% | 3.601% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.690 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 9.192%) |
| `b4` | 10,000,000 | 22.668% | -1.674% | **BREACH** | S2 stressed coverage 0.589 vs floor 0.950 (short by 0.361) |
| `b5` | 10,000 | 34.559% | -2.746% | **BREACH** | S2 stressed coverage 0.881 vs floor 0.950 (short by 0.069) |
| `b5` | 100,000 | 34.568% | -2.756% | **BREACH** | S2 stressed coverage 0.881 vs floor 0.950 (short by 0.069) |
| `b5` | 1,000,000 | 34.588% | -2.793% | **BREACH** | S2 stressed coverage 0.881 vs floor 0.950 (short by 0.069) |
| `b5` | 10,000,000 | 13.419% | 9.190% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.560 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 13.419%) |
| `h1` | 10,000,000 | 8.646% | 7.826% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.505 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 8.646%) |
| `h2` | 10,000 | 34.248% | -2.696% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h2` | 100,000 | 34.251% | -2.699% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h2` | 1,000,000 | 34.272% | -2.740% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h2` | 10,000,000 | 6.889% | 10.237% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.390 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 6.889%) |
| `h3` | 10,000,000 | 9.404% | 11.436% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.434 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 9.404%) |
| `h3d` | 10,000 | 34.457% | -2.718% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h3d` | 100,000 | 34.463% | -2.724% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h3d` | 10,000,000 | 5.856% | 8.725% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.391 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 5.856%) |
| `h4` | 10,000 | 34.457% | -2.718% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h4` | 100,000 | 34.463% | -2.724% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h4` | 10,000,000 | 5.856% | 8.725% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.391 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 5.856%) |
| `h5` | 10,000 | 34.457% | -2.718% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h5` | 100,000 | 34.463% | -2.724% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h5` | 10,000,000 | 5.856% | 8.725% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.391 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 5.856%) |
| `h6` | 10,000 | 34.457% | -2.718% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h6` | 100,000 | 34.463% | -2.724% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h6` | 10,000,000 | 8.276% | 9.548% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.448 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 8.276%) |
| `h7` | 10,000 | 34.457% | -2.718% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h7` | 100,000 | 34.463% | -2.724% | **BREACH** | S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072) |
| `h7` | 10,000,000 | 12.511% | 5.933% | **NOT DEMONSTRATED** | NOT DEMONSTRATED: capital at work 0.643 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 12.511%) |

### Why capital sits idle — attributed to a component, not guessed

Capital at work is what decides the demonstration check, and a bare number cannot say WHICH mechanism withheld the capital. Every registered ablation removes exactly one component, so the row-to-row difference below attributes the idleness. **An ablation that does not move the number exonerates its component** — that is a finding too, and it rules out the explanations a reader would otherwise reach for.

| Policy | Removes | 10,000 | 100,000 | 1,000,000 | 10,000,000 |
|---|---|---|---|---|---|
| `srcla` | _nothing — the full controller_ | **0.943** | **0.943** | **0.943** | **0.391** |
| `h1` | remove post-deposit simulation; rank on displayed rate. | 0.944 | 0.944 | 0.943 | 0.505 | **← restores deployment**
| `h2` | remove calibrated lower bounds; use the point forecast. | 0.943 | 0.943 | 0.944 | 0.390 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P | 0.882 | 0.882 | 0.886 | 0.434 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 0.943 | 0.943 | 0.943 | 0.391 |
| `h5` | remove shared-dependency caps. | 0.943 | 0.943 | 0.943 | 0.391 |
| `h6` | remove c_i^liquidity. | 0.943 | 0.943 | 0.943 | 0.448 | **← restores deployment**
| `h7` | remove the phi_i weighting. | 0.943 | 0.943 | 0.719 | 0.643 | **← restores deployment**
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 0.943 | 0.943 | 0.943 | 0.391 |


### The capacity frontier — was the tier beyond the venues, or was the capacity declined?

Idle capital has two opposite explanations — the venues could not absorb the tier, or the policy declined capacity that was available — and they carry opposite verdicts. The discriminating evidence is the other policies at the SAME tier. Rows are sorted by how much each deployed; read down until stressed coverage collapses. **That is the frontier.** A policy sitting well below it with coverage intact was not constrained by the market.

**Tier 10,000 USDC**

| Policy | Capital at work | Stressed coverage (min) | Full exit | Net APY | Displayed − realized |
|---|---|---|---|---|---|
| `b4` | 0.980 | 100.000% | 0 | 22.666% | -1.672% |
| `h1` | 0.944 | 100.000% | 0 | 19.271% | -0.465% |
| `b5` | 0.943 | 88.125% | 1 | 34.559% | -2.746% |
| **`srcla`** | 0.943 | 87.800% | 1 | 34.457% | -2.718% |
| `h4` | 0.943 | 87.800% | 1 | 34.457% | -2.718% |
| `h5` | 0.943 | 87.800% | 1 | 34.457% | -2.718% |
| `h6` | 0.943 | 87.800% | 1 | 34.457% | -2.718% |
| `h7` | 0.943 | 87.800% | 1 | 34.457% | -2.718% |
| `h3d` | 0.943 | 87.800% | 1 | 34.457% | -2.718% |
| `b3` | 0.943 | 87.807% | 1 | 34.248% | -2.696% |
| `h2` | 0.943 | 87.807% | 1 | 34.248% | -2.696% |
| `b2u` | 0.929 | 99.932% | 1 | 7.893% | 0.310% |
| `b1` | 0.927 | 99.898% | 1 | 9.949% | 0.414% |
| `b2` | 0.886 | 99.933% | 1 | 7.102% | 0.673% |
| `h3` | 0.882 | 100.000% | 0 | 6.067% | 0.597% |
| `b0` | 0.000 | 100.000% | 0 | 0.000% | 0.000% |

**Tier 100,000 USDC**

| Policy | Capital at work | Stressed coverage (min) | Full exit | Net APY | Displayed − realized |
|---|---|---|---|---|---|
| `b4` | 0.980 | 100.000% | 0 | 22.668% | -1.673% |
| `h1` | 0.944 | 100.000% | 0 | 19.276% | -0.470% |
| `b5` | 0.943 | 88.125% | 1 | 34.568% | -2.756% |
| **`srcla`** | 0.943 | 87.800% | 1 | 34.463% | -2.724% |
| `h4` | 0.943 | 87.800% | 1 | 34.463% | -2.724% |
| `h5` | 0.943 | 87.800% | 1 | 34.463% | -2.724% |
| `h6` | 0.943 | 87.800% | 1 | 34.463% | -2.724% |
| `h7` | 0.943 | 87.800% | 1 | 34.463% | -2.724% |
| `h3d` | 0.943 | 87.800% | 1 | 34.463% | -2.724% |
| `b3` | 0.943 | 87.807% | 1 | 34.251% | -2.699% |
| `h2` | 0.943 | 87.807% | 1 | 34.251% | -2.699% |
| `b2u` | 0.929 | 99.932% | 1 | 7.909% | 0.294% |
| `b1` | 0.927 | 99.898% | 1 | 9.973% | 0.391% |
| `b2` | 0.886 | 99.933% | 1 | 7.117% | 0.658% |
| `h3` | 0.882 | 100.000% | 0 | 6.087% | 0.577% |
| `b0` | 0.000 | 100.000% | 0 | 0.000% | 0.000% |

**Tier 1,000,000 USDC**

| Policy | Capital at work | Stressed coverage (min) | Full exit | Net APY | Displayed − realized |
|---|---|---|---|---|---|
| `b4` | 0.980 | 100.000% | 0 | 22.668% | -1.674% |
| `h2` | 0.944 | 87.807% | 1 | 34.272% | -2.740% |
| `b5` | 0.944 | 88.125% | 1 | 34.588% | -2.793% |
| `b2u` | 0.944 | 99.890% | 1 | 9.344% | 0.172% |
| **`srcla`** | 0.943 | 100.000% | 0 | 29.051% | -1.772% |
| `h4` | 0.943 | 100.000% | 0 | 29.051% | -1.772% |
| `h5` | 0.943 | 100.000% | 0 | 29.051% | -1.772% |
| `h6` | 0.943 | 100.000% | 0 | 29.051% | -1.772% |
| `h3d` | 0.943 | 100.000% | 0 | 29.051% | -1.772% |
| `h1` | 0.943 | 100.000% | 0 | 19.138% | -0.443% |
| `b1` | 0.927 | 99.898% | 1 | 9.975% | 0.389% |
| `b2` | 0.899 | 99.892% | 1 | 8.751% | 0.646% |
| `h3` | 0.886 | 100.000% | 0 | 7.035% | 0.677% |
| `h7` | 0.719 | 100.000% | 0 | 29.270% | 6.762% |
| `b3` | 0.668 | 87.850% | 3 | 32.930% | 10.130% |
| `b0` | 0.000 | 100.000% | 0 | 0.000% | 0.000% |

**Tier 10,000,000 USDC**

| Policy | Capital at work | Stressed coverage (min) | Full exit | Net APY | Displayed − realized |
|---|---|---|---|---|---|
| `b4` | 0.980 | 58.949% | **censored** | 22.668% | -1.674% |
| `b1` | 0.898 | 84.214% | 1 | 7.422% | 0.572% |
| `b2u` | 0.719 | 99.945% | 1 | 3.621% | 1.346% |
| `b3` | 0.690 | 100.000% | 0 | 9.192% | 3.601% |
| `h7` | 0.643 | 100.000% | 0 | 12.511% | 5.933% |
| `b2` | 0.578 | 100.000% | 0 | 4.054% | 2.865% |
| `b5` | 0.560 | 100.000% | 0 | 13.419% | 9.190% |
| `h1` | 0.505 | 100.000% | 0 | 8.646% | 7.826% |
| `h6` | 0.448 | 100.000% | 1 | 8.276% | 9.548% |
| `h3` | 0.434 | 100.000% | 0 | 9.404% | 11.436% |
| **`srcla`** | 0.391 | 100.000% | 0 | 5.856% | 8.725% |
| `h4` | 0.391 | 100.000% | 0 | 5.856% | 8.725% |
| `h5` | 0.391 | 100.000% | 0 | 5.856% | 8.725% |
| `h3d` | 0.391 | 100.000% | 0 | 5.856% | 8.725% |
| `h2` | 0.390 | 100.000% | 0 | 6.889% | 10.237% |
| `b0` | 0.000 | 100.000% | 0 | 0.000% | 0.000% |


### Per-policy results

`stressedLiquidCoverage` is measured every origin; the §11.5 gate tests only the **minimum** over the whole run, so one market-wide dry hour scores identically to chronic illiquidity. The p05 and median columns below distinguish the two — neither is what the gate tests.

§11.4's three sustainability measurements are reported per policy per tier in the same table. **Full exit** is the origins needed to redeem 100% of NAV from the run's worst coverage origin, executing only same-transaction exits — a LOWER BOUND, because each origin's capacity is read from a replay in which the vault did not exit, and marked `censored` where the era ended before the bound could be tested (a missing measurement, not a failure). **Max venue share** is the largest fraction of a venue the vault itself was, at any origin. **Displayed − realized** is the deployed-weighted advertised rate minus what the vault actually kept.

#### Tier 10,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Full exit (origins, lower bound) | Max venue share | Displayed − realized | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 34.457% | 4 | 11,800 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.718% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.000% | — |
| `b1` | 11.2 | 9.949% | 18 | 33,836 | 0 | 100.0% | 99.898% | 100.000% | 100.000% | 1 | — | 0.414% | — |
| `b2` | 11.2 | 7.102% | 11 | 39,821 | 0 | 100.0% | 99.933% | 100.000% | 100.000% | 1 | — | 0.673% | — |
| `b2u` | 11.2 | 7.893% | 13 | 40,626 | 0 | 100.0% | 99.932% | 100.000% | 100.000% | 1 | — | 0.310% | — |
| `b3` | 11.2 | 34.248% | 3 | 10,200 | 0 | 100.0% | 87.807% | 87.827% | 94.191% | 1 | — | -2.696% | — |
| `b4` | 11.2 | 22.666% | 245 | 9,981 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -1.672% | — |
| `b5` | 11.2 | 34.559% | 7 | 14,570 | 0 | 100.0% | 88.125% | 88.146% | 94.499% | 1 | — | -2.746% | — |
| `h1` | 11.3 | 19.271% | 4 | 14,877 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -0.465% | — |
| `h2` | 11.3 | 34.248% | 3 | 10,200 | 0 | 100.0% | 87.807% | 87.827% | 94.191% | 1 | — | -2.696% | — |
| `h3` | 11.3 | 6.067% | 16 | 38,627 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.597% | — |
| `h4` | 11.3 | 34.457% | 4 | 11,800 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.718% | — |
| `h5` | 11.3 | 34.457% | 4 | 11,800 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.718% | **INERT** |
| `h6` | 11.3 | 34.457% | 4 | 11,800 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.718% | **INERT** |
| `h7` | 11.3 | 34.457% | 4 | 11,800 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.718% | **INERT** |
| `h3d` | 11.3 | 34.457% | 4 | 11,800 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.718% | — |

#### Tier 100,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Full exit (origins, lower bound) | Max venue share | Displayed − realized | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 34.463% | 4 | 118,000 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.724% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.000% | — |
| `b1` | 11.2 | 9.973% | 18 | 338,358 | 0 | 100.0% | 99.898% | 100.000% | 100.000% | 1 | — | 0.391% | — |
| `b2` | 11.2 | 7.117% | 11 | 398,209 | 0 | 100.0% | 99.933% | 100.000% | 100.000% | 1 | — | 0.658% | — |
| `b2u` | 11.2 | 7.909% | 13 | 406,260 | 0 | 100.0% | 99.932% | 100.000% | 100.000% | 1 | — | 0.294% | — |
| `b3` | 11.2 | 34.251% | 3 | 102,000 | 0 | 100.0% | 87.807% | 87.827% | 94.191% | 1 | — | -2.699% | — |
| `b4` | 11.2 | 22.668% | 245 | 99,809 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -1.673% | — |
| `b5` | 11.2 | 34.568% | 7 | 145,699 | 0 | 100.0% | 88.125% | 88.145% | 94.499% | 1 | — | -2.756% | — |
| `h1` | 11.3 | 19.276% | 4 | 148,771 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -0.470% | — |
| `h2` | 11.3 | 34.251% | 3 | 102,000 | 0 | 100.0% | 87.807% | 87.827% | 94.191% | 1 | — | -2.699% | — |
| `h3` | 11.3 | 6.087% | 16 | 386,267 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.577% | — |
| `h4` | 11.3 | 34.463% | 4 | 118,000 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.724% | — |
| `h5` | 11.3 | 34.463% | 4 | 118,000 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.724% | **INERT** |
| `h6` | 11.3 | 34.463% | 4 | 118,000 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.724% | **INERT** |
| `h7` | 11.3 | 34.463% | 4 | 118,000 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.724% | **INERT** |
| `h3d` | 11.3 | 34.463% | 4 | 118,000 | 0 | 100.0% | 87.800% | 87.820% | 94.187% | 1 | — | -2.724% | — |

#### Tier 1,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Full exit (origins, lower bound) | Max venue share | Displayed − realized | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 29.051% | 3 | 1,012,395 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -1.772% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.000% | — |
| `b1` | 11.2 | 9.975% | 18 | 3,383,584 | 0 | 100.0% | 99.898% | 100.000% | 100.000% | 1 | — | 0.389% | — |
| `b2` | 11.2 | 8.751% | 13 | 4,418,337 | 0 | 100.0% | 99.892% | 100.000% | 100.000% | 1 | — | 0.646% | — |
| `b2u` | 11.2 | 9.344% | 213 | 4,291,434 | 0 | 100.0% | 99.890% | 100.000% | 100.000% | 1 | — | 0.172% | — |
| `b3` | 11.2 | 32.930% | 4 | 1,300,000 | 0 | 100.0% | 87.850% | 87.868% | 94.059% | 3 | — | 10.130% | — |
| `b4` | 11.2 | 22.668% | 245 | 998,095 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -1.674% | — |
| `b5` | 11.2 | 34.588% | 7 | 1,443,557 | 0 | 100.0% | 88.125% | 88.145% | 94.348% | 1 | — | -2.793% | — |
| `h1` | 11.3 | 19.138% | 4 | 1,252,240 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -0.443% | — |
| `h2` | 11.3 | 34.272% | 3 | 1,004,875 | 0 | 100.0% | 87.807% | 87.827% | 94.042% | 1 | — | -2.740% | — |
| `h3` | 11.3 | 7.035% | 17 | 4,018,661 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.677% | — |
| `h4` | 11.3 | 29.051% | 3 | 1,012,395 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -1.772% | — |
| `h5` | 11.3 | 29.051% | 3 | 1,012,395 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -1.772% | **INERT** |
| `h6` | 11.3 | 29.051% | 3 | 1,012,395 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -1.772% | **INERT** |
| `h7` | 11.3 | 29.270% | 3 | 1,260,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 6.762% | — |
| `h3d` | 11.3 | 29.051% | 3 | 1,012,395 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | -1.772% | — |

#### Tier 10,000,000 USDC

| Policy | § | Net APY | Rebalances | Turnover (USDC) | Costs (USDC) | Withdrawals filled | Stressed coverage — **min (gate)** | Stressed coverage — p05 | Stressed coverage — median | Full exit (origins, lower bound) | Max venue share | Displayed − realized | Ablation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `srcla` | 11.3 | 5.856% | 23 | 18,600,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 8.725% | — |
| `b0` | 11.2 | 0.000% | 0 | 0 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 0.000% | — |
| `b1` | 11.2 | 7.422% | 17 | 38,599,869 | 0 | 100.0% | 84.214% | 84.264% | 95.514% | 1 | — | 0.572% | — |
| `b2` | 11.2 | 4.054% | 18 | 46,048,527 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 2.865% | — |
| `b2u` | 11.2 | 3.621% | 18 | 74,659,999 | 0 | 100.0% | 99.945% | 99.964% | 100.000% | 1 | — | 1.346% | — |
| `b3` | 11.2 | 9.192% | 9 | 9,600,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 3.601% | — |
| `b4` | 11.2 | 22.668% | 245 | 9,980,948 | 0 | 100.0% | 58.949% | 58.959% | 66.315% | **censored** | — | -1.674% | — |
| `b5` | 11.2 | 13.419% | 20 | 14,398,712 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 9.190% | — |
| `h1` | 11.3 | 8.646% | 25 | 15,993,505 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 7.826% | — |
| `h2` | 11.3 | 6.889% | 21 | 10,800,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 10.237% | — |
| `h3` | 11.3 | 9.404% | 22 | 23,800,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 11.436% | — |
| `h4` | 11.3 | 5.856% | 23 | 18,600,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 8.725% | — |
| `h5` | 11.3 | 5.856% | 23 | 18,600,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 8.725% | **INERT** |
| `h6` | 11.3 | 8.276% | 24 | 21,785,714 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 1 | — | 9.548% | — |
| `h7` | 11.3 | 12.511% | 6 | 10,000,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 5.933% | — |
| `h3d` | 11.3 | 5.856% | 23 | 18,600,000 | 0 | 100.0% | 100.000% | 100.000% | 100.000% | 0 | — | 8.725% | — |

### The skill window (P22) — is either yield statement informative?

Registered non-inferiority margin: **43.0 bps** annualized (`REGISTERED_NONINFERIORITY_MARGIN`, an **unconfirmed** registration the paper owner must confirm before the freeze). The window below is bounded hindsight minus the best SUSTAINABLE baseline — the entire return reallocation could have earned.

| Tier | Bounded hindsight (B5) | Best sustainable baseline | its net APY | Skill window | Superiority resolvable? |
|---|---|---|---|---|---|
| 10,000 | 34.559% | b4 | 22.666% | 1189.3 bps | INFORMATIVE |
| 100,000 | 34.568% | b4 | 22.668% | 1190.1 bps | INFORMATIVE |
| 1,000,000 | 34.588% | b4 | 22.668% | 1192.0 bps | INFORMATIVE |
| 10,000,000 | 13.419% | — | — | — | **NOT PRODUCED** |

A window narrower than the margin means **no policy could have demonstrated yield superiority at this resolution**, so the superiority line is reported NOT INFORMATIVE and gates nothing. It does **not** excuse the non-inferiority test: a narrow window makes non-inferiority *easier*, so a pass there is disclosed as weak evidence of allocation quality — deploy-and-hold would satisfy it too. The window never touches the demonstration, completeness or sustainability checks: yield can be beyond reach, redeemability cannot.

### SRCLA against each deployable baseline

**Non-inferiority** is §11.5's yield criterion: one-sided at a 43.0 bps annualized margin, HAC-corrected, and cross-checked by a seeded moving-block bootstrap that may downgrade a pass to UNRESOLVED but may never upgrade a failure. The two-sided p and the bootstrap CI are **reported diagnostics** and gate nothing.

| Tier | Baseline | SRCLA | Baseline | Non-inferior (43.0 bps) | one-sided p | two-sided HAC p | bootstrap 95% CI of difference |
|---|---|---|---|---|---|---|---|
| 10,000 | `b1` | 34.457% | 9.949% | NON-INFERIOR | 0.0000 | 0.0000 | [1.78e-5, 2.85e-5] |
| 10,000 | `b2` | 34.457% | 7.102% | NON-INFERIOR | 0.0000 | 0.0000 | [2.07e-5, 3.17e-5] |
| 10,000 | `b4` | 34.457% | 22.666% | NON-INFERIOR | 0.0000 | 0.0000 | [8.40e-6, 1.28e-5] |
| 100,000 | `b1` | 34.463% | 9.973% | NON-INFERIOR | 0.0000 | 0.0000 | [1.78e-5, 2.84e-5] |
| 100,000 | `b2` | 34.463% | 7.117% | NON-INFERIOR | 0.0000 | 0.0000 | [2.06e-5, 3.17e-5] |
| 100,000 | `b4` | 34.463% | 22.668% | NON-INFERIOR | 0.0000 | 0.0000 | [8.41e-6, 1.28e-5] |
| 1,000,000 | `b1` | 29.051% | 9.975% | NON-INFERIOR | 0.0000 | 0.0000 | [1.39e-5, 2.28e-5] |
| 1,000,000 | `b2` | 29.051% | 8.751% | NON-INFERIOR | 0.0000 | 0.0000 | [1.52e-5, 2.42e-5] |
| 1,000,000 | `b4` | 29.051% | 22.668% | NON-INFERIOR | 0.0000 | 0.0000 | [4.61e-6, 7.10e-6] |

## Ablation contributions

Each row below removes exactly one component from SRCLA (§11.3) and reports what that component was measured to be worth: `contribution = SRCLA net APY − ablation net APY` at the same tier. **Positive** means removing the component made the policy worse — the component was earning its keep. **Negative** means removing it made the policy BETTER — the component cost more than it earned on this data.

#### Tier 10,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 34.457% | 19.271% | +15.186 pp | 4 | 4 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 34.457% | 34.248% | +0.209 pp | 3 | 4 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles. | 34.457% | 6.067% | +28.390 pp | 16 | 4 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 34.457% | 34.457% | +0.000 pp | 4 | 4 |
| `h5` | remove shared-dependency caps. | 34.457% | 34.457% | **INERT** (identical decisions — not a measured contribution) | 4 | 4 |
| `h6` | remove c_i^liquidity. | 34.457% | 34.457% | **INERT** (identical decisions — not a measured contribution) | 4 | 4 |
| `h7` | remove the phi_i weighting. | 34.457% | 34.457% | **INERT** (identical decisions — not a measured contribution) | 4 | 4 |
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 34.457% | 34.457% | +0.000 pp | 4 | 4 |

#### Tier 100,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 34.463% | 19.276% | +15.187 pp | 4 | 4 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 34.463% | 34.251% | +0.212 pp | 3 | 4 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles. | 34.463% | 6.087% | +28.376 pp | 16 | 4 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 34.463% | 34.463% | +0.000 pp | 4 | 4 |
| `h5` | remove shared-dependency caps. | 34.463% | 34.463% | **INERT** (identical decisions — not a measured contribution) | 4 | 4 |
| `h6` | remove c_i^liquidity. | 34.463% | 34.463% | **INERT** (identical decisions — not a measured contribution) | 4 | 4 |
| `h7` | remove the phi_i weighting. | 34.463% | 34.463% | **INERT** (identical decisions — not a measured contribution) | 4 | 4 |
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 34.463% | 34.463% | +0.000 pp | 4 | 4 |

#### Tier 1,000,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 29.051% | 19.138% | +9.913 pp | 4 | 3 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 29.051% | 34.272% | **-5.221 pp** | 3 | 3 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles. | 29.051% | 7.035% | +22.016 pp | 17 | 3 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 29.051% | 29.051% | +0.000 pp | 3 | 3 |
| `h5` | remove shared-dependency caps. | 29.051% | 29.051% | **INERT** (identical decisions — not a measured contribution) | 3 | 3 |
| `h6` | remove c_i^liquidity. | 29.051% | 29.051% | **INERT** (identical decisions — not a measured contribution) | 3 | 3 |
| `h7` | remove the phi_i weighting. | 29.051% | 29.270% | **-0.219 pp** | 3 | 3 |
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 29.051% | 29.051% | +0.000 pp | 3 | 3 |

#### Tier 10,000,000 USDC

| Ablation | Removes | SRCLA net APY | Ablation net APY | Contribution | Ablation rebalances | SRCLA rebalances |
|---|---|---|---|---|---|---|
| `h1` | remove post-deposit simulation; rank on displayed rate. | 5.856% | 8.646% | **-2.790 pp** | 25 | 23 |
| `h2` | remove calibrated lower bounds; use the point forecast. | 5.856% | 6.889% | **-1.034 pp** | 21 | 23 |
| `h3` | remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles. | 5.856% | 9.404% | **-3.548 pp** | 22 | 23 |
| `h4` | remove the dynamic reserve and stress feasibility; admin floor only. | 5.856% | 5.856% | +0.000 pp | 23 | 23 |
| `h5` | remove shared-dependency caps. | 5.856% | 5.856% | **INERT** (identical decisions — not a measured contribution) | 23 | 23 |
| `h6` | remove c_i^liquidity. | 5.856% | 8.276% | **-2.421 pp** | 24 | 23 |
| `h7` | remove the phi_i weighting. | 5.856% | 12.511% | **-6.655 pp** | 6 | 23 |
| `h3d` | remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. | 5.856% | 5.856% | +0.000 pp | 23 | 23 |

> **Negative contribution: removing the component helped, not hurt.** This is the report's most important measured signal — the component cost more than it earned on this data.
>
> - `h2` (remove calibrated lower bounds; use the point forecast.) at tier 1,000,000 USDC: contribution **-5.221 pp**.
> - `h7` (remove the phi_i weighting.) at tier 1,000,000 USDC: contribution **-0.219 pp**.
> - `h1` (remove post-deposit simulation; rank on displayed rate.) at tier 10,000,000 USDC: contribution **-2.790 pp**.
> - `h2` (remove calibrated lower bounds; use the point forecast.) at tier 10,000,000 USDC: contribution **-1.034 pp**.
> - `h3` (remove the complete-cost gate and the no-trade band. As implemented (P13/P15/P16/P17) that is §9.1.2's deployment hurdle and §9.1.3's rotation hurdle, the two movement hurdles the `k*sigma` band was replaced by; the §9.1.4 churn brakes (cooldown, min/max turnover, reversal allowance) stay in force, since the paper puts them outside the hurdles.) at tier 10,000,000 USDC: contribution **-3.548 pp**.
> - `h6` (remove c_i^liquidity.) at tier 10,000,000 USDC: contribution **-2.421 pp**.
> - `h7` (remove the phi_i weighting.) at tier 10,000,000 USDC: contribution **-6.655 pp**.


### §11.5 forecast gate

**FAIL** — blocked on: Kupiec unconditional coverage — aave-v3-usdc; Kupiec unconditional coverage — compound-v3-usdc; Per-venue coverage — moonwell-usdc; Kupiec unconditional coverage — moonwell-usdc; Christoffersen conditional coverage — moonwell-usdc

| Verdict | Role | Check | Detail |
|---|---|---|---|
| PASS | gates | Per-venue coverage — aave-v3-usdc | achieved 100.00% against target 99.00% (tolerance 1.00pp, floor 98.00%) on 899 out-of-sample residuals, q=-1.1195e-4 |
| **FAIL** | gates | Kupiec unconditional coverage — aave-v3-usdc | LR_uc 18.0705, p 0.0000 < 0.05 — breach rate 0.00% against expected 1.00% |
| PASS | gates | Christoffersen conditional coverage — aave-v3-usdc | LR_cc 0.8241 (LR_ind 0.0000), p 0.6623 >= 0.05 on 41 non-overlapping windows |
| PASS | gates | Per-venue coverage — compound-v3-usdc | achieved 100.00% against target 99.00% (tolerance 1.00pp, floor 98.00%) on 1103 out-of-sample residuals, q=-5.7725e-5 |
| **FAIL** | gates | Kupiec unconditional coverage — compound-v3-usdc | LR_uc 22.1710, p 0.0000 < 0.05 — breach rate 0.00% against expected 1.00% |
| PASS | gates | Christoffersen conditional coverage — compound-v3-usdc | LR_cc 0.9246 (LR_ind 0.0000), p 0.6298 >= 0.05 on 46 non-overlapping windows |
| **FAIL** | gates | Per-venue coverage — moonwell-usdc | achieved 92.45% against target 99.00% (tolerance 1.00pp, floor 98.00%) on 1073 out-of-sample residuals, q=-8.5493e-5 |
| **FAIL** | gates | Kupiec unconditional coverage — moonwell-usdc | LR_uc 191.6822, p 0.0000 < 0.05 — breach rate 7.55% against expected 1.00% |
| **FAIL** | gates | Christoffersen conditional coverage — moonwell-usdc | LR_cc 8.5341 (LR_ind 2.1025), p 0.0140 < 0.05 on 45 non-overlapping windows |
| PASS | gates | Label completeness | worst venue aave-v3-usdc at 100.00% of 1133 origins (floor 99.00%); aave-v3-usdc 100.00%, compound-v3-usdc 100.00%, moonwell-usdc 100.00% |
| PASS | gates | Regime purity | 192 of 3399 label windows straddle a regime change (5.65%, tolerance 10%): aave-v3-usdc@1784851200 (aave:0xa238dd80c259a72e81d7e4664a9801593f98d1c5\|0x86ab1c62a8bf868e1b3e1ab87d587aba6fbcbdc5:0:900000000000000000000000000:45000000000000000:100000000000000000:active -> aave:0xa238dd80c259a72e81d7e4664a9801593f98d1c5\|0x86ab1c62a8bf868e1b3e1ab87d587aba6fbcbdc5:0:900000000000000000000000000:46000000000000000:100000000000000000:active at 1784916000, inside [origin, origin+H]); aave-v3-usdc@1784854800… |
| PASS | gates | Availability-lag barrier | all 3399 labels are readable no earlier than origin + 86400s + 900s lag |
| PASS | gates | Registered grid points present | swept 36, scorable 36, registered grid 36 |
| PASS | gates | Selection margin | margin 6.4198e-1 against the registered floor 1e-3 |
| PASS | gates | Artifact reproducibility | content hash re-derives from the artifact body: 694cf86f6f7363f2f76a19ce66781ae82311ab1cbd2b7220b3aab94bda8223cf |
| PASS | gates | Calibrated artifact | artifact is registered, not provisional |
| PASS | gates | Artifact completeness (P23) | the artifact carries every field the policy reads |

Coverage is recomputed OUT OF SAMPLE. The artifact's per-venue quantile was solved to hit the target on the calibration era, so its in-sample coverage is true by construction and says nothing; what follows is the same quantile measured against the labels this era produced. Christoffersen's independence test runs on a stream thinned to NON-OVERLAPPING horizon windows — consecutive labels share most of their window, so on the raw stream the test would reject clustering the sampling grid created rather than clustering the forecast did.

| Venue | Residuals | Achieved coverage | Exceedances | Kupiec p | Christoffersen p | Non-overlapping windows |
|---|---|---|---|---|---|---|
| aave-v3-usdc | 899 | 100.00% | 0 | 0.0000 | 0.6623 | 41 |
| compound-v3-usdc | 1103 | 100.00% | 0 | 0.0000 | 0.6298 | 46 |
| moonwell-usdc | 1073 | 92.45% | 81 | 0.0000 | 0.0140 | 45 |

### §11.5 policy gate

| Verdict | Role | Check | Detail |
|---|---|---|---|
| **FAIL** | gates | Demonstration: sustainability was demonstrated while deployed | NOT DEMONSTRATED at srcla@10000000000000 (realized 5.856%): below the 0.7 capital-at-work floor, redeemability proves nothing and no sustainability claim may be drawn |
| PASS | gates | Every registered tier ran | all 4 of §11.1's tiers |
| PASS | gates | Every registered policy ran at every tier | all 64 required (policy, tier) runs |
| PASS | gates | Calibrated artifact | 694cf86f6f7363f2f76a19ce66781ae82311ab1cbd2b7220b3aab94bda8223cf |
| **FAIL** | gates | §11.1 pinned-prestate fork replay | did not execute on fork: b4@10000000000 (b4@10000000000 REFUSED BY THE CHAIN: the vault reverted the plan: transaction execution reverted (action="sendTransaction", data=null, reason=null, invocation=null, revert=null, transaction={ "data": "", "from": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "to": "0xEBBb24079B6fd4c26d84C2f1c66f4377Fb6B7C0e" }, receipt={ "_type": "TransactionReceipt", "blobGasPrice": "1", "blobGasUsed": null, "blockHash": "0x6f87a4bb26d3e182a6dbac5f9ed1d9c7c25bb5132918cfe534b3d4de20a8b378", "blockNumber": 51207219, "contractAddress": null, "cumulativeGasUsed": "302961",… |
| PASS | gates | Safety: withdrawal success measured and met | >= 99% across 4 SRCLA runs |
| **FAIL** | gates | Safety: stressed liquid coverage | srcla@10000000000 0.878, srcla@100000000000 0.878 reported (not gating): b3@10000000000 0.878, b5@10000000000 0.881, h2@10000000000 0.878, h4@10000000000 0.878, h5@10000000000 0.878, h6@10000000000 0.878, h7@10000000000 0.878, h3d@10000000000 0.878, b3@100000000000 0.878, b5@100000000000 0.881, h2@100000000000 0.878, h4@100000000000 0.878, h5@100000000000 0.878, h6@100000000000 0.878, h7@100000000000 0.878, h3d@100000000000 0.878, b3@1000000000000 0.879, b5@1000000000000 0.881, h2@1000000000000 0.878, b1@10000000000000 0.842, b4@10000000000000 0.589 |
| **NOT PRODUCED** | gates | Sustainability S1: complete exit within the registered bound | NOT DEMONSTRATED at srcla@10000000000000 |
| **NOT PRODUCED** | gates | Sustainability S3: venue-stress share (utilization-ceiling clause NOT EVALUATED) | NOT DEMONSTRATED at srcla@10000000000000 |
| **NOT PRODUCED** | gates | Sustainability S4: action validity (§11.5 violation classes NOT EVALUATED) | NOT DEMONSTRATED at srcla@10000000000000 |
| **FAIL** | gates | Sustainability: scale invariance across every registered tier (P26) | breaches at srcla@10000000000 (S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072)); srcla@100000000000 (S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072)) |
| **FAIL** | reported | No inert ablation | reported (not gating): these made byte-identical decisions to SRCLA: h5, h6, h7 — any delta attributed to the component each removes is noise |
| PASS | reported | Diagnostic: statistical distinguishability from every sustainable baseline | p < 0.05 against all 9 admissible deployable comparisons |
| PASS | gates | Non-inferior to every sustainable baseline (margin 43.0 bps) | within 43.0 bps of all 9 sustainable comparators (one-sided HAC p < 0.05, block-bootstrap agreeing) |
| PASS | gates | Price of unsustainability published | b0@10000000000 0.000% (displayed−realized 0.000pp) — NOT DEMONSTRATED: capital at work 0.000 < 0.7; a vault holding idle cash is trivially redeemable and has demonstrated nothing about sustainability (realized 0.000%); b3@10000000000 34.248% (displayed−realized -2.696pp) — S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072); b5@10000000000 34.559% (displayed−realized -2.746pp) — S2 stressed coverage 0.881 vs floor 0.950 (short by 0.069); h2@10000000000 34.248% (displayed−realized -2.696pp) — S2 stressed coverage 0.878 vs floor 0.950 (short by 0.072); h4@10000000000 34.457%… |

## Limitations

- **§11.1's pinned-prestate fork replay is not produced.** `src/evaluation/fork-runner.ts#runForkReplays` produces it and needs a live Base fork with the vault deployed; this run supplied none, so the gate reports NOT PRODUCED and blocks. No allocation in this report has been shown to be one the chain would have accepted.
- **Withdrawals are synthetic** (see above), so the withdrawal-success and stressed-coverage figures describe the registered schedule, not observed demand.
- **An INERT ablation removed nothing** on this dataset: its decision sequence is byte-identical to SRCLA's, so any delta reported for it is noise and attributing it to the removed component would be a misattribution. Inert rows are marked in the tables above.
- **Reward emissions** contribute whatever the measured probe found, which may be zero. A zero is reported as zero rather than omitted.

## Reproducing this report

```bash
cd srcla && docker compose up -d
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' pnpm prisma:push
DATABASE_URL='...' pnpm backfill:history            # ~18k hourly origins
DATABASE_URL='...' pnpm exec tsx scripts/freeze-artifact.ts
DATABASE_URL='...' pnpm evaluation:run --era heldout-c --artifact config/registered-artifact.json --out evaluation-heldout-c.json
DATABASE_URL='...' pnpm evaluation:run --era heldout-b --artifact config/registered-artifact.json --out evaluation-heldout-b.json
```

