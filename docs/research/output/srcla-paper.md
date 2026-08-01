# Safe Robust Cost-aware Lending Allocation for ERC-4626 Vaults

**Research report version:** 0.1
**Date:** 2026-08-01
**Empirical status:** Evidence review, registry, executable core, and contract baseline verified. Historical superiority results are not yet available.

## Abstract

Direct DeFi lending allocators often expose either a capacity-aware objective or strong vault safety rails, but rarely publish the complete forecasting, risk, cost, rebalance, and emergency policy needed for reproduction. This report proposes the Safe Robust Cost-aware Lending Allocator (SRCLA), an unleveraged USDC allocator for an ERC-4626 vault on Base. SRCLA combines protocol-specific post-deposit rate simulation, calibrated probabilistic returns, hard market and dependency constraints, a dynamic idle reserve, stressed withdrawal feasibility, and cost-aware impulse control. A bounded primary-source review finds Idle Best Yield to be the closest disclosed live allocation objective, while Yearn V3, Morpho-based frameworks, and Euler Earn expose stronger enforcement without a canonical optimizer. Six research-core tests and 68 existing Foundry tests verify important mechanics. Superior realized yield remains a hypothesis pending historical backtests, stress experiments, ablations, and pinned Base-fork replays.

## 1. Introduction

Highest-APY routing is incomplete because a vault deposit changes utilization and return, rates are nonstationary, incentives may not be realizable as USDC, movement has costs, and accounting claims may be temporarily non-withdrawable.

The research question is whether an unleveraged Base USDC allocator can improve realized net yield relative to reproducible baselines while satisfying identical safety and stressed-withdrawal constraints. The proposed contribution is an integration and validation framework, not a claim that robust optimization, no-trade regions, ERC-4626 accounting, or capacity-aware rates are individually new.

## 2. Scope

The system is one pooled ERC-4626 vault using native Circle USDC on Base. It supplies without leverage to Aave V3, Compound III, Moonwell, and individually approved Morpho Blue markets. Curated allocator vaults are related work rather than destinations. Experiments cover \$10,000, \$100,000, \$1 million, and \$10 million using one policy.

## 3. Related Work

Idle Best Yield publishes the closest live capacity-aware objective by evaluating rates after proposed deposits [1]. Its complete forecast, risk model, cost hurdle, solver, cooldown, and keeper configuration are not public.

Yearn V3 exposes debt, minimum-idle, loss, reporting, role, and shutdown mechanisms while leaving target selection external [9]. Morpho publishes isolated-market mechanics and AdaptiveCurveIRM [10]. Euler Earn exposes caps, queues, timelocks, reserves, forced removal, and loss procedures, but allocation policy remains curator-defined [11].

Agentic allocators name cost, liquidity, stability, and risk factors [12]–[16] without publishing enough equations and parameters for equivalent counterfactual tests. Almanak can make an individual open strategy reproducible but is not a canonical optimizer [17].

Baude et al. model utilization-dependent multi-market leveraged allocation [2]. Wasserstein DRO supplies conservative distributional optimization [3]. Multiperiod portfolio research derives no-trade regions and boundary trading [4]. Online optimization supports switching costs and nonstationarity [5], [6]. AgileRate and offline RL optimize protocol rate setting rather than depositor allocation [7], [8].

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

## 12. Advantages and Limitations

Intended advantages are reproducible uncertainty, hard safety, withdrawal feasibility, size-aware capacity, passive drift correction, and formal impulse control. Risks are overfit, excessive reserves, subjective dependency caps, operational complexity, implementation error, common-mode risks, and unavailable exit liquidity. Complexity is justified only if out-of-sample ablations show value.

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

## Appendix A: Disclosure Comparison

| System | Public strength | Principal limitation |
|---|---|---|
| Idle Best Yield | Post-deposit capacity-aware objective | Full cost, risk, solver, trigger, and keeper configuration are incomplete |
| Yearn V3 | Debt, loss, idle, reporting, withdrawal, and shutdown enforcement | No canonical optimizer |
| Morpho | Exact isolated-market and stateful IRM mechanics | Rate mechanism is not an allocation policy |
| Euler Earn | Caps, queues, timelocks, reserves, forced removal, loss procedures | Allocation objective remains curator-defined |
| Yield Seeker and ZyfAI | Rich qualitative yield, cost, stability, liquidity, and risk factors | Equations, weights, thresholds, and live parameters are hidden |
| Mamo and Giza | Understandable routing or lifecycle boundaries | Objective, cost horizon, and decisive triggers are incomplete |
| Surf Liquid | Strong planning/enforcement separation | Forecast and scoring implementation is hidden |
| Almanak | Potentially complete when a strategy and configuration are open | Framework rather than one canonical strategy |

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
