# Safe, Robust, Cost-Aware Lending Allocation for ERC-4626 Vaults

**Research report version:** 0.4

**Date:** 2026-08-02

**Release scope:** Base-native research release specification

**Empirical status:** The architecture, source review, market registry, and evaluation protocol are specified. Historical outperformance and production readiness have not yet been demonstrated.

## Abstract

A lending vault should not allocate all capital to the market displaying the highest annual percentage yield (APY). A sufficiently large deposit changes utilization and the attainable supply rate; accounting assets may not be synchronously withdrawable; and gas, slippage, reward conversion, and rate reversal can eliminate an apparent yield advantage. This report specifies the Safe, Robust, Cost-Aware Lending Allocator (SRCLA), a deterministic controller for one pooled, unleveraged ERC-4626 vault over Circle native USDC on Base. Release one allocates through vault-bound adapters to Aave V3, Compound III, and Moonwell. An immutable on-chain layer enforces market admission, market and dependency caps, idle reserve, loss and slippage bounds, decision expiry, pause behavior, and bounded emergency exits. A separately deployable TypeScript service observes finalized Base state, simulates protocol-exact post-deposit rates, calibrates deterministic lower prediction bounds without look-ahead, solves a constrained allocation problem, and submits staged rebalances only when conservative benefit exceeds full cost. Base interest remains inside protocol positions; separately accrued incentives are conservatively recognized and converted through an immutable, Uniswap-V3-only reward executor when an event-driven cost gate passes. A registered B0–B5 evaluation, H1–H5 ablations, cohort accounting, stress tests, and pinned Base-fork replays form two release gates: forecast calibration and statistically distinguishable after-cost policy outperformance. This paper specifies a falsifiable architecture and evaluation procedure; it does not claim completed performance results.

**Keywords:** DeFi, ERC-4626, Base, USDC, lending allocation, yield farming, deterministic forecasting, robust optimization, liquidity risk, transaction costs.

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
- a registered evaluation whose negative or statistically indistinguishable result fails the release gate and remains part of the research record.

## 2. Scope, Claims, and Release Boundary

### 2.1 Locked release-one scope

