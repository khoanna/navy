# Mathematical Literature for Direct-Lending USDC Rebalancing

**Research/access date:** 2026-08-01
**Fixed scope:** unleveraged, single-asset USDC on Base; direct supply to Aave V3, Compound III, Moonwell, and explicitly eligible Morpho Blue markets; no curated allocator vaults; maximize realized net yield subject to hard safety constraints.
**Evidence policy:** official protocol documentation/source code and original research papers only. First-party parameters and product claims are not independently validated.

## Research question

At decision time (t), choose direct-market USDC weights (w_t\in\mathbb{R}^n) and transfers (z_t=w_t-w_{t-1}) to maximize realized net yield, while never violating an explicit admissibility and safety policy:

\[
\max_{w_t}\quad \inf_{P\in\mathcal P_t}
\mathbb E_P\!\left[\sum_i w_{i,t}\,R_{i,t:t+H}(w_{i,t})\right]
-C_t(z_t)-\lambda\,\rho_P(w_t)
\]

subject to

\[
\mathbf 1^\top w_t=1,\quad 0\le w_{i,t}\le c_{i,t},\quad
w_{i,t}=0\ \text{if market }i\notin\mathcal E_t,
\]

plus minimum idle/exit liquidity, dependency concentration, and emergency rules. Here $R$ is future base interest plus realizable incentives, $C$ is executable movement/claim cost, $\mathcal P_t$ is an uncertainty set, and $\mathcal E_t$ is the hard eligible-market set. This is a proposed organizing model, not a claim of novelty.

## 1. Exact protocol mechanics and endogenous rates

Let market cash/supply be $S_i$, borrows $B_i$, proposed deposit $x_i$, and utilization $u_i=B_i/S_i$. If borrows do not change during the transaction, the immediate post-deposit utilization is

\[
u_i'(x_i)=\frac{B_i}{S_i+x_i}.
\]

