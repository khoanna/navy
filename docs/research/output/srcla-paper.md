# Safe Robust Cost-aware Lending Allocation for ERC-4626 Vaults

**Research report version:** 0.1
**Date:** 2026-08-01
**Empirical status:** Evidence review, registry, executable core, and contract baseline verified. Historical superiority results are not yet available.

## Abstract

Direct DeFi lending allocators often expose either a capacity-aware objective or strong vault safety rails, but rarely publish the complete forecasting, risk, cost, rebalance, and emergency policy needed for reproduction. This report proposes the Safe Robust Cost-aware Lending Allocator (SRCLA), an unleveraged USDC allocator for an ERC-4626 vault on Base. SRCLA combines protocol-specific post-deposit rate simulation, calibrated probabilistic returns, hard market and dependency constraints, a dynamic idle reserve, stressed withdrawal feasibility, and cost-aware impulse control. A bounded primary-source review finds Idle Best Yield to be the closest disclosed live allocation objective, while Yearn V3, Morpho-based frameworks, and Euler Earn expose stronger enforcement without a canonical optimizer. Six research-core tests and 68 existing Foundry tests verify important mechanics. Superior realized yield remains a hypothesis pending historical backtests, stress experiments, ablations, and pinned Base-fork replays.

## 1. Introduction

Highest-APY routing is incomplete because a vault deposit changes utilization and return, rates are nonstationary, incentives may not be realizable as USDC, movement has costs, and accounting claims may be temporarily non-withdrawable.

The research question is whether an unleveraged Base USDC allocator can improve realized net yield relative to reproducible baselines while satisfying identical safety and stressed-withdrawal constraints. The proposed contribution is an integration and validation framework, not a claim that robust optimization, no-trade regions, ERC-4626 accounting, or capacity-aware rates are individually new.

### 1.1 Why another allocator is needed

The need follows from five properties of a pooled lending vault that cannot be handled safely by a highest-APY rule alone:

1. **The decision changes the opportunity.** A sufficiently large USDC deposit changes utilization and therefore the supply rate. Current APY is not the return available to the completed allocation.
2. **Accounting value is not withdrawal liquidity.** An ERC-4626 vault may correctly report assets that a lending market cannot return during utilization or protocol stress. A yield-only optimizer can therefore be solvent on paper but unable to service redemptions.
3. **Yield improvements are path-dependent and costly.** Gas, reward conversion, liquidity impact, delayed execution, and rapid rate reversal can turn a gross-APY improvement into a user loss.
4. **Market risks are correlated.** Two markets may share collateral, oracle, governance, bridge, or liquidation dependencies. Per-market caps alone do not bound the common-mode exposure.
5. **A pooled vault must allocate profit fairly through time.** New deposits must enter at the prevailing ERC-4626 share price and must not receive yield earned before entry; allocation performance and user profit therefore require one consistent accounting model.

Existing systems disclose valuable parts of the answer, but the reviewed public material does not provide all five as one reproducible controller. Idle addresses allocation-induced rate changes; Yearn and Euler Earn provide strong vault and unwind controls; Morpho exposes exact market mechanics; several agentic systems describe cost, risk, or deterministic enforcement. The missing artifact is a controller whose objective, constraints, reserve, trigger, accounting, and evaluation procedure can all be independently reconstructed. SRCLA is proposed to test whether filling that integration gap creates measurable value.

## 2. Scope

The system is one pooled ERC-4626 vault using native Circle USDC on Base. It supplies without leverage to Aave V3, Compound III, Moonwell, and individually approved Morpho Blue markets. Curated allocator vaults are related work rather than destinations. Experiments cover \$10,000, \$100,000, \$1 million, and \$10 million using one policy.

## 3. Related Work and Comparative Critique

### 3.1 Comparison method

Projects are compared only on publicly disclosed behavior. Absence of a published formula is treated as a reproducibility limitation, not evidence that the deployed system lacks the feature. The comparison asks whether a third party can reconstruct: (i) opportunity eligibility, (ii) the allocation objective, (iii) capacity and risk treatment, (iv) the rebalance trigger, (v) withdrawal and emergency behavior, and (vi) live parameters. This distinction prevents marketing descriptions and observable transactions from being mistaken for a reproducible algorithm.

### 3.2 Direct allocation and vault precedents

