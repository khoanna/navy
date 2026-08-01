# Closest Prior Work and SRCLA Overlap

**Review date:** 2026-08-01
**Status:** Bounded systematic review in progress; this document does not establish universal novelty.

## Comparison rule

For each proposed component, this analysis identifies the closest mathematical antecedent and the closest disclosed production mechanism. Relationships are classified as:

- **Identical:** the same decision structure is already disclosed.
- **Adapted:** an existing method is transferred to direct DeFi lending.
- **Integrated:** known components are combined into one controller and evaluated jointly.
- **Not found in bounded review:** no matching method was located in the registered search; this is not proof of absence.

## Overlap matrix

| SRCLA component | Closest academic antecedent | Closest production disclosure | Relationship | Remaining research question |
|---|---|---|---|---|
| Post-deposit endogenous supply rates | Baude et al. model utilization-dependent multi-market allocation | Idle Best Yield publishes `nextRate_i(x_i)` | Identical/adapted | Does exact four-protocol Base simulation materially improve realized results at larger tiers? |
| Morpho stateful rate path | Baude et al. include AdaptiveCurveIRM | Morpho publishes AdaptiveCurveIRM | Adapted | Does forecasting the target-rate path improve unleveraged allocation beyond instantaneous simulation? |
| Probabilistic horizon yield | Wasserstein DRO and nonstationary learning literature | DeFAI products mention forecasts or stability without equations | Adapted/integrated | Which calibrated model improves out-of-sample net yield without excess idle capital? |
| Hard admissibility and caps | Generic constrained optimization | Yearn, Morpho/MetaMorpho, Euler Earn, Giza, and Surf expose caps or roles | Integrated | Can one transparent dependency taxonomy be justified and maintained? |
| Dynamic idle reserve | Inventory/liquidity control literature | Idle, Yearn, and Euler Earn expose idle/reserve mechanics | Adapted/integrated | Does withdrawal-conditioned reserve sizing beat fixed reserve percentages? |
| Stressed multi-market withdrawal feasibility | Generic robust constraints and liquidity-risk literature | Protocols expose liquidity mechanics, not a published joint optimizer | Not found in bounded review | Is there prior direct-lending work embedding time-bucket withdrawal success in allocation? |
| No-trade region and boundary trading | DeMiguel et al.; online optimization with switching costs | Idle/Mamo/ZyfAI/Yield Seeker describe material or break-even triggers | Adapted | How should fixed gas, asymmetric exits, and discontinuous safety actions change the boundary? |
| Deposit-driven passive correction | Cash-flow-aware portfolio rebalancing | Euler/MetaMorpho supply queues route deposits; product policies are curator-defined | Integrated | Does new-flow correction reduce turnover without widening tracking error excessively? |
| Safety override | Constrained control with emergency actions | Yearn shutdown; Euler cap-to-zero/forced removal; Surf Guardian | Integrated | How should emergency authority be bounded and replayed without profitability checks? |
| Replayable decisions | Reproducible computational research | Almanak can expose complete open strategies; most products do not publish logs/models | Integrated | Can the artifact standard itself improve comparability across strategies? |
| ERC-4626 fair entry and profit | ERC-4626 share accounting | Yearn/Euler/MetaMorpho and NavyVault use shares | Identical mechanism | Can experiments reconcile allocator return, share price, and user money-weighted profit exactly? |

## What is already known

SRCLA cannot claim novelty for capacity-aware rates, robust optimization, probabilistic forecasting, transaction-cost no-trade regions, hard portfolio constraints, ERC-4626 shares, or deterministic execution boundaries individually. Each has clear antecedents.

## Candidate contribution

The bounded evidence supports a candidate **integration and validation contribution**:

> A reproducible direct-lending controller that combines protocol-exact decision-dependent rates, calibrated horizon uncertainty, hard dependency and stressed-liquidity feasibility, dynamic reserves, and an asymmetric cost-aware impulse policy inside an ERC-4626 accounting and execution boundary.

The least-covered elements are joint stressed withdrawal feasibility and dependency-aware caps within an unleveraged direct-market lending optimizer. A wider peer-reviewed and governance-code search is still required before calling either element novel.

## Why production comparisons are limited

Idle exposes the strongest allocation objective, while Yearn, Morpho/MetaMorpho, and Euler Earn expose strong rails and accounting. Agentic allocators name richer factors but withhold material equations and parameters. Consequently, empirical claims can compare SRCLA fairly only with reproducible baselines, not with unverifiable counterfactual implementations of proprietary systems.

## Required claim language

Before experiments:

> We propose and evaluate an integration of established robust-control and transaction-cost ideas adapted to allocation-dependent direct DeFi lending under explicit liquidity and dependency constraints.

After experiments, any superiority statement must name markets, blocks/dates, portfolio tiers, cost assumptions, safety policy, baselines, effect sizes, and uncertainty intervals.
