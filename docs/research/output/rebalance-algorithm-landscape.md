# Publicly Disclosed DeFi Allocation and Rebalance Algorithms

**Research/access date:** 2026-08-01
**Scope:** Lending-pool allocation and rebalancing. CLMM, auto-compounding, and hedging are included only where they supply a transferable control mechanism.
**Starting source:** `raw/DeFAI.md` (used as a lead list; claims below are tied to its cited first-party sources or additional first-party sources).

## Executive conclusion

No reviewed live protocol exposes a fully reproducible production system consisting of candidate admission, data transformations, scoring weights, portfolio optimizer, rebalance trigger, transaction construction, all live parameters, and emergency policy. Public disclosure falls into three tiers:

1. **Mathematically explicit:** Idle Best Yield and academic policies disclose an objective or policy sufficiently clearly to implement a research baseline.
2. **Mechanically explicit:** Yearn V3, Morpho, and Almanak expose contracts/frameworks and safety constraints, but strategy choice remains external or strategy-specific.
3. **Qualitatively explicit:** DeFAI products disclose inputs and control architecture, while material formulas, thresholds, forecasts, or hosted controller code remain hidden.

The strongest research baseline is therefore compositional: Idle's capacity-aware lending objective; a horizon-based, cost-aware no-trade region; explicit risk/capacity constraints; Yearn-style debt, liquidity and loss accounting; economic reward harvesting; and deterministic policy enforcement as in Surf/Almanak. Claims that a new method “outperforms” these systems will require common data, transaction-cost assumptions, stress scenarios, and out-of-sample evaluation—not feature comparison alone.

## Reading guide and evidence labels

- **Disclosed:** directly documented or visible in first-party code.
- **Hidden:** required for reproduction but absent from reviewed public material.
- **Reproducibility:** **high** means an independent implementation can reproduce the decision rule; **medium** means mechanics are implementable but the decision policy is incomplete; **low** means only factors or architecture are public.
- “Current status” means the official source was reachable and described the product on the access date. It does **not** prove that every vault, keeper, integration, or UI was live, nor validate performance or security claims.

## Comparison matrix