**Idle Best Yield.** Idle discloses the closest live lending-allocation objective: an off-chain optimizer maximizes allocation-weighted supply return using each integration's rate *after* the proposed deposit [1]. Integrations expose post-allocation rates and available liquidity, and the on-chain rebalance moves only allocation deltas. This is stronger than selecting the highest displayed APY because it accounts for the allocator's effect on utilization. Its principal limitation is incomplete controller disclosure: the numerical solver, forecast horizon, risk penalty, gas and slippage hurdle, hysteresis, cooldown, and live keeper configuration are not published. A point estimate can also chase a temporarily high curve unless stability and uncertainty are modeled. SRCLA retains capacity-aware simulation but adds protocol-specific state transitions, lower-confidence-bound returns, hard dependency constraints, stressed withdrawal feasibility, and an explicit net-benefit impulse gate.

**Yearn V3.** Yearn exposes robust vault machinery: strategy debt, minimum idle, reporting, loss handling, role separation, withdrawal logic, and shutdown controls [9]. These mechanisms are valuable for accounting and safe execution. Yearn is intentionally non-opinionated, however, and permissioned roles or an external allocator choose target debt. Consequently there is no canonical Yearn objective, forecast, or rebalance policy against which an allocator can be reproduced. SRCLA does not replace these vault controls; it specifies the missing decision layer and makes target generation testable.

**Morpho Blue and AdaptiveCurveIRM.** Morpho publishes isolated-market state and a path-dependent interest-rate mechanism [10]. Isolation makes collateral, oracle, LLTV, and liquidation dependencies explicit and enables exact post-deposit simulation. The interest-rate model is not itself a portfolio allocator: it does not decide which markets a USDC vault should admit, cap, fund, or exit. Naively treating all Morpho markets as one protocol bucket also hides correlated oracle, collateral, and liquidation-venue risk. SRCLA treats every market as a separately admitted destination while constraining shared dependencies.

**Euler Earn.** Euler Earn discloses strong curator and allocator controls, including supply caps, withdrawal queues, timelocks, reserves, forced market removal, and loss procedures [11]. These controls bound authority and provide an unwind mechanism, but the curator defines the allocation objective and operational parameters. Safety therefore depends on the selected curator policy, and a withdrawal queue alone does not prove that stressed liquidity is sufficient. SRCLA adds an explicit robust objective and requires scenario-level withdrawal feasibility before accepting a target.

### 3.3 Agentic allocators

**Yield Seeker.** Autoseek describes a Base USDC loop using APY, discounted incentives, protocol risk, transaction cost, liquidity, and slippage; it moves only when expected net gain exceeds reallocation cost and converts rewards to USDC [12]. These are appropriate economic inputs. The published material does not reveal the adjusted-APY haircut, risk weights, allocation solver, holding horizon, rebalance and harvest thresholds, cash reserve, illiquidity behavior, or unwind order. Its beta gas subsidy can further obscure production economics. SRCLA makes these quantities explicit and evaluates unsubsidized costs under one registered policy.

**ZyfAI.** ZyfAI identifies APY delta, pool safety, yield stability, break-even economics, liquidity health, collateral, slippage, and rate curves, while separating instant-liquidity and asynchronous tiers [13]. Scoped accounts limit withdrawal authority. However, the score, weights, thresholds, concentration rules, and reward schedule are undisclosed; asynchronous venues introduce delayed exit and stale-NAV risk, and documented wrapper upgrade authority adds governance risk. SRCLA's initial scope excludes asynchronous and leveraged destinations, constrains governance dependencies, and calculates reserve needs directly.

**Mamo.** Mamo offers a comprehensible Base routing loop across a narrow Moonwell/Morpho universe: compare live rates, move when the difference is meaningful, and compound rewards once their value reaches an economic threshold [14]. CowSwap auctions, Chainlink price checks, slippage limits, personal vaults, and user-approved upgrades are practical strengths. The unpublished meaning of “meaningful,” absence of a disclosed capacity or rate-persistence model, and venue concentration make rate chasing and correlated exposure difficult to evaluate. SRCLA broadens direct-market diversification and formalizes the movement threshold, but assumes the additional adapter complexity that Mamo avoids.

**Giza.** Giza exposes scheduled/manual execution, user-selected protocols, and per-protocol minimums, maximums, and exclusions [15]. Its lifecycle represents failed, blocked, deactivation, and emergency states, which is stronger operational disclosure than a simple yield router. The objective, risk adjustment, cadence, cost hurdle, reward handling, reserve, and failed-unwind policy remain unpublished. SRCLA contributes a deterministic objective and trigger while borrowing the idea that failure states must be explicit.

