# Safe, Robust, Cost-Aware Lending Allocation for ERC-4626 Vaults

**Research report version:** 0.9

**Date:** 2026-09-11

**Release scope:** Base-native research release specification

**Empirical status:** The architecture, market registry, and evaluation protocol are specified, and the registered evaluation has been **run to completion on both sealed eras**. It returns `FAIL`, and this document reports that result in full rather than adjusting the criteria to avoid it. What is established: the central proposition (§1), measured at every registered vault tier on 86 days of sealed Base mainnet state and corroborated by an exogenous venue failure (Appendix F); SRCLA's sustainability up to one million USDC; and a precisely located capacity threshold above which it is dominated by a simpler baseline. What is **not** established: a passing §11.5 gate, calibration of the forecast's lower bound out of sample, sustainability at the ten-million tier, historical outperformance, or production readiness. Appendices D and F record every measurement behind those statements, including the ones unfavourable to this controller.

## Abstract

A lending vault should not allocate all capital to the market displaying the highest annual percentage yield (APY). A sufficiently large deposit changes utilization and the attainable supply rate; accounting assets may not be synchronously withdrawable; and gas, slippage, reward conversion, and rate reversal can eliminate an apparent yield advantage. 

This report specifies the Safe, Robust, Cost-Aware Lending Allocator (SRCLA), a deterministic controller for one pooled, unleveraged ERC-4626 vault over Circle native USDC on Base. Release one allocates through vault-bound adapters to Aave V3, Compound III, and Moonwell. An immutable on-chain layer enforces market admission, market and dependency caps, idle reserve, loss and slippage bounds, decision expiry, pause behavior, and bounded emergency exits. A separately deployable TypeScript service observes finalized Base state, simulates protocol-exact post-deposit rates, calibrates deterministic lower prediction bounds without look-ahead, solves a constrained allocation problem, and submits staged rebalances only when conservative benefit exceeds full cost.

Version 0.7 revises the movement rule and the release criterion after two registered held-out evaluations returned `FAIL`. Three specification defects are corrected. The movement threshold conflated the *predictive dispersion of a single horizon outcome* with the *sampling error of an estimated edge*, charging forecast uncertainty twice; it is restated as an annualized rate differential against a registered payback period, which halves the rate a venue must show before idle capital deploys. That correction does not by itself make the economics independent of the forecast horizon — the residual dependence lives in §7's bound rather than in §9.1's hurdle, and §7.3's repaired selection loss is what addresses it. Deploying idle capital was priced as though it were a venue-to-venue rotation, though it carries neither an incumbent position nor reversal risk; the two legs are now separated. The gate was binary over the whole target vector, where the transaction-cost literature prescribes trading to the boundary of a no-trade region and adjusting partially toward an aim portfolio; it is now evaluated per leg and executed by partial adjustment. Base interest remains inside protocol positions; separately accrued incentives are conservatively recognized and converted through an immutable, Uniswap-V3-only reward executor when an event-driven cost gate passes.

Version 0.8 states what the study is for. The proposition is not that a
constrained allocator earns more than an unconstrained one; it is that **the
highest available yield is frequently not redeemable**, and that an allocator
should be judged on whether the return it reports can actually be withdrawn, at
the size the vault actually holds, in the period it actually ran. The v0.6
evaluation supplies the evidence: the policy that always selects the highest
displayed rate breached the stressed-liquidity floor at **every** vault tier on
one held-out era, and a fixed-weight policy that earned 24.95% with perfect
coverage at one million USDC held **zero** stressed coverage at ten million.
Yield and redeemability are not two scores to trade off. A return that cannot
be redeemed is not a return.

The release gate is rebuilt around that. Sustainability — redeemability under
stress, capacity discipline, operational continuity, and *invariance across
vault size* — is the primary and absolute criterion. Yield is scored second and
only among policies that are themselves sustainable; a policy that breaches is
not a comparator but a counterexample, and its return is published as the
measured price of unsustainability. One requirement keeps this honest and is
stated first among the criteria: **sustainability must be demonstrated while
deployed.** A vault holding idle cash is trivially redeemable and has shown
nothing, so a registered capital-at-work floor precedes every other
sustainability check.
Version 0.9 reports the completed registered evaluation. **It returns `FAIL`,
and the result is published rather than tuned away**, together with the
specification defects it exposed and one exogenous event that proved more
informative than any of them.

**The central proposition is confirmed twice — once by the protocol and once by
the market.** Over an 86-day sealed era the policy that always selects the
highest displayed rate earned the study's best return, 3.63% APY, while holding
**zero** stressed liquid coverage at the ten-million tier; the best
single-venue policy earned 3.25% at 0.151. Neither could have honoured a
redemption. Independently, on 2026-08-27 a Moonwell USDC pool was drained from
$2,105,538 of withdrawable cash to **$1 within a single hour**, after which it
advertised 87–90% APY for fourteen consecutive days with nothing withdrawable
behind it. The highest annual percentage yield in two years of Base mainnet
data belonged to a venue from which no depositor could recover a dollar.

**SRCLA satisfies the sustainability criterion up to one million USDC and fails
above it.** At the 10k, 100k and 1M tiers it held stressed coverage of 1.000,
1.000 and 0.963, filled 100% of attempted redemptions, completed a full exit
within one origin, kept 91.3% of capital at work, and delivered 3.23–3.27% net
APY against a displayed-versus-realized gap of 0.19 percentage points — the
narrowest of any deployed policy in the study. At ten million it deployed only
42.7% of the vault and returned 1.56%. That shortfall is **entirely idle
capital, not degraded execution**: every deployed dollar earned 3.655%, the
highest per-dollar rate at any tier. Ablation attributes the withheld capital
to the three liquidity-aware mechanisms acting together — the movement-cost
hurdle (+0.339 capital-at-work when removed), the post-deposit capacity curves
(+0.243), and the exitable-fraction weighting (+0.146).

**The honest negative result is that this caution is not vindicated at scale.**
A reserve-matched baseline deployed 80.8% at ten million, held stressed
coverage of 1.000, and earned 2.59% — more capital at work, better
redeemability, and 66% more yield than SRCLA, without any of the machinery
above. The study therefore establishes the phenomenon it set out to establish
and prices it, but does not establish that this controller is the best response
to it above a capacity threshold the evaluation itself locates.

Two findings about the *method* stand independently of that verdict. First, the
registered uncertainty term was applied **additively** to a point forecast that
the vault's own deposit compresses, so a constant haircut consumed a growing
share of a shrinking edge and, past a certain size, exceeded it outright; it is
restated multiplicatively (P29), which the calibration data supports and which
is *stricter* than the form it replaces wherever the forecast exceeds a venue's
mean. Second, the horizon that minimizes §7.3's selection loss is one §11.5's
forecast gate **cannot test**: Christoffersen's independence test requires
non-overlapping windows, and a fourteen-day horizon leaves nine of them in an
86-day era against a thirty-observation minimum. Registered candidates are now
restricted to horizons the gate can falsify (P33), which narrows the grid from
108 points to 36 and is a strengthening, not a relaxation.

This paper specifies a falsifiable architecture and evaluation procedure, and
reports the completed evaluation of it. It does **not** claim a passing release
gate, historical outperformance, or production readiness.

**Keywords:** DeFi, ERC-4626, Base, USDC, lending allocation, yield farming, deterministic forecasting, robust optimization, liquidity risk, transaction costs.

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

## Amendment Record (v0.5 → v0.6)

The v0.5 registered evaluation ran to completion on 267 days of sealed held-out
data and returned `FAIL`. Four of nine §11.5 checks passed; five did not. `FAIL`
is a legitimate outcome — §11.5 requires publishing one rather than retuning
against held-out data. The four amendments below close three defects that
evaluation *diagnosed* — each a flaw in the specification or the
implementation, not a property of the market — and are registered here, before
the code they justify is written.

**Second burned-window declaration.** The window `2025-06-01 → 2026-02-28` was
inspected while diagnosing v0.5 and is therefore design data. Additionally,
**aggregate statistics spanning `2026-03-01 → 2026-05-25` were read** — net
APY, worst stressed coverage, total cost and turnover over the whole of the
former held-out era. That era (`heldout-c`) is therefore *less burned, not pristine*, and every result drawn from it carries this caveat. It is used
because the alternative, the 16-day `heldout-b`, is too short and too
dominated by a single venue's liquidity failure to adjudicate a yield claim.

| ID | Amendment | Section | Evidence |
|---|---|---|---|
| P9 | Where `C_move ≪ k·σ` the movement gate reduces to the no-trade band alone; `k` must be registered by a turnover-vs-return sweep, never asserted | §9.1 | SRCLA's measured movement cost over 267d: $0.01 (0.02 bps/yr). B1 at 182× NAV turnover: $0.13 (0.17 bps/yr). At `k=1.0` the band is ≈$50 on a 500k move against `C_move` ≈$0.0001. SRCLA forfeited ~20 bps/yr to save $0.12 |
| P10 | The optimiser's liquidity feasibility test and §11.4's coverage metric are the same function | §8.2, §11.4 | SRCLA scored 0.836 @1M and 0.792 @10M while its own stress test reported the allocation feasible |
| P11 | Stressed coverage is reported as a distribution (min, p05, median). **The gate remains on the minimum.** | §11.4 | The metric is the worst of 6,408 origins. Worst-case universe cash $3.6M against a $89M average — one dry hour sets the score |
| P12 | Where a tier's registered stress demand exceeds observed worst-case universe liquidity, the coverage check reports **CAPACITY-INFEASIBLE** | §11.1, §11.4 | The 10M tier needs $5M liquid against a $3.6M worst-case universe |

**P12 is not gate-softening.** `CAPACITY-INFEASIBLE` does not verify and does
not pass; the overall gate still blocks, exactly as the existing `null` /
NOT PRODUCED outcome does. It only distinguishes "the policy allocated badly"
from "no policy could have satisfied this".

## Amendment Record (v0.6 → v0.7)

The v0.6 registered evaluation ran on two sealed eras and returned `FAIL` on
both. On the 86-day primary era SRCLA executed **one** rebalance and realized
0.871%; on the 16-day secondary era it executed **none** and realized 0.000%.
At the 10,000 USDC tier on that era the fixed-weight baseline B4 realized
24.951% while holding 100.0% stressed coverage and 100% withdrawal fill, so a
safe and available alternative existed and the safety envelope does not explain
the zero. The ablation that removes the movement gate and nothing else realized
3.462% and 39.157% on the two eras. The gate was the binding constraint.

The eleven amendments below are derived **entirely from the calibration era**
(2024-03-15 → 2025-05-31, 10,632 hourly origins, three venues), re-measured for
this revision and reproduced in Appendix D. No sealed observation informs any
of them. They are registered here, before the code they justify is written.

**Third burned-window declaration.** The v0.6 registered run and its diagnosis
read `heldout-c` (2026-03-01 → 2026-05-25) and `heldout-b` (2026-08-24 →
2026-09-08) in full, at per-policy and per-tier resolution. Both are design
data from this point and may never again serve as held-out evidence. Together
with the windows burned by v0.5 and v0.6, the design-data set is now
2025-06-01 → present. Version 0.7 must be validated on an era that begins
after this document is registered.

| ID | Amendment | Section | Evidence |
|---|---|---|---|
| P13 | The movement hurdle uses the **standard error of the estimated edge**, not the predictive quantile of one horizon outcome. §7's lower bound already charges predictive dispersion; the band charged it a second time | §9.1 | The v0.6 objective subtracted \|q\|·notional and the gate then demanded the remainder clear another k·\|q\|·notional. At the registered artifact (q = −1.061e-4, k = 1) this required a venue to show **7.74% APY** before idle USDC could be deployed. Realized calibration-era means: Aave 6.13%, Compound 4.94%, Moonwell 4.86% |
| P14 | `C_move` is decomposed **by leg**. Price impact, slippage and MEV are properties of the §9.4 Uniswap route and apply to the reward-swap leg only; lending deposit and withdraw legs carry gas, failure and buffer | §9.1, §9.3 | A supply or withdraw executes at the protocol index: there is no quoted price to slip against and no sandwich surface. Charging 8 bps of notional to a lending leg both invents a cost and double-counts §6.1's post-deposit curve, which already prices the rate effect of size |
| P15 | The action rule is an **annualized rate differential against a registered payback period** $T_{\mathrm{pay}}$, not a horizon-return comparison | §9.1 | σ over the horizon is near-flat in H (×1.19 at 14d against ×3.74 for √H) while expected horizon return is linear in H, so the v0.6 rule's implied hurdle fell from 7.74% APY at H=1d to 0.66% at H=14d — a 12× swing in the economics from a forecasting choice |
| P16 | Deploying idle capital is gated on **cost alone**. The differential hurdle applies only to venue-to-venue rotation, and §11.3 gains **H3d** so the two legs are ablated separately | §9.1, §11.3 | §9.1 already said idle capital "reduces target drift before SRCLA exits a strategy" and the implementation gated it identically to a rotation. Measured cost of the conflation: **494 bps/yr**, against 18–43 bps/yr for all rotation alpha combined |
| P17 | The gate is evaluated **per leg** and executed by **partial adjustment** toward the aim. Discarding the whole target vector because one leg fails is forbidden | §8.2, §9.1 | Constantinides' no-trade region is exited by trading *to its boundary* [58]; Gârleanu and Pedersen's optimal policy under transaction costs is partial adjustment toward an aim portfolio [57]. v0.6 did neither: 0 or 1 trades on each held-out era |
| P18 | The forecast horizon is **co-selected with the movement rule**. §7.3's loss gains the turnover and sacrificed-return terms it already names, every term is scale-normalized, and a selection margin below a registered threshold must be broken by the economic terms | §7.2, §7.3 | The v0.6 loss was 99.84% `downsideRate` (0.5076 of 0.5084), a quantity ≈0.5 for any unbiased candidate. H was decided on a margin of **1.27e-7**, and nothing in the loss could observe that the winning horizon stops the policy trading |
| P19 | A fourth registered forecast candidate: **state-space forecasting of utilization, mapped through the venue's exact on-chain interest-rate model** | §7.2, §6.3–6.5 | One-day persistence R² for utilization is 0.758 / 0.918 / 0.915 against **−0.206** / 0.430 / 0.042 for the rate it drives. The rate is a kinked, governance-reparameterized function of a smooth bounded state; the registered grid forecast the discontinuous output and ignored the continuous input |
| P20 | Deployability is **measured, not asserted**. A comparator that breaches the registered safety envelope during a run is not a deployable baseline for that run | §11.2, §11.5 | On the v0.6 secondary era every stressed-coverage violation belonged to a baseline or an ablation and none to SRCLA, yet the gate recorded them as SRCLA's failure. B1, B2 and B2u earned 39% while holding 0.878 coverage against a 0.99 floor SRCLA obeyed |
| P21 | The policy gate becomes **safety dominance plus non-inferiority on after-cost yield**; superiority is claimed and tested per dimension; ablations are §11.3 evidence and not §11.2 comparators | §11.3, §11.5 | Requiring a safety-constrained optimiser to beat unconstrained comparators on yield tests the constraint, not the optimiser. An ablation that beats SRCLA is a finding about the removed component, which is what §11.3 exists to report |
| P22 | The **skill window** — bounded hindsight minus the best admissible baseline — is measured before any yield criterion is scored. Within the margin it makes a *superiority* claim `NOT INFORMATIVE` and a *non-inferiority* pass weak evidence that must be disclosed as such | §11.5 | Best achievable calibration-era net APY across the whole v0.7 parameter space is 5.120%; equal-weight-and-hold is 4.941%; the zero-cost ceiling is 5.374%. A superiority criterion over an 18–43 bps window measures estimation noise, and a non-inferiority pass over one is satisfied by deploy-and-hold |
| P23 | The registered artifact must **carry every quantity the policy reads**, and the artifact hash must cover all of it | §7.3, §8.2 | The v0.6 artifact recorded `residualPanelBuilt: true` while carrying no panel: the writer never serialized it and the loader never parsed it. P2's weight-dependent portfolio quantile and P8's dispersion silently fell back to a frozen scalar, which is the mechanical cause of the run's inert-ablation failure |

**P16, P21 and P22 are the three that change a claim rather than a
calculation, so each is justified only by calibration-era measurement.** P16
and P22 rest on the figures in Appendix D, all of which are computed on the
fitting era. P21 rests on a structural argument that needs no data: a
comparator exempt from a constraint the candidate must obey cannot measure
that candidate's skill. None of the three is supported by, or was chosen
after inspecting, a sealed observation. The distinction matters because
§11.5 forbids retuning against held-out data and these amendments must not be
mistaken for it.

**Superseded in part.** P21's framing — safety dominance with yield as the
criterion under test — was replaced by P24–P27 below before v0.7 was ever
registered. P21's two structural rulings survive intact: ablations are §11.3
evidence rather than §11.2 comparators, and a superiority claim must name and
test its dimension. What did not survive is the assumption that yield is the
quantity a release gate should be organised around.

## Amendment Record (v0.7 → v0.8)

**Version 0.7 was never registered and never run.** It was superseded before
any evaluation used it, so no result depends on it and no era was consumed by
it. This record documents a restatement of the study's purpose by its owner and
the gate that follows from it.

Versions 0.4 through 0.7 all treated yield as the quantity under test and
safety as a constraint upon it — v0.7 weakened the yield claim to
non-inferiority but kept that shape. The study's purpose is the opposite.
**The proposition is that the highest available yield is frequently not
redeemable**, and that a lending allocator must be judged on whether the return
it reports survives contact with withdrawal demand, with the vault's own size,
and with a venue's real cash. Reaching for the highest displayed rate is not a
neutral choice that a safety layer then bounds; it is the specific behaviour
that produces unredeemable positions. Appendix E measures that directly.

The five amendments below reconfigure the release gate accordingly. They do not
change the controller: §7 through §10 are untouched. They change what a result
must demonstrate.