The sole user-facing and accounting asset is Circle native Base USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` [46]. Bridged USDbC and test assets are forbidden. The chain is Base, chain ID 8453. Protocol receipt tokens and incentive tokens remain within vault-bound strategy or reward contracts.

Users interact with one ERC-4626 vault and receive fungible vault shares. Entry uses USDC approval followed by `deposit` or `mint`. Exit uses synchronous `withdraw` or `redeem`. Farming has no backend relayer, EIP-3009 deposit flow, sponsored gas, or relayed redemption. ERC-20 Permit on vault shares may remain available for composability, but the system does not relay it.

Release one includes exactly:

- Aave V3 Base USDC;
- Compound III Base USDC Comet; and
- Moonwell Base mUSDC.

The allocation and dependency model is generic so a later protocol can be added through a new immutable adapter and a new registered evaluation. No future protocol is silently included in release-one evidence.

### 2.2 Research claim and falsification

The paper makes a design-completeness claim: the disclosed policy combines capacity-aware rates, uncertainty treatment, dependency limits, withdrawal feasibility, and complete movement costs in one reproducible pipeline. It does not yet make an outperformance claim.

The research proposition is rejected for release if any of the following occurs:

- the policy violates a declared safety constraint;
- deterministic forecasts fail their registered calibration requirements;
- SRCLA is statistically indistinguishable from a simpler deployable baseline after equal costs, information, and delays;
- a required tier, regime, baseline, ablation, or fork result is missing;
- the evaluation cannot reproduce its manifest and result hashes; or
- the result depends on tuning against held-out observations.

### 2.3 Research core and production-hardening path

The research release permits one external admin/guardian wallet, one allocator key in the SRCLA service environment, one archive-capable Base RPC, and locally forked Anvil tests. These choices simplify reproducibility; they are not production security claims.

Material-fund deployment additionally requires independent audits, an admin multisignature and timelock, a separately empowered guardian, hardware-backed allocator signing and rotation, redundant independent RPC providers, conservative canary caps, continuous monitoring, incident runbooks, configuration review, and a public bug bounty. These controls belong to a clearly separated production-hardening path.

## 3. Related Work and the Design Gap

### 3.1 Existing contributions

**Idle Best Yield** is the closest disclosed direct-allocation precedent. It evaluates an integration's rate after the proposed allocation rather than ranking only current displayed rates [1], [18], [19]. Public material does not disclose a complete live uncertainty model, stressed reserve, shared-dependency policy, full movement threshold, cooldown, or keeper configuration.

**Yearn V3** supplies mature ERC-4626 machinery including strategy debt, minimum idle assets, loss handling, role separation, withdrawals, and shutdown [9]. It deliberately leaves target allocation to a debt manager or external allocator. **Morpho Blue**, MetaMorpho, and the Public Allocator expose isolated market mechanics, explicit market state, caps, queues, timelocks, and bounded reallocations [10], [20], [21], [40], [41]. **Euler Earn** similarly exposes curator, allocator, reserve, cap, queue, and loss controls [11], [22]. These systems provide important enforcement precedents but not one canonical portfolio objective.

**Yield Seeker**, **ZyfAI**, and **Mamo** discuss adjusted APY, transaction cost, liquidity, incentives, break-even economics, and meaningful rate differences [12]–[14], [23]–[31]. **Giza** makes operational lifecycle states explicit [15], [32]. **Surf Liquid** separates predictive planning from deterministic enforcement [16]. **Almanak** provides simulation and operational tooling for strategy-defined policies [17], [33], [34]. Their disclosures motivate SRCLA but do not expose one reconstructable production rule with all thresholds and live parameters.

Research on distributionally robust optimization, multiperiod allocation, switching costs, and non-stationarity supports the use of conservative objectives and no-trade regions [3]–[6]. Leveraged multi-market allocation [2] is outside the unleveraged release scope, while AgileRate and reinforcement-learning work optimize protocol rate setting rather than depositor allocation [7], [8]. Time-series cross-validation and prediction-bound literature supports rolling-origin evaluation and explicit distinction between estimating a conditional mean and bounding a future outcome [53], [54].

### 3.2 Gap statement

The review does not prove that a private deployed controller lacks a capability. It shows that an external reader cannot reconstruct one disclosed, direct, unleveraged Base-USDC controller simultaneously specifying:

| Required property | Failure prevented |
|---|---|
| Post-deposit rate model | A large allocation erasing its displayed yield |
| Deterministic lower prediction bound | A transient or unstable rate dominating the target |
| Market and shared-dependency caps | Nominal diversification preserving common-mode exposure |
| Dynamic reserve and withdrawal stress | Positive NAV but unsuccessful synchronous exits |
| Complete cost and turnover gate | Churn destroying gross yield improvements |
| Bounded on-chain execution | A forecast or key bypassing the safety policy |
| Registered evaluation | Post-hoc tuning or irreproducible superiority claims |

SRCLA is useful only if this combined policy produces statistically distinguishable after-cost value while preserving its safety envelope. Section 11 specifies the rejecting tests.

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

Its effective exposure limit is the minimum of these applicable bounds. Dependency groups are opaque administrator-configured identifiers rather than hard-coded protocol categories. They may represent common governance, oracle, liquidation venue, reward router, or controller risk. Base and native USDC are accepted common-mode dependencies for this single-chain study and therefore receive 100% limits rather than being presented as diversification.

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

The planning input is a lower prediction bound for the next outcome, not a confidence interval around an estimated mean. If $\widehat\mu_{i,t,H}(x)$ is a deterministic point forecast and $q_{\alpha,t}$ is a calibrated lower quantile of completed horizon residuals, then:

$$
\ell_{i,t,H}(x)=\widehat\mu_{i,t,H}(x)+q_{\alpha,t},
\qquad q_{\alpha,t}\le 0.
$$

This empirical residual form avoids assuming that a normal standard-deviation multiplier correctly represents non-stationary lending returns. Every quantile rule, tie, minimum sample, and missing-data behavior is fixed before held-out evaluation.

### 7.2 Registered candidate methods

Calibration compares exactly three established deterministic candidates:

1. a rolling distribution of historical realized horizon returns;
2. an exponentially weighted level forecast with a lower quantile of walk-forward horizon residuals; and
3. a fixed-specification direct-horizon autoregressive model with exogenous features (ARX).

The registered grid also compares horizons of 1, 7, and 14 days and lower-bound coverage targets of 90%, 95%, and 99%. The selected method, horizon, coverage, features, window or decay, residual treatment, minimum observations, and lexical tie-break are frozen from the calibration era before held-out evaluation.

### 7.3 No-look-ahead and calibration gate

Only an outcome whose horizon has fully ended and whose availability lag has passed may train a forecast at origin $t$. Random train/test splitting, full-history normalization, post-held-out retuning, and contamination across configuration regimes are forbidden. Overlapping horizons may be used for prediction, but formal coverage evaluation also reports a non-overlapping or dependence-aware stream [55].

Candidate selection uses a published loss function covering point error, lower-bound coverage, exceedance shortfall, sharpness, downside outcomes, turnover, and sacrificed return. Coverage is reported per market and again for the portfolio produced after optimizer selection, because selecting among noisy forecasts can amplify optimistic errors. Calibration coverage and independence diagnostics are release gates, not descriptive charts. The selected parameter artifact and its content hash are immutable for held-out evaluation. A newly admitted or materially changed market remains at zero deployable weight until it has enough post-change completed labels.

## 8. Reserve, Stress, and Allocation Optimization

### 8.1 Dynamic idle reserve

Let $I^{\mathrm{floor}}$ be the administrator's non-bypassable idle floor, $Q_\beta(W_H)$ a registered withdrawal-demand quantile, $D_s$ withdrawal demand in stress scenario $s$, and $E_s(x)=\sum_i\min(x_i,e_{i,s})$ the stressed exit value of candidate positions $x$. The candidate-dependent required idle amount is:

$$
I_t^{\mathrm{required}}(x)=
\max\left(I^{\mathrm{floor}},Q_\beta(W_H),\max_s\{D_s-E_s(x)\}\right).
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
w^*=\arg\max_w \sum_i w_i\,\ell_{i,t,H}(w_iV_t),
$$

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

## 9. Movement, Rewards, and On-Chain Execution

### 9.1 Complete-cost movement rule

New deposits and existing idle USDC reduce target drift before SRCLA exits a strategy. Existing capital moves only if conservative horizon gain $G_H$ exceeds the complete movement cost:

$$
C_{\mathrm{move}}=
C_{\mathrm{L2}}+C_{\mathrm{L1data}}+C_{\mathrm{exit}}+C_{\mathrm{entry}}
+C_{\mathrm{claim}}+C_{\mathrm{approve/reset}}+C_{\mathrm{swap}}
+C_{\mathrm{impact}}+C_{\mathrm{slippage/MEV}}+C_{\mathrm{failure}}+C_{\mathrm{buffer}}.
$$

The economic action rule is:

$$
G_H>C_{\mathrm{move}}.
$$

Base costs include both L2 execution and L1 data availability [47]. Cooldown, minimum turnover, maximum turnover, and reversal allowances prevent repeated small moves. A market that becomes ineligible invokes a bounded safety unwind and bypasses the economic gate.

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
| B2 | Use post-deposit capacity curves without uncertainty treatment. |
| B3 | Add a movement-cost threshold to B2 but omit the full dynamic-reserve and dependency policy. |
| B4 | Use one frozen robust allocation over the eligible market set. |
| B5 | Use bounded hindsight as a non-deployable diagnostic upper bound. |

B5 cannot establish deployability and is excluded from the deployable outperformance comparison.

### 11.3 Component hypotheses

- **H1—capacity:** Post-deposit simulation improves after-cost return or reduces allocation regret relative to B1, especially at larger tiers.
- **H2—uncertainty:** Calibrated lower bounds reduce reversals and downside outcomes relative to B2 without an unacceptable return penalty.
- **H3—cost control:** The complete movement gate reduces turnover and execution cost relative to immediately following every target.
- **H4—liquidity:** Dynamic reserve and scenario feasibility improve stressed synchronous-withdrawal success relative to a fixed reserve.
- **H5—dependency:** Shared-dependency caps prevent common-mode limit breaches left by protocol-only diversification.

Each hypothesis removes only its named component while holding other information, delays, costs, and rules fixed.

### 11.4 Metrics and fork evidence

Forecast metrics include bias, mean absolute error, root mean squared error, mean absolute scaled error, pinball loss, lower-bound coverage, exception independence, exceedance shortfall, and sharpness. Controller metrics include realized net APY, share-price growth, cohort profit, Base L2 and L1 data fees, swap costs, turnover, reversals, drawdown, expected shortfall, withdrawal success, stressed liquid coverage, unavailable assets, dependency concentration, and policy violations.

Pinned Base-fork jobs validate exact adapter math, transaction success, gas, L1 data fee, swap output, protocol rounding, and balance deltas. Historical ETH/USD and USDC/USD oracle rounds convert transaction cost consistently. DEX price impact already embedded in executed output is not subtracted twice.

### 11.5 Two mandatory release gates

The forecast gate fails on inadequate lower-bound calibration, incomplete labels, regime contamination, look-ahead, missing candidate results, or non-reproducible artifacts.

The policy gate fails on any safety violation, missing tier/regime/baseline/ablation/fork result, incomplete cost, manifest mismatch, irreproducible result hash, or statistically indistinguishable after-cost performance from simpler deployable baselines. A negative result is published as `FAIL`; it is not removed or retuned against held-out data.

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

SRCLA may underperform a simpler policy. Lower prediction bounds can reject profitable opportunities; reserves impose cash drag; dependency caps encode judgment; and protocol-exact adapters increase implementation and monitoring cost. A deterministic method is auditable but not automatically accurate. Historical Base behavior may not represent future regimes, and a three-market universe limits diversification.

Residual risks include contract exploits, proxy or governance changes, oracle failure, Circle USDC depeg or freeze risk, protocol liquidity disappearance, public-mempool MEV, allocator censorship, Base sequencer disruption, RPC corruption, and correlated infrastructure. The initial design accepts Base and Circle USDC as common-mode risks rather than claiming to diversify them away.

Fork replay improves execution realism but cannot reproduce all historical mempool competition or off-chain operational failures. Empirical coverage does not guarantee future lower-bound coverage under distribution shift [56]. Statistical significance also does not prove economic materiality; the report must publish effect sizes, costs, and safety outcomes together.

The architecture is a research-reproducible core with a production-hardening path, not audited production software. No user-fund deployment should infer safety from the paper or passing prototype tests alone.

## 14. Conclusion

SRCLA turns “move USDC to the best yield” into an explicit and bounded process. It admits only verified markets, simulates the rate after the vault's allocation, calibrates a deterministic lower prediction bound, chooses a stress-feasible portfolio under market and dependency caps, preserves a dynamic idle reserve, and moves capital only when conservative gain exceeds complete cost. Immutable contracts enforce the safety envelope; replaceable adapters isolate protocol mechanics; and an auditable off-chain service performs forecasting, optimization, staged execution, and recovery.

Base interest remains part of strategy value without harvesting. Separate incentive tokens are recognized conservatively and converted through approved Uniswap V3 routes only when an event-driven economic and safety gate passes. Users retain standard synchronous ERC-4626 entry and exit and pay their own gas.

The architecture is intentionally falsifiable. Forecast calibration and after-cost policy outperformance are mandatory release gates. Until those registered evaluations pass—and the distinct production-hardening controls are completed—the correct conclusion is that SRCLA is a specified research system, not a demonstrated superior or production-ready investment product.

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
| Forecast candidates | Rolling horizon distribution; exponentially weighted residual model; fixed direct-horizon ARX |
| Forecast horizons | 1, 7, and 14 days |
| Lower-bound coverage candidates | 90%, 95%, and 99% |
| Market cold start | Ineligible until sufficient post-regime completed history |
| Reserve | Maximum of admin floor, withdrawal quantile, and stress shortfall |
| Reward execution | Event-driven; Uniswap V3 only; no fixed weekly harvest |
| Rebalance | Staged, expiring, ordered actions with complete-cost and turnover gate |
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

The evaluation command may produce `PASS` or `FAIL`. Successful reproducibility is distinct from a passing outperformance gate.