**Surf Liquid.** Surf separates a forecasting and planning layer from a deterministic Guardian that checks allowlists, concentration, exit liquidity, slippage, simulations, and invariants [16]. This is a strong authority boundary. Its forecast implementation, data, score, thresholds, idle buffer, reward trigger, allowlist governance, and enforcement code are not sufficiently disclosed for replication; broader liquidity and cross-chain scopes add risks outside direct lending. SRCLA adopts deterministic enforcement but deliberately narrows the first study to single-chain, unleveraged USDC lending.

**Almanak.** Almanak provides a framework in which a deterministic `decide()` function, simulation, backtesting, parameter sweeps, canaries, monitoring, and emergency tools can make an individual strategy reproducible [17]. It is not one allocator: objectives, limits, triggers, and unwind logic remain strategy-defined, and private strategies can remain opaque. SRCLA is a concrete policy that could be implemented with such tooling, not a competing orchestration framework.

### 3.4 Research models

Baude et al. model utilization-dependent multi-market leveraged allocation [2], but leverage and liquidation fall outside this first study. Wasserstein distributionally robust optimization supplies conservative uncertainty treatment [3]. Multiperiod portfolio research derives no-trade regions and boundary trading under transaction costs [4]. Online optimization addresses switching costs and nonstationarity [5], [6]. AgileRate and offline reinforcement learning optimize protocol rate setting rather than depositor allocation [7], [8]. SRCLA's proposed novelty is therefore the reproducible integration of these ideas for a constrained ERC-4626 lending vault, not invention of the individual mathematical components.

### 3.5 Requirement-coverage gap

The bounded review yields the coverage matrix below. “Partial” means that a relevant mechanism or qualitative factor is disclosed but its complete rule or live parameters are not reproducible. “External” means that the framework allows the feature but delegates it to a curator or strategy. The table does not claim that an undisclosed production system lacks a capability.

| System | Post-deposit capacity | Explicit uncertainty | Costed trigger | Stressed withdrawal feasibility | Shared-dependency constraints | ERC-4626 temporal fairness | Reproducible complete policy |
|---|---|---|---|---|---|---|---|
| Idle Best Yield | Yes | Not disclosed | Partial | Partial | Not disclosed | Yes | No |
| Yearn V3 | External | External | External | Partial | External | Yes | No |
| Morpho Blue | Market mechanics | No allocator | No allocator | Market liquidity only | External | External | No allocator |
| Euler Earn | External | External | External | Partial | External | Yes | No |
| Yield Seeker | Not disclosed | Partial | Partial | Not disclosed | Not disclosed | Account-specific | No |
| ZyfAI | Not disclosed | Partial | Partial | Tier-dependent | Not disclosed | Wrapper-dependent | No |
| Mamo | Not disclosed | Not disclosed | Partial | Partial | Not disclosed | Personal vault | No |
| Giza | Not disclosed | Not disclosed | Not disclosed | Lifecycle only | User protocol caps | Account-specific | No |
| Surf Liquid | Partial | Partial | Partial | Partial | Concentration limits | Vault-dependent | No |
| Almanak | Strategy-defined | Strategy-defined | Strategy-defined | Strategy-defined | Strategy-defined | Strategy-defined | Only if strategy is open |
| **SRCLA specification** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |

This matrix establishes a **design need**, not performance superiority: within the reviewed primary-source set, no existing disclosed controller simultaneously satisfies the complete requirement set. Each requirement blocks a distinct counterexample. Without capacity modeling, a large deposit can erase its quoted yield; without uncertainty, a transient spike can dominate; without a cost gate, churn can destroy gains; without stressed liquidity, withdrawals can fail; without dependency caps, nominal diversification can remain correlated; and without share-price accounting, user-level profit can be misattributed. Removing any requirement therefore admits a failure that the remaining requirements do not necessarily prevent.

SRCLA is needed only if this combined requirement set matters to the intended vault. It would not be justified if a simpler baseline delivers statistically indistinguishable net yield and safety, or if the operational cost of forecasts and adapters exceeds their measured benefit. Section 12 makes that claim falsifiable.

## 4. Vault and Profit Accounting

Accounting assets back shares; liquid assets limit withdrawals.

$$
\mathrm{totalAssets}_t =
\mathrm{USDC}_{idle,t}
+ \sum_i \mathrm{USDCValue}(position_{i,t})
- \mathrm{recognizedLosses}_t
- \mathrm{liabilities}_t
$$

