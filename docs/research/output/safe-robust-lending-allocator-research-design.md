# Safe Robust Lending Allocator — Research Design

**Date:** 2026-08-01
**Status:** Approved conversational design; awaiting written-spec review
**Working name:** Safe Robust Cost-aware Lending Allocator (SRCLA)

## 1. Research objective

Design and evaluate a reproducible allocation and rebalancing controller for an ERC-4626 vault that supplies pooled USDC directly to lending markets on Base. The controller maximizes realized net yield subject to explicit hard safety constraints.

The research will not assume superiority. It will test whether the controller improves realized net yield, turnover, and stressed withdrawal coverage relative to disclosed and reproducible baselines operating under the same market universe, information, costs, and safety policy.

## 2. Fixed scope

- One ERC-4626 pooled vault.
- One underlying asset: USDC.
- One chain: Base.
- Unleveraged supply allocation only; no borrowing or recursive loops.
- Direct lending markets only.
- Initial protocol families: Aave V3, Compound III, Moonwell, and explicitly eligible Morpho Blue markets.
- Curated allocator vaults such as MetaMorpho are comparison material, not allocation destinations.
- Historical walk-forward backtesting plus transaction replay on a Base mainnet fork.
- Portfolio tiers: \$10,000, \$100,000, \$1 million, and \$10 million.

The same controller and safety policy apply across portfolio tiers. Market impact, capacity, gas sensitivity, feasible diversification, and allocation outcomes change endogenously with portfolio size.

## 3. Vault ownership and accounting boundary

The ERC-4626 vault owns and accounts for all pooled assets. Its portfolio consists of idle USDC and lending positions held directly by the vault:

```text
Total vault assets
├── Idle USDC reserve
├── Aave V3 USDC position
├── Compound III USDC position
├── Moonwell USDC position
└── Eligible Morpho Blue USDC positions
```

Supplying USDC moves the underlying tokens into a lending protocol, but the vault retains the corresponding position or receipt asset. Every controlled position contributes to `totalAssets()`.

The accounting value is:

$$
\mathrm{totalAssets}_t =
\mathrm{USDC}_{idle,t}
+\sum_i \mathrm{USDCValue}(position_{i,t})
-\mathrm{recognizedLosses}_t
-\mathrm{liabilities}_t.
$$

Forecast values and displayed APYs never enter share pricing. Positions are valued from their accrued underlying claims using protocol-specific, manipulation-resistant accounting.

The system maintains separate measurements for:

- **Accounting assets:** value backing ERC-4626 shares.
- **Liquid assets:** USDC executable for withdrawal under current market conditions.

## 4. Fair user profit accounting

Existing profits belong to existing shares. A later depositor enters at the current pre-deposit share price:

$$
p_t=\frac{\mathrm{totalAssets}_t}{\mathrm{totalSupply}_t},
\qquad
\mathrm{sharesMinted}=\frac{\mathrm{depositAssets}}{p_t}.
$$

After entry, all shares receive the same proportional change in asset value. A later depositor receives no yield accrued before entry.

For reporting, user profit is:

$$
\mathrm{profit}_u(t)=
\mathrm{redeemValue}(shares_{u,t})
+\mathrm{priorWithdrawals}_u
-\mathrm{totalDeposits}_u.
$$

The contract provides correct share accounting. An event-based indexer reconstructs deposits, withdrawals, transfers, realized profit, unrealized profit, money-weighted return, and time-weighted return. Transferable shares require explicit cost-basis reconstruction rather than inference from the current wallet balance.

The vault must accrue or query all material lending interest before minting shares. It must include ERC-4626 rounding and inflation-attack protections.

## 5. Decision architecture

```text
Vault/accounting state
        +
Protocol market state
        +
Risk and dependency state
        +
Execution-cost estimates
        ↓
1. Deterministic market eligibility
        ↓
2. Exact post-allocation simulation
        ↓
3. Safety-constrained robust target
        ↓
4. Dynamic idle-reserve target
        ↓
5. Impulse/no-trade controller
        ↓
6. Deterministic on-chain execution
```

The predictive layer proposes allocations. It cannot override eligibility, allocation caps, liquidity requirements, permissions, or emergency rules.

## 6. Eligibility policy

A market receives zero target allocation unless all admission conditions pass:

- USDC is the supplied asset.
- Deployment address and contract implementation are verified.
- Protocol and market are allowlisted.
- Operating history and data coverage satisfy the declared policy.
- The interest-rate model can be simulated exactly.
- Supplied capital and available liquidity exceed minimum thresholds.
- Oracle configuration, collateral, LLTV, and liquidation venue satisfy policy.
- Governance and upgrade authority satisfy policy.
- Supply and withdrawal actions are not paused.
- Required data is fresh and internally consistent.
- No incident or emergency exclusion is active.

Morpho eligibility is assessed per isolated market because collateral, oracle, LLTV, IRM, and liquidity differ between markets.

## 7. Exact market-state adapters

Protocol adapters must reproduce exact deployed behavior and integer arithmetic where necessary. A generic interest-rate approximation is insufficient.

For market supply $S_i$, borrows $B_i$, and proposed deposit $x_i$, a first-order post-deposit utilization is:

$$
u'_i(x_i)=\frac{B_i}{S_i+x_i}.
$$

The adapter then applies the deployed market's actual rate mechanics:

- Aave V3 and Moonwell: supplier rate derived from utilization, borrow curve, and reserves.
- Compound III: directly parameterized supply curve.
- Morpho Blue: isolated-market configuration and the path-dependent AdaptiveCurveIRM target rate.

Adapters also expose available withdrawal liquidity, pause state, incentive state, caps, and execution previews.

## 8. Probabilistic return forecasting

The selected forecasting approach is a calibrated probabilistic ensemble. Exact protocol mechanics determine the immediate counterfactual rate; forecasting covers uncertain future borrowing, supply, utilization, incentives, liquidity, gas, and parameter regimes.

Candidate features include:

- Utilization and distance from the rate kink.
- Borrow and supply flows over multiple windows.
- Rate level, trend, persistence, and volatility.
- Available liquidity and withdrawal flows.
- Vault position relative to market capacity.
- Incentive emissions, claimability, and reward-token volatility.
- Gas conditions.
- Temporal seasonality.
- Governance and parameter-change indicators.
- Morpho AdaptiveCurveIRM target state and utilization history.

For horizon $H$:

$$
\widehat R_{i,t:t+H}\sim P(R\mid X_t,w_i).
$$

Candidate horizons are 6 hours, 24 hours, 3 days, and 7 days. The controller uses a calibrated lower quantile or lower-confidence bound. Rolling historical quantiles and Wasserstein distributionally robust optimization remain comparison methods.

Training uses chronological walk-forward evaluation. Features, parameters, seeds, transformations, and calibration are published. When uncertainty is uncalibrated, the predictive layer falls back to a conservative deterministic policy.

## 9. Optimization objective

Let $w_0$ be the idle-USDC weight and $w_i$ the weight for lending market $i$. The target allocation is:

$$
w_t^*=\arg\max_{w\in\mathcal W_t}
LCB_\alpha\left[\sum_i w_iR_{i,t:t+H}(w_i)\right]
-C_t(w,w_{t-1}).
$$

Realized net yield is:

$$
Y_{t,H}=\sum_i\int_t^{t+H}w_i(\tau)r_i(\tau)d\tau
+I^{realized}_{t,H}-G_{t,H}-S_{t,H}-L_{t,H},
$$

where incentives are counted only when claimable and conservatively convertible to USDC, $G$ is gas, $S$ is swap or execution impact, and $L$ is realized loss under the declared withdrawal policy.

The allocation satisfies:

$$
w_0+\sum_iw_i=1,\qquad w_i\ge0.
$$

Each market allocation is capped by market, protocol, utilization, liquidity, collateral, oracle, governance, and shared-dependency constraints.

## 10. Dynamic idle reserve

The idle reserve is optimized rather than fixed arbitrarily:

$$
R_t=\max\left(
R_{min},
Q_\beta(\mathrm{withdrawals}_{t:t+H_w}),
\mathrm{stressLiquidityShortfall}_t
\right).
$$

The target reserve can rise during high utilization, withdrawal pressure, gas spikes, stale data, regime changes, or protocol incidents.

Under stress scenario $s$, the portfolio must satisfy:

$$
V_{idle}+\sum_i\min(Vw_i,L^{withdrawable}_{i,s})\ge q_sV.
$$

Immediate and longer time-bucket requirements will be calibrated and tested through sensitivity analysis, not presented as universal safety constants.