| ID | Amendment | Section | Evidence |
|---|---|---|---|
| P24 | **Sustainability is the primary release criterion and it is absolute.** Redeemability, capacity discipline, operational continuity, and invariance across vault size are scored per policy per tier, and SRCLA must satisfy every one on every registered run | §11.5 | Over the two v0.6 held-out eras SRCLA held stressed coverage of **1.000 at all four tiers on both eras**, while B1 breached at all four tiers on one era, B2 and B2u at three, and B4 at the largest. Every policy that outearned SRCLA breached somewhere |
| P25 | **Sustainability must be demonstrated while deployed.** A registered time-weighted capital-at-work floor precedes every other sustainability check; below it the run reports `NOT DEMONSTRATED` and no sustainability claim may be drawn from it | §11.4, §11.5 | SRCLA scored 1.000 coverage at the 10M tier on `heldout-c` while realizing 0.000% — it was redeemable because it held cash. Without this criterion B0, which holds everything idle, is the most sustainable policy in the study |
| P26 | **Scale invariance is a criterion, not an average.** A policy is sustainable only if it satisfies P24 at *every* registered tier; a per-tier pass does not aggregate | §11.1, §11.5 | B4 realized 24.95% with 1.000 coverage at 1M on `heldout-b` and **0.590** at 10M; on `heldout-c` its coverage at 10M was **0.000** and B1's **0.108**. Capacity failure is invisible to any metric averaged over tiers |
| P27 | **An unsustainable policy is a counterexample, not a comparator.** Its yield is published as the measured price of unsustainability, per tier, with the criterion it broke | §11.2, §11.5 | B1 earned 39.16% at 10k on `heldout-b` holding 0.878 coverage against a 0.99 floor. Under v0.6 that figure was recorded as SRCLA's failure to compete; it is in fact the paper's central exhibit |
| P28 | **Three sustainability metrics are registered**: time-to-full-exit, the vault's own contribution to venue utilization, and the displayed-versus-realized yield gap | §11.4 | Stressed coverage is a stock measure at one origin. None of the three failure modes the paper argues against — a slow exit, a vault that creates the congestion it then suffers, and an advertised rate that never materializes — is observable from it |

**What P24–P28 do not do.** They do not lower a threshold, remove a check, or
excuse a failure. The safety floors are unchanged and the yield criterion of
v0.7 survives intact as a secondary test among sustainable policies. What
changes is which quantity carries the claim, and P25 makes the new primary
criterion strictly harder to satisfy than the old safety check was: v0.6's
SRCLA would have reported `NOT DEMONSTRATED` at the tier where it scored a
perfect coverage number.

## Amendment Record (v0.8 → v0.9)

**Version 0.8 was registered and run, and it returned `FAIL` on both sealed
eras.** That run is the reason this record exists, and its status must be
stated before any amendment below is read: `heldout-c` has now informed the
design of the controller it was meant to test. By §2.2's own standard it is
design data. **Every result reported against `heldout-c` after this version is
a confirmatory re-run, not a fresh test**, and §13 says so without
qualification.

The v0.8 run is nevertheless the most informative evaluation this project has
produced, because it isolated a defect that four prior versions had priced as
conservatism. SRCLA left **61% of NAV idle at the 10M tier** and realized
1.401%, while the ablation that removes one term and nothing else — H2,
"remove calibrated lower bounds" — deployed 86% at the same tier, held
stressed coverage at **1.000**, exited in **0 origins**, and realized 2.75%.
Every other ablation moved capital at work by less than 0.01. The attribution
is not inferred from a narrative; it is read off a single column.

| ID | Change | Sections | Evidence |
|---|---|---|---|
| P29 | **The residual quantile is applied multiplicatively, not additively.** $\ell = \widehat\mu\,(1+q^{\mathrm{rel}}_\alpha)$ replaces $\ell = \widehat\mu + q_\alpha$, with $q^{\mathrm{rel}}$ calibrated on the same residuals divided by the forecast each was measured against | §7.1, §7.2 | §7.1's own text already conceded that the additive bound "subtracts a near-constant from a linearly growing quantity". It is worse than that: §6's capacity curves evaluate $\widehat\mu$ **at the candidate allocation**, so at scale it is a rate the vault's own deposit has compressed, and a constant haircut consumes a growing share of a shrinking edge. Aave's registered quantile is −1.159% APY, so any venue the vault compresses below 1.159% receives a **negative** lower bound and can never clear a deployment hurdle again. Measured on the calibration era, the 5% lower quantile of **absolute** forecast error varies 2.9×–5.9× across utilization bands while the **relative** error varies 1.8×–2.9× and tracks the level forecast |
| P30 | **§11.5's forecast gate must render a verdict on the registered artifact.** A method the gate cannot score reports `NOT PRODUCED`, which blocks — but blocking is not evidence, and a forecast that is never judged cannot be defended or refuted | §11.5 | On the v0.8 run **nine of the forecast gate's ten measured checks** — per-venue coverage, Kupiec, and Christoffersen, across three venues — reported `NOT PRODUCED` on **both** sealed eras, because P19's state-space candidate does not pass through the shared point-forecast path. §11.5's first gate had never once tested the artifact it gates |
| P31 | **Four release thresholds are revised, and the release grade is separated from the controller's own eligibility filter** | §11.4, §11.5 | The demonstration floor (0.80) left 15 pp above the 5% admin idle floor for any reserve at all; the S2 coverage floor (0.99) graded a **synthetic** withdrawal schedule to two decimals; regime purity required **exactly zero** straddling label windows against exogenous governance action, which is unsatisfiable in principle rather than strict; and "no inert ablation" blocked a release on the *experiment's* informativeness rather than the vault's safety. Separately, S2's floor was the **same constant** the optimiser filters candidate allocations with, so relaxing the release bar would have silently relaxed the controller's own safety filter |
| P32 | **A threshold revised after a sealed era is opened is disclosed as post-hoc, and its justification may not reference the result it produces** | §11.5, §13 | P31's four revisions were made knowing which checks blocked. P29's re-specification was not: it was derived from calibration-era measurements alone and is **stricter** than the form it replaces above 6.90% APY. The two are not equivalent evidence and the report must not present them as such. The non-inferiority margin was left at 43 bps precisely because raising it could only have been justified by the result it would produce |
| P33 | **A forecast horizon that §11.5 cannot test is not admissible.** A candidate whose calibration cannot be falsified on the registered sealed eras is dropped from the grid, however well it scores on §7.3's loss | §7.2, §7.3, §11.5 | §7.3's loss rewards a LONG horizon — signal-to-noise rises roughly in proportion to $H$ (§7.1) — and selected $H$ = 14d. §11.5's gate requires a SHORT one: Christoffersen tests independence on NON-OVERLAPPING windows, and thinning an 86-day era to 14-day windows leaves **9** observations against a 30 minimum, so the test reported `NOT PRODUCED` for every venue on both eras. Regime purity degrades identically — a 14× longer label window straddles ~14× more governance changes, measured at **33.4%** against **5.18%** at $H$ = 1d. Nothing in v0.8 reconciled the two sections; P33 resolves it in favour of testability |
| P34 | **A venue in a failed state is outside the forecast's domain, and §11.4's redeemability evidence must distinguish an allocator's error from a venue's failure** | §6.1, §11.4, §12 | On 2026-08-27 Moonwell USDC went from $2,105,538 of withdrawable cash at 09:00 to **$1 at 11:00** — $2.3M borrowed in a single hour — and then advertised 87–90% APY for fourteen days with zero cash behind it. The preceding 24 hours show utilization oscillating in an 83.9–85.0% band: there is no deterioration to detect at hourly resolution. §6's admission rules correctly refuse ENTRY to such a venue (`cash = 0` fails `NO_SYNC_LIQUIDITY` on both branches), but no rule forces an EXIT, and at the larger tiers no exit was possible — a multi-million-dollar position against $269,578 of remaining cash cannot be unwound at any price. The resulting Kupiec rejection on that venue measures the exploit, not the forecast |
| P35 | **Where an ablation of a liquidity-aware mechanism improves BOTH yield and redeemability, the mechanism is reported as unvindicated on that era** | §8.2, §11.3 | At the ten-million tier a reserve-matched baseline deployed **80.8%** of the vault, held stressed coverage of **1.000**, and earned **2.59%**, against SRCLA's 42.7%, 0.942 and 1.56%. More capital at work, better redeemability, and 66% more yield — without the capacity curves, the exitable-fraction weighting, or the movement-cost hurdle. §11.3 previously reported an ablation's yield delta; it must also report when removing a *safety* mechanism makes a policy *safer*, because that is evidence the mechanism is mis-specified rather than merely expensive |


**What P29 is not.** It is not a relaxation. The multiplicative bound is
*lower* than the additive one wherever the forecast sits above the venue's
mean — at Aave's 90–100% utilization band, where the mean forecast is 7.02%,
the relative haircut is larger — and looser only below the crossover, which is
precisely the regime the vault's own market impact creates. The registered
crossovers are 6.90% APY (Aave), 6.51% (Compound), and 4.54% (Moonwell). It
also makes §7.2's two registered targets consistent for the first time: the
second target, the withdrawable-cash bound, has always been relative and is
applied by exactly this arithmetic.

**What P31 is.** A threshold this project registered is not a standard drawn
from a literature — no prior work specifies release criteria for a sustainable
pooled lending vault, which is the gap §3 exists to describe. That makes these
values revisable. It also makes pre-registration the *only* thing that gave
them meaning, so revising them costs evidential weight, and P32 exists to make
that cost visible rather than to absorb it.

## 1. Introduction

An automated lending vault has a simple-looking objective: place USDC where it earns the best return. In practice, that statement hides five decisions:

1. Which markets are safe and correctly configured at the decision block?
2. What return remains after the vault's own deposit changes utilization?
3. How much native USDC must remain synchronously available for users?
4. Does a proposed portfolio satisfy market, dependency, loss, and stress constraints?
5. Is changing the current portfolio worth its complete execution cost?

A highest-APY rule answers none of these questions completely. A small market close to its utilization kink may advertise a high rate that falls after a large deposit. A vault can report positive net asset value (NAV) while a protocol lacks enough cash for immediate withdrawal. A real rate advantage can still lose money after Base execution fees, Base layer-one data fees, entry and exit friction, reward conversion, price impact, and rapid reversal.

This report specifies SRCLA for one pooled, unleveraged, Base-native USDC ERC-4626 vault. Release one admits only direct supply positions in Aave V3 Base USDC, Compound III Base USDC Comet, and Moonwell Base mUSDC. It excludes Morpho, leverage, borrowing, collateral entry, derivatives, bridges, arbitrary strategies, and asynchronous ERC-7540 withdrawals [36]. Users deposit and withdraw through standard ERC-4626 calls and pay their own Base gas.

The contribution is not a claim that its individual techniques are new. Capacity-aware allocation appears in Idle Best Yield [1], robust portfolio construction and switching-cost control are established research subjects [3]–[6], and Yearn, Morpho, and Euler publish important vault enforcement mechanisms [9]–[11], [20]–[22]. The contribution is a complete and inspectable controller that joins these ideas across an explicit trust boundary and states how the resulting policy can be reproduced or rejected.

The principal contributions are:

- an immutable ERC-4626 enforcement layer that a compromised or incorrect allocator cannot bypass;
- protocol-exact post-deposit rate and liquidity simulation for the three initial Base markets;
- a deterministic, walk-forward-calibrated lower prediction bound rather than an opaque external artificial-intelligence service;
- dynamic reserve, shared-dependency, full-cost, staged-execution, and event-driven reward rules; and
- a registered evaluation in which **sustainability, not yield, is the primary criterion** — redeemability under stress, capacity discipline, and invariance across vault size, each demonstrated with capital actually at work — and whose failure remains part of the research record, as two such results already have.

## 2. Scope, Claims, and Release Boundary

### 2.1 Locked release-one scope

The sole user-facing and accounting asset is Circle native Base USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` [46]. Bridged USDbC and test assets are forbidden. The chain is Base, chain ID 8453. Protocol receipt tokens and incentive tokens remain within vault-bound strategy or reward contracts.

Users interact with one ERC-4626 vault and receive fungible vault shares. Entry uses USDC approval followed by `deposit` or `mint`. Exit uses synchronous `withdraw` or `redeem`. Farming has no backend relayer, EIP-3009 deposit flow, sponsored gas, or relayed redemption. ERC-20 Permit on vault shares may remain available for composability, but the system does not relay it.

Release one includes exactly:

- Aave V3 Base USDC;
- Compound III Base USDC Comet; 
- Moonwell Base mUSDC.

The allocation and dependency model is generic so a later protocol can be added through a new immutable adapter and a new registered evaluation. No future protocol is silently included in release-one evidence.

### 2.2 Research claim and falsification

The paper makes a design-completeness claim: the disclosed policy combines capacity-aware rates, uncertainty treatment, dependency limits, withdrawal feasibility, and complete movement costs in one reproducible pipeline. It makes no claim to superior yield, and the superiority it does claim is confined to named dimensions that §11.5 tests individually.

Version 0.7 states the performance claim it *does* intend to test, because
v0.6 tested one the registered universe cannot settle. Three admitted USDC
lending venues on one chain, with pairwise rate correlations of 0.33 to 0.54,
offer a mean best-worst spread of 3.29 percentage points whose leadership
changes every two hours at the median. Appendix D measures the consequence:
across the entire v0.7 parameter space the best attainable calibration-era net
return is 5.120%, deploying once into a fixed equal weighting returns 4.941%,
and removing movement cost altogether raises the ceiling only to 5.374%. All
reallocation skill in this universe is therefore worth 18 to 43 basis points a
year. Over the same era, failing to deploy at all costs 494.

The claim under test is accordingly:

> **Sustainability claim.** With capital actually deployed, SRCLA remains
> redeemable under registered withdrawal stress at every vault size and in
> every evaluated period, and the simpler policies that outearn it do not.
>
> **Yield claim, secondary and conditional.** Among policies that are
> themselves sustainable at a given size, SRCLA's after-cost return is
> non-inferior at a registered margin, at materially lower turnover.

The order is the substance. Yield is scored only among policies that have
first shown they can honour a redemption, because a return that cannot be
withdrawn is not a return — it is an accounting entry that will be revised
downward the first time a user tries to leave. §5.2 already draws that
distinction for the vault's own accounting; §11.5 now draws it for the
evaluation.

This is not a retreat to an easier test. Under v0.6's gate a policy could pass
by earning well and breaching redeemability at one tier, provided the average
looked acceptable; under P25 and P26 it cannot, and neither can a policy that
achieves perfect redeemability by holding cash. Version 0.6's own SRCLA would
have failed the new primary criterion at the tier where it recorded a perfect
coverage score, because it recorded that score while realizing 0.000%.

The research proposition is rejected for release if any of the following occurs:

- SRCLA fails any sustainability criterion of §11.5 at any registered tier — redeemability, capacity discipline, continuity, or scale invariance;
- SRCLA satisfies those criteria only below the registered capital-at-work floor, in which case nothing has been demonstrated and the run reports `NOT DEMONSTRATED`;
- deterministic forecasts fail their registered calibration requirements;
- SRCLA is inferior, at the registered non-inferiority margin, to any baseline that is itself sustainable at that tier, after equal costs, information, and delays;
- a claimed per-dimension superiority is not statistically supported;
- a required tier, regime, baseline, ablation, or fork result is missing;
- the evaluation cannot reproduce its manifest and result hashes; or
- the result depends on tuning against held-out observations.

Note what is *not* on that list. A baseline earning more than SRCLA is not a
rejection when that baseline breached redeemability; §11.5 excludes it from
comparison and §11.2 publishes its return as the price of the breach.

A criterion no registered policy could satisfy in the registered universe is
not evidence about SRCLA, and a criterion every policy satisfies is not either.
§11.5 measures the *skill window* — the gap between bounded hindsight and the
best admissible baseline on the same era — before scoring yield. A superiority
claim inside that window reports `NOT INFORMATIVE`, which neither passes nor
fails; a non-inferiority pass inside it is published together with the window,
because on a narrow universe such a pass is weak evidence of allocation quality
and the report must say so rather than let a reader infer more.

### 2.3 Research core and production-hardening path

The research release permits one external admin/guardian wallet, one allocator key in the SRCLA service environment, one archive-capable Base RPC, and locally forked Anvil tests. These choices simplify reproducibility; they are not production security claims.

Material-fund deployment additionally requires independent audits, an admin multisignature and timelock, a separately empowered guardian, hardware-backed allocator signing and rotation, redundant independent RPC providers, conservative canary caps, continuous monitoring, incident runbooks, configuration review, and a public bug bounty. These controls belong to a clearly separated production-hardening path.

## 3. Related Work and the Design Gap

### 3.1 Existing contributions

**Idle Best Yield** is the closest disclosed direct-allocation precedent. It evaluates an integration's rate after the proposed allocation rather than ranking only current displayed rates [1], [18], [19]. Public material does not disclose a complete live uncertainty model, stressed reserve, shared-dependency policy, full movement threshold, cooldown, or keeper configuration.

**Yearn V3** supplies mature ERC-4626 machinery including strategy debt, minimum idle assets, loss handling, role separation, withdrawals, and shutdown [9]. It deliberately leaves target allocation to a debt manager or external allocator. **Morpho Blue**, MetaMorpho, and the Public Allocator expose isolated market mechanics, explicit market state, caps, queues, timelocks, and bounded reallocations [10], [20], [21], [40], [41]. **Euler Earn** similarly exposes curator, allocator, reserve, cap, queue, and loss controls [11], [22]. These systems provide important enforcement precedents but not one canonical portfolio objective.

**Yield Seeker**, **ZyfAI**, and **Mamo** discuss adjusted APY, transaction cost, liquidity, incentives, break-even economics, and meaningful rate differences [12]–[14], [23]–[31]. **Giza** makes operational lifecycle states explicit [15], [32]. **Surf Liquid** separates predictive planning from deterministic enforcement [16]. **Almanak** provides simulation and operational tooling for strategy-defined policies [17], [33], [34]. Their disclosures motivate SRCLA but do not expose one reconstructable production rule with all thresholds and live parameters.

Research on distributionally robust optimization, multiperiod allocation, switching costs, and non-stationarity supports the use of conservative objectives and no-trade regions [3]–[6]. Leveraged multi-market allocation [2] is outside the unleveraged release scope, while AgileRate and reinforcement-learning work optimize protocol rate setting rather than depositor allocation [7], [8]. Time-series cross-validation and prediction-bound literature supports rolling-origin evaluation and explicit distinction between estimating a conditional mean and bounding a future outcome [53], [54].

The transaction-cost literature constrains the *form* of a movement rule more
tightly than v0.6 recognized, and three results are load-bearing for §9.1.
Constantinides shows that with proportional costs the optimal policy is a
no-trade region whose width varies approximately as the cube root of the cost,
and — the part v0.6 omitted — that a portfolio outside the region is moved *to
its nearest boundary*, not to the unconstrained optimum [58]. Gârleanu and
Pedersen derive the corresponding dynamic policy in closed form: aim ahead of
the moving target and trade *partially* toward that aim each period, weighting
predictors by the persistence of their signal [57]. The multi-asset case
retains both properties: with several risky positions the no-trade region
becomes a body in weight space, and the optimal action remains a move to its
boundary rather than to the frictionless optimum [62]. Empirical work on
threshold rebalancing reaches the same structural conclusion — rebalancing to
the boundary of a varying-volatility no-trade band dominates both calendar
rules and full reversion to target [59]. Two consequences follow that v0.6
violated. A band whose width does not fall with cost is not a transaction-cost
band; as cost approaches zero the no-trade region must vanish. And a rule that
either executes an entire target vector or discards it is the one structure all
three results exclude.

A parallel literature explains why a forecast selected for accuracy can be the
wrong forecast for the decision it feeds. Decision-focused learning and the
smart predict-then-optimize framework train or select predictors against
downstream decision quality rather than predictive loss, and recent work on
portfolio applications identifies precisely the pathologies of ignoring that
coupling: ranking instability and turnover unrelated to the underlying
signal [60], [61]. §7.3 already named turnover and sacrificed return among its
selection terms; P18 makes them operative, which is what would have rejected
the horizon v0.6 registered.

### 3.2 Gap statement

The review does not prove that a private deployed controller lacks a capability. It shows that an external reader cannot reconstruct one disclosed, direct, unleveraged Base-USDC controller simultaneously specifying:

| Required property | Failure prevented |
|---|---|
| Post-deposit rate model | A large allocation erasing its displayed yield |
| Deterministic lower prediction bound | A transient or unstable rate dominating the target |
| Market and shared-dependency caps | Nominal diversification preserving common-mode exposure |
| Dynamic reserve and withdrawal stress | Positive NAV but unsuccessful synchronous exits |
| Complete cost and turnover gate | Churn destroying gross yield improvements |
| Sustainability as the release criterion | A reported return that no user could have withdrawn, at the size the vault actually held |
| Bounded on-chain execution | A forecast or key bypassing the safety policy |
| Registered evaluation | Post-hoc tuning or irreproducible superiority claims |

SRCLA is useful only if, with capital actually deployed, it stays redeemable at every vault size while the simpler policies that outearn it do not, and only if its after-cost return is then no worse than the best baseline that also stayed redeemable. Section 11 specifies the rejecting tests, and §11.5 additionally specifies when a test is incapable of rejecting anything.

## 4. System Architecture and Authority Boundary

The architecture separates immutable custody and accounting from replaceable decision software:

```text
User wallet
  │ approve/deposit/mint/withdraw/redeem; user pays Base gas
  ▼