A late depositor enters at the current share price:

$$
p_t = \frac{\mathrm{totalAssets}_t}{\mathrm{totalSupply}_t},
\qquad
\mathrm{sharesMinted} = \frac{\mathrm{depositAssets}}{p_t}
$$

Personal profit is:

$$
\mathrm{profit}_u(t) =
\mathrm{redeemValue}(shares_{u,t})
+ \mathrm{priorWithdrawals}_u
- \mathrm{totalDeposits}_u
$$

Thus later users receive no profit accrued before entry.

## 5. Protocol-Exact State

For supply $S_i$, borrows $B_i$, and proposed deposit $x_i$:

$$
u'_i(x_i) = \frac{B_i}{S_i + x_i}
$$

Aave and Moonwell derive supplier rates from borrow rates and utilization. Compound III directly parameterizes a supply curve. Morpho AdaptiveCurveIRM is path-dependent. One generic adapter would therefore be incorrect.

The registry pins six candidate destinations at Base block 49,397,275. Morpho markets remain unapproved until collateral, oracle, LLTV, liquidation depth, and history pass review.

## 6. SRCLA Design

The decision flow is: deterministic eligibility; protocol-exact simulation; calibrated horizon forecasts; hard-constrained robust target and reserve; impulse decision; bounded execution. Prediction can propose but cannot override policy.

For horizon $H$:

$$
\widehat R_{i,t:t+H} \sim P(R \mid X_t,w_i)
$$

The target is:

$$
w_t^* = \arg\max_{w \in \mathcal W_t}
LCB_\alpha\left[\sum_i w_i R_{i,t:t+H}(w_i)\right]
- C_t(w,w_{t-1})
$$

subject to:

$$
w_0 + \sum_iw_i = 1, \qquad w_i \ge 0
$$

Hard limits cover markets, protocols, utilization, liquidity, collateral, oracle, governance, liquidation venue, and shared dependencies.

## 7. Reserve and Rebalancing

The reserve target is:

$$
R_t = \max\left(
R_{min},
Q_\beta(\mathrm{withdrawals}_{t:t+H_w}),
\mathrm{stressLiquidityShortfall}_t
\right)
$$

Every stress scenario must satisfy:

$$
V_{idle} + \sum_i \min(Vw_i,L^{withdrawable}_{i,s}) \ge q_sV
$$

Deposits first correct drift. Existing capital moves only when:

$$
LCB_\alpha(\Delta Y_H) >
C_{gas}+C_{transition}+C_{reversal}+M_{uncertainty}
$$

Normal actions respect cooldown and turnover budgets. Safety violations bypass economic conditions.

## 8. Safety and Threat Model

Admission checks deployed code, market identity, rate model, oracle, collateral, governance, pauses, and data freshness. Allocation caps limit protocol and shared dependencies. Emergency events include pauses, oracle deviation, upgrades, liquidity collapse, depegs, inconsistent data, and confirmed incidents. Base and USDC remain accepted common-mode risks within this scope.

## 9. Evaluation Protocol

Baselines are B0 Hold, B1 current-rate winner, B2 capacity-aware allocation, B3 cost threshold, B4 robust static, and B5 hindsight diagnostic. All receive identical states, costs, constraints, and delays.

Metrics include realized net APY, user profit, share-price growth, costs, turnover, reversals, regret, withdrawal success, drawdown, expected shortfall, dependency exposure, unavailable assets, and violations. Ablations remove each SRCLA component separately.

The necessity claim is evaluated through preregistered component hypotheses:

- **H1 (capacity):** post-deposit simulation improves net APY or reduces allocation regret relative to current-rate winner B1, with the difference increasing at larger vault tiers.
- **H2 (uncertainty):** conservative forecasts reduce reversals and downside loss relative to capacity-only B2 without an unacceptable yield penalty.
- **H3 (cost control):** the impulse gate reduces turnover and total execution cost relative to rebalancing directly to every new optimum.
- **H4 (liquidity):** the dynamic reserve and feasibility constraint improve stressed-withdrawal success relative to equal-yield policies using a fixed reserve.
- **H5 (dependency safety):** shared-dependency caps prevent scenario-limit violations that protocol-only diversification permits.

For every hypothesis, the relevant component is removed while data, opportunity set, delays, fees, and all unrelated constraints remain fixed. Results must be reported by vault tier and market regime with confidence intervals, not only as one average APY. This design can distinguish “the full algorithm performed well” from “the proposed component was actually necessary.”