This makes return endogenous to allocation. A displayed supply APR (s_i(u_i)) is not the return on the proposed allocation; the static marginal baseline is (s_i(u_i'(x_i))). For a large move, an implementation must use each protocol's exact integer arithmetic and accrue-interest state transition rather than this approximation.

### Aave V3

Aave's variable borrow curve is piecewise linear around an optimal utilization (u^*); the liquidity/supply rate is borrow rate multiplied by utilization and the share not taken by the reserve factor:

\[
r_b(u)=
\begin{cases}
r_0+\frac{u}{u^*}s_1,&u\le u^*\\
r_0+s_1+\frac{u-u^*}{1-u^*}s_2,&u>u^*
\end{cases},\qquad
r_s(u)=r_b(u)u(1-f).
\]

The exact deployed strategy and reserve configuration—not generic documentation—must be read for Base USDC. Available liquidity is a hard operational state: at very high utilization, nominal aToken value need not be immediately withdrawable in full. The official V3 code exposes reserve state and interest-rate strategy; governance can change risk and rate parameters.

- Primary sources: [Aave V3 technical paper](https://raw.githubusercontent.com/aave/aave-v3-core/master/techpaper/Aave_V3_Technical_Paper.pdf), [current Aave V3 Origin code](https://github.com/aave-dao/aave-v3-origin), [archived DefaultReserveInterestRateStrategy](https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/pool/DefaultReserveInterestRateStrategy.sol), [Base deployment address book](https://github.com/bgd-labs/aave-address-book), [Aave Base USDC rate adjustment example](https://governance.aave.com/t/chaos-labs-risk-stewards-usdc-ir-adjustment-on-aave-v3-base-instance-07-25-25/22688).
- Strength: exact deterministic post-deposit curve is computable on chain.
- Limitation: future borrows/supplies, incentives, governance changes, and withdrawals make a static optimum short-lived.

### Compound III (Comet)

Compound III publishes separate kinked supply and borrow curves. For supply:

\[
r_s(u)=
\begin{cases}
a_s+b_su,&u\le k_s\\
a_s+b_sk_s+c_s(u-k_s),&u>k_s.
\end{cases}
\]

Utilization is `totalBorrow / totalSupply`; interest accrues each second from block timestamps. Unlike Aave/Moonwell, the documented Comet supply curve is directly parameterized rather than derived as (r_bu(1-f)). Therefore a generic “borrow curve times utilization” adapter would be incorrect. Base USDC market parameters must be fetched from the deployed Comet/configurator.

- Primary sources: [Compound III interest rates](https://docs.compound.finance/interest-rates/), [Comet repository](https://github.com/compound-finance/comet), [Base deployments](https://docs.compound.finance/).
- Strength: `getSupplyRate(u)` permits exact counterfactual rate queries.
- Limitation: governance parameters and reward programs can change; protocol cash and pause/withdraw controls must be evaluated separately from rate.

### Moonwell

Moonwell documents a governance-set kink/jump utilization curve. Its Compound-style market model derives supplier return from borrower rate, utilization, and reserves, while WELL incentives are separate and volatile:

\[
r_s(u)=r_b(u)\,u\,(1-f),
\]

with a piecewise borrow curve whose base rate, multiplier, kink and jump multiplier are published per market. A post-deposit evaluator must distinguish base USDC yield from incentive APY and value only claimable, liquid rewards after swap cost/haircut.

- Primary sources: [Moonwell interest-rate curves](https://docs.moonwell.fi/moonwell/protocol-information/interest-rate-curves), [Lend FAQ](https://docs.moonwell.fi/moonwell/moonwell-overview/lend/lend-faq), [Moonwell contracts](https://github.com/moonwell-fi/moonwell-contracts-v2).
- Strength: transparent piecewise market curve and on-chain state.
- Limitation: headline APY may mix base rate and WELL emissions; governance and emissions create structural breaks.

### Morpho Blue direct markets

Each Morpho market is isolated by loan token, collateral token, oracle, IRM and LLTV. For an eligible market with fee (f), supplier rate is approximately

\[
r_s(u,t)=r_b(u,t)u(1-f).
\]

The AdaptiveCurveIRM has target utilization (u^*=0.9), curve steepness 4, and a stateful target rate (r^*(t)). Utilization moves the instantaneous curve while persistent deviation makes (r^*(t)) drift up or down. Thus the post-deposit rate is path-dependent: a deposit lowers utilization immediately and, if low utilization persists, pushes the future curve downward. A static kink model cannot reproduce this.

- Primary sources: [Morpho IRM technical reference](https://docs.morpho.org/get-started/resources/contracts/irm/), [interest-rate concepts](https://docs.morpho.org/learn/concepts/irm/), [Morpho Blue repository](https://github.com/morpho-org/morpho-blue), [IRM repository](https://github.com/morpho-org/morpho-blue-irm), [Morpho risk disclosures](https://docs.morpho.org/learn/resources/risks/).
- Strength: immutable market tuple and open stateful rate mechanism allow exact simulation.
- Limitation: permissionless market creation makes eligibility central. Oracle, collateral, LLTV, liquidation liquidity and shared dependencies vary by market even though the supplied asset is always USDC.

## 2. Realized-yield objective and reproducible baselines

For horizon (H), define realized net return:

\[
Y_{t,H}=\sum_i\int_t^{t+H} w_i(\tau)r_{s,i}(\tau)d\tau
+I_{t,H}^{\text{realized}}-G_{t,H}-S_{t,H}-L_{t,H},
\]

where incentives (I) are counted only when claimable and conservatively converted to USDC; (G) is gas; (S) is swap/price impact; and (L) is realized loss or unavailable capital under the declared withdrawal policy. This avoids using displayed APY as the dependent variable.

Minimum reproducible baselines:

| ID | Policy | Purpose / limitation |
|---|---|---|
| **B0 Hold** | Never rebalance after initial equal or fixed safe allocation | Measures whether any controller earns enough to justify complexity. |
| **B1 Winner** | Allocate to highest current displayed base APR | Naive rate-chasing lower benchmark. |
| **B2 Post-deposit** | Solve `max Σ x_i s_i(u_i'(x_i))`, subject to simplex | Idle-style capacity-aware benchmark; myopic and gross-return only. [Idle objective](https://docs.idle.finance/products/best-yield/overview) |
| **B3 Cost threshold** | Apply B2 target only if horizon-(H) predicted gain exceeds executable transfer cost | Tests whether uncertainty/risk additions beat a conventional net-gain gate. |
| **B4 Constrained robust-static** | Worst-case/quantile return over a rolling uncertainty set, with fixed caps and liquidity floor | Separates robust forecast value from online/adaptive control value. |
| **B5 Oracle** | Hindsight optimal under identical costs/constraints | Upper diagnostic only; must never be reported as deployable performance. |

All baselines must use the same block-level states, exact protocol adapters, reward prices/haircuts, gas quotes, eligibility set, execution delay, and withdrawal stress.

## 3. Forecast uncertainty and robust optimization

### Deterministic robust counterpart

If horizon return vector is only known to lie in set (mathcal U_t), choose

\[
\max_{w\in\mathcal W_t}\min_{r\in\mathcal U_t}w^Tr-C(w-w_{t-1}).
\]

Box uncertainty is tractable but overly conservative and ignores co-movement. Ellipsoidal/factor sets can represent common Base demand, USDC incentive, or protocol-shared shocks but depend on stable covariance/factor estimates.

### Wasserstein distributionally robust optimization

Esfahani and Kuhn optimize worst-case expectation over distributions in a Wasserstein ball around empirical samples:

\[
\sup_{w\in\mathcal W}\inf_{P:W(P,\hat P_N)\le\varepsilon}
\mathbb E_P[U(w,R)].
\]

They give finite-dimensional convex reformulations and finite-sample guarantees under stated assumptions. Cost-sensitive DRO portfolio work incorporates general convex transaction costs. These are strong mathematical templates, but neither models DeFi's endogenous post-deposit rates, stateful Morpho curve, permission changes, or censored withdrawal liquidity.

- [Data-driven DRO using Wasserstein distance](https://arxiv.org/abs/1505.05116)
- [Cost-sensitive distributionally robust log-optimal portfolio](https://arxiv.org/abs/2410.23536)
- Pros: explicit ambiguity, tractability, uncertainty-aware lower bound.
- Cons: radius calibration can dominate results; historical samples may omit exploits/depegs; log-utility is not the stated “net yield under hard safety” objective; returns depend on the action through utilization.
- Reproducibility: equations are public; exact experiments require author data/code where available plus a new DeFi adapter.

## 4. Transaction costs, no-trade regions, and hysteresis

A deterministic net-gain trigger is

\[
\text{rebalance iff}\quad
\widehat{\Delta Y}_{t,H}>C_t(z)+m_t,
\]

where (m_t) is a safety margin. Under uncertainty, a more defensible gate is

\[
Q_{\alpha}(\Delta Y_{t,H})>C_t(z)+m_t,
\]

or a lower confidence bound. This naturally creates a no-trade region. Explicit cooldown, minimum residence time, and reversal penalty can prevent oscillation, but they must not block safety exits.

Bandits with movement costs formalize action-dependent switching cost; nonstationary bandit work supplies dynamic-regret comparators, sliding windows, restart/change detection, and parameter-free adaptation:

- [Bandits with Movement Costs and Adaptive Pricing](https://proceedings.mlr.press/v65/koren17a.html): metric movement cost generalizes unit switching cost.
- [Learning to Optimize under Non-Stationarity](https://proceedings.mlr.press/v89/cheung19b.html): Sliding-Window UCB and bandit-over-bandit for time-varying linear rewards.
- [Efficient Contextual Bandits in Non-stationary Worlds](https://proceedings.mlr.press/v75/luo18a.html): interval, switching, and dynamic regret with change tests.
- [Piecewise Stationary Bandits under Risk Criteria](https://proceedings.mlr.press/v206/bhatt23b.html): heavy-tailed rewards, nonparametric change detection, and risk criteria.

Classical/multiperiod portfolio work gives a closer formal foundation for hysteresis than a hand-built threshold. DeMiguel, Mei and Nogales derive a multidimensional no-trade region under proportional transaction costs: remain at the current portfolio inside the region; outside it, solve a quadratic program and trade to the boundary rather than necessarily to the frictionless target. Their market-impact extension makes the region state-dependent. Leland likewise analyzes asymmetric buy/sell costs and nearest-boundary trading. These results motivate a lending policy with asymmetric entry/exit cost and boundary trading, but fixed gas, temporary non-withdrawable capital, and discontinuous safety exits require a new adaptation.

- [Multiperiod Portfolio Optimization with General Transaction Costs](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2295345)
- [Optimal Portfolio Management with Transaction Costs](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=206871)

Online convex optimization (OCO) may align better than bandits. Senapati and Vaze study online losses with movement costs and delayed gradients; Zhao et al. study dynamic regret under comparator path length and environmental variation. Mapping weights to decisions and realized negative yield to online loss gives a principled changing-rate comparator, although kinked rates, incentives, fixed gas and changing eligibility can violate convex/smooth assumptions.

- [OCO with Switching Cost and Delayed Gradients](https://arxiv.org/abs/2310.11880)
- [Adaptivity and Non-stationarity in Online Learning](https://arxiv.org/abs/2112.14368)

Transfer limits: direct lending exposes rates for every market on chain, so this is closer to **full-information online optimization** than a classic bandit. Allocations also change the reward curve, safety constraints change over time, transaction costs are asymmetric, and emergency exits cannot obey an exploration policy. OCO with switching costs is the closer formal baseline; a bandit controller is at most a candidate forecast/exploration component.

## 5. Exit-liquidity stress as a hard constraint

Immediate accounting liquidity is approximately (A_i=S_i-B_i), but safe withdrawable amount must use exact protocol state and controls. Define stress demand (q\) and stressed available liquidity (A_i^{(s)}). A simple hard constraint is

\[
\sum_i\min(w_iV,A_i^{(s)})+V_{idle}\ge qV
\quad\forall s\in\mathcal S,
\]

or require an ordered unwind to satisfy time-bucket demands (q_{24h},q_{7d}). Scenarios should include borrower utilization jumps, supplier runs, frozen/paused markets, oracle incidents, gas spikes, and zero liquidity in one protocol. Treating high utilization merely as a smooth yield penalty is insufficient because withdrawal feasibility is discontinuous.

Protocol-specific observations:

- Aave/Moonwell pooled markets: available underlying cash bounds immediate withdrawals; rate spikes incentivize repayment/supply but do not guarantee either.
- Compound III: base-asset liquidity and protocol pause/withdraw controls must be checked directly.
- Morpho: liquidity is isolated per market; high target utilization is intentional, and collateral is not rehypothecated, but a supplier still needs borrower repayment/new supply/liquidation flow to exit an illiquid market.

No primary source found in this pass publishes a complete direct-lending allocator that places multi-market stressed withdrawal success inside its optimization. Establishing absence requires a broader systematic review.

## 6. Correlated dependency constraints

Market count is not diversification. Define binary/exposure matrix (D_{ig}) for dependency group (g): protocol implementation, admin/governance, oracle provider/feed, collateral asset, liquidation venue, USDC itself, sequencer/Base, incentive token, and keeper/data path. Enforce

\[
\sum_i D_{ig}w_i\le C_g\quad\forall g.
\]

For Morpho, multiple markets can share an oracle, collateral family or liquidation venue while appearing separate. For Aave, Compound and Moonwell, all USDC allocation shares Base and USDC failure modes, so those risks cannot be diversified within scope; they require explicit acceptance/emergency policy rather than a misleading cap.

This is a transparent hard-constraint representation, not a validated probability model. Research must define dependency taxonomy, justify caps, version changes, and test whether binary groups miss severity or nonlinear contagion. No reviewed allocator or paper supplies a complete, empirically validated dependency graph for this exact universe.

## 7. Novelty-overlap matrix

Legend: **E** explicit method/equation; **P** partial/qualitative; **—** not addressed in the cited source.

| Candidate component | Idle | Protocol IRMs | Leveraged-lending paper | Wasserstein DRO | Movement-cost / nonstationary learning | Disclosed DeFAI allocators | Exact-scope gap still to establish |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Post-deposit endogenous supply rate | E | E | E | — | — | P | Joint exact adapter for four direct Base venues is engineering overlap, not necessarily novelty. |
| Stateful Morpho rate response | — | E | E | — | — | — | Need establish whether any unleveraged allocator forecasts adaptive-IRM path response. |
| Realized reward/gas/slippage accounting | P | P | fees P | transaction cost E | movement cost E | P | Exact realized-USDC measurement and reward stopping may be a contribution, but literature is broad. |
| Return uncertainty set / worst-case objective | — | — | — | E | confidence/regret E | “risk-adjusted” P | Need review DeFi-specific robust yield allocation and endogenous-return DRO. |
| Net-gain no-trade region | P | — | frequency P | costs E | switching costs E | P | Combining lower-confidence gain with asymmetric on-chain cost may overlap control/portfolio literature. |
| Hysteresis / reversal penalty / safety override | — | — | — | — | switches P | — | Must search impulse-control and transaction-cost portfolio literature more deeply. |
| Stressed withdrawal-feasibility constraint | partial mechanics | liquidity state | — | generic constraints | — | liquidity P | Exact multi-market time-bucket unwind constraint appears open in reviewed set; absence not proven. |
| Dependency-graph hard caps | — | market parameters P | — | generic constraints | — | concentration P | Need systematic smart-contract/systemic-risk literature review and empirical validation. |
| Nonstationary online adaptation | off-chain recompute P | Morpho IRM E | cadence tests P | rolling ambiguity possible | OCO/bandit E | continuous monitoring P | Full-information, action-dependent rate control with changing safety constraints needs overlap search. |
| Replayable decisions and common benchmarks | — | source E | equations E | equations E | equations E | mostly — | A reproducibility protocol/dataset may be valuable even without a novel optimizer. |

## 8. Candidate synthesis—without a novelty claim

The evidence supports evaluating a **Safe Robust Cost-aware Lending Allocator** with four layers:

1. **Eligibility:** deterministic allowlist and hard market/protocol/oracle/collateral/dependency constraints.
2. **Exact state transition:** protocol-specific post-deposit rate and immediate-liquidity adapters, including Morpho's stateful IRM.
3. **Robust target:** lower-confidence or distributionally robust horizon net yield, constrained by stressed unwind feasibility.
4. **Impulse controller:** rebalance only when robust incremental gain clears executable cost, hysteresis and reversal margin; safety exits bypass economic cooldown.

Every component has antecedents in protocol code, robust portfolio optimization, transaction-cost control, or online learning. The potential research contribution would be the **specific integration and empirical validation for endogenous, nonstationary direct-lending markets**, not any component in isolation.

## 9. What the literature review must still establish

Before claiming novelty, a systematic review should:

1. search journal/conference databases beyond arXiv for DeFi lending allocation, stochastic/robust portfolio control with endogenous returns, liquidity runs, and impulse control;
2. review production and archived code for Idle, Yearn debt allocators, Instadapp/Fluid, Enzyme, CIAN and institutional treasury allocators, while retaining only direct-market comparable logic;
3. search governance forums and keeper repositories for unpublished-but-public threshold rules;
4. identify whether robust/DRO models with decision-dependent distributions already cover this mathematical structure;
5. extend the classical proportional/fixed-transaction-cost portfolio and impulse-control review beyond the two working papers cited here;
6. review systemic-risk/network models for shared oracle, collateral and governance dependencies;
7. verify exact Base deployments, USDC token variant, live addresses, IRM parameters, reserve factors, incentives, pause states and eligible Morpho tuples at the backtest start of each sample;
8. publish protocol adapters, block/event dataset, configs, transaction-cost model, stress scenarios, seeds, and all baseline code;
9. predefine out-of-sample metrics: realized net APY, turnover, worst drawdown, CVaR/expected shortfall, withdrawal success by time bucket, constraint violations, and regret to hindsight oracle;
10. use ablations to distinguish value from post-deposit rates, uncertainty, dependency caps, exit stress, and hysteresis separately.

## 10. Bounded conclusions

- Exact current/post-deposit rates are disclosed and reproducible for the four protocol families, but future rates are endogenous and nonstationary.
- Idle supplies the closest public live allocation baseline; it does not publicly integrate the complete fixed-scope uncertainty, safety, cost and exit problem.
- Robust optimization, no-trade regions, movement costs, and nonstationary learning are established research areas. Applying them to DeFi is not inherently novel.
- The least-covered seam in this pass is the joint formulation of decision-dependent lending returns, robust net-gain impulse control, stressed withdrawal feasibility, and dependency hard constraints with replayable direct-market execution.
- This is a research gap hypothesis, not proof of novelty or superiority.