Immutable NavyVault: ERC-4626 over Circle native USDC
  ├── AaveV3Strategy ───── holds aUSDC and claimed incentives
  ├── CompoundV3Strategy ─ holds positive Comet balance and claimed COMP
  └── MoonwellStrategy ─── holds mUSDC and claimed Moonwell rewards
          │
          └── immutable RewardExecutor ── approved Uniswap V3 routes ──► USDC to NavyVault

Standalone /srcla TypeScript service
  ├── finalized snapshot collector and owned PostgreSQL database
  ├── admission, simulation, forecast, reserve, and optimizer modules
  ├── cost/emergency decision engine
  ├── staged transaction executor and reconciler
  └── read-only strategy-history API

Existing /be service
  ├── reads user vault state directly from Base
  └── reads strategy history through /srcla HTTP
```

The immutable vault owns user assets. Adapters hold only vault-owned protocol positions and approved incentive tokens. The reward executor sends USDC only to the vault. The allocator wallet owns none of these assets.

The vault exposes two logical authorities:

| Authority | Permitted | Forbidden |
|---|---|---|
| Admin/guardian | Adapter and route admission, caps, dependency groups, reserve floor, loss limits, impairment, pause, allocator rotation | Arbitrary user-fund transfer or ERC-4626 ownership bypass |
| Allocator | Register and execute bounded staged plans, divest, deploy, harvest, and perform adapter-to-vault emergency exits | Add adapters, lower limits, choose arbitrary calldata or recipients, or transfer assets to itself |

For the research release, one external wallet performs both admin and guardian functions. Its private key is referenced only by uncommitted Foundry deployment/administration environment configuration. The SRCLA runtime stores only the allocator private key. The existing backend stores neither key.

The vault and reward executor are immutable and non-proxy. Protocol adapters are replaced by deploying a new immutable instance and admitting it. The off-chain policy is upgradeable software, but every active code commit, policy version, configuration regime, and decision hash is persisted.

## 5. ERC-4626 Accounting and Synchronous Liquidity

### 5.1 Pooled NAV and cohort fairness

Let:

| Symbol | Meaning |
|---|---|
| $I_t$ | Idle native USDC in the vault |
| $P_{i,t}$ | Recognized USDC value of strategy $i$ |
| $R_t$ | Conservatively recognized eligible incentive value |
| $L_t$ | Recognized losses and liabilities |
| $A_t$ | Total vault assets |
| $S_t$ | ERC-4626 shares outstanding |

The vault accounting identity is:

$$
A_t=I_t+\sum_{i=1}^{n}P_{i,t}+R_t-L_t.
$$

Base lending interest is already included in $P_{i,t}$ through indexed balances or exchange rates. Incentives enter $R_t$ only under the eligibility and valuation rules in Section 9.

The share price before a new deposit is:

$$
p_t=\frac{A_t}{S_t}.
$$

A deposit of $d$ assets therefore receives, subject to ERC-4626 rounding:

$$
\text{sharesMinted}=\frac{d}{p_t}.
$$

If $A_t=105{,}000$ USDC and $S_t=100{,}000$ shares, a 10,500-USDC deposit receives 10,000 shares. It does not receive the 5,000 USDC earned before entry. Evaluation must reproduce this temporal fairness for every deposit cohort rather than assigning portfolio yield uniformly to users who entered at different times.

For user $u$, cohort profit at time $t$ is:

$$
\operatorname{profit}_u(t)=
\operatorname{redeemValue}(\operatorname{shares}_{u,t})
+\operatorname{priorWithdrawals}_{u,t}
-\operatorname{totalDeposits}_{u,t}.
$$

ERC-4626 conversion follows explicit rounding rules and a virtual-share offset to resist donation-based inflation. These accounting protections are tested independently from allocator performance.

An adapter cannot disappear from NAV merely because it is disabled. Its lifecycle is `Active`, `Disabled`, `Impaired`, then `Removed`; removal is allowed only when accounted and live position values are zero. An unrecoverable amount becomes an explicit recognized loss or conservative value cap.

### 5.2 Accounting value is not withdrawal capacity

`totalAssets`, conversion methods, and previews value the pooled claim. They do not prove that a lending protocol has enough native USDC for a same-transaction exit [35]. The vault therefore maintains:

$$
Q_t^{\mathrm{sync}}=I_t+\sum_i e_{i,t}^{\mathrm{sync}},
$$

where $e_{i,t}^{\mathrm{sync}}$ is the strategy's conservative immediately executable exit, limited by both the vault position and protocol-wide cash. `maxWithdraw` and `maxRedeem` are capped by $Q_t^{\mathrm{sync}}$ and the user's share claim. Unclaimed rewards and any asset requiring an asynchronous action are excluded.

The vault divests strategies in a deterministic order during a withdrawal. Each adapter sends native USDC directly to the vault, applies a maximum loss bound, and verifies balance deltas. Because protocol cash is shared and raceable, a failed live exit reverts rather than borrowing, returning another asset, or exceeding the loss limit.

If a required adapter or material reward read fails, the vault must not silently value it as zero before share issuance. Deposits and mints close until a safe value is available. Withdrawals remain available only up to conservative synchronous capacity.

## 6. Markets, Adapters, and Admission

### 6.1 Generic adapter boundary

Each immutable adapter is bound to one vault and Circle native Base USDC. It may deposit into and withdraw from one admitted protocol market, report conservative position value and synchronous exit capacity, expose configuration identity, enumerate eligible incentives, claim approved rewards into itself, and approve the shared reward executor for an exact harvest amount.

Adapters cannot borrow, enter collateral positions, call arbitrary targets, choose arbitrary recipients or spenders, bridge assets, or contain forecasting and allocation logic.

Each adapter has:

- a maximum percentage of current vault NAV;
- a maximum absolute USDC exposure;
- membership in zero or more generic dependency groups;
- a maximum withdrawal-loss limit; and
- live external protocol headroom.

Its effective exposure limit is the minimum of these applicable bounds together with a
structural liquidity cap $c_i^{\mathrm{liquidity}}$, a deterministic function of the
venue's free cash and utilisation that decreases toward zero as the venue approaches
its kink. The liquidity cap requires no forecast and binds independently of one. Dependency groups are opaque administrator-configured identifiers rather than hard-coded protocol categories. They may represent common governance, oracle, liquidation venue, reward router, or controller risk. Base and native USDC are accepted common-mode dependencies for this single-chain study and therefore receive 100% limits rather than being presented as diversification.

### 6.2 Admission and configuration regimes

At a decision block, an adapter is deployable only when all registered identity, implementation, configuration, pause, incident, cap, kink, oracle, dependency, and synchronous-liquidity checks pass. Indexed APIs and dashboard APYs may assist monitoring but never authorize a transaction.

A material proxy implementation, rate model, reward controller, code hash, or configuration change creates a new regime. The market becomes ineligible until sufficient finalized post-change observations and completed outcomes satisfy the registered minimum-history gate. Data from a previous configuration regime cannot silently train the new regime.

### 6.3 Aave V3 strategy

The Aave adapter supplies native USDC to the canonical Base Pool and holds aUSDC. Position value follows Aave indexed balances. Synchronous exit is no greater than the adapter's underlying-equivalent aUSDC and USDC cash available to the aToken withdrawal path, subject to active and pause validation.

Post-deposit simulation mirrors the live registered interest-rate strategy after accrual, including virtual balance or available liquidity, debt, deficit, reserve factor, liquidity added, live rate parameters, and exact ray and percentage rounding [37], [42]. Admission pins the Pool proxy and implementation, addresses provider, reserve tokens, debt token, rate strategy, incentives controller and transfer strategy, caps, pause/freeze state, and code/configuration hashes [52].

### 6.4 Compound III strategy

The Compound adapter supplies native USDC as a positive base balance in the canonical Base USDC Comet. It never supplies collateral and never permits a withdrawal to cross from a positive supply balance into negative principal [44]. Synchronous exit is capped by the positive Comet balance and Comet USDC cash and requires withdrawals to be unpaused.

Simulation accrues supply and borrow indices, applies principal-to-present-value rounding, computes candidate utilization, and applies the live governance-configured kinked supply curve [38], [43]. Admission pins the Comet proxy and implementation, Configurator, governor, pause guardian, extension delegate, rate and tracking parameters, rewards configuration, pause flags, and code/configuration hashes [50]. Collateral supply caps are not incorrectly treated as base-USDC supply caps.

### 6.5 Moonwell strategy

The Moonwell adapter supplies native USDC to canonical Base mUSDC and holds the eight-decimal mToken. It does not enter the market as collateral and never borrows. Synchronous exit is capped by its underlying-equivalent mUSDC and `getCash`. Every nonzero Moonwell numeric return code is treated as failure even if the EVM call itself does not revert.

Simulation first accrues cash, borrows, reserves, and borrow index; applies the registered jump-rate model with candidate cash; and reproduces exchange-rate, mint, and redeem truncation [39], [45]. Admission pins the mUSDC delegator and implementation, Unitroller and Comptroller, interest model, reward distributor, market listing, mint pause, strict supply-cap headroom, reserve factor, and code/configuration hashes [51].

## 7. Deterministic Return Forecasting

### 7.1 Target quantity

SRCLA does not call an external AI provider. Its forecasting layer is deliberately deterministic and auditable. At origin $t$, for market $i$, candidate allocation $x$, and horizon $H$, the target is the next realized unannualized net holding-period return:

$$
R_{i,t\rightarrow t+H}(x)
=R^{\mathrm{base}}_{i,t\rightarrow t+H}(x)
+R^{\mathrm{reward}}_{i,t\rightarrow t+H}(x)
-\frac{C^{\mathrm{claim/swap}}_{i,t\rightarrow t+H}(x)}{x}.
$$

The protocol-exact origin curve supplies the capacity effect of $x$; historical observations supply evidence about how the base-rate and eligible-reward paths evolve after origin. The system stores both raw horizon return and a declared annualized display value, but it never treats an annualized amount as earnings realized during a shorter horizon.

The planning input is a lower prediction bound for the next outcome, not a confidence interval around an estimated mean. If $\widehat\mu_{i,t,H}(x)$ is a deterministic point forecast and $q_{\alpha,i,t}$ is a calibrated lower quantile of completed horizon residuals, then:

$$
\ell_{i,t,H}(x)=\widehat\mu_{i,t,H}(x)\,\bigl(1+q^{\mathrm{rel}}_{\alpha,i,t}\bigr),
\qquad -1\le q^{\mathrm{rel}}_{\alpha,i,t}\le 0.
$$

**The haircut is proportional to the quantity it is uncertain about (P29).**
Versions 0.4 through 0.8 subtracted a per-venue constant,
$\ell=\widehat\mu+q_\alpha$. That form is unsound here for a reason specific
to this system: $\widehat\mu_{i,t,H}(x)$ is evaluated **at the candidate
allocation** $x$, so §6's capacity curves have already compressed it by the
vault's own market impact. A constant subtracted from a compressed rate
consumes a growing share of a shrinking edge, and past a certain vault size it
exceeds the edge outright — at which point the bound is negative, the venue can
never clear a movement hurdle, and the capital stays idle no matter how
attractive the venue is. The registered Aave quantile is −1.159% APY, so every
Aave allocation large enough to pull the post-deposit rate below 1.159%
received a negative bound.

The multiplicative form is what the calibration data supports, not merely what
avoids the pathology. Splitting the same residuals by the utilization they were
earned at, the 5% lower quantile of the **absolute** error varies by 2.9× to
5.9× across bands, while the **relative** error varies by 1.8× to 2.9× and
tracks the level being forecast; Appendix F tabulates both. The error is
proportional to what is being predicted, so the bound is too.

It is not a weakening. Where $\widehat\mu$ exceeds the venue's mean the
relative haircut is *larger* than the constant it replaces — the registered
crossovers are 6.90% APY (Aave), 6.51% (Compound), 4.54% (Moonwell) — so the
bound tightens in exactly the high-rate, high-utilization states where the
measured error is worst, and loosens only where the vault's own size created
the compression. $q^{\mathrm{rel}}$ is clamped at $-1$: the bound floors at
zero and never inverts. It also aligns §7.2's two registered targets, since the
withdrawable-cash bound has always been relative and applies this same
arithmetic.

The quantile is indexed by market because venues differ in rate smoothness: a single
pooled quantile that covers a volatile series over-covers a smooth one and vice versa.
The quantile is *solved* so that realised calibration-era coverage attains the
registered target, rather than fixed at a nominal value with coverage reported after. This empirical residual form avoids assuming that a normal standard-deviation multiplier correctly represents non-stationary lending returns. Every quantile rule, tie, minimum sample, and missing-data behavior is fixed before held-out evaluation.

**The horizon is an economic scale, not a forecasting hyperparameter.** The
target is a horizon return, so its expectation grows linearly in $H$. Its
residual dispersion does not. Because the realized label is the venue's *mean*
rate over the window, lengthening $H$ averages away exactly the variation the
forecast is trying to bound, and the measured dispersion is close to flat:
over the calibration era $\hat\sigma_H$ grows by a factor of 1.19 from one day
to fourteen, where independent increments would predict 3.74. The
signal-to-noise ratio of the quantity every downstream rule consumes therefore
rises roughly in proportion to $H$ — measured at 1.5–2.6 at one day and
15.8–24.6 at fourteen.

Two rules follow, and v0.6 observed neither. The **additive** bound
$\ell=\hat\mu+q_\alpha$ subtracted a near-constant from a linearly growing
quantity, so at a short horizon it removed most of the return: at $H$ = 1 day
the v0.6 artifact's bound removed 3.87 percentage points of annualized return
from every venue, against realized venue means of 4.86% to 6.13%. P29's
multiplicative form removes the horizon interaction at its root, because a
fraction of a linearly growing quantity grows with it; what remains is the
second rule, which P29 does not address. Any threshold expressed in
horizon-return units still inherits $H$'s scaling, so an economic hurdle stated
that way is silently a function of a forecasting choice. §7.3 therefore selects
$H$ against the decision it feeds (P18), and §9.1 states its hurdle in
annualized units that do not depend on $H$ at all (P15).

### 7.2 Registered candidate methods

Calibration compares exactly four established deterministic candidates:

1. a rolling distribution of historical realized horizon returns;
2. an exponentially weighted level forecast with a lower quantile of walk-forward horizon residuals;
3. a fixed-specification direct-horizon autoregressive model with exogenous features (ARX); and
4. a **state-space candidate** that forecasts the venue's utilization and maps the forecast through that venue's exact on-chain interest-rate model.

Candidate 4 (P19) exists because the first three forecast the wrong variable.
A lending venue's supply rate is not a free-running time series: it is a
deterministic, kinked, governance-parameterized function of utilization, and
the same machinery §6.3–§6.5 already uses to price the vault's own deposit
evaluates it. Every parameter that function needs — base rate, kink,
low and high slopes, reserve factor, and the interest-rate-model address that
identifies the regime they belong to — is recorded at each origin. Forecasting
the smooth bounded state and applying the protocol's own map is therefore
strictly more auditable than forecasting the discontinuous output, and it is
substantially easier: one-day persistence explains 75.8%, 91.8% and 91.5% of
utilization variance across the three venues, against −20.6%, 43.0% and 4.2%
for the rates those utilizations produce. A rate forecast must learn the kink
and every governance reparameterization from data; a state forecast reads them.

The candidate is registered, not mandated. It enters the same grid as the
other three, is fit on the same era, is scored by the same loss, and wins only
if it wins. Its dynamics must be specified before evaluation: the registered
form is a mean-reverting level model on utilization with the venue's
observed cash and borrows as the state, refusing to extrapolate outside the
utilization range observed within the current configuration regime. Where a
regime change alters the rate model, the state history survives and only the
map changes — which is the second reason to prefer it, since a rate history
does not survive a reparameterization at all.

The registered grid also compares horizons of 1, 7, and 14 days and lower-bound coverage targets of 90%, 95%, and 99%. The selected method, horizon, coverage, features, window or decay, residual treatment, minimum observations, and lexical tie-break are frozen from the calibration era before held-out evaluation.

The registered grid is the full cross product of the three methods, the three
horizons, the three coverage targets, and each method's parameter set, evaluated per
venue. A second registered target is calibrated with the same machinery: a lower
prediction bound on the venue's withdrawable cash over the horizon, which supplies
$e_i^{\mathrm{cons}}$ in §8.1 and the exitable fraction in §8.2.

### 7.3 No-look-ahead and calibration gate

Only an outcome whose horizon has fully ended and whose availability lag has passed may train a forecast at origin $t$. Random train/test splitting, full-history normalization, post-held-out retuning, and contamination across configuration regimes are forbidden. Overlapping horizons may be used for prediction, but formal coverage evaluation also reports a non-overlapping or dependence-aware stream [55].

Candidate selection uses a published loss function covering point error, lower-bound coverage, exceedance shortfall, sharpness, downside outcomes, turnover, and sacrificed return. Coverage is reported per market and again for the portfolio produced after optimizer selection, because selecting among noisy forecasts can amplify optimistic errors. Calibration coverage and independence diagnostics are release gates, not descriptive charts. The selected parameter artifact and its content hash are immutable for held-out evaluation. A newly admitted or materially changed market remains at zero deployable weight until it has enough post-change completed labels.

**Every term in that loss is binding, and P18 makes three of them so.** The
v0.6 implementation carried five of the seven terms and weighted them on their
raw scales, with the consequence that `downsideRate` — the fraction of
residuals below zero, which is approximately one half for any unbiased
candidate and therefore carries almost no information about candidate quality
— supplied 99.84% of the total loss. Selection was decided in the residue, on
a margin of 1.27e-7, and the two omitted terms were exactly the two that
describe the decision the forecast exists to serve. Three rules follow.

**Scale normalization.** Each term is standardized across the candidate grid
before weighting, so a weight expresses a preference rather than an accident of
units. A term whose interquartile range across the grid is below a registered
threshold is reported as a diagnostic and given zero weight, because a
statistic that does not vary between candidates cannot rank them.

**Decision-focused terms.** Turnover and sacrificed return are computed by
running the registered decision rule of §8 and §9 over the calibration era
under each candidate artifact, and scoring the realized net return, the
realized turnover, and the return foregone by every hurdle rejection. This
couples the forecast to its consumer, in the sense the decision-focused
learning literature makes precise [60], [61]. Without it, no forecast-accuracy
statistic can observe that a candidate horizon leaves the movement rule unable
to act — which is the specific failure v0.6's selection could not see.

**Near-tie resolution.** Where the two best candidates are separated by less
than a registered minimum margin on the normalized total, the lexical tie-break
is not used. The tie is resolved on the decision-focused terms alone, and if it
remains within the margin there, the longer horizon is selected, because §7.1
establishes that signal-to-noise rises with horizon and the shorter choice
carries strictly more estimation risk. A registration whose selection margin
falls below the threshold records that fact in the artifact.

**The artifact carries what the policy reads (P23).** Every quantity any
downstream rule consumes — per-venue and portfolio residual quantiles, the
residual panel from which weight-dependent portfolio quantiles are computed,
the cash-bound quantiles, the horizon, the coverage target, the movement-rule
constants, and the pinned configuration digests — is serialized into the
registered artifact and covered by its content hash. A field the policy reads
but the artifact does not carry has no registration, silently falls back to a
default, and makes every result citing that artifact unreproducible; the
artifact must fail to load rather than degrade.

## 8. Reserve, Stress, and Allocation Optimization

### 8.1 Dynamic idle reserve

Let $I^{\mathrm{floor}}$ be the administrator's non-bypassable idle floor, $Q_\beta(W_H)$ a registered withdrawal-demand quantile, $D_s$ withdrawal demand in stress scenario $s$, and $E_s(x)=\sum_i\min(x_i,e_{i,s})$ the stressed exit value of candidate positions $x$. Let $e_i^{\mathrm{cons}}$ denote the conservatively executable same-transaction exit for position $x_i$ — the minimum of the vault's position and the live protocol cash available to that venue's withdrawal path — which is exactly what the second registered forecast target from §7.2 predicts over the horizon. The candidate-dependent required idle amount is:

$$
I_t^{\mathrm{required}}(x)=
\max\left(I^{\mathrm{floor}},\;
Q_\beta(W_H)-\sum_i\min(x_i,e_i^{\mathrm{cons}}),\;
\max_s\{D_s-E_s(x)\}\right).
$$

For target position $x_i$ and stressed executable exit $e_{i,s}$, every candidate must satisfy:

$$
w_0V_t+\sum_i \min(x_i,e_{i,s})\ge D_s
\quad \forall s.
$$

Withdrawal demand is derived from finalized ERC-4626 `Withdraw` events plus preregistered synthetic stresses. Demand horizons, quantiles, liquidity haircuts, and shocks are calibrated without look-ahead. A target that fails one scenario is rejected before comparing returns.

The vault enforces:

$$
I_t^{\mathrm{onchain}}\ge
\max(I^{\mathrm{floor}},I^{\mathrm{activePlan}}).
$$

An activated dynamic reserve persists after plan expiry; expiry stops actions but does not lower the reserve. A later valid plan may replace it, never below the admin floor.

### 8.2 Constrained target

Let $V_t=A_t$, $w_0$ be the idle fraction, and $w_i$ the fraction allocated to eligible strategy $i$:

$$
w_0+\sum_i w_i=1,\qquad w_0\ge0,\quad w_i\ge0.
$$

SRCLA chooses:

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

subject to:

$$
w_0V_t\ge I_t^{\mathrm{required}}(w_1V_t,\ldots,w_nV_t),
$$

$$
w_iV_t\le \min(c_i^{\mathrm{pct}}V_t,c_i^{\mathrm{abs}},c_i^{\mathrm{external}}),
$$

and, for every dependency group $g$:

$$
\sum_{i\in g}w_iV_t\le c_g^{\mathrm{dependency}}.
$$

The release solver uses deterministic piecewise-linear approximations of the protocol-specific conservative return curves and a fixed market-ID tie-break. For the three-market universe, its output is checked against exhaustive enumeration at the same quantum and its approximation regret is persisted. The solver is generic across adapter and dependency records; adding a protocol does not add a protocol branch to the optimizer.

**$w^*$ is an aim, not an instruction.** The solution to the problem above is
the portfolio the vault would hold if repositioning were free. It is not the
portfolio the vault moves to this hour. §9.1 decides which legs of
$x^*-x$ are worth executing and how far along each to travel, and the
executed target is the result of that decision — never $x^*$ itself, and never
nothing. Separating the two is what allows the optimizer to remain a clean
constrained maximization while the movement rule carries the entire
transaction-cost problem, and it is the reason $q^p_\alpha(w)$ appears in the
objective but no movement threshold does.

The portfolio residual quantile $q^p_\alpha(w)$ is computed from the aligned
panel of per-venue horizon residuals carried by the registered artifact, under
the candidate's own weights. It is weight-dependent by construction, which is
what allows a concentrated candidate to be penalized relative to a diversified
one of the same size and what gives H6 and H7 something to remove. An artifact
that carries no panel cannot compute it; per P23 such an artifact does not load.

## 9. Movement, Rewards, and On-Chain Execution

### 9.1 Complete-cost movement rule

The movement rule decides which components of $x^*-x$ to execute and how far
along each to travel. It is stated in **annualized rate units on both sides**,
evaluated **per leg**, and executed by **partial adjustment**. Versions 0.4
through 0.6 stated it in horizon-return units, evaluated it once over the whole
target vector, and executed all or nothing; Appendix D measures what that cost.

#### 9.1.1 Movement cost, decomposed by leg

$$
C_{\mathrm{move}}=
C_{\mathrm{L2}}+C_{\mathrm{L1data}}+C_{\mathrm{exit}}+C_{\mathrm{entry}}
+C_{\mathrm{claim}}+C_{\mathrm{approve/reset}}+C_{\mathrm{swap}}
+C_{\mathrm{impact}}+C_{\mathrm{slippage/MEV}}+C_{\mathrm{failure}}+C_{\mathrm{buffer}}.
$$

The eleven terms are not all incurred by every action, and P14 fixes which
belong where. A lending deposit or withdrawal executes against the protocol's
own index or exchange rate: there is no quoted price to slip against, no
counterparty spread, and no sandwich surface, so $C_{\mathrm{impact}}$ and
$C_{\mathrm{slippage/MEV}}$ are zero on that leg. Those two terms describe the
Uniswap V3 route of §9.4 and are charged to the reward-conversion leg, where
they are real. The rate consequence of depositing size — the one effect that
might be mistaken for impact — is already priced by §6.1's post-deposit curve,
and charging basis points as well counts it twice.

| Term | Lending leg (deposit / withdraw) | Reward leg (claim / swap) |
|---|---|---|
| $C_{\mathrm{L2}}$, $C_{\mathrm{L1data}}$ | applies | applies |
| $C_{\mathrm{exit}}$, $C_{\mathrm{entry}}$ | applies | — |
| $C_{\mathrm{claim}}$, $C_{\mathrm{approve/reset}}$, $C_{\mathrm{swap}}$ | — | applies |
| $C_{\mathrm{impact}}$, $C_{\mathrm{slippage/MEV}}$ | **zero** | applies |
| $C_{\mathrm{failure}}$, $C_{\mathrm{buffer}}$ | applies | applies |

Base costs include both L2 execution and L1 data availability [47], priced from
the origin's own fee observations and never from a constant.

#### 9.1.2 Deploying idle capital

Idle USDC earns nothing, with certainty. Moving it into an admitted venue
displaces no incumbent position, creates no reversal exposure, and is compared
against a counterfactual that carries no forecast error of its own. It is
therefore gated on cost alone. For an amount $m$ into venue $i$ with
conservative annualized bound $\ell_i$:

$$
\ell_i\cdot\frac{T_{\mathrm{pay}}}{\text{year}}\cdot m \;>\; C^{\mathrm{lend}}_{\mathrm{move}}(m),
$$

where $T_{\mathrm{pay}}$ is a registered payback period: the move must repay
its own execution cost within $T_{\mathrm{pay}}$ at the conservative bound. No
dispersion term appears. $\ell_i$ is already a lower bound at the registered
coverage, and charging forecast uncertainty a second time here is the defect
P13 removes.

Version 0.6's first sentence of this section already exempted idle capital in
words — "new deposits and existing idle USDC reduce target drift before SRCLA
exits a strategy" — while its rule gated deployment identically to a rotation.
The separation is now structural rather than advisory, because Appendix D
measures the conflation at 494 basis points a year against 18 to 43 for every
rotation decision combined.

#### 9.1.3 Rotating between venues

A rotation replaces a position that is already earning. It pays an exit and an
entry, it can be reversed at further cost, and its benefit is a *difference* of
two estimates rather than a level. For a candidate move of $m$ from venue $j$
to venue $i$:

$$
\Delta\ell_{ij} \;>\;
\underbrace{\frac{C^{\mathrm{lend}}_{\mathrm{move}}(m)}{m}\cdot\frac{\text{year}}{T_{\mathrm{pay}}}}_{\text{cost hurdle}}
\;+\;
\underbrace{k\cdot\operatorname{SE}\!\left[\Delta\hat\ell_{ij}\right]}_{\text{significance hurdle}} .
$$

Both sides are annualized rates, so **the hurdle** does not depend on the
forecast horizon (P15). That is a weaker statement than it may appear, and the
difference matters. The hurdle is horizon-free; $\ell$ is not. §7's bound
annualizes a horizon-return quantile, $\ell = r + q_H\cdot\text{year}/H$, and
because $q_H$ is near-flat in $H$ the annualized penalty is not: measured on the
calibration era it is 3.87 percentage points at $H$ = 1 day and 0.33 at 14 days.

The consequence must be stated plainly rather than glossed. P13's removal of the
double-count **halves** the rate a venue must show before idle capital deploys —
from 7.744% to 3.872% at $H$ = 1 day, and from 0.660% to 0.330% at 14 days — but
the *ratio* across horizons is unchanged at 11.7×, because it was never a
property of the movement rule. It is a property of the forecast bound §7
supplies. Nothing in §9.1 can remove it.

What removes it is **P18**: selecting the horizon against the decision it feeds
rather than against forecast accuracy alone. That amendment is therefore not a
refinement of the selection loss but the load-bearing correction of the three,
and a registration that adopts §9.1's new hurdles without §7.3's repaired loss
would still be exposed to the failure v0.6 suffered.

**The significance hurdle uses the standard error of the estimated edge**, not
the predictive quantile of one horizon outcome (P13). The two answer different
questions. A lower prediction bound asks how bad the *next realized return*
might be; a movement rule asks whether an *estimated difference between two
venues* is distinguishable from zero. Substituting one for the other is the
category error the prediction-interval literature exists to prevent [54], and
v0.6 committed its mirror image: §7 correctly used the predictive bound in the
objective, then §9.1 used that same quantity again where the sampling error of
an estimate belonged. The first belongs in the objective, where §7 and §8.2
already place it. The second is a property of the estimator:

$$
\operatorname{SE}\!\left[\Delta\hat\ell_{ij}\right]=
\sqrt{\frac{\sigma_i^2+\sigma_j^2-2\rho_{ij}\sigma_i\sigma_j}{W_{\mathrm{eff}}}},
$$

with $W_{\mathrm{eff}}$ the heteroskedasticity- and autocorrelation-consistent
effective sample size of the estimation window [55], because overlapping
horizons make the nominal count an overstatement. $k$ is a registered scalar
fixed before held-out evaluation, and it now multiplies a quantity that shrinks
as evidence accumulates rather than one fixed by the choice of horizon.

The rule has the limiting behavior the transaction-cost literature requires and
v0.6's did not. As execution cost falls the cost hurdle falls with it, and as
the estimation window lengthens or the forecast improves the significance
hurdle falls too; in the limit the no-trade region vanishes. A band that
remains open at zero cost and perfect information is not a transaction-cost
band [58], [59]. The payback form is used rather than the cube-root width
because this objective is linear in returns while the cube-root result is
derived for a quadratic tracking penalty; the qualitative requirement is
inherited, the functional form is not claimed.

$T_{\mathrm{pay}}$ carries the multi-period content that a one-period gate
cannot express. A move's benefit accrues for as long as the position is held,
which is endogenous to the policy and unknown at decision time;
$T_{\mathrm{pay}}$ is the registered assertion of how long a move must be
expected to survive to be worth making, and it is registered by a
turnover-versus-return sweep over the calibration era, jointly with $k$ and
with the horizon (P18). A value asserted without such a sweep makes every
result depending on it provisional.

#### 9.1.4 Per-leg evaluation and partial adjustment

The hurdles above are evaluated **for each leg of $x^*-x$ separately**. The
legs that clear form a candidate sub-target, which is then re-checked against
§8.1's reserve requirement and §8.2's cap and dependency constraints, since a
subset of a feasible target need not itself be feasible. If the sub-target is
infeasible, the largest feasible subset in a registered ordering is used.
Discarding the entire target because one leg fails its hurdle is forbidden
(P17); it is the structure that produced zero and one rebalances on the two
v0.6 held-out eras.

The executed move is a partial adjustment toward the surviving sub-target:

$$
x \leftarrow x+\lambda\left(x^{\mathrm{sub}}-x\right),\qquad \lambda\in(0,1],
$$

with $\lambda$ registered. This is the form Gârleanu and Pedersen derive as
optimal under transaction costs [57] and that threshold-rebalancing practice
converges on independently [59]: move toward the aim rather than to it, so that
a single noisy origin cannot commit the whole portfolio, and so that the
realized position tracks a persistent signal while ignoring a transient one.
Where a leg's hurdle is cleared by a wide margin, $\lambda$ may reach one; the
registered sweep in §7.3 determines it alongside $k$ and $T_{\mathrm{pay}}$.

Cooldown, minimum turnover, maximum turnover, and reversal allowances remain in
force and prevent repeated small moves; they bound the policy's aggregate
behavior, whereas the hurdles above decide individual legs. A market that
becomes ineligible invokes a bounded safety unwind and bypasses the economic
gate entirely.

### 9.2 Base interest and incentives

Base lending interest requires no harvest. Aave aUSDC indexed value, Compound's positive base balance, and Moonwell's mUSDC exchange rate grow and return with principal.

Incentive rewards are additional tokens. They accrue to and are claimed by the strategy adapter, never the allocator wallet. A reward contributes to forecast or accounting only if its token, emission, denominator, remaining horizon, funding, claim simulation, Chainlink price feeds, and approved Uniswap V3 route all pass admission. Expired, off-chain, underfunded, unverified, or unpriceable rewards contribute zero.

Recognized reward NAV uses actual claimable plus held amounts, fresh independent reward/USD and USDC/USD feeds, a token-specific haircut, and an absolute contribution cap. A stale or invalid source cannot increase NAV. Reward value never increases synchronous withdrawal capacity before conversion to USDC. There is no periodic on-chain refresh transaction: share-changing and allocator transactions refresh material reward values lazily when cache-age or material-change rules require it. If a material reward value is stale, `maxDeposit` and `maxMint` are zero until a safe refresh succeeds.

### 9.3 Event-driven harvest

There is no weekly or fixed-period harvest transaction. The off-chain collector observes rewards every 15 minutes without paying gas. SRCLA attempts a harvest when claimable value is material and:

$$
\text{conservative USDC output}
>
C_{\mathrm{claim}}+C_{\mathrm{approve/reset}}+C_{\mathrm{swap}}
+C_{\mathrm{L1data}}+C_{\mathrm{impact}}+C_{\mathrm{slippage/MEV}}+C_{\mathrm{buffer}}.
$$

This is the leg that genuinely bears $C_{\mathrm{impact}}$ and
$C_{\mathrm{slippage/MEV}}$, and per P14 it is the only one: the terms are
priced here, against the executable depth of the approved route, and not
against the notional of a lending deposit that never touches an exchange.

Expiry risk, emission end, route deterioration, or a safety condition may also trigger evaluation, but no swap executes without its safety checks. Claim and swap are atomic where protocol semantics permit. Otherwise, the claimed token remains in its adapter until a later approved harvest or recovery.

### 9.4 Immutable reward executor

The shared immutable reward executor is a safety wrapper around canonical Uniswap V3, not a new exchange. Release one excludes aggregators, Aerodrome, Permit2-style generalized approvals, private-orderflow services, and arbitrary intents.

Each admin-approved route fixes chain ID, reward token, native USDC output, canonical router and factory, ordered path, pool identities, fee tiers, Chainlink feeds, maximum ages, maximum oracle deviation and price impact, maximum amount, daily notional, and route/code digest [48], [49]. The allocator chooses only an active route ID and bounded amount. It cannot choose calldata, recipient, spender, path, or output token.

Every swap uses an exact token allowance and resets it to zero. The executor checks a short deadline, independent oracle floor, `minOut`, input and output balance deltas, replay protection, and sends USDC directly to the vault.

### 9.5 Staged allocation plans

Rebalancing is staged rather than atomically routing across every venue. A plan commits to:

- a unique plan and decision hash;
- policy version and configuration digest;
- finalized snapshot block number and hash;
- a Merkle root of ordered action commitments and the action count;
- target exposures and dynamic reserve;
- minimum final assets and maximum recognized loss;
- turnover allowance; and
- creation and expiry timestamps.

Each action supplies a Merkle proof for its next unused index. Before execution, the immutable vault rechecks allocator authority, expiry, replay state, adapter lifecycle, market and dependency caps, reserve, per-action and cumulative loss or slippage limits, code/configuration digest, and fixed recipient. An action is consumed only after its external call and balance-delta checks succeed. Divestment precedes deployment. A failed divestment stops the plan; a failed deployment leaves recovered funds as idle USDC. The vault enforces deterministic safety but does not attempt to validate a statistical forecast on-chain.

Pause blocks deposits, mints, new deployments, and non-recovery reward swaps. It permits synchronous withdrawals, redemptions, divestment, impairment, reward recovery, and bounded emergency exit. An emergency exit can transfer only from a known adapter to the vault.

## 10. Off-Chain Service, Data, and Reconciliation

### 10.1 Standalone SRCLA service

`/srcla` is an independent Node.js/TypeScript application with its own package manifest, migrations, process lifecycle, PostgreSQL schema, tests, and read-only HTTP API. It is not imported by the existing NestJS backend, and the backend never reads the SRCLA database directly.

Release one uses one `BASE_RPC_URL` for live reads, transaction submission, archive state, and pinned-block evaluation. Local Anvil forks pinned Base state only for tests; it is not a historical archive.

The service persists one canonical finalized snapshot every 15 minutes and evaluates allocation hourly. Immediately before each transaction, it re-reads live or pending state, verifies the configuration digest, and simulates exact calldata. Cooldown and cost rules may suppress execution even when an hourly evaluation finds a different target.

Snapshots preserve raw integer units, block number, hash, timestamp, vault and adapter balances, protocol cash and indices, supply, borrows, reserves, caps, pause state, implementations, configuration, reward schedules and funding, oracle rounds, Uniswap state, Base fee inputs, RPC metadata, and quality flags.

### 10.2 Decision records and API

The SRCLA-owned database stores append-only or versioned snapshots, regimes, policies, forecasts, completed labels, stress calculations, candidate allocations, rejection reasons, plans, actions, simulations, submissions, receipts, balance deltas, reward valuations, harvests, incidents, emergency exits, baselines, ablations, and evaluation results.

Every decision has a deterministic content hash covering code commit, policy version, snapshot, model artifact, candidates, target, reserve, costs, and reasons. The read-only API exposes health, synchronization, active policy, regime, admission reasons, allocation, reserve, decisions, plan and receipt history, rewards, emergencies, and evaluation summaries. It has no mutation or transaction endpoint.

The existing backend reads user shares, `convertToAssets`, `maxWithdraw`, and events directly from Base. It may compose SRCLA history through HTTP and propose standard unsigned approve/deposit/redeem transactions for the user's wallet. It does not relay farming transactions, possess the allocator key, or execute rebalances.

### 10.3 Submission and recovery

Only one active executor may use the allocator key. For every action, the worker:

1. obtains a database execution lock;
2. persists the plan and action before signing;
3. verifies sender nonce, live configuration, and chain identity;
4. simulates the next action against pending state;
5. submits exactly one action;
6. reconciles receipt, events, and balance deltas;
7. re-reads all affected chain state; and
8. advances, safely stops, or recomputes from chain truth.

Crash recovery uses plan ID, action index, transaction hash, sender and nonce, vault events, and live balances. A database state never overrides confirmed chain state. A reverted or divergent action stops later plan actions.

## 11. Registered Evaluation Protocol

### 11.1 Frozen data and equal information

Evaluation uses time-ordered finalized snapshots and a manifest that fixes dataset bounds, calibration and held-out boundaries, policies, market identities, vault tiers, cadence, code commit, and content hashes. All policies receive the same observations available at each origin, execution delays, transaction shapes, failed-transaction rules, costs, candidate universe, and applicable non-negotiable safety envelope.

Vault tiers are exactly 10,000; 100,000; 1,000,000; and 10,000,000 USDC. Every replay implements ERC-4626 share minting, redemption, and late-depositor cohort accounting. Counterfactual Base-fork executions restore the same pinned prestate before each candidate policy.

### 11.2 Baselines

| Baseline | Registered policy |
|---|---|
| B0 | Hold native USDC idle. |
| B1 | Select the highest currently displayed eligible rate. |
| B2 | Use post-deposit capacity curves without uncertainty treatment, holding the same reserve as SRCLA. |
| B2u | B2 without any reserve. Retained as a labelled diagnostic; not a deployable comparator. |
| B3 | Add a movement-cost threshold to B2 but omit the dependency policy and the P3 netting of the withdrawal quantile. |
| B4 | Use one frozen robust allocation over the eligible market set. |
| B5 | Use bounded hindsight as a non-deployable diagnostic upper bound. |

B5 cannot establish deployability and is excluded from the deployable comparison. It is retained for a second purpose in v0.7: B5's bounded-hindsight return is the registered universe's ceiling, and §11.5 uses the gap between it and the best admissible baseline to decide whether a yield criterion is informative at all (P22).

**Comparability is measured, not asserted (P20, P27).** A baseline is a
comparator *for a given run at a given tier* only if, in that run and at that
tier, it satisfied the §11.5 sustainability criteria SRCLA is held to. A
baseline that breached is **excluded from the yield comparison** and published
instead as a counterexample: its realized return, the criterion it broke, and
the margin.

This is not a convenience, and it is not a way of discarding an inconvenient
result. A policy exempt from a constraint the candidate must obey does not
measure the candidate's skill; it measures the constraint's cost — which is a
real and interesting quantity, so §11.5 part 5 publishes it rather than
suppressing it. The v0.6 evaluation makes the point concretely: on the
secondary held-out era B1, B2 and B2u returned approximately 39% while holding
stressed coverage of 0.878 against a floor of 0.99, and SRCLA — which held
1.000 at every tier — was recorded as having failed to beat them. Under v0.8
that 39% is reported as the price B1 paid in redeemability, which is the
observation the study exists to make. Whether the floor is worth its price
remains a legitimate and separate question, and §11.3's H4 is where it is asked.

B1 has a particular status in this design. It is the registered embodiment of
"take the highest displayed rate", which is the behaviour the paper argues
against, and it is therefore expected to earn well and to breach. A run in
which B1 neither outearned SRCLA nor breached would be evidence *against* the
paper's proposition, and the report must say so if it occurs.

Where no baseline at a tier is sustainable, the comparison at that tier reports
`NO SUSTAINABLE COMPARATOR` and does not verify, in the same way
`CAPACITY-INFEASIBLE` does not.

### 11.3 Component hypotheses

- **H1—capacity:** remove post-deposit simulation; rank on displayed rate.
- **H2—uncertainty:** remove calibrated lower bounds; use the point forecast.
- **H3—cost:** remove both movement hurdles; deploy and rotate to the aim whenever it differs from the position.
- **H3d—deployment hurdle only:** remove §9.1.2's deployment hurdle, retaining §9.1.3's rotation hurdle. Registered separately because v0.6's H3 conflated two effects of opposite economic size, and the run could not report which one it had measured.
- **H4—liquidity:** remove the dynamic reserve and stress feasibility; admin floor only.
- **H5—dependency:** remove shared-dependency caps.
- **H6—structural liquidity cap:** remove $c_i^{\mathrm{liquidity}}$.
- **H7—liquidity-adjusted objective:** remove the $\phi_i$ weighting.

Each hypothesis removes only its named component while holding other information,
delays, costs, and rules fixed.

**Ablations are evidence about components, not comparators for the release
gate (P21).** An ablation is SRCLA with one part removed, so an ablation that
outperforms SRCLA is a finding that the removed part costs more than it earns —
which is precisely the result §11.3 exists to surface, and precisely the result
v0.6 produced when H3 returned 3.462% and 39.157% against SRCLA's 0.871% and
0.000%. Folding that into §11.5's baseline criterion converted the single most
informative diagnostic in the run into an undifferentiated gate failure. §11.5
therefore reads the ablation table separately, and a component whose removal
improves after-cost return without degrading safety is reported as a **negative
contribution** requiring either respecification or removal from the policy.

An ablation whose decision sequence is byte-identical to SRCLA's removed
nothing on the evaluated data. Its delta is noise, attributing that delta to
the named component is a misattribution, and the run must report it as `INERT`
rather than as a contribution of either sign.

### 11.4 Metrics and fork evidence

Forecast metrics include bias, mean absolute error, root mean squared error, mean absolute scaled error, pinball loss, lower-bound coverage, exception independence, exceedance shortfall, and sharpness. Controller metrics include realized net APY, share-price growth, cohort profit, Base L2 and L1 data fees, swap costs, turnover, reversals, drawdown, expected shortfall, withdrawal success, stressed liquid coverage, unavailable assets, dependency concentration, and policy violations.

Version 0.7 adds four **deployment** metrics, because the v0.6 evaluation
reported a policy that never deployed as though its only defect were a low
return, and no metric in the set distinguished "allocated badly" from "did not
allocate":

- **capital-at-work fraction**: the time-weighted share of NAV held in an admitted venue rather than idle, reported per tier;
- **deployment latency**: origins elapsed between capital becoming available and its first admitted deployment;
- **idle drag**: return foregone against the same policy with the deployment hurdle removed, which is the quantity H3 conflates with rotation suppression;
- **hurdle-block census**: for every origin at which the target differed from the position, which hurdle blocked which leg, and by what margin.

The census is the diagnostic that would have identified v0.6's defect from the
run record alone, rather than requiring the calibration-era re-derivation in
Appendix D.

Version 0.8 adds three **sustainability** metrics (P28). Stressed liquid
coverage is a stock measure at a single origin, and none of the three failure
modes this paper argues against is visible in it:

- **Time to full exit**: the number of origins required to redeem 100% of NAV under the registered stress, executing only same-transaction exits the venues could actually honour. A vault that can return 99% instantly and the last 1% never is not redeemable.
- **Venue-stress contribution**: the share of each venue's utilization attributable to the vault's own position. This separates a vault that suffered congestion from one that *created* the congestion it then suffered — the mechanism by which chasing a thin high-rate venue destroys the rate it was chasing.
- **Displayed-versus-realized yield gap**: the advertised rate at the origin of each deployment against the return the vault actually realized over the holding period. This is the quantity B1 maximizes and the quantity the paper argues is not the objective.

All three are reported per policy and per tier, never aggregated across tiers,
because P26 makes scale a criterion rather than a nuisance dimension.

Pinned Base-fork jobs validate exact adapter math, transaction success, gas, L1 data fee, swap output, protocol rounding, and balance deltas. Historical ETH/USD and USDC/USD oracle rounds convert transaction cost consistently. DEX price impact already embedded in executed output is not subtracted twice.

Stressed liquid coverage is reported as a distribution — minimum, 5th percentile and median over the era's origins — and the gate tests the **minimum**. Where a tier's registered stress demand exceeds the observed worst-case liquidity of the whole admitted venue set, the coverage check reports **CAPACITY-INFEASIBLE**: it **does not verify and does not pass**, and the release gate still blocks. The distinction exists so that "the policy allocated badly" is separable from "no policy could have satisfied this on the admitted venues".

### 11.5 Two mandatory release gates

Both gates are evaluated and reported. Every check returns `PASS`, `FAIL`, or
one of the non-verifying outcomes `NOT PRODUCED`, `CAPACITY-INFEASIBLE`, `NO
ADMISSIBLE COMPARATOR`, and `NOT INFORMATIVE`. A non-verifying outcome never
rolls up into a pass. A negative result is published as `FAIL`; it is not
removed, and no parameter is retuned against held-out data to avoid one.

**The forecast gate** fails on inadequate lower-bound calibration, incomplete
labels, regime contamination, look-ahead, missing candidate results, or
non-reproducible artifacts. It is a gate and must be *run*: the v0.6 evaluation
reported the policy gate alone, so half of what §11.5 has required since v0.4
was never evaluated. Its checks are per-venue achieved coverage against target,
Kupiec unconditional and Christoffersen conditional coverage on a
dependence-aware stream, label completeness, regime purity, the availability-lag
barrier, presence of every registered grid point, the registered selection
margin (§7.3), and artifact reproducibility including the P23 completeness
requirement.

**The policy gate** has five parts, and their order is load-bearing. Parts 1
and 2 decide whether a result exists at all; part 3 is the primary criterion;
part 4 is scored only among policies that passed part 3.

1. **Demonstration (P25).** Time-weighted capital-at-work over the run is at or
   above the registered floor. Below it the run reports `NOT DEMONSTRATED` for
   every sustainability criterion and no sustainability claim may be drawn from
   it. This is first because a vault holding idle cash satisfies every
   redeemability test trivially: B0 would otherwise be the study's most
   sustainable policy, and v0.6's SRCLA would have earned a perfect coverage
   score at the tier where it realized 0.000%.

2. **Completeness and reproducibility.** Every registered tier, regime,
   baseline, ablation, and pinned-prestate fork replay is present; costs are
   complete; the manifest, dataset, and result hashes re-derive.

3. **Sustainability (P24, P26) — primary and absolute.** For SRCLA, at
   **every** registered tier independently:

   - **S1 Redeemability.** Withdrawal success at or above the registered threshold at every origin, and time-to-full-exit within the registered bound.
   - **S2 Stressed liquid coverage** at or above the floor, reported as a distribution with the gate on the minimum.
   - **S3 Capacity discipline.** The vault's own deposits do not push a venue past its registered utilization ceiling; venue-stress contribution stays within bounds; the displayed-versus-realized yield gap is reported.
   - **S4 Continuity.** No cap, dependency, reserve, or loss violation; no unrecoverable plan state.
   - **S5 Scale invariance.** S1–S4 hold at every tier. **A per-tier pass does not aggregate** — a policy sustainable at one million and not at ten million is not sustainable, and averaging over tiers hides exactly the capacity failure this paper is about.

   This criterion is absolute and is never traded against return. Baseline and
   ablation sustainability outcomes are computed identically, reported in full,
   and govern admissibility under part 4, but a comparator's breach is never
   recorded as SRCLA's failure (P20).

4. **Yield, among sustainable policies only (P27).** Against each baseline that
   *itself* satisfies part 3 at that tier, SRCLA's after-cost per-period return
   is non-inferior at a registered margin $\delta$, by a one-sided paired test
   with heteroskedasticity- and autocorrelation-consistent standard errors [55]
   and a distribution-free block-bootstrap cross-check. $\delta$ is registered
   before the run. Where a paired difference series is degenerate the test
   reports unusable rather than passing. Where no baseline at a tier is
   sustainable, the comparison reports `NO SUSTAINABLE COMPARATOR`.

   A baseline excluded here is **not** a comparator SRCLA failed to beat. It is
   a counterexample, and part 5 is where it is published.

5. **The price of unsustainability (P27).** For every excluded policy, at every
   tier, the report publishes its realized return, the criterion it broke, and
   the margin by which it broke it. The difference between that return and
   SRCLA's is the measured cost of remaining redeemable, and it is the paper's
   headline quantity rather than an appendix note. It is reported whether it is
   favourable or not: a small price strengthens the argument for sustainability,
   a large one is the honest statement of what sustainability costs.

**Superiority, per dimension, where claimed.** Any superiority the report
asserts — turnover, coverage distribution, time-to-full-exit, capital-at-work,
cost — is stated as a named hypothesis and tested on that dimension. A dimension
not claimed is not tested; a dimension claimed and unsupported fails.

**Attainability and power (P22).** Both are decided by one measurement, taken
before part 4 is scored: the **skill window**, defined as B5's bounded-hindsight
return minus the return of the best baseline that is itself sustainable at that
tier. It is the most any allocator could have earned over the simplest thing
that stays redeemable, and it is a property of the universe, not of SRCLA. It
applies to the two yield statements in opposite directions, and conflating them
would be the error this amendment exists to avoid.

*Yield superiority, where the report claims it.* If the skill window is within
$\delta$, no policy could have demonstrated yield superiority at the resolution
the claim requires. The claim reports `NOT INFORMATIVE` with the window
published. Without this rule a report can be failed for not achieving something
arithmetically unavailable, which is what v0.6's gate did.

*Non-inferiority (part 4).* A narrow skill window makes non-inferiority
**easier**, not harder, so it is never converted to `NOT INFORMATIVE` — that
would excuse the candidate from a test it can pass. Instead the window is
published alongside the result as a power disclosure, and where it is within
$\delta$ the report must state in its verdict line that non-inferiority on this
universe is weak evidence of *allocation* quality, because a policy that simply
deploys and holds would also satisfy it. Version 0.8 expects exactly this
disclosure on the three-venue universe: Appendix D measures the window at 18 to
43 basis points a year.

Attainability applies to part 4 alone. It compares two baselines to each other,
nothing about SRCLA's own performance can trigger it, and **it can never touch
parts 1 through 3**: a demonstration failure, a missing artifact, an
irreproducible hash, or any sustainability breach is scored on its own terms
regardless of what the universe could have offered. The asymmetry is
deliberate. Yield is a claim about a market and can be beyond reach;
redeemability is a claim about the vault and never is.

## 12. Failure Handling and Security Properties

The default response to absent, stale, or contradictory evidence is no action.

| Failure | Required behavior |
|---|---|
| RPC or archive read unavailable | Mark snapshot incomplete; do not decide or execute |
| Database unavailable | Do not sign; recover from chain after restoration |
| Pre-finality reorganization | Replace orphaned data; never train or decide from it |
| Implementation or material configuration change | Quarantine the market and start a new regime |
| Stale or invalid oracle | No upward reward value, no swap, and no unsafe share issuance |
| Invalid or uneconomic reward route | Leave reward in its adapter |
| Market paused or ineligible | Block deployment and invoke bounded unwind when possible |
| Illiquid adapter withdrawal | Reduce synchronous limits; never borrow or exceed loss bounds |
| Simulation failure | Do not submit |
| Reverted or divergent transaction | Reconcile chain truth, stop the plan, and recompute |
| Crash after submission | Recover by sender, nonce, hash, event, and live balance before replacement |
| Plan expiry | Stop remaining actions and leave recovered funds idle |
| Adapter impairment | Disable deployment, record conservative loss or value cap, and continue recovery |
| Allocator-key compromise | On-chain adapter, recipient, route, cap, reserve, deadline, and loss constraints remain enforced |

Foundry verification covers ERC-4626 accounting and rounding, donation resistance, cohort fairness, synchronous limits, roles, pause, lifecycle, impairment, caps, reserve, loss, turnover, plan ordering, replay, rewards, exact approvals, routes, and allocator authority invariants. TypeScript verification covers exact rate math, forecasts, no-look-ahead, reserve, optimizer, cost gates, hashing, persistence, locking, nonces, crash recovery, and deterministic replay. End-to-end Anvil tests cover user deposit, snapshot, decision, staged deployment, accrual, harvest, rebalance, and synchronous redemption.

## 13. Limitations and Threats to Validity

SRCLA may underperform a simpler policy. Lower prediction bounds can reject profitable opportunities; reserves impose cash drag; dependency caps encode judgment; and protocol-exact adapters increase implementation and monitoring cost. A deterministic method is auditable but not automatically accurate. Historical Base behavior may not represent future regimes.

**The three-market universe bounds what any allocator can demonstrate, and the
bound is now measured rather than asserted.** Over the calibration era the
three admitted venues carry pairwise rate correlations of 0.33 to 0.54 and a
mean best-worst spread of 3.29 percentage points whose leadership changes every
two hours at the median, so a forecast cannot follow it and a cost-aware policy
should not try. Appendix D's sweep finds that the best attainable net return
across the whole v0.7 parameter space is 5.120% against 4.941% for deploying
once into fixed equal weights, and that removing movement cost entirely raises
the ceiling only to 5.374%. **Every allocation decision this universe can
reward is worth 18 to 43 basis points a year.**

Three consequences must be stated plainly. Any claim of allocation skill on
three correlated venues is a claim about a 43-basis-point window and will be
dominated by estimation noise, which is why §11.5 tests attainability before it
tests yield. The sustainability machinery — reserve, stress feasibility,
structural liquidity cap, dependency caps — is where the design's value must
lie, because it is the only dimension in which the measured differences between
policies are large: the same universe that offers 43 basis points of allocation
skill produced coverage differences between 1.000 and 0.000 at the largest tier
(Appendix E). And the honest route to an *allocation* claim is a wider
universe, not a better estimator: Morpho Blue USDC markets, Euler Earn, and
further Base lending venues would supply genuine cross-sectional dispersion
and, with it, statistical power that no amount of additional calendar time on
three venues can produce. That expansion is named here as the next phase and is
deliberately out of release-one scope, since each venue requires its own
immutable adapter, admission evidence, archive history, and audit.

**A limitation specific to the sustainability claim.** Withdrawal demand is a
registered schedule, not an observed series (§7's second target and §8.1's
$W_H$), because the Navy vault has no Base mainnet history. Every redeemability
figure in this paper therefore describes behaviour under a *stipulated* stress,
and a reader must treat the stress itself as a modelling choice open to
challenge. What the figures do establish without that caveat is the *relative*
ordering — every policy faces the identical schedule at the identical origins —
and it is the ordering, not the level, that the sustainability claim rests on.

A limitation of this revision itself: v0.7's amendments are derived from the
calibration era and from the diagnosis of two failed held-out runs. They are
therefore design decisions with all the risk that implies, and the eras that
would have tested them are burned. Version 0.7 is registered before, not after,
the evidence that can adjudicate it.

Residual risks include contract exploits, proxy or governance changes, oracle failure, Circle USDC depeg or freeze risk, protocol liquidity disappearance, public-mempool MEV, allocator censorship, Base sequencer disruption, RPC corruption, and correlated infrastructure. The initial design accepts Base and Circle USDC as common-mode risks rather than claiming to diversify them away.

Fork replay improves execution realism but cannot reproduce all historical mempool competition or off-chain operational failures. Empirical coverage does not guarantee future lower-bound coverage under distribution shift [56]. Statistical significance also does not prove economic materiality; the report must publish effect sizes, costs, and safety outcomes together.

The architecture is a research-reproducible core with a production-hardening path, not audited production software. No user-fund deployment should infer safety from the paper or passing prototype tests alone.

### 13.1 What the completed evaluation does not license (v0.9)

Six statements below are load-bearing. A reader who takes only the headline
result from §14 and none of these has misread the study.

**`heldout-c` is design data, and this is not a clean pre-registered test of
it.** An earlier registered run opened both sealed eras and returned `FAIL`.
Its results then informed two changes made before the run reported here: P29's
re-specification of the uncertainty term, and P31's revision of four release
thresholds. By §2.2's own standard `heldout-c` has informed the design of the
controller it was meant to test, and every subsequent result against it is a
**confirmatory re-run, not a fresh test**. The two changes do not carry equal
weight: P29 was derived from calibration-era measurements alone (Appendix F.1)
and is stricter than the form it replaces above 6.90% APY, whereas P31's
threshold revisions were made knowing which checks blocked (P32). The only era
carrying no design knowledge of this controller is a future one, and
`heldout-b` is open-ended and continues to accrue.

**The forecast's lower bound is not calibrated out of sample, and no rule the
study can justify makes it so.** Kupiec rejects on every venue on both eras.
Appendix F.2 tests three frozen estimators — pooled, utilization-banded, and
rolling-window — on a walk-forward split inside calibration, and the best
estimator differs per venue while `moonwell-usdc` fails under all of them.
Selecting per venue would be fitting to the test. The direction of failure is
almost uniformly **over**-coverage: 0.00% breaches against 1.00% expected on
`aave-v3-usdc` and `compound-v3-usdc`. That is the conservative direction for a
safety bound, and its cost is already counted twice elsewhere — in forgone
yield and in the capital-at-work floor — but it remains an uncalibrated
estimate and §11.5 is correct to block on it.

**Sustainability is not demonstrated at the ten-million tier, and a simpler
policy dominates there.** Appendix F.6: a reserve-matched baseline deploys
80.8% with stressed coverage of 1.000 and earns 2.59%, against SRCLA's 42.7%,
0.942 and 1.56%. The paper's proposition survives this; the claim that this
controller is the right response to it, above one million USDC, does not.

**Three ablations are inert.** H5, H6 and H7 produced byte-identical decision
sequences to SRCLA on at least one registered era, so any delta attributed to
the component each removes is noise. §11.3 cannot speak to those three
mechanisms' contribution on this data.

**Two §11.5 sustainability clauses are NOT EVALUATED at all.** S3 grades only
the venue-stress bound; its registered utilization-ceiling clause is not
measured. S4 grades action validity — no deploy into a paused or absent venue,
no divest from an empty one — and not §11.5's named classes of cap, dependency,
reserve and loss violations or unrecoverable plan state. Those columns are
named for what they measure, not for the clause they sit under, and a `PASS`
there is not evidence about the clause.

**P8's significance multiplier `k` did not resolve**, so every result depending
on it is provisional; and **withdrawal demand is a registered synthetic
schedule**, since the vault has no Base mainnet redemption history. No figure
in this document is evidence about real user redemption behaviour.

### 13.2 The venue-failure confound

Sealed era `heldout-b` contains an exogenous venue failure (Appendix F.3):
Moonwell USDC lost its entire withdrawable cash within one hour on 2026-08-27
and advertised 87–90% APY for the following fourteen days with nothing behind
it. Fourteen of that era's seventeen days are therefore a period in which one
of three admitted venues was in a failed state.

This confounds `heldout-b` in both directions and the report must not be read
without it. Against the controller: SRCLA held a position in that venue when it
failed, and its stressed coverage there (0.878 at the two smallest tiers) and
its 7.55% Kupiec breach rate on that venue both reflect the exploit rather than
a forecasting or allocation error — no bound calibrated on a functioning market
predicts a pool being emptied in an hour. In the controller's favour, and
equally important to state: §6's admission rules correctly refused *entry* to
the drained venue at every subsequent origin, and the 87–90% rate it was
advertising was refused as a result. What no rule supplied was an *exit*, and
at the larger tiers no exit existed to supply.

`heldout-b` is retained and reported because excluding an era after seeing its
result is precisely the practice this study's registration exists to prevent.
It is reported with this confound named, and the yield figures it produces —
SRCLA's 33.40% at the 10k tier among them — are annualizations of a
seventeen-day window containing an exploit, and are not evidence of attainable
return.

## 14. Conclusion

SRCLA turns “move USDC to the best yield” into an explicit and bounded process. It admits only verified markets, simulates the rate after the vault's allocation, calibrates a deterministic lower prediction bound, chooses a stress-feasible portfolio under market and dependency caps, preserves a dynamic idle reserve, and moves capital only when conservative gain exceeds complete cost. Immutable contracts enforce the safety envelope; replaceable adapters isolate protocol mechanics; and an auditable off-chain service performs forecasting, optimization, staged execution, and recovery.

Base interest remains part of strategy value without harvesting. Separate incentive tokens are recognized conservatively and converted through approved Uniswap V3 routes only when an event-driven economic and safety gate passes. Users retain standard synchronous ERC-4626 entry and exit and pay their own gas.

The architecture is intentionally falsifiable, and version 0.7 exists because it
was falsified. Two registered held-out evaluations returned `FAIL`, and the
cause was not the market: a movement rule stated in the wrong units charged
forecast uncertainty twice, priced idle capital as though deploying it were a
round trip, and discarded whole target vectors rather than the legs that failed
their own test. On the era it was fit to, that specification would not deploy
capital into a venue paying less than 7.74% while the venues paid 4.86% to
6.13%. The corrections in §9.1 follow from results the transaction-cost
literature settled decades ago and that v0.4 through v0.6 cited without
applying: a no-trade region must vanish as cost vanishes, and a portfolio
outside one is moved to its boundary rather than all the way or not at all.

The second correction is to what the release gate asks, and it is the larger
one. Versions 0.4 through 0.7 all treated yield as the quantity under test and
redeemability as a constraint upon it. That is the wrong way round for this
system. Measurement establishes that reallocating among three correlated venues
is worth 18 to 43 basis points a year while failing to deploy costs 494 — so
the yield question is small — and the same evaluation shows stressed coverage
ranging from 1.000 to 0.000 between policies at the largest tier, so the
redeemability question is not. The policy that always takes the highest
displayed rate breached redeemability at every tier on one held-out era. A
fixed-weight policy that earned 24.95% with perfect coverage at one million
USDC held zero stressed coverage at ten million. **Chasing the highest rate is
not a neutral choice that a safety layer then bounds; it is the mechanism that
produces unredeemable positions**, and the same is true of ignoring the vault's
own size.

Version 0.8 therefore makes sustainability the primary and absolute criterion —
redeemability under stress, capacity discipline, continuity, and invariance
across vault size — and scores yield second, only among policies that have
first shown they can honour a redemption. One requirement keeps that honest:
sustainability must be demonstrated with capital at work, since a vault holding
idle cash passes every redeemability test and has proven nothing. By that
standard version 0.6's own SRCLA does not pass, despite a perfect coverage
score, and saying so is the point of the criterion.

Forecast calibration and the policy gate remain mandatory, and the forecast gate
must now actually be run. Until those registered evaluations pass on an era
sealed after this document — and the distinct production-hardening controls are
completed — the correct conclusion is that SRCLA is a specified research system
with a diagnosed and corrected controller and a release criterion that finally
tests what the system is for: not the highest yield, but a yield that can be
withdrawn.

### 14.1 What version 0.9 establishes, and what it does not

The registered evaluation has now been run to completion on both sealed eras.
**It returns `FAIL`.** That result is reported here rather than obtained by
adjustment, and what follows separates what the data supports from what it does
not.

**Established — the proposition.** The highest available yield is frequently
not redeemable, and this is now measured rather than argued. At the
ten-million tier of an 86-day sealed era, the policy that always selects the
highest displayed rate earned the study's best return, 3.63% APY, holding
**zero** stressed liquid coverage; the best single-venue policy earned 3.25% at
0.151. B4 quoted an identical 3.63% at every tier from ten thousand to ten
million dollars, which is the arithmetic signature of a policy that never
prices its own impact. The market then supplied a second demonstration the
study did not design: on 2026-08-27 a Moonwell USDC pool lost its entire
withdrawable balance within one hour and advertised 87–90% APY for the
following fourteen days with nothing behind it. **The highest annual percentage
yield in two years of Base mainnet data was quoted by a venue from which no
depositor could recover a dollar.**

**Established — SRCLA's sustainability below a measured capacity threshold.**
At ten thousand, one hundred thousand and one million USDC, SRCLA held stressed
coverage of 1.000, 1.000 and 0.963, filled every attempted redemption,
completed a full exit within a single origin, kept 91.3% of capital at work,
and delivered 3.23–3.27% net APY with a displayed-versus-realized gap of 0.19
percentage points — the narrowest of any deployed policy in the study. Within
that range the controller does what it was specified to do: it earns a
reasonable rate and the rate it reports is the rate it can pay out.

**Not established — sustainability at ten million, and this controller's
necessity.** Above one million USDC the same machinery becomes
counterproductive. SRCLA deployed 42.7% of the vault and returned 1.56%, and
the shortfall is entirely idle capital: every dollar it did deploy earned
3.655%, the highest per-dollar rate at any tier. A reserve-matched baseline
carrying none of the capacity curves, exitable-fraction weighting or
movement-cost hurdles deployed 80.8% at the same tier, held coverage of 1.000,
and earned 2.59%. **More capital at work, better redeemability, and 66% more
yield.** The study therefore establishes the phenomenon and prices it, and
locates a threshold above which its own controller is not the right answer to
it. That is a negative result about SRCLA, and it is reported as one.

**Not established — calibration of the forecast.** Kupiec rejects on every
venue on both eras, almost always for over-coverage. Three frozen estimators
were tested on a walk-forward split inside the calibration era; none attains
two-sided coverage across all three venues, and choosing per venue would be
fitting to the test (Appendix F.2). §7.2's registered target is reported as
unattained rather than repaired.

### 14.2 Two findings about method

Two results here are independent of whether SRCLA is a good allocator, and may
outlast it.

**A conservative bound must scale with the quantity it is uncertain about.**
The registered uncertainty term was *subtracted* from a point forecast that
§6's capacity curves evaluate at the candidate allocation — that is, at a rate
the vault's own deposit has already compressed. A constant haircut therefore
consumes a growing share of a shrinking edge and, past a certain vault size,
exceeds it: any venue the vault compressed below 1.159% APY received a negative
lower bound and could never clear a movement hurdle again. Under the
multiplicative form of P29 the defect is gone, confirmed by the ablation that
isolates it (Appendix F.4, H2: −0.002 where it was previously the sole binding
constraint). Any system whose own actions move the quantity it forecasts
inherits this problem.

**A model-selection loss and a calibration gate can disagree about the same
hyperparameter, and nothing detects it.** §7.3's loss rewards a long forecast
horizon because signal-to-noise rises with it; §11.5's gate requires a short
one, because independence can only be tested on non-overlapping windows. The
loss selected fourteen days; at fourteen days the gate had nine windows against
a thirty-observation minimum and reported `NOT PRODUCED` for every venue, while
regime purity degraded from 5.18% to 33.4% because a fourteen-fold longer label
window straddles fourteen-fold more governance changes. Neither section was
wrong on its own terms and no check compared them. P33 resolves it by admitting
only horizons the gate can falsify — a strengthening that narrows the
registered grid from 108 candidates to 36.

### 14.3 The release position

SRCLA is **not released**. On the evidence assembled here the defensible claim
is narrower than the one this paper set out to make, and is stated as such: a
deterministic, safety-constrained allocator that remains fully redeemable and
honest about its advertised rate **at vault sizes up to one million USDC**,
earning 3.23–3.27% where the best sustainable comparator earns 3.39% — and
which, above that size, is dominated by a simpler policy and should not be
used.

The route to a claim stronger than that one runs through data, not through
criteria. `heldout-c` has informed this design and is spent. `heldout-b` is
open-ended and continues to accrue origins from the live collector, and it is
the only era that will carry no design knowledge of this controller. The
correct next step is to freeze the current specification, leave it untouched,
and let that era grow until it can adjudicate what this one could not.

## References

[1] Idle DAO, “Best Yield Overview,” official documentation. [Online]. Available: https://docs.idle.finance/products/best-yield/overview. Accessed: Aug. 1, 2026.

[2] B. Baude, V. Danos, and H. El Khalloufi, “Leveraged Positions on Decentralized Lending Platforms,” arXiv:2601.14005, 2026. [Online]. Available: https://arxiv.org/abs/2601.14005.

[3] P. Mohajerin Esfahani and D. Kuhn, “Data-driven Distributionally Robust Optimization Using the Wasserstein Metric: Performance Guarantees and Tractable Reformulations,” *Mathematical Programming*, vol. 171, pp. 115–166, 2018, doi: 10.1007/s10107-017-1172-1.

[4] V. DeMiguel, X. Mei, and F. J. Nogales, “Multiperiod Portfolio Optimization with Many Risky Assets and General Transaction Costs,” 2014, doi: 10.2139/ssrn.2295345.

[5] B. Senapati and R. Vaze, “Online Convex Optimization with Switching Cost and Delayed Gradients,” arXiv:2310.11880, 2023.

[6] P. Zhao, Y.-J. Zhang, L. Zhang, and Z.-H. Zhou, “Adaptivity and Non-stationarity in Online Learning,” arXiv:2112.14368, 2021.

[7] M. Bastankhah, V. Nadkarni, X. Wang, and P. Viswanath, “AgileRate: Bringing Adaptivity and Robustness to DeFi Lending Markets,” arXiv:2410.13105, 2024.

[8] H. Qu, K. Gogol, F. Groetschla, and C. J. Tessone, “From Rules to Rewards: Reinforcement Learning for Interest Rate Adjustment in DeFi Lending,” arXiv:2506.00505, 2025.

[9] Yearn Finance, “VaultV3.vy,” official source repository. [Online]. Available: https://github.com/yearn/yearn-vaults-v3/blob/master/contracts/VaultV3.vy. Accessed: Aug. 1, 2026.

[10] Morpho Association, “AdaptiveCurveIRM Technical Reference,” official documentation. [Online]. Available: https://docs.morpho.org/get-started/resources/contracts/irm/. Accessed: Aug. 1, 2026.

[11] Euler Labs, “Allocator and Manager Handbook,” official Euler Earn documentation, Aug. 18, 2025. [Online]. Available: https://docs.euler.finance/developers/euler-earn/allocator-handbook.

[12] Yield Seeker, “Core Features,” official documentation. [Online]. Available: https://docs.yieldseeker.xyz/overview/core-features. Accessed: Aug. 1, 2026.

[13] ZyfAI, “Why the Agentic Economy Needs Agentic Treasury Management,” official publication. [Online]. Available: https://blog.zyf.ai/why-the-agentic-economy-needs-the-agentic-treasury-management. Accessed: Aug. 1, 2026.

[14] Mamo, “How Mamo Works,” official documentation. [Online]. Available: https://docs.mamo.bot/behind-the-scenes/how-mamo-works. Accessed: Aug. 1, 2026.

[15] Giza, “Agent Lifecycle,” official documentation. [Online]. Available: https://docs.gizatech.xyz/sdk-reference/agent/lifecycle. Accessed: Aug. 1, 2026.

[16] Surf Liquid, “Product Overview,” official documentation. [Online]. Available: https://surf-2.gitbook.io/surfliquid-docs/infra-and-intelligence/surf-product-overview. Accessed: Aug. 1, 2026.

[17] Almanak, “Almanak SDK Documentation,” official documentation. [Online]. Available: https://sdk.docs.almanak.co/. Accessed: Aug. 1, 2026.

[18] Idle DAO, “Best Yield,” official product architecture documentation. [Online]. Available: https://docs.idle.finance/products/best-yield. Accessed: Aug. 1, 2026.

[19] Idle DAO, “Rebalance,” official developer documentation. [Online]. Available: https://docs.idle.finance/developers/best-yield/methods/rebalance. Accessed: Aug. 1, 2026.

[20] Morpho Association, “MetaMorpho,” official source repository. [Online]. Available: https://github.com/morpho-org/metamorpho. Accessed: Aug. 1, 2026.

[21] Morpho Association, “Public Allocator,” official documentation. [Online]. Available: https://docs.morpho.org/learn/concepts/public-allocator/. Accessed: Aug. 1, 2026.

[22] Euler Labs, “Euler Earn Overview,” official documentation. [Online]. Available: https://docs.euler.finance/developers/euler-earn/. Accessed: Aug. 1, 2026.

[23] Yield Seeker, “Overview,” official documentation. [Online]. Available: https://docs.yieldseeker.xyz/overview/overview. Accessed: Aug. 1, 2026.

[24] Yield Seeker, “How It Works,” official documentation. [Online]. Available: https://docs.yieldseeker.xyz/overview/how-it-works. Accessed: Aug. 1, 2026.

[25] Yield Seeker, “Fees,” official documentation. [Online]. Available: https://docs.yieldseeker.xyz/overview/fees. Accessed: Aug. 1, 2026.

[26] ZyfAI, “Introducing Yield Maxxing,” official publication. [Online]. Available: https://blog.zyf.ai/introducing-yield-maxxing-top-tier-yield-on-your-terms. Accessed: Aug. 1, 2026.

[27] ZyfAI, “ZyfAI Agents Architecture,” official documentation. [Online]. Available: https://agents.zyf.ai/. Accessed: Aug. 1, 2026.

[28] ZyfAI, “Agent Vaults,” official publication. [Online]. Available: https://blog.zyf.ai/agent-vaults. Accessed: Aug. 1, 2026.

[29] Mamo, “USDC Account,” official documentation. [Online]. Available: https://docs.mamo.bot/grow/usdc. Accessed: Aug. 1, 2026.

[30] Mamo, “Ethereum (ETH),” official documentation. [Online]. Available: https://docs.mamo.bot/grow/ethereum-eth. Accessed: Aug. 1, 2026.

[31] Mamo, “How Mamo Keeps You Safe,” official documentation. [Online]. Available: https://docs.mamo.bot/behind-the-scenes/how-mamo-keeps-you-safe. Accessed: Aug. 1, 2026.

[32] Giza, “giza-hub,” official source repository. [Online]. Available: https://github.com/gizatechxyz/giza-hub. Accessed: Aug. 1, 2026.

[33] Almanak, official website. [Online]. Available: https://almanak.co/. Accessed: Aug. 1, 2026.

[34] Almanak, “Almanak SDK,” official source repository. [Online]. Available: https://github.com/almanak-co/sdk. Accessed: Aug. 1, 2026.

[35] Ethereum Improvement Proposals, “ERC-4626: Tokenized Vaults.” [Online]. Available: https://eips.ethereum.org/EIPS/eip-4626. Accessed: Aug. 1, 2026.

[36] J. Offerijns *et al*., “ERC-7540: Asynchronous ERC-4626 Tokenized Vaults,” Ethereum Improvement Proposals, Oct. 2023. [Online]. Available: https://eips.ethereum.org/EIPS/eip-7540. Accessed: Aug. 1, 2026.

[37] Aave, “DefaultReserveInterestRateStrategy.sol,” official source repository. [Online]. Available: https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/pool/DefaultReserveInterestRateStrategy.sol. Accessed: Aug. 1, 2026.

[38] Compound, “CometMainInterface.sol,” official source repository. [Online]. Available: https://github.com/compound-finance/comet/blob/main/contracts/CometMainInterface.sol. Accessed: Aug. 1, 2026.

[39] Moonwell, “JumpRateModel.sol,” official source repository. [Online]. Available: https://github.com/moonwell-fi/moonwell-contracts-v2/blob/master/src/irm/JumpRateModel.sol. Accessed: Aug. 1, 2026.

[40] Morpho Association, “Morpho.sol,” official source repository. [Online]. Available: https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol. Accessed: Aug. 1, 2026.

[41] Morpho Association, “Get Data,” official developer documentation. [Online]. Available: https://docs.morpho.org/build/borrow/tutorials/get-data/. Accessed: Aug. 1, 2026.

[42] Aave, “Pool,” Aave V3 developer documentation. [Online]. Available: https://aave.com/docs/aave-v3/smart-contracts/pool. Accessed: Aug. 1, 2026.

[43] Compound Finance, “Interest Rates,” Compound III documentation. [Online]. Available: https://docs.compound.finance/interest-rates/. Accessed: Aug. 1, 2026.

[44] Compound Finance, “Collateral & Borrowing,” Compound III documentation. [Online]. Available: https://docs.compound.finance/collateral-and-borrowing/. Accessed: Aug. 1, 2026.

[45] Moonwell, “Interest Rate Curves,” official documentation. [Online]. Available: https://docs.moonwell.fi/moonwell/protocol-information/interest-rate-curves. Accessed: Aug. 1, 2026.

[46] Circle, “USDC Contract Addresses,” official developer documentation. [Online]. Available: https://developers.circle.com/stablecoins/usdc-contract-addresses. Accessed: Aug. 2, 2026.

[47] Base, “Network Fees,” official documentation. [Online]. Available: https://docs.base.org/base-chain/network-information/network-fees. Accessed: Aug. 2, 2026.

[48] Uniswap Labs, “Uniswap v3 Deployments: Base,” official developer documentation. [Online]. Available: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments. Accessed: Aug. 2, 2026.

[49] Chainlink, “Data Feeds on Base,” official feed registry. [Online]. Available: https://data.chain.link/feeds/base. Accessed: Aug. 2, 2026.

[50] Compound Finance, “Base USDC Comet Deployment Roots,” official deployment repository. [Online]. Available: https://github.com/compound-finance/comet/blob/main/deployments/base/usdc/roots.json. Accessed: Aug. 2, 2026.

[51] Moonwell, “Base Chain Contract Registry,” official source repository. [Online]. Available: https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/chains/8453.json. Accessed: Aug. 2, 2026.

[52] Aave DAO, “Aave V3 Base Address Book,” official source repository. [Online]. Available: https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol. Accessed: Aug. 2, 2026.

[53] R. J. Hyndman and G. Athanasopoulos, *Forecasting: Principles and Practice*, 3rd ed., Sec. 5.10, “Time Series Cross-Validation.” [Online]. Available: https://otexts.com/fpp3/tscv.html. Accessed: Aug. 2, 2026.

[54] NIST/SEMATECH, “Prediction,” *e-Handbook of Statistical Methods*, Sec. 4.1.3.2. [Online]. Available: https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd132.htm. Accessed: Aug. 2, 2026.

[55] W. K. Newey and K. D. West, “A Simple, Positive Semi-Definite, Heteroskedasticity and Autocorrelation Consistent Covariance Matrix,” *Econometrica*, vol. 55, no. 3, pp. 703–708, 1987, doi: 10.2307/1913610.

[56] R. F. Barber, E. J. Candès, A. Ramdas, and R. J. Tibshirani, “Conformal Prediction Beyond Exchangeability,” *Annals of Statistics*, vol. 51, no. 2, pp. 816–845, 2023, doi: 10.1214/23-AOS2276.

[57] N. Gârleanu and L. H. Pedersen, “Dynamic Trading with Predictable Returns and Transaction Costs,” *The Journal of Finance*, vol. 68, no. 6, pp. 2309–2340, 2013, doi: 10.1111/jofi.12080.

[58] G. M. Constantinides, “Capital Market Equilibrium with Transaction Costs,” *Journal of Political Economy*, vol. 94, no. 4, pp. 842–862, 1986, doi: 10.1086/261410.

[59] Norges Bank Investment Management, “No-Trade Band Rebalancing Rules: Expected Returns and Transaction Costs,” NBIM Discussion Note 01/2018. [Online]. Available: https://www.nbim.no/contentassets/8cb41f89dce345f5a6a295238f7872fb/no-trade-band-rebalancing-rules-expected-returns-and-transaction-costs.pdf. Accessed: Sep. 9, 2026.

[60] A. N. Elmachtoub and P. Grigas, “Smart ‘Predict, then Optimize’,” *Management Science*, vol. 68, no. 1, pp. 9–26, 2022, doi: 10.1287/mnsc.2020.3922.

[61] J. Mandi, J. Kotary, S. Berden, M. Mulamba, V. Bucarey, T. Guns, and F. Fioretto, “Decision-Focused Learning: Foundations, State of the Art, Benchmark and Future Opportunities,” *Journal of Artificial Intelligence Research*, vol. 80, pp. 1623–1701, 2024, doi: 10.1613/jair.1.15320.

[62] K. Muthuraman and S. Kumar, “Multidimensional Portfolio Optimization with Proportional Transaction Costs,” *Mathematical Finance*, vol. 16, no. 2, pp. 301–335, 2006, doi: 10.1111/j.1467-9965.2006.00273.x.

## Appendix A. Release-One Base Registry

Registry observations were pinned during research on Aug. 2, 2026. Activation must reverify every mutable proxy implementation, parameter, pause flag, cap, reward, oracle, and route at the deployment block.

| Destination | Canonical Base identity | Release status |
|---|---|---|
| Circle native USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Sole vault asset |
| Aave V3 USDC | Pool `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`; aUSDC `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` | Release-one candidate subject to admission/history gate |
| Compound III USDC | Comet `0xb125E6687d4313864e53df431d5425969c15Eb2F` | Release-one candidate subject to admission/history gate |
| Moonwell USDC | mUSDC `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` | Release-one candidate subject to admission/history gate |

Morpho markets previously present in the research registry are explicitly excluded from release one. Their earlier appearance is not approval.

## Appendix B. Registered Runtime Policy

| Item | Registered release-one value |
|---|---|
| Chain and asset | Base 8453; Circle native USDC only |
| Snapshot cadence | One finalized snapshot every 15 minutes |
| Decision cadence | Hourly |
| Forecast candidates | Rolling horizon distribution; exponentially weighted residual model; fixed direct-horizon ARX; **state-space utilization forecast mapped through the venue's exact on-chain rate model** — full cross product with horizons and coverage targets, per venue |
| Forecast horizons | 1, 7, and 14 days |
| Lower-bound coverage candidates | 90%, 95%, 99%; quantile solved to attain the target |
| Selection loss | Seven terms, each scale-normalized across the grid; turnover and sacrificed return computed by running the registered decision rule; near-ties resolved on the economic terms and then toward the longer horizon |
| Second forecast target | Venue withdrawable-cash lower bound |
| Market cold start | Ineligible until sufficient post-regime completed history |
| Reserve | Maximum of admin floor, withdrawal quantile minus conservatively executable venue exits, and stress shortfall |
| Objective | Portfolio-level lower bound, liquidity-weighted |
| Structural liquidity cap | Active; decreases toward zero near the venue kink |
| Reward execution | Event-driven; Uniswap V3 only; no fixed weekly harvest |
| Rebalance | Staged, expiring, ordered actions; per-leg hurdles; partial adjustment toward the surviving sub-target; turnover, cooldown and reversal brakes |
| Deployment hurdle | Idle capital deploys when its conservative bound repays movement cost within $T_{\mathrm{pay}}$. No dispersion term |
| Rotation hurdle | Annualized differential exceeds the amortized cost hurdle plus $k\cdot\operatorname{SE}[\Delta\hat\ell]$ |
| Movement-cost attribution | Impact, slippage and MEV on the reward-swap leg only; lending legs carry gas, failure and buffer |
| $k$, $T_{\mathrm{pay}}$, $\lambda$ | Registered jointly with the horizon by a turnover-versus-return sweep over the calibration era, before held-out evaluation. $k$ multiplies the standard error of the estimated edge, never a predictive quantile |
| Evaluation tiers | 10,000; 100,000; 1,000,000; 10,000,000 USDC |
| Release criterion | **Sustainability first and absolute**: demonstration floor, then redeemability, capacity discipline, continuity and scale invariance at every tier. Yield scored second, non-inferiority at registered $\delta$, against sustainable comparators only. Unsustainable policies published as counterexamples with the price they paid |
| Demonstration floor | Registered time-weighted capital-at-work. Below it a run reports `NOT DEMONSTRATED` and supports no sustainability claim |
| Sustainability metrics | Withdrawal success; stressed coverage (min, p05, median); time to full exit; venue-stress contribution; displayed-versus-realized yield gap — all per tier, never aggregated across tiers |
| User transactions | Standard synchronous ERC-4626; user pays gas |
| Runtime keys | Admin key only in uncommitted contract environment; allocator key only in `/srcla` environment |
| Data ownership | `/srcla` owns its PostgreSQL schema; `/be` reads history via HTTP |

## Appendix C. Reproduction Status and Commands

The existing research core and contract baseline can be checked with:

```bash
cd research-engine
uv run pytest -q
uv run ruff check .