| System | Type | Objective and pool inputs | Constraints and trigger | Execution and risk controls | Hidden / limitations | Reproducibility; status |
|---|---|---|---|---|---|---|
| **Idle Best Yield** | Lending allocator | Maximizes aggregate current APR, `sum (x_i/tot) * nextRate_i(x_i)`; `nextRate` incorporates the deposit's effect on each supply curve | Integrated protocols/assets; trigger depends on material allocation improvement and network conditions; docs report roughly 3-hour Ethereum and hourly Polygon cadence | Off-chain bot submits target allocations; on-chain contract computes redeem/mint amounts; partial redemption under low liquidity; optional ~1% unlent reserve; emergency pause leaves redemption available | No explicit forecast horizon, risk penalty, gas objective, significance threshold, solver details, or optimizer source identified | **High for the static objective; medium end-to-end.** Official docs reachable; docs label pages updated 1–3 years ago. [Overview](https://docs.idle.finance/products/best-yield/overview), [rebalance](https://docs.idle.finance/developers/best-yield/methods/rebalance), [FAQ](https://docs.idle.finance/other/faqs), [security policy](https://docs.idle.finance/developers/best-yield/security-management-policy) |
| **Morpho MetaMorpho / Public Allocator** | Lending meta-vault framework | Curator allocates to Morpho markets; Public Allocator reallocates liquidity in response to borrower demand rather than optimizing depositor yield | Market caps, supply/withdraw queues, timelocked governance concepts, and per-market flow caps bound movement | Permissioned allocator/curator plus public paid reallocation; caps prevent unrestricted flow | No canonical yield scorer or target-allocation optimizer—the curator policy is external | **High for constraints/execution, low for selection.** Legacy official reference reachable. [Public Allocator](https://legacy.docs.morpho.org/public-allocator/contracts/publicAllocator), [MetaMorpho repository](https://github.com/morpho-org/metamorpho) |
| **ZyfAI** | Agentic lending/vault allocator | APY delta, pool safety, yield stability, break-even, liquidity health; also collateral, TVL/APY stability, slippage, collateral composition, rate curves/kinks | Curated universe, risk tier, liquidity tier, Safe/session-key permissions; rebalance only after break-even/risk gates | Per-user Safe or ERC-4626/7540 wrapper; NAV oracle/indexer; withdrawal servicing and scoped destinations | Weights, score, horizon, thresholds, optimizer, allowlist method, reward loop and emergency parameters | **Low–medium.** Official product/blog pages reachable; live deployment not independently established here. [Agents](https://agents.zyf.ai/), [treasury logic](https://blog.zyf.ai/why-the-agentic-economy-needs-the-agentic-treasury-management), [Agent Vaults](https://blog.zyf.ai/agent-vaults) |
| **Yield Seeker / Autoseek** | Agentic Base vault allocator | APY, discounted incentives (“Adjusted APY”), protocol risk, liquidity depth/slippage and transaction cost | User risk settings; move when net gain exceeds reallocation cost | Isolated agent account; reward-to-USDC swap and reinvestment; user-only withdrawal claim; docs call current infrastructure custodial | Haircuts, risk weights, horizon/threshold, optimizer, routes/protection, buffer, stress exit | **Low–medium.** Official docs reachable; beta economics may not represent steady state. [How it Works](https://docs.yieldseeker.xyz/overview/how-it-works), [Core Features](https://docs.yieldseeker.xyz/overview/core-features), [Security](https://docs.yieldseeker.xyz/overview/security) |
| **Giza ARMA / Giza Agent** | Lending allocator agent | Evaluates yields and seeks a better distribution | User protocol set; per-protocol min/max and exclusions; scheduled and manual runs | User smart account; asynchronous deactivate/unwind; lifecycle includes blocked, failed and emergency states | Objective, risk/cost model, cadence, threshold, incentive harvesting, oracle and failed-exit policy | **Medium for lifecycle; low for optimizer.** Official docs/repository reachable. [Lifecycle](https://docs.gizatech.xyz/sdk-reference/agent/lifecycle), [Giza Hub](https://github.com/gizatechxyz/giza-hub) |
| **Mamo** | Narrow lending router | Compares live rates across Moonwell markets and Morpho/Moonwell vaults | Narrow curated universe; moves when rate difference is “meaningful”; reward conversion near an economic threshold (about $5 documented for ETH) | Personal vault; CowSwap auctions, Chainlink fair-price check, tight slippage, delayed conversion if unsafe; user approval for strategy changes/upgrades | Meaningful delta, averaging, capacity, gas model, allocation split, emergency triggers | **Medium.** Official docs reachable. [How Mamo Works](https://docs.mamo.bot/behind-the-scenes/how-mamo-works), [Security](https://docs.mamo.bot/behind-the-scenes/how-mamo-keeps-you-safe), [ETH account](https://docs.mamo.bot/grow/ethereum-eth) |
| **Surf Liquid** | Agentic multi-venue allocator | Forecast yield curves, depth/slippage, incentives, risk-adjusted scores and stress tests; constructs transition paths | Allowlists, exposure/concentration, rate-change, slippage, exit-depth, simulation and invariant limits | Nondeterministic Intelligence proposes; deterministic Guardian approves/rejects; MPC permissions, circuit breakers, batched/atomic execution and safe-unwind goal | Forecast/scoring code, weights/data, all thresholds, cadence, reward loop, live parameters; cross-chain atomic claims need separate assumptions | **Medium architecture; low strategy.** Official docs reachable; deployment/code enforcement not established here. [Product Overview](https://surf-2.gitbook.io/surfliquid-docs/infra-and-intelligence/surf-product-overview) |
| **Sail** | Agentic multi-chain allocator/compounder | Personalized risk/reward allocation; reward claim only if value covers gas and improves net yield | ERC-7702 signed mandate limits networks, tokens, protocols and actions | Scoped, revocable session keys; claim, possibly multi-hop swap to USD stablecoin, and reallocate | Allocation formula, score/weights, cadence, rebalance threshold, oracle/slippage, buffer and unwind order | **Medium for compounding loop; low for allocation.** Official docs reachable. [Permissions](https://docs.sail.money/security/permissions-and-keys/quickstart), [Auto-Compounding](https://docs.sail.money/learn/how-sail-works/rewards-auto-compounding) |
| **Yearn V3** | General vault/debt framework | Non-opinionated: authorized debt manager chooses target debt by strategy | Per-strategy maximum debt, deposit/withdraw limits, minimum idle, max loss on debt reduction, withdrawal queue, role separation | `update_debt`; reports profit/loss; unrealized-loss accounting; gradual profit unlock; irreversible emergency shutdown disables deposits while withdrawals remain | No universal strategy ranking, forecast, optimizer or trigger; safety depends on allocator and strategy | **High framework; none for a canonical optimizer.** Active official repository reachable; source identifies API 3.0.4. [VaultV3 source](https://github.com/yearn/yearn-vaults-v3/blob/master/contracts/VaultV3.vy) |
| **Almanak** | General strategy framework | Developer-defined deterministic `decide()` maps market snapshot to Hold/Swap/LP/Borrow intents; optional policy-bounded LLM mode | Generated Zodiac Roles permissions, strategy policy, connector and mandate constraints | Intent compilation, simulation/backtesting, transaction construction, monitoring, canary/emergency tooling | No single algorithm; reproducibility depends entirely on whether an individual strategy/configuration is public | **High for an open strategy; not comparable as one optimizer.** Official site/docs reachable. [SDK](https://sdk.docs.almanak.co/), [site](https://almanak.co/) |

## Lending allocator design analysis

### 1. Objective functions

Idle is the only reviewed live allocator that publishes a precise lending objective. Its marginal-rate function is a necessary improvement over displayed-APR ranking, but it remains a **static, gross-return** objective. It does not publicly place forecast uncertainty, loss severity, movement cost, or dependency concentration inside the optimization. Morpho and Yearn publish allocation rails, not an objective. The agentic products name richer factors but do not expose how they combine.

This creates three useful baselines for research:

- **B0: current-rate winner:** allocate to the highest displayed supply APR.
- **B1: Idle-style capacity-aware optimizer:** maximize aggregate post-deposit APR.
- **B2: constrained target allocator:** B1 plus protocol caps, minimum idle, withdrawal queue, and rebalance cost threshold.

A proposed algorithm should beat B2 out of sample; beating only B0 is not a meaningful novelty claim.

### 2. Evaluation inputs

Across lending-specific disclosures, the union of stated inputs is: current and post-allocation supply rate; rate-curve shape and kink distance; incentives and reward volatility; gas, slippage and break-even; TVL and available withdrawal liquidity; collateral mix and health; protocol/market risk; yield stability; user mandate; and per-protocol exposure limits. Missing almost everywhere are the forecast horizon, uncertainty distribution, correlated dependency graph, and explicit loss-given-failure.

### 3. Rebalance decision

Four trigger families appear:

1. **Periodic recomputation:** Idle documents approximate chain-specific cadence; Giza exposes scheduled runs.
2. **Material improvement:** Idle and Mamo require an unspecified significant/meaningful advantage.
3. **Net benefit:** Yield Seeker and ZyfAI explicitly compare improvement with movement cost/break-even.
4. **Policy or liquidity event:** Morpho's Public Allocator responds to borrowing liquidity demand; withdrawals and emergencies can force debt reduction independently of expected yield.

None reviewed publishes a complete formula of the form `P(improvement persists over H) × benefit - all transition costs - risk change > threshold`, with hysteresis, cooldown, and reversal penalty. That is a clear research gap.

### 4. Constraints and risk controls

- **Capacity/exposure:** Morpho flow/market caps; Yearn per-strategy max debt; Giza user min/max/exclusion; Surf concentration limits.
- **Liquidity:** Idle partial redemption and unlent reserve; Yearn minimum idle and withdrawal queue; Giza asynchronous unwind; ZyfAI distinguishes instant and async tiers.
- **Execution:** Mamo price/slippage checks; Surf simulation/invariants; Sail permissions; Idle pauses rebalancing while preserving redemption.
- **Loss accounting:** Yearn's `max_loss`, unrealized-loss assessment, reporting, profit unlocking and irreversible shutdown are the most explicit reviewed controls.
- **Authority:** protocol governance, curators, multisigs, session keys, MPC/TEE infrastructure and role managers differ materially; “non-custodial” does not eliminate allocator-key risk.

### 5. Reproducibility ranking for lending research

1. **Idle:** strongest live mathematical baseline, but incomplete cost/risk and off-chain implementation disclosure.
2. **Leveraged lending paper:** strongest explicit optimization model, but solves a leverage/borrow-cost problem rather than unleveraged supply allocation and lacks a production controller.
3. **Yearn V3 / Morpho:** strongest open enforcement and accounting frameworks; no canonical selection policy.
4. **Mamo / Giza:** understandable routing/lifecycle, but decisive thresholds and objective remain hidden.
5. **ZyfAI / Yield Seeker / Surf / Sail:** broad and promising factor sets, yet low optimizer reproducibility because weights, models, horizons and parameters are absent.

## Explicit research algorithms and baselines

| Paper | Decision policy | Inputs / constraints / cadence | Strengths | Risks and limitations | Reproducibility; source |
|---|---|---|---|---|---|
| **Leveraged Positions on Decentralized Lending Platforms** (Baude, Danos, El Khalloufi, 2026) | Reduces multi-market recursive staking/borrowing to convex allocation; gives closed forms under linear, kinked and Morpho adaptive rate models | Utilization-dependent borrow rates, staking return, market-specific leverage limits, fees, position size; evaluates rebalance frequency on Ethereum/Base data | Transparent, capacity-aware and analytically tractable; directly usable as leveraged-lending baseline | Model/rate estimation error; oracle, liquidation execution, liquidity, incentives and smart-contract risk require extensions; backtest window is narrow | **High for paper model.** arXiv primary paper accessible 2026-08-01. [arXiv:2601.14005](https://arxiv.org/abs/2601.14005) |

## Transferable mechanisms from excluded strategy classes

These are **not candidate lending allocators** and should not expand the paper's empirical universe:

- **Beefy:** treat reward claiming as an economic stopping decision; expose swap/add-liquidity/redeposit mechanics; retain pause/panic and allowance removal. [Strategy Contract](https://docs.beefy.finance/developer-documentation/strategy-contract), [Gas Throttler](https://docs.beefy.finance/developer-documentation/strategy-contract/gasfeethrottler-contract)
- **Gamma:** event-driven triggers, depeg protection and the warning that frequent rebalances can realize losses transfer conceptually to lending churn controls. [LP Vaults](https://docs.gamma.xyz/gamma/lp-vaults/introduction)
- **Arrakis:** cooldowns, oracle deviation, maximum slippage and restricted executor are reusable enforcement patterns. [Standard Manager](https://docs.arrakis.finance/autogenerated/interfaces/IArrakisStandardManager.sol/interface.IArrakisStandardManager.html)
- **CLMM/hedging papers:** cost-aware no-trade regions and hard liquidation-probability constraints are useful modeling ideas, but CL range/hedge algorithms are outside scope. [Predictable Loss](https://arxiv.org/abs/2309.08431), [Optimal Hedge Ratio](https://arxiv.org/abs/2603.19716)

## Cross-system strengths, weaknesses, and failure modes

### What is strongest in the disclosed designs

- **Capacity-aware marginal rates:** Idle and the leveraged-lending paper avoid ranking pools solely by displayed APR after a large allocation changes utilization.
- **No-trade economics:** ZyfAI, Yield Seeker, Mamo and Sail acknowledge break-even or economic thresholds; this is the seed of a formal hysteresis/no-trade region.
- **Separation of proposal and authority:** Surf and Almanak keep flexible intelligence behind deterministic permissions and invariants.
- **Explicit exit mechanics:** Idle's partial liquidity redemption, Yearn's withdrawal queues/minimum idle/max-loss controls, and Giza's asynchronous lifecycle make liquidity a state variable rather than an assumption.
- **Economic compounding:** reward claims should occur only when realizable reward value exceeds gas, price impact and execution risk.
- **Liquidation as a hard constraint:** the leveraged-lending paper models leverage limits rather than treating borrow APR as the only cost.

### Common weaknesses and risks

1. **Myopic APR chasing:** current APR can reverse immediately, and allocation itself moves the rate.
2. **Nominal incentive inflation:** volatile emissions can make gross APY economically misleading; price impact and vesting/claimability matter.
3. **Churn and hysteresis failure:** a threshold without horizon, confidence interval, cooldown and reversal penalty still oscillates around noisy rates.
4. **Exit-liquidity asymmetry:** entering is easy; stressed withdrawal may realize loss, wait through async settlement, or fail behind utilization.
5. **Correlated “diversification”:** several vaults can share collateral, oracle, bridge, curator, stablecoin or governance dependencies.
6. **Oracle and data risk:** stale/manipulated prices affect NAV, swaps, collateral health, range selection and circuit breakers.
7. **Execution leakage:** gas, slippage, MEV, partial completion, approvals and cross-chain messaging can erase forecast alpha.
8. **Tail-risk blindness:** historical APY/volatility misses exploits, depegs, liquidation cascades, governance capture and withdrawal freezes.
9. **Centralized control planes:** off-chain bots, MPC/TEE keys, multisigs, curators and proprietary models can be critical even when custody is on-chain.
10. **Unverifiable performance:** a documented architecture is not evidence of superior realized return; most products do not publish reproducible datasets and counterfactual backtests.

## Implications for a genuinely differentiated algorithm

A defensible new algorithm should be formulated as a **constrained, cost-aware, partially observable control problem**, not “pick the highest risk-adjusted APY.” At minimum it should expose:

1. a conservative post-allocation return distribution over a declared horizon, including base rate, haircut incentives and capacity impact;
2. explicit protocol/collateral/oracle/bridge dependency constraints and concentration caps;
3. an executable transition cost with gas, slippage, price impact, withdrawal delay and reward realization;
4. a no-trade region based on expected improvement **and uncertainty**, plus cooldown and reversal penalties;
5. liquidity states, an idle reserve, and a stress-tested ordered unwind plan;
6. reward harvesting as an optimal stopping subproblem rather than a fixed schedule;
7. optional leverage only under hard health-factor/liquidation-probability and jump/depeg constraints;
8. deterministic admission, permissions, invariants, circuit breakers and post-trade accounting around any predictive/AI model;
9. full decision logs so each rebalance can be replayed from inputs, versioned parameters and code;
10. evaluation against Idle/static-APR, threshold routing, fixed-weight, no-rebalance and the leveraged-lending paper under the same data and costs.

The likely publishable novelty lies in integrating **uncertainty-aware net benefit, dependency-aware risk, executable unwind liquidity, and hierarchical sub-strategies** into one auditable controller. “Outstanding” should be replaced by testable hypotheses: higher out-of-sample net return at equal expected shortfall; lower drawdown/turnover; better withdrawal success in stress; and bounded policy violations.

## Bounded coverage and search gaps

This lending landscape is broad but **not exhaustive**. DeFi strategy code changes quickly; deployed parameters can differ by chain and vault; private keepers and hosted scoring services are not observable from documentation; and the review did not enumerate every lending vault, curator, market, or Yearn strategy.

Priority gaps for the next pass:

- verify live deployments, contract versions, owners/roles and parameters for a representative vault from each protocol;
- retrieve and reproduce Idle's off-chain allocation solver, if publicly archived, including rounding and gas-aware submission logic;
- inspect individual Yearn lending strategies at pinned commits and reconstruct harvest/credit triggers;
- add Aave Umbrella/merit incentives, Spark Liquidity Layer, Euler Earn, Seamless/Moonwell and CIAN only where current first-party specifications or code expose allocation decisions;
- search formal work on multi-protocol lending under endogenous utilization, robust optimization, transaction-cost no-trade regions, oracle/manipulation-aware allocation, and reward-harvest optimal stopping;
- obtain reproducible datasets and exact backtest protocols from the cited 2025–2026 papers;
- distinguish product availability from documentation availability through chain-specific contract and transaction checks;
- quantify shared dependencies across apparently diversified protocols and develop a machine-readable risk ontology;
- investigate cross-chain lending rebalancing separately because latency, bridge finality and non-atomic failure materially change the control problem.

## Source discipline

Only official documentation, official repositories, and original papers are cited. First-party performance, safety, custody and “AI” claims are treated as descriptions, not independently validated facts. Access date is 2026-08-01; page “last updated” labels are noted where visible, but absence of a date is not evidence of freshness.