## 11. Rebalance timing and impulse controller

The keeper evaluates on:

- Deposit or mint events that add meaningful idle capital.
- Withdrawal or redemption events that reduce reserves.
- A regular fallback schedule, provisionally hourly on Base.
- Material utilization, rate, liquidity, incentive, governance, or risk changes.
- Approaching allocation or safety boundaries.
- Deteriorating forecast calibration.
- Safety violations.

Evaluation does not imply movement. Execution has three modes.

### Passive drift correction

New deposits, idle USDC, and normal cash flows move the portfolio toward its target without withdrawing existing positions.

### Economic rebalance

Existing capital moves only when:

$$
LCB_\alpha(\Delta Y_H)>
C_{gas}+C_{transition}+C_{reversal}+M_{uncertainty}.
$$

The controller can trade only to the nearest acceptable boundary instead of the frictionless optimum. Normal actions also respect minimum residence time, cooldown, turnover budget, gas budget, and a higher hurdle for reversing recent transfers.

### Safety rebalance

Hard-policy violations bypass profit thresholds, cooldowns, residence time, and reversal penalties. The controller reduces or exits exposure, increases idle reserves, freezes new allocation, or enters emergency mode as necessary.

## 12. On-chain execution boundary

User `deposit()` and `mint()` calls mint shares and stage USDC as idle assets. They do not perform an unpredictable full rebalance inside the user transaction. A permissioned keeper proposes bounded actions afterward, subject to a maximum idle-time policy.

Each proposal includes target markets and amounts, maximum USDC movement, minimum resulting assets, minimum idle reserve, state-validity deadline, market-state tolerances, and decision/model version.

The vault verifies:

- Market eligibility remains valid.
- Allocation and dependency caps remain satisfied.
- Minimum idle USDC remains.
- Maximum loss and execution cost remain within bounds.
- Proposal state has not become stale.
- Assets cannot be transferred to arbitrary destinations.
- Post-action accounting and portfolio invariants hold.

Every evaluation and execution decision is replayable from timestamped inputs, parameter and model versions, current and target weights, actions, and rejection reasons.

## 13. Withdrawals

The first version uses standard synchronous ERC-4626 withdrawals rather than an asynchronous queue.

Withdrawal priority is:

1. Idle USDC.
2. Excess allocations already above their updated targets.
3. The most liquid, lowest-opportunity-cost safe position.
4. Controlled emergency unwind if normal liquidity is insufficient.

`maxWithdraw()` and `maxRedeem()` must not promise more than the owner's claim and currently executable vault liquidity. A redemption cannot silently socialize excess loss or overpay the exiting user. The transaction limits or clearly rejects withdrawals that cannot be completed within the declared maximum loss.

An ERC-7540-style asynchronous queue is a possible later extension, not part of the initial algorithm evaluation.

## 14. Safety model

Safety has three levels.

### Admission gates

Unsafe, unsupported, stale, paused, anomalous, or unverified markets receive zero allocation.

### Allocation limits

Limits cover individual markets, protocols, utilization, vault share of market supply, immediate liquidity, collateral families, oracle dependencies, governance authorities, and liquidation venues. Caps shrink when liquidity or safety conditions deteriorate and never rise merely because yield increases.

### Emergency conditions

Triggers include pauses, oracle staleness or deviation, unaccepted upgrades, utilization or liquidity emergencies, collateral depegs, abnormal model output, data inconsistency, confirmed incidents, and failure of stressed-withdrawal requirements.

Possible actions include freezing deposits, disabling normal allocation, withdrawing affected positions, raising idle reserves, setting caps to zero, and entering vault emergency mode.

Thresholds are justified through historical stress distributions, market-depth simulation, protocol characteristics, and conservative/moderate/permissive sensitivity analysis. All compared algorithms use the same safety policy.

## 15. Disclosed-algorithm comparison

### Idle Best Yield

**Strength:** publishes a capacity-aware post-deposit allocation objective and concrete rebalance mechanics.
**Weakness:** the disclosed objective is static and gross-return based; forecast uncertainty, complete costs, risk constraints, and stress liquidity are absent or unpublished.
**Extension:** retain capacity-aware rates while adding calibrated uncertainty, hard safety constraints, stressed withdrawals, and impulse control.

### Yield Seeker and ZyfAI