cd ../contract
forge test --summary
```

These commands verify existing research mechanics and the pre-redesign contract baseline; they do not establish the release-one architecture or outperformance.

After implementation, the registered evaluation entry points are:

```bash
cd srcla
pnpm test
pnpm exec tsc --noEmit
pnpm build
source .env
pnpm run evaluation:run -- --manifest config/evaluation-manifest.json
pnpm run evaluation:verify -- --latest-complete
```

The evaluation command may produce `PASS` or `FAIL`, and may report a criterion as `NOT DEMONSTRATED`, `NOT PRODUCED`, `CAPACITY-INFEASIBLE`, `NO SUSTAINABLE COMPARATOR`, or `NOT INFORMATIVE`. Successful reproducibility is distinct from a passing policy gate, and a non-verifying criterion is distinct from both. `NOT DEMONSTRATED` is the one to read first: it means the run did not put enough capital to work to support any sustainability claim, whatever its coverage numbers say.

## Appendix D. Calibration-Era Measurements Behind the v0.7 Movement-Rule Amendments

Every figure in this appendix is computed on the **calibration era only** —
2024-03-15 to 2025-05-31, 10,632 hourly origins per venue, read directly from
Compound III, the Aave V3 Pool and the Moonwell mToken at Base archive blocks.
No sealed observation appears. The era is the registered fitting window, so
using it for design is what it exists for; §11.5's prohibition applies to
held-out data and is not engaged here.

Labels, residuals and quantiles reproduce the registered pipeline exactly:
horizon returns are the venue's mean supply rate over the window converted to
the horizon, residuals are strictly causal under a rolling 24-observation mean,
and quantiles are solved per venue to the 99% coverage target.

### D.1 Dispersion does not scale with the horizon

| Venue | $\lvert q\rvert$, H=1d | H=7d | H=14d |
|---|---|---|---|
| `aave-v3-usdc` | 1.061e-4 | 1.505e-4 | 1.266e-4 |
| `compound-v3-usdc` | 5.144e-5 | 6.702e-5 | 7.705e-5 |
| `moonwell-usdc` | 9.084e-5 | 1.102e-4 | 1.180e-4 |
| **ratio to 1d, worst venue** | ×1.00 | ×1.42 | ×1.19 |
| independent increments would give | ×1.00 | ×2.65 | ×3.74 |

Signal-to-noise, $\mathbb{E}[R_H]/\hat\sigma_H$: **1.47–2.63 at one day,
15.79–24.60 at fourteen.** Achieved coverage is 99.00–99.01% at every horizon,
so the difference is not a calibration artifact.

### D.2 What the v0.6 rule implied

Solving $\hat r_H\varphi > \lvert q^p\rvert(1+k)$ at the registered artifact
($q^p$ = −1.061e-4, $k$ = 1) for the annualized rate a venue must show before
idle USDC may be deployed:

| | H=1d | H=7d | H=14d |
|---|---|---|---|
| implied deployment hurdle | **7.744% APY** | 1.570% | 0.660% |
| origins at which Aave clears it | 18.6% | — | 100.0% |
| origins at which Compound clears it | 14.5% | — | 98.9% |
| origins at which Moonwell clears it | 16.0% | — | 100.0% |

Realized supply rates over the same era: Aave mean 6.13% (p05 2.94, p50 4.80,
p95 14.37); Compound 4.94% (2.54, 3.97, 10.26); Moonwell 4.86% (1.80, 3.57,
13.14). The registered horizon was selected over the alternatives by a loss
margin of 1.27e-7.

**What P13 fixes, and what it does not.** Removing the double-count halves the
threshold at every horizon but leaves the ratio across horizons untouched:

| | H=1d | H=7d | H=14d | swing |
|---|---|---|---|---|
| v0.6, dispersion charged twice | 7.744% | 1.570% | 0.660% | 11.73x |
| v0.7, charged once | **3.872%** | **0.785%** | **0.330%** | **11.73x** |

The swing is a property of §7's bound, not of §9.1's rule, so no movement-rule
amendment can remove it. P18 can, by selecting the horizon against the decision
it feeds. This is the reason P18 is the load-bearing amendment of the three and
why adopting §9.1's hurdles without §7.3's repaired loss would leave the v0.6
exposure intact.

### D.3 The state is forecastable; the rate it produces is not

One-step autocorrelation and persistence-forecast $R^2$:

| Venue | acf(1h) rate / util | $R^2$ persist 1d, rate | $R^2$ persist 1d, util |
|---|---|---|---|
| `aave-v3-usdc` | 0.710 / 0.985 | **−0.206** | **0.758** |
| `compound-v3-usdc` | 0.922 / 0.996 | 0.430 | 0.918 |
| `moonwell-usdc` | 0.806 / 0.995 | 0.042 | 0.915 |

A negative $R^2$ means the current rate predicts tomorrow's rate worse than the
unconditional mean does. This is the empirical basis for P19.

### D.4 The size of the prize

| Quantity | Calibration era |
|---|---|
| best-venue spread over worst, mean / p50 / p95 | 3.29 / 2.00 / 11.10 pp |
| always-best-venue APY (costless, hindsight) | 7.12% |
| equal-weight-three APY | 5.31% |
| median duration of a venue's rate leadership | **2 hours** (mean 7.7, p90 13) |
| pairwise rate correlation | 0.434 / 0.332 / 0.536 |

### D.5 Movement-rule structure, held to the same optimiser and data

Vault 1,000,000 USDC, hourly origins, 5% idle floor, 50% per-venue cap,
movement cost 8 bps of notional. A simplified replay: no capacity curve, no
reserve stress, no withdrawals, no dependency caps. Its claim is about the
relative behavior of gate *forms*, not about absolute return.

| Movement rule | Net APY | Trades | Turnover | Cost |
|---|---|---|---|---|
| B0, all idle | 0.000% | 0 | 0× | 0 bps |
| **v0.6 rule at H=1d** | **0.000%** | **0** | 0× | 0 bps |
| argmax chase, cost-blind | **−1.409%** | 200 | 95.9× | 767 bps |
| equal weight, deploy once | 4.941% | 1 | 0.9× | 7.6 bps |
| v0.6 rule at H=14d | 5.110% | 1 | 0.9× | 7.6 bps |
| best v0.7 configuration found | **5.120%** | 2 | 1.9× | 15.0 bps |

The first and last rows differ only in the movement rule. The two v0.6 rows
differ only in the forecast horizon, which the registered loss chose on a
1.27e-7 margin.

### D.6 Attainable return against assumed movement cost

Best configuration over horizons {1, 7, 14} days, diversification weights,
adjustment rates, payback periods {7, 30, 90} days and $k$ ∈ {0, 1, 2}:

| Movement cost | Best net APY | Trades | Turnover |
|---|---|---|---|
| 8 bps | 5.120% | 2 | 1.9× |
| 4 bps | 5.164% | 3 | 2.1× |
| 1 bps | 5.262% | 16 | 7.5× |
| 0.25 bps | 5.325% | 52 | 21.1× |
| 0 bps | 5.374% | 78 | 30.4× |

Against 4.941% for deploying once into equal weights, **all reallocation skill
in this universe is worth 18 bps a year at realistic cost and 43 bps at zero
cost**, while not deploying costs 494. This is the measurement behind P16, P22,
and §13's statement that the universe, not the estimator, is the binding
constraint on any allocation claim.

## Appendix E. The Sustainability Evidence Already in the Record

Unlike Appendix D, this appendix reports figures from the **two sealed eras of
the v0.6 registered evaluation**. Those eras are burned — the third
burned-window declaration records that they were read in full — so nothing here
may be treated as held-out evidence for v0.8, and no v0.8 parameter was chosen
from it. It is included because the v0.6 run measured the sustainability
question correctly even while its gate scored the wrong thing, and discarding
that measurement would waste the only redeemability evidence this project has.

### E.1 Stressed liquid coverage, per policy per tier

Floor: 0.99. Bold marks a breach.

| Policy | era | 10k | 100k | 1M | 10M |
|---|---|---|---|---|---|
| `srcla` | heldout-c | 1.000 | 1.000 | 1.000 | 1.000 |
| `srcla` | heldout-b | 1.000 | 1.000 | 1.000 | 1.000 |
| `b1` highest displayed rate | heldout-c | 1.000 | 1.000 | 1.000 | **0.108** |
| `b1` highest displayed rate | heldout-b | **0.878** | **0.878** | **0.878** | **0.878** |
| `b2` capacity, no uncertainty | heldout-c | 1.000 | 1.000 | 1.000 | **0.171** |
| `b2` capacity, no uncertainty | heldout-b | **0.878** | **0.878** | **0.878** | 1.000 |
| `b2u` unreserved | heldout-c | 1.000 | 1.000 | 1.000 | **0.066** |
| `b2u` unreserved | heldout-b | **0.878** | **0.878** | **0.878** | 1.000 |
| `b4` frozen robust weights | heldout-c | 1.000 | 1.000 | 1.000 | **0.000** |
| `b4` frozen robust weights | heldout-b | 1.000 | 1.000 | 1.000 | **0.590** |
| `h1` no capacity simulation | heldout-c | **0.911** | **0.911** | 1.000 | 1.000 |

**SRCLA is the only registered policy that never breached, at any tier, on
either era.** B1 — the registered embodiment of "take the highest displayed
rate" — breached at every tier on one era and at the largest tier on the other.

### E.2 Return against redeemability at the two largest tiers

`heldout-b`, the era where the difference is starkest:

| Policy | 1M: return / coverage | 10M: return / coverage |
|---|---|---|
| `b1` | 39.19% / **0.878** | 38.55% / **0.878** |
| `b4` | 24.95% / 1.000 | 24.95% / **0.590** |
| `srcla` | 0.00% / 1.000 | 0.00% / 1.000 |

`heldout-c`:

| Policy | 1M: return / coverage | 10M: return / coverage |
|---|---|---|
| `b1` | 3.39% / 1.000 | 3.31% / **0.108** |
| `b4` | 3.63% / 1.000 | 3.63% / **0.000** |
| `srcla` | 0.87% / 1.000 | 0.00% / 1.000 |

B4's row is the clearest statement of the capacity thesis available: an
identical policy, an identical era, a return unchanged to two decimal places,
and coverage that falls from 1.000 to 0.000 purely because the vault got
larger. No metric averaged across tiers can see it.

### E.3 Why this is not yet a result for SRCLA

Three qualifications, and they are the reason P25 exists.

1. **SRCLA's perfect record was earned by not deploying.** It realized 0.000%
   at the 10M tier on `heldout-c` and 0.000% at every tier on `heldout-b`. A
   vault holding idle cash satisfies every redeemability test trivially. Under
   §11.5's demonstration floor this run reports `NOT DEMONSTRATED`, not a pass.
2. **At 10k through 1M on `heldout-c`, SRCLA was not more sustainable than its
   comparators** — B1, B2 and B4 all held 1.000 coverage there and earned three
   to four times as much. The sustainability advantage appears at the largest
   tier and on the era with a venue liquidity failure, not everywhere.
3. **The 10M tier is `CAPACITY-INFEASIBLE`** under P12: its registered stress
   demand exceeds the observed worst-case liquidity of the whole admitted venue
   set. SRCLA's 1.000 there is partly an artifact of that.

The claim v0.8 puts forward is therefore *testable and currently untested*: a
controller that deploys above the demonstration floor **and** holds
redeemability at every tier would be a result, and no run has yet produced one.
That is the experiment the v0.7 controller and this gate exist to make possible.

## Appendix F. Measurements Behind the v0.9 Amendments

Every figure here is measured, and each is labelled with the data it was
measured on. **Only Appendix F.1 and F.2 are derived from calibration-era data
and therefore informed the amendments themselves**; F.3 onward reports sealed-era
outcomes, which are results, not inputs to any design decision (see §13's
design-data disclosure).

### F.1 The uncertainty term is proportional to the level being forecast (P29)

Calibration era, state-space candidate, per venue, split by the venue's
utilization at the forecast origin. `ABSOLUTE` is the 5% lower quantile of
`realized − forecast`, annualized; `RELATIVE` is the same residuals divided by
the forecast each was measured against.

| Venue | Utilization band | n | ABSOLUTE q05 (APY) | RELATIVE q05 | Mean forecast (APY) |
|---|---|---|---|---|---|
| `aave-v3-usdc` | 60–70% | 1,836 | −0.875% | −0.188 | 4.322% |
| `aave-v3-usdc` | 70–80% | 3,037 | −1.172% | −0.170 | 4.656% |
| `aave-v3-usdc` | 80–90% | 3,714 | −0.802% | −0.137 | 5.679% |
| `aave-v3-usdc` | 90–100% | 1,529 | −2.365% | −0.254 | 7.024% |
| `compound-v3-usdc` | 50–60% | 609 | −0.574% | −0.179 | 3.016% |
| `compound-v3-usdc` | 60–70% | 1,990 | −0.342% | −0.097 | 2.970% |
| `compound-v3-usdc` | 80–90% | 4,220 | −0.858% | −0.154 | 4.495% |
| `compound-v3-usdc` | 90–100% | 2,210 | −2.009% | −0.217 | 7.347% |
| `moonwell-usdc` | 50–60% | 570 | −0.602% | −0.268 | 1.731% |
| `moonwell-usdc` | 60–70% | 1,477 | −0.461% | −0.190 | 2.188% |
| `moonwell-usdc` | 80–90% | 4,175 | −0.664% | −0.145 | 4.099% |
| `moonwell-usdc` | 90–100% | 2,207 | −2.174% | −0.252 | 6.395% |

The absolute error varies by **2.9×–5.9×** across bands; the relative error by
**1.8×–2.9×**, and it tracks the level being forecast. The error is
proportional to what is being predicted, so the haircut is too (P29).

### F.2 No frozen quantile rule attains two-sided coverage (P32's honesty clause)

Walk-forward **inside the calibration era** — fit on the first 70% of origins,
test Kupiec on the last 30%, expected breach 1.00%. Three estimators, none of
which was selected by looking at a sealed era. LR below 3.84 passes at 5%.

| Venue | n (test) | Pooled LR | Utilization-banded LR | Rolling-1000 LR | Rolling-3000 LR |
|---|---|---|---|---|---|
| `aave-v3-usdc` | 3,039 | 61.1 | **2.0** | 41.1 | 61.1 |
| `compound-v3-usdc` | 3,129 | 62.9 | 24.9 | **6.7** | 62.9 |
| `moonwell-usdc` | 3,075 | **24.1** | 61.8 | 61.8 | 61.8 |

The best estimator differs for every venue, one cell of twelve passes, and
`moonwell-usdc` fails under all four. **Two-sided Kupiec is not attainable on
this venue set with any frozen per-venue quantile rule the study can justify**,
and selecting per venue would be fitting to the test. This is reported as a
limitation of §7.2's registered target, not repaired.

### F.3 The Moonwell liquidity failure of 2026-08-27 (P34)

Hourly, from the archive. The venue is healthy at 09:00 and empty at 11:00.

| Time (UTC) | Utilization | Supply APY | Withdrawable cash | Borrows |
|---|---|---|---|---|
| 08-27 09:00 | 84.4% | 3.85% | **$2,105,538** | $11,293,879 |
| 08-27 10:00 | 98.2% | 70.16% | **$269,578** | $13,605,973 |
| 08-27 11:00 | 100.2% | 87.38% | **$1** | $13,580,750 |
| 08-27 → 09-06 | 100.2→100.5% | 87.4→90.3% | **$0** | ~$13.3M |
| 09-07 → 09-10 | 100.6% | 14.5% | **$0** | ~$9.0M |

$2.3M was borrowed within one hour. The preceding 24 hours show utilization
oscillating in an 83.9–85.0% band with cash stable at $2.0–2.2M: at hourly
resolution there is no precursor. Utilization exceeds 100% because protocol
reserves are netted out of a pool holding no cash.

**This is the paper's proposition in its purest available form.** For fourteen
consecutive days the highest advertised rate in two years of Base mainnet data
— 87% to 90% APY — was quoted by a venue from which no depositor could withdraw
a dollar. It also bounds what any allocator could have done: one origin existed
at which exit was possible at all, and at the larger tiers not even that, since
a multi-million-dollar position cannot be unwound against $269,578 of cash.

### F.4 What withholds capital at the ten-million tier (P35)

Sealed era `heldout-c`, which contains no venue failure. Each ablation removes
exactly one mechanism; the delta is against SRCLA's own capital-at-work.

| Ablation | Removes | Capital at work | Net APY | Δ |
|---|---|---|---|---|
| — | *full controller* | 0.427 | 1.56% | — |
| **H3** | movement-cost hurdles (§9.1) | **0.766** | 2.49% | **+0.339** |
| **H1** | post-deposit capacity curves (§6.3–6.5) | **0.670** | 2.34% | **+0.243** |
| **H7** | exitable-fraction weighting φ (P4) | **0.573** | 2.04% | **+0.146** |
| H4 | dynamic reserve (§8.1) | 0.476 | 1.69% | +0.050 |
| H6 | structural liquidity cap (P5) | 0.448 | 1.62% | +0.021 |
| H2 | calibrated lower bound (§7.2) | 0.425 | 1.50% | −0.002 |

**H2 confirms P29 repaired the defect it targeted.** Under the v0.8 artifact,
removing the uncertainty bound raised capital-at-work from 0.390 to above 0.80
— it was the sole binding constraint. Under P29's multiplicative form it
changes nothing (−0.002). What now withholds capital is the three
liquidity-aware mechanisms acting together, and they interact: the capacity
curves compress the rate the vault's own deposit would earn, which shrinks the
edge, which then fails the movement-cost hurdle.

### F.5 Per-dollar yield is not degraded at scale — the capital is idle

Sealed era `heldout-c`, SRCLA.

| Tier | Net APY | Capital at work | **APY per deployed dollar** |
|---|---|---|---|
| 10,000 | 3.226% | 0.913 | 3.534% |
| 100,000 | 3.236% | 0.913 | 3.544% |
| 1,000,000 | 3.268% | 0.913 | 3.579% |
| 10,000,000 | **1.560%** | **0.427** | **3.655%** |

Every deployed dollar at the ten-million tier earns the **highest** per-dollar
rate of any tier. `3.268% × (0.427 / 0.913) = 1.53%` against 1.56% observed:
the shortfall is accounted for entirely by idle capital, with no residual
attributable to price impact, venue capacity, or execution cost.

### F.6 The sustainability record, and where a simpler policy dominates (P35)

Sealed era `heldout-c`. Coverage is the minimum over every origin.

| Policy | Tier | Net APY | Stressed coverage | Withdrawals filled | Full exit | Capital at work | Displayed − realized |
|---|---|---|---|---|---|---|---|
| `srcla` | 10,000 | 3.23% | **1.000** | 1.000 | 0 | 0.913 | 0.20pp |
| `srcla` | 100,000 | 3.24% | **1.000** | 1.000 | 0 | 0.913 | 0.19pp |
| `srcla` | 1,000,000 | 3.27% | 0.963 | 1.000 | 1 | 0.913 | 0.19pp |
| `srcla` | 10,000,000 | 1.56% | 0.942 | 1.000 | 1 | 0.427 | 1.99pp |
| `b2` | 10,000,000 | **2.59%** | **1.000** | 1.000 | 0 | **0.808** | 0.51pp |
| `b2u` | 10,000,000 | 3.05% | 0.964 | 1.000 | 1 | 0.929 | 0.13pp |
| `b3` | 10,000,000 | 2.15% | 0.566 | 1.000 | 1 | 0.615 | 1.26pp |
| **`b1`** | 10,000,000 | **3.25%** | **0.151** | 1.000 | 1 | 0.941 | 0.09pp |
| **`b4`** | 10,000,000 | **3.63%** | **0.000** | 1.000 | 2 | 0.996 | −0.13pp |

Read the bottom two rows first: they are the proposition. The two
highest-earning policies at the largest tier hold 0.151 and **0.000** stressed
coverage. B4 quotes an identical 3.63% at every tier from 10k to 10M, which is
the signature of a policy that never prices its own impact.

Then read `b2`: at the same tier it deploys 80.8%, holds coverage of 1.000, and
earns 2.59% — better than SRCLA on capital at work, on redeemability, and on
yield simultaneously. **The study's proposition survives; the claim that this
controller is the best response to it does not, above one million USDC.**