## 10. Verified Results

The evidence matrix contains 17 primary-source systems or methods, and all citation keys resolve to the bibliography. The Base registry contains six unique USDC destinations.

Six Python tests pass for post-deposit utilization, capacity-aware splitting, caps and ineligibility, dynamic reserves, safety override, and late-depositor fairness.

The existing Foundry baseline reports:

| Outcome | Count |
|---|---:|
| Passed | 68 |
| Failed | 0 |
| Skipped | 1 |

Passing tests cover deposits, caps, idle buffers, adapter movement, loss limits, reallocations, withdrawals, pause behavior, total-assets resilience, ownership, fuzzed round trips, and Compound/Morpho adapter behavior. These are mechanism tests, not performance evidence.

## 11. Results Not Yet Established

No historical walk-forward APY, forecast calibration, cross-tier performance, stress comparison, ablation effect, or complete Base SRCLA fork replay has been produced. Therefore, SRCLA outperformance remains unconfirmed.

## 12. Comparative Advantages, Risks, and Falsifiability

SRCLA is designed to close a specific integration gap rather than win by adding an opaque score. Table 2 links every intended advantage to a predecessor limitation and to evidence that must be produced.

| Intended SRCLA advantage | Limitation addressed | Why it may improve outcomes | Required falsification test |
|---|---|---|---|
| Protocol-exact post-deposit simulation | Headline-rate routing; generic utilization approximations | Avoids allocating beyond profitable capacity | Compare with B1 and B2 across all deposit tiers |
| Lower-confidence-bound objective | Point estimates and undisclosed stability haircuts | Penalizes uncertain or transient yield | Forecast calibration and B2/B4 ablation |
| Hard market and dependency constraints | Qualitative risk scores; protocol-only caps | Prevents yield from compensating for forbidden exposure | Adversarial oracle, collateral, governance, and concentration scenarios |
| Dynamic idle reserve and stressed withdrawal test | Fixed buffers or undocumented unwind rules | Preserves serviceability without keeping excessive idle cash | Withdrawal shocks versus fixed-reserve baselines |
| Explicit net-benefit impulse gate | “Meaningful” or proprietary movement thresholds | Reduces gas loss, churn, and rapid reversals | B2 versus B3 and no-hysteresis ablations |
| Deposit-first drift correction | Full-portfolio movement after every inflow | Uses new cash to reduce turnover | Replay identical flows with and without passive correction |
| ERC-4626 share accounting | Per-user profit ambiguity | Prevents late entrants receiving prior yield | Multi-user invariant and dilution tests |
| Deterministic policy enforcement | Agent discretion over execution | Keeps prediction errors inside auditable bounds | Unauthorized-action and stale-data fault injection |

These properties do **not** yet establish superior performance. SRCLA can underperform because conservative bounds may reject profitable opportunities, reserves create cash drag, caps may be subjective, forecasts may be miscalibrated, and multiple adapters increase implementation and operational risk. Other residual risks include unavailable exit liquidity, oracle failure, smart-contract exploits, keeper censorship, stablecoin depeg, Base sequencer failure, and correlated governance dependencies.

An “outstanding” result is accepted only if the frozen SRCLA policy produces statistically defensible higher realized net APY than B1–B4 at several vault sizes, while meeting the same constraints and not worsening withdrawal failures, expected shortfall, drawdown, or policy violations. Results must survive walk-forward testing, cost and latency sensitivity, stress tests, and component ablations. If it fails any safety constraint or gains disappear after costs, the superiority hypothesis is rejected.

## 13. Conclusion

SRCLA is a defined and partially implemented architecture for direct Base USDC lending allocation. Evidence supports a plausible integration gap but not universal novelty or superiority. A final empirical conclusion requires the registered dataset, frozen walk-forward tests, stress analysis, ablations, and Base-fork replay.

## IEEE References

[1] Idle DAO, “Best Yield Overview,” official documentation. [Online]. Available: https://docs.idle.finance/products/best-yield/overview. Accessed: Aug. 1, 2026.

[2] B. Baude, V. Danos, and H. El Khalloufi, “Leveraged Positions on Decentralized Lending Platforms,” arXiv:2601.14005, 2026. [Online]. Available: https://arxiv.org/abs/2601.14005.