**Strength:** disclose a broad factor set including adjusted yield, protocol risk, liquidity, slippage, stability, costs, and break-even.
**Weakness:** weights, equations, horizons, thresholds, solver, and live parameters are not reproducible.
**Extension:** publish the complete input transformation, calibrated distribution, constraints, thresholds, and decision logs.

### Mamo

**Strength:** understandable narrow routing and protected reward conversion.
**Weakness:** the meaningful rate difference and capacity, uncertainty, and stress-liquidity treatment are undisclosed.
**Extension:** use a formal lower-confidence net-benefit boundary and exact market-capacity adapters.

### Giza ARMA

**Strength:** user limits and explicit scheduled, failure, deactivation, and emergency lifecycle states.
**Weakness:** selection, cost, risk, cadence, and failed-unwind policies are incomplete.
**Extension:** preserve explicit lifecycle states while publishing the complete allocation and unwind controller.

### Morpho MetaMorpho and Yearn V3

**Strength:** open enforcement, caps, queues, accounting, loss controls, and role boundaries.
**Weakness:** target selection is external, curator-dependent, or deliberately non-opinionated.
**Extension:** adopt their enforcement and accounting lessons while providing a reproducible direct-market optimizer.

### Surf Liquid and Almanak

**Strength:** separation between flexible planning and deterministic permissioned execution, plus simulation and operational controls.
**Weakness:** Surf's scoring policy is hidden, while Almanak is a framework rather than a canonical optimizer.
**Extension:** retain the authority separation while publishing one complete fixed lending policy.

### Highest-current-APR routing

**Strength:** simple and explainable.
**Weakness:** ignores allocation-induced rate changes, persistence, costs, liquidity, uncertainty, and risk, causing probable churn.
**Extension:** optimize conservative post-allocation net yield and move only across a formal no-trade boundary.

## 16. Differentiation hypothesis

The proposed contribution is not any one component in isolation. Robust optimization, no-trade regions, protocol constraints, and ERC-4626 vaults already exist. The research-gap hypothesis is their specific integration and reproducible empirical validation for endogenous, nonstationary direct-lending markets.

The controller differs by jointly providing:

1. Exact protocol-specific allocation-dependent rate simulation.
2. Calibrated probabilistic horizon returns instead of point APY.
3. Hard safety and dependency constraints that yield cannot override.
4. Dynamic idle reserves and stressed withdrawal feasibility inside allocation.
5. Deposit-driven passive drift correction.
6. A lower-confidence, cost-aware impulse/no-trade controller.
7. Separate economic and safety execution paths.
8. Fair, model-independent ERC-4626 share and user-profit accounting.
9. Replayable decisions and common reproducible benchmarks.
10. Identical controller logic across capital tiers.

Before experiments, the defensible claim is architectural integration. A superiority claim requires out-of-sample evidence under declared conditions.

## 17. Evaluation design

### Baselines

- **B0 Hold:** fixed safe allocation, no normal rebalance.
- **B1 Winner:** highest current displayed base supply APR.
- **B2 Post-deposit:** Idle-style capacity-aware optimization.
- **B3 Cost threshold:** B2 plus a conventional predicted-gain-over-cost gate.
- **B4 Robust static:** conservative target without impulse control.
- **B5 Hindsight oracle:** future-aware diagnostic upper bound, never a deployable result.

All baselines use the same market set, safety policy, protocol state, execution delay, costs, rewards, and information available at the decision time.

### Historical test

Use chronological training, validation, and final test periods. At every decision point, reconstruct only contemporaneously available state, predict, optimize, apply execution delay and costs, accrue realized returns, process modeled vault flows, and update share accounting.

### Base-fork replay

Replay representative calm, volatile, congested, and illiquid decisions at pinned Base blocks. Measure transaction success, gas, assets moved, proposed-versus-executed allocation, accounting changes, losses, stale-proposal rejection, and invariant preservation.

### Stress tests

Include utilization spikes, supplier runs, an unavailable market, protocol pauses, oracle or collateral shocks, incentive collapse, gas spikes, governance changes, forecast regime changes, and coordinated vault redemptions.

### Metrics

Economic metrics include realized net APY, user profit, share-price growth, costs, turnover, rebalance and reversal counts, and regret to hindsight.

Safety metrics include policy violations, withdrawal success by time bucket, drawdown, expected shortfall, dependency exposure, unavailable assets, and emergency completion time.