[3] P. Mohajerin Esfahani and D. Kuhn, “Data-driven Distributionally Robust Optimization Using the Wasserstein Metric: Performance Guarantees and Tractable Reformulations,” Mathematical Programming, vol. 171, pp. 115–166, 2018, doi: 10.1007/s10107-017-1172-1.

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

## Appendix A: Algorithm Disclosure and Risk Comparison

| System | Disclosed decision/rebalance logic | Main strengths | Main limitations and risks | SRCLA distinction |
|---|---|---|---|---|
| Idle Best Yield | Maximize weighted post-deposit supply rate; execute allocation deltas | Capacity-aware live objective; integration liquidity interface | Solver, uncertainty, risk overlay, cost gate, cooldown, and keeper parameters incomplete | Adds uncertainty, dependency constraints, reserve stress tests, and impulse control |
| Yearn V3 | Permissioned roles update strategy debt within vault controls | Mature accounting, loss, idle, reporting, withdrawal, and shutdown machinery | No canonical allocation or rebalance optimizer; policy quality is deployment-specific | Defines and tests the decision layer above vault enforcement |
| Morpho Blue | Isolated markets with published state and AdaptiveCurveIRM | Exact market mechanics; explicit collateral/oracle/LLTV dependencies | IRM is not an allocator; isolated choices can create collateral and oracle concentration | Separately admits markets and caps shared dependencies |
| Euler Earn | Curator/allocator actions bounded by caps, queues, timelocks, and reserves | Strong authority, removal, loss, and unwind controls | Objective and parameters remain curator-defined; queue does not guarantee stressed liquidity | Couples controls to robust optimization and scenario feasibility |
| Yield Seeker | Adjusted APY and net-gain-over-cost routing; rewards converted to USDC | Considers incentives, risk, liquidity, slippage, and costs | Formula, thresholds, reserve, unwind, and production economics undisclosed | Publishes cost horizon, uncertainty, reserve, and evaluation baselines |
| ZyfAI | Filter/score by APY delta, safety, stability, break-even, and liquidity health | Risk tiers, scoped accounts, explicit async-liquidity trade-off | Proprietary scoring; delayed exits, stale NAV, and upgrade authority risks | Starts with synchronous direct markets and deterministic dependency limits |
| Mamo | Compare live rates; move on a meaningful difference; compound above threshold | Simple loop; price/slippage controls; user-controlled vault | Threshold/capacity model unpublished; concentrated venue dependencies | Models sustainable post-deposit yield and formalizes movement economics |
| Giza | Scheduled/manual redistribution subject to user min/max/exclusions | Explicit user constraints and operational lifecycle states | Objective, costs, reserve, cadence, rewards, and unwind policy incomplete | Supplies a reproducible objective, reserve, and safety override |
| Surf Liquid | Predict and score opportunities; Guardian validates proposed transitions | Strong separation of planning from deterministic enforcement | Model, data, thresholds, buffer, governance, and enforcement code incomplete | Narrow, testable controller with the same authority separation |
| Almanak | Strategy-defined deterministic `decide()` or policy-constrained agent | Simulation, backtests, canaries, monitoring, and emergency tooling | Framework, not one canonical allocator; reproducibility varies by strategy | Concrete algorithm and experiment specification, potentially deployable through such tooling |

## Appendix B: Pinned Base Market Registry

Registry observation: Base block 49,397,275 on Aug. 1, 2026. Native USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

| Destination | Contract or market identifier | Status |
|---|---|---|
| Aave V3 USDC | Pool `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | Candidate; rate history must be pinned |
| Compound III USDC | Comet `0xb125E6687d4313864e53df431d5425969c15Eb2F` | Candidate; configuration and rewards history required |
| Moonwell USDC | mUSDC `0x36918B66F9A3eC7a59d0007D8458DB17bDffBF21` | Candidate; parameter and reward history required |
| Morpho USDC/cbBTC 86% | `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836` | Not approved pending collateral/oracle review |
| Morpho USDC/USDe 91.5% | `0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354` | Not approved pending depeg/oracle review |
| Morpho USDC/WETH 86% | `0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda` | Not approved pending oracle/liquidation review |

## Appendix C: Reproduction and Provenance

The executable research core is retained outside this output directory in `research-engine/`. Run:

```bash
cd research-engine
uv run pytest -q
uv run ruff check .
```

The ERC-4626 baseline is retained in `contract/`. Run:

```bash
cd contract
forge test --summary
```

Detailed intermediate research artifacts removed from the output directory remain recoverable from Git commits `61e0717` through `237f663`. This single paper is the authoritative human-facing output.