Forecast metrics include quantile coverage, calibration error, prediction error, and regime-change response time.

### Ablations

Remove post-deposit modeling, forecasting, uncertainty calibration, dynamic reserves, stressed liquidity, dependency caps, the no-trade region, reversal penalty, and passive deposit correction one at a time.

## 18. Testable hypotheses

Under identical hard safety constraints and test conditions:

- **H1:** The proposed controller produces higher realized net yield than B0–B4 after all measured costs.
- **H2:** The impulse controller reduces turnover and reversal trades relative to B2–B4.
- **H3:** Dynamic reserves and stressed-liquidity constraints improve withdrawal success under stress.
- **H4:** Exact post-deposit modeling adds more value as portfolio size increases.
- **H5:** Calibrated probabilistic forecasts improve net performance over deterministic current-rate policies without increasing policy violations.
- **H6:** A single size-aware policy remains competitive across all four capital tiers without tier-specific strategy tuning.

Failed hypotheses and negative ablation results remain reportable research outcomes.

## 19. Known limitations and risks

- Forecasts can overfit or fail after structural breaks.
- Conservative uncertainty bounds can retain excessive idle USDC.
- Safety caps can reduce yield and feasible diversification.
- Dependency classifications and thresholds require justified judgment.
- More sophisticated controllers create implementation, audit, and operational risk.
- Safety exits can fail when underlying liquidity disappears.
- Fork replay cannot reproduce every historical off-chain condition.
- ERC-4626 accounting can be vulnerable to stale state, rounding, donation, and manipulation errors.
- Proprietary competitors cannot be reproduced for direct performance comparison.
- Results on Base USDC cannot establish universal superiority on other chains, assets, periods, or risk policies.

## 20. Claim discipline

Before experiments, use:

> We propose a reproducible ERC-4626 lending allocator integrating exact allocation-dependent rates, calibrated uncertainty, hard dependency and liquidity constraints, dynamic reserves, and cost-aware impulse control.

After successful experiments, claims must remain conditional:

> Under the evaluated Base USDC markets, periods, capital tiers, costs, and common safety policy, the controller achieved the reported improvement over the declared reproducible baselines.

Do not claim universal safety, global optimality, or superiority to unreproducible proprietary controllers.

## 21. Research inputs

- `output/rebalance-algorithm-landscape.md`
- `output/lending-rebalance-mathematical-literature.md`
- `raw/DeFAI.md`

The next stage is a systematic novelty review and an implementation/evaluation plan. No production implementation should begin until the written design is reviewed and approved.

## 22. Citation and reference standard

The paper will use IEEE numbered citations in order of first appearance, for example `[1]` and `[2, Sec. IV]`. Every factual statement about a prior algorithm, protocol mechanism, deployment, parameter, or risk must cite the primary source that supports it.

Source priority is:

1. Peer-reviewed original paper or authoritative preprint from the authors.
2. Official protocol specification or technical paper.
3. Verified official source-code repository at a pinned commit or release.
4. Verified deployed contract and governance proposal for chain-specific live parameters.
5. Official protocol documentation with publication/update and access dates.

Secondary articles may help discover sources but do not establish technical claims when a primary source is available.

Reference records must include, where applicable:

- Full author list, paper title, venue, year, volume, issue, pages, and DOI.
- arXiv or SSRN identifier and version date for preprints.
- Protocol or organization as corporate author for official documentation.
- Page or document title, version/update date, URL, and access date.
- Repository owner, repository and file, release/tag, pinned commit hash, URL, and access date.
- Chain, contract name, deployed address, implementation version, block number, and observation date for on-chain evidence.
- Governance proposal identifier, execution transaction, and effective block for mutable parameters.

The literature matrix will record a source's publication type, review status, version, scope, disclosed equations, reproducibility, and limitations. Claims of novelty must cite both the closest academic method and the closest production disclosure.

All tables and figures derived from external data must identify the dataset, observation window, chain, block range, transformation, and reproduction artifact. Direct quotations require page or section locators. Equations adapted from prior work must be labeled as adapted and cited; original extensions must clearly distinguish inherited terms from new terms.

Before submission, references will be exported to a machine-readable bibliography such as BibTeX and checked for duplicate records, broken URLs, missing DOIs, inconsistent author names, and citations absent from the bibliography.
