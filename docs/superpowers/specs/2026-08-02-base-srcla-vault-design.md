# Base-Native SRCLA Vault and Allocator Design

**Date:** 2026-08-02

**Status:** Approved design, pending written-spec review

**Research authority:** [`docs/research/output/srcla-paper.md`](../../research/output/srcla-paper.md)

**Supersedes for farming:** [`2026-07-28-navy-vault-rebalancing-farming-design.md`](2026-07-28-navy-vault-rebalancing-farming-design.md)

## 1. Purpose

Redesign Navy farming as a Base-native implementation of the Safe, Robust, Cost-Aware Lending Allocator (SRCLA). The result must serve two purposes without mixing their claims:

1. A reproducible research system that implements and evaluates the paper's controller.
2. A production-oriented architecture with an explicit hardening path before real-fund release.

The initial universe is one pooled, unleveraged ERC-4626 vault over Circle native USDC on Base, allocated directly to:

- Aave V3 Base USDC;
- Compound III Base USDC Comet; and
- Moonwell Base mUSDC.

Morpho, leverage, derivatives, bridges, ERC-7540 asynchronous withdrawals, and arbitrary external strategies are excluded from release one.

The release gate is the paper's registered evaluation. If SRCLA does not outperform the specified baselines after equal costs, delays, information, and safety constraints, the implementation does not advance to production. A negative result remains part of the research record and must not be tuned away using held-out data.

## 2. Locked product decisions

### 2.1 Chain and asset

- Chain: Base, chain ID `8453`.
- Sole user-facing and accounting asset: Circle native Base USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Bridged USDbC and protocol-specific mock USDC assets are forbidden.
- Protocol receipt tokens and internal shares remain inside their strategy adapters.

### 2.2 User custody and transactions

- Users interact with one pooled ERC-4626 vault and receive fungible Navy vault shares.
- Users pay their own gas.
- Entry uses standard USDC approval followed by ERC-4626 `deposit` or `mint`.
- Exit uses standard synchronous ERC-4626 `withdraw` or `redeem`.
- Farming has no backend relayer, EIP-3009 deposit path, or relayed permit-redemption path.
- ERC-20 Permit remains available on vault shares for general composability, but Navy does not relay it.

### 2.3 Upgrade boundary

- The ERC-4626 vault/accounting core is immutable and not proxy-upgradeable.
- Protocol adapters are replaceable by deploying new immutable adapter instances and admitting them through admin configuration.
- The reward executor is immutable and uses an admin-managed registry of approved Uniswap V3 route identities.
- The off-chain allocator is ordinary versioned software and can be upgraded through deployment, with every active policy version persisted and auditable.

### 2.4 Keys and authority

- One external admin wallet controls administration and guardian functions.
- Its private key is referenced only by an uncommitted `contract/.env` for Foundry deployment and administration scripts. It is never embedded in Solidity, scripts, or Git history.
- One allocator private key lives in `/srcla` runtime environment configuration.
- No runtime service stores the admin key.
- Production replaces the external admin EOA with multisig plus timelock and moves allocator signing to hardware-backed custody.

## 3. System architecture

```text
User wallet
  │ approve/deposit/mint/withdraw/redeem; user pays Base gas
  ▼
Immutable NavyVault (ERC-4626 over native USDC)
  │
  ├── AaveV3Strategy ───── holds aUSDC and claimed Aave incentives
  ├── CompoundV3Strategy ─ holds positive Comet balance and claimed COMP
  └── MoonwellStrategy ─── holds mUSDC and claimed Moonwell rewards
          │
          └── immutable RewardExecutor ── approved Uniswap V3 routes ──► USDC to NavyVault

Standalone /srcla TypeScript worker
  ├── finalized Base snapshot collector
  ├── market admission engine
  ├── protocol-exact rate and liquidity simulators
  ├── deterministic forecast/calibration engine
  ├── constrained allocation and reserve optimizer
  ├── cost/emergency decision engine
  ├── staged on-chain executor and reconciler
  ├── owned PostgreSQL database
  └── read-only strategy-history API

Existing /be
  ├── reads user shares/positions directly from Base
  └── reads strategy/decision history through /srcla HTTP API
```

The allocator proposes and executes within a deterministic envelope. It never owns user funds, protocol receipt tokens, reward tokens, or swap proceeds.

## 4. On-chain contracts

### 4.1 `NavyVault`

`NavyVault` is an immutable OpenZeppelin-based ERC-4626 and ERC-20 Permit vault over Circle native Base USDC.

Its accounting identity is:

```text
totalAssets = idle native USDC
            + recognized USDC value of strategy positions
            + conservatively recognized eligible incentive rewards
            - recognized losses
```

Accounting value and synchronous liquidity are separate. `totalAssets`, conversion functions, and previews value the pooled claim. `maxWithdraw` and `maxRedeem` are capped by native USDC that can conservatively execute in the same transaction.

The vault must not silently treat a failing adapter read as zero during share issuance. If a required position or reward valuation cannot be refreshed safely, deposits and mints close until the state is resolved. Withdrawals and redemptions remain available up to conservative immediately serviceable liquidity.

### 4.2 Roles

The vault exposes two logical authorities:

| Authority | Permitted actions | Forbidden actions |
|---|---|---|
| Admin/guardian | Admit and configure adapters, dependency groups, caps, reserve floor, loss limits, reward routes, oracle policies, impairment, pause, and allocator rotation | Direct arbitrary fund transfer; bypass ERC-4626 ownership |
| Allocator | Register bounded plans; divest, deploy, harvest, and perform adapter-to-vault emergency exits under live checks | Add/configure adapters; lower admin limits; select arbitrary targets/recipients/calldata; transfer assets to itself |

### 4.3 Adapter registry and lifecycle

Every adapter has one of four states:

- `Active`: may receive new capital and be divested.
- `Disabled`: receives no new capital; stays in NAV and may be divested or emergency-exited.
- `Impaired`: receives no new capital; admin has recorded a conservative value cap or recognized loss; recovery remains possible.
- `Removed`: allowed only after its accounted position reaches zero. Historical records remain in events and SRCLA storage.

Forced disappearance from NAV is prohibited. Unrecoverable value becomes an explicit recognized loss with an event and decision record.

### 4.4 Hard exposure constraints

Each adapter has:

- a maximum share of vault NAV in basis points;
- a maximum absolute USDC exposure;
- membership in zero or more generic dependency groups; and
- an adapter-specific maximum withdrawal-loss bound when stricter than the vault default.

The effective adapter limit is the lower of percentage, absolute, external protocol headroom, and live admission capacity.

Dependency groups are opaque IDs configured by the admin rather than hard-coded protocol enums. Examples include protocol governance, oracle, liquidation venue, reward router, and shared controller. Each group has a maximum exposure. This supports future protocols without redeploying the vault.

Base and Circle native USDC remain accepted common-mode dependencies for this single-chain, single-asset study and therefore carry 100% policy limits rather than being misrepresented as diversified.

### 4.5 Idle reserve

The admin configures a non-bypassable minimum idle floor. SRCLA computes a higher plan reserve when required by withdrawal quantiles or stress scenarios.

```text
requiredIdle = max(adminFloor, activePlanDynamicReserve)
```

The last activated dynamic reserve persists after a plan's execution deadline; expiry prevents further actions but does not silently lower the reserve. A later valid plan may update it, never below the admin floor.

### 4.6 Staged allocation plans

Allocation is deliberately staged rather than atomic across all venues.

An allocator plan commits to:

- decision hash and monotonically unique plan ID;
- policy version;
- snapshot block number and hash;
- action count and ordered action commitments;
- target exposures;
- dynamic reserve;
- minimum final vault assets;
- maximum recognized loss;
- turnover allowance;
- creation and expiry times; and
- configuration/code-identity digest.

Each action references the plan and its next unused action index. Before execution, the vault rechecks authorization, expiry, replay status, adapter state, caps, dependency limits, idle reserve, loss/slippage bound, and fixed recipients. Divestment precedes deployment. A divestment failure stops the plan. A later deployment failure leaves the recovered capital as idle USDC and cannot strand it in an intermediate executor.

The contract does not attempt to verify statistical forecasts. It verifies the deterministic safety envelope that no forecast may bypass.

### 4.7 Pause and emergency behavior

Pause blocks:

- deposits;
- mints;
- new strategy deployments; and
- non-recovery reward swaps.

Pause permits:

- withdrawals and redemptions up to synchronous capacity;
- strategy divestment;
- reward recovery;
- impairment/loss recognition; and
- bounded emergency exit.

An allocator emergency exit bypasses the economic cost gate when a market becomes ineligible. It may only withdraw from an admitted/known adapter to `NavyVault`; it cannot deploy elsewhere, choose a recipient, or swap arbitrary assets.

### 4.8 Synchronous withdrawal implementation

Each strategy exposes a conservative `maxWithdrawable` view based on both the vault's position and protocol-wide immediately executable cash:

- Aave: no more than the strategy's underlying-equivalent aUSDC and USDC cash available to the aToken withdrawal path, subject to active/pause validation.
- Compound: no more than the strategy's positive Comet balance and Comet USDC cash, with a hard check that withdrawal cannot create a borrow.
- Moonwell: no more than the strategy's underlying-equivalent mUSDC and `getCash`, with nonzero numeric protocol error codes treated as failure.

The vault applies conservative liquidity haircuts and a deterministic withdrawal order. `maxWithdraw` never includes unclaimed rewards or USDC that requires an asynchronous operation. Live liquidity is raceable; failed execution reverts instead of exceeding the loss limit.

## 5. Strategy adapter interface

The common adapter boundary is the vault-bound `IStrategyAdapter` interface. Its responsibilities are fixed:

- report the immutable vault and native-USDC asset;
- deposit native USDC already transferred or approved by the vault;
- withdraw no more than a requested native-USDC amount directly to the vault;
- report conservative USDC-denominated position value;
- report conservative same-transaction withdrawal capacity;
- expose live protocol/configuration identity used by admission checks;
- enumerate eligible claimable/held reward tokens and amounts;
- claim approved protocol rewards without redirecting them outside the adapter;
- authorize only the shared reward executor for the exact harvest amount; and
- reject arbitrary recipients, spenders, borrowing, collateral entry, and arbitrary calls.

Adapters do not contain forecasting or allocation logic.

### 5.1 Aave V3 strategy

The Aave strategy supplies Circle native USDC to the canonical Base Pool and holds aUSDC. Accounting uses indexed/scaled Aave balances. Post-deposit simulation is off-chain and mirrors the live registered interest-rate strategy after accrual, including virtual balance, debt, reserve factor, deficit, liquidity added, rate parameters, and exact integer rounding.

Admission pins the Pool proxy/implementation, addresses provider, reserve tokens, aToken, variable debt token, rate strategy, incentives controller/transfer strategy, pause/freeze state, caps, and code/configuration hashes.

### 5.2 Compound III strategy

The Compound strategy supplies Circle native USDC as the positive base balance of the canonical Base USDC Comet. It never supplies collateral, enters a borrow, or permits a withdrawal to cross from positive supply into negative principal.

Post-deposit simulation accrues current indices to the decision time, applies principal/present-value rounding, recomputes utilization after the candidate deposit, and calls the live kinked supply curve.

Admission pins the Comet proxy/implementation, Configurator, governor, pause guardian, extension delegate, rate/tracking parameters, reward contract/configuration, pause flags, and code/configuration hashes. Collateral supply caps are not incorrectly applied to base-USDC supply.

### 5.3 Moonwell strategy

The Moonwell strategy supplies Circle native USDC to canonical Base mUSDC and holds the 8-decimal mToken. It never enters the market as collateral or borrows.

Post-deposit simulation first accrues interest, updates cash/borrows/reserves, uses the live registered jump-rate model with `cash + deposit`, and reproduces exchange-rate and mint/redeem truncation. Every nonzero numeric result from Moonwell mint/redeem calls is failure even when the EVM call itself does not revert.

Admission pins the mUSDC delegator/implementation, Unitroller/Comptroller, interest model, reward distributor, listing/pause state, strict supply-cap headroom, reserve factor, and code/configuration hashes.

## 6. Incentive reward accounting and execution

### 6.1 Base interest versus incentive rewards

Base lending interest requires no harvest:

- aUSDC indexed value grows;
- Compound's positive base balance grows; and
- mUSDC's exchange rate grows.

These gains are continuously part of strategy position value and return with principal on withdrawal.

Incentive rewards are separate tokens such as COMP or native Base WELL. They accrue to and are claimed by the strategy adapter. They never enter allocator EOA custody.

### 6.2 Eligibility

An incentive contributes to forecast or accounting only when all of the following pass:

- exact reward token and emission configuration are verified on-chain;
- emission is active inside the forecast horizon;
- eligibility denominator and dilution are known;
- distributor/claim contract is sufficiently funded;
- a static claim simulation succeeds;
- an admin-approved Uniswap V3 route to Circle native USDC exists;
- fresh admitted Chainlink reward/USD and USDC/USD feeds exist; and
- executable liquidity, price deviation, slippage, amount, and cost limits pass.

Off-chain reward programs, expired emissions, unverified tokens, and unfunded claims contribute zero.

### 6.3 Lazy conservative valuation

There is no scheduled hourly on-chain valuation transaction. SRCLA observes claimable rewards every 15 minutes off-chain. Share-changing and allocator transactions refresh reward value lazily when the configured cache age or material-change threshold requires it.

The recognized USDC value is derived from actual claimable plus held token amounts, fresh Chainlink prices, active-emission/funding state, an admin-set token-specific haircut, and an absolute contribution cap. A stale or invalid source can never create an upward valuation. Before issuing shares, every material reward value must be fresh; otherwise `maxDeposit` and `maxMint` are zero.

Reward value contributes to NAV but never to synchronous withdrawal capacity until converted to native USDC. This preserves late-depositor fairness without claiming or swapping on every user transaction.

### 6.4 Event-driven harvest

There is no weekly harvest schedule. SRCLA attempts a harvest when observed claimable value is material and:

```text
conservative USDC output
  > claim gas
  + approval/reset gas
  + swap gas and Base L1 data fee
  + Uniswap fee and price impact
  + slippage/MEV allowance
  + safety buffer
```

The claim and swap are atomic where the source protocol permits. Failure leaves the pre-transaction state unchanged. When protocol claim semantics require an intermediate held balance, the token remains in its adapter and only an approved recovery/harvest path can move it.

### 6.5 `RewardExecutor`

`RewardExecutor` is an immutable, shared safety wrapper around canonical Uniswap V3. It does not implement an exchange.

The admin registry maps a route ID to:

- chain ID;
- exact reward token and Circle native USDC output;
- canonical Uniswap V3 router and factory;
- ordered token path, pool addresses, and fee tiers;
- admitted Chainlink feed identities and maximum ages;
- maximum oracle deviation and price impact;
- maximum input amount and daily notional;
- minimum profit/safety rule; and
- route/code identity digest.

The allocator chooses only among active route IDs. Arbitrary target addresses, calldata, spenders, paths, recipients, and output assets are prohibited.

Each harvest uses exact token allowance and resets it to zero. The extra gas is included in the economic gate. The executor verifies input/output balance deltas and sends native USDC directly to `NavyVault`.

Release one supports only Uniswap V3. Aerodrome, aggregators, Permit2/AllowanceHolder routes, private-orderflow services, and asynchronous intents remain excluded.

## 7. Standalone `/srcla` service

### 7.1 Package boundary

`/srcla` is its own Node.js/TypeScript application with its own package manifest, configuration, migrations, tests, process lifecycle, PostgreSQL ownership, and read-only HTTP API. It is not imported as a library by NestJS.

Pure deterministic modules remain framework-free. Chain, database, scheduler, HTTP, and key-management adapters remain thin around them.

### 7.2 Runtime configuration

Release one uses one `BASE_RPC_URL` that supports:

- live reads;
- transaction submission;
- historical archive state; and
- pinned-block calls required by evaluation and fork preparation.

Local Anvil is used only for testing. It forks pinned Base state from the RPC and may dump/load local state; it is not treated as a historical Base archive.

The worker stores only the allocator private key. It refuses to start when chain ID, vault, strategy, reward executor, USDC identity, or database schema does not match configured expectations.

### 7.3 Observation cadence

- Persist one canonical finalized Base snapshot every 15 minutes.
- Evaluate the allocation policy every hour.
- Re-read live state and simulate exact calldata immediately before every transaction.
- Cooldown, turnover, and full-cost rules may suppress execution even when evaluation produces a new target.

Snapshot records include block number/hash/timestamp, RPC and ingestion metadata, raw integer units, vault/adapter balances, protocol cash, supply/borrows/reserves/indices, caps and pause flags, implementation/configuration identities, reward schedules/funding/claims, oracle rounds, Uniswap route state, Base gas state, and every quality flag.

### 7.4 Admission pipeline

A market is eligible only when all identity, freshness, configuration, incident, pause, cap, kink, dependency, oracle, reward, and synchronous-liquidity checks required by the paper pass.

A proxy implementation, rate model, reward controller, material configuration, or admitted code hash change starts a new regime. The market becomes ineligible until sufficient post-change observations and completed forecast outcomes pass the registered minimum-data gate. Historical data from a different configuration regime cannot silently train the new regime.

### 7.5 Protocol-exact simulation

Protocol modules normalize exact candidate-position curves, not dashboard APYs. Every module retains raw inputs and exact rounding. TypeScript projections are verified against pinned Base-fork execution at below-kink, kink, above-kink, zero/cap, full-exit, and rounding boundaries.

### 7.6 Deterministic forecast research

The paper's lower-bound return is interpreted as a lower prediction bound for the next realized holding-period return, not merely a confidence interval around an estimated mean.

The registered calibration compares:

- rolling historical horizon distributions;
- exponentially weighted level forecasts with walk-forward horizon residual bounds; and
- fixed-specification direct-horizon ARX.

It also compares pre-registered:

- horizons of 1, 7, and 14 days; and
- lower-bound coverage targets of 90%, 95%, and 99%.

Only fully known outcomes available at each forecast origin may train or calibrate that origin. Random train/test shuffling, full-history preprocessing, and post-held-out parameter tuning are forbidden.

Selection uses only the calibration era under a published loss function covering forecast error, lower-bound coverage and shortfall, turnover, downside, and sacrificed return. Method, horizon, coverage, features, windows/decay, residual treatment, minimum observations, and tie-breaks are frozen before held-out evaluation.

### 7.7 Dynamic reserve and stress feasibility

SRCLA derives withdrawal demand from finalized ERC-4626 `Withdraw` events and registered synthetic stress scenarios. Candidate withdrawal horizons, demand quantiles, liquidity haircuts, and scenario shocks are calibrated and frozen without look-ahead.

For every scenario, a target must satisfy:

```text
idle USDC + sum(min(target position, stressed executable exit)) >= stressed demand
```

The selected dynamic reserve is the maximum of the admin floor, calibrated demand quantile, and worst stress shortfall. Targets failing any scenario are rejected before return comparison.

### 7.8 Allocation optimizer

The optimizer consumes separable protocol-specific conservative return curves and generic hard constraints. It uses deterministic piecewise-linear approximation and fixed tie-breaking, with its release-one output verified against exhaustive enumeration for the three-market universe. Solver inputs, approximation error, feasible candidates, rejected candidates, and final objective values are persisted.

The optimizer supports generic adapters and dependency groups; it does not encode a three-protocol special case. A future solver change creates a new policy version and requires the registered evaluation again.

### 7.9 Action decision

New deposits and idle funds reduce drift first. Existing capital moves only when conservative horizon gain exceeds:

- Base L2 execution fee;
- Base L1 data-availability fee;
- protocol exit and entry cost;
- claim and approval/reset cost;
- swap fee and price impact;
- slippage and MEV allowance;
- failed-attempt/reversal allowance; and
- safety buffer.

Cooldown and turnover budgets prevent oscillation. A safety violation or new ineligibility invokes the bounded emergency policy and bypasses the economic gate.

### 7.10 Staged executor and reconciliation

The worker:

1. obtains a database execution lock;
2. builds and persists the plan before signing;
3. verifies nonce and exact on-chain configuration;
4. simulates the next action against pending/live state;
5. submits one action;
6. waits for and reconciles its receipt and balance deltas;
7. re-reads all affected state; and
8. either advances, safely stops, or replaces the plan from the new state.

Only one executor instance may submit for the allocator key. Restart recovery uses plan ID, action index, transaction hash, sender nonce, on-chain events, and live balances. Database status never overrides chain truth.

## 8. SRCLA persistence and API

The SRCLA-owned PostgreSQL schema stores append-only or versioned records for:

- finalized snapshots and raw observations;
- contract/configuration regimes;
- policies and parameter sets;
- reward/route/oracle admission records;
- completed forecast labels;
- forecasts and bounds;
- reserve/stress calculations;
- candidate allocations and rejection reasons;
- plans and ordered actions;
- simulations, submissions, receipts, and balance deltas;
- reward valuations and harvests;
- alerts, incidents, impairments, and emergency exits; and
- evaluation runs, baselines, ablations, and metrics.

Every decision has a deterministic content hash covering code commit, policy version, input snapshot, model artifact/parameters, candidates, chosen target, reserve, costs, and reasons.

The read-only HTTP API exposes versioned endpoints for:

- health and synchronization status;
- active policy and configuration regime;
- admitted/rejected markets and reasons;
- current allocation and reserve;
- decisions and candidate comparisons;
- plans, actions, receipts, and emergency history;
- reward valuation/harvest history; and
- evaluation summaries.

The API has no endpoint that submits a transaction or changes policy.

## 9. Existing backend integration

The NestJS `/be` service no longer owns farming custody or allocation execution.

It must:

- read vault share balances, `convertToAssets`, `maxWithdraw`, and relevant events directly from Base;
- proxy or compose read-only SRCLA decision/history data for authenticated Navy clients when useful;
- update AI farming tools to propose standard user-paid approve/deposit/redeem transactions rather than gasless authorization flows; and
- remove or retire the Base farming equivalents of deposit-authorization, deposit-submit, redeem-permit, and redeem-submit endpoints.

`/be` must not read the SRCLA database directly and must not receive the allocator key.

Payments and non-farming relayer behavior are unchanged.

## 10. Failure handling

The default response to missing or contradictory evidence is no action.

| Failure | Required behavior |
|---|---|
| RPC/archive read unavailable | Mark snapshot incomplete; do not decide or execute |
| Database unavailable | Do not sign or submit; recover from chain after database restoration |
| Reorg before finalized snapshot | Replace orphaned data; never train or decide from it |
| Proxy/configuration identity changes | Quarantine market; create new regime; require new history |
| Oracle stale/invalid | No upward reward value, no reward swap, and no unsafe share issuance |
| Route/quote invalid or too costly | Keep reward in adapter and retry only after a later valid decision |
| Market paused/ineligible | Block deployment and invoke bounded emergency exit when possible |
| Adapter withdrawal illiquid | Reduce synchronous limits; do not borrow or exceed loss bound |
| Action simulation fails | Do not submit |
| Submitted transaction reverts | Reconcile, stop plan, recompute from chain state |
| Crash after submission | Recover by nonce/hash/event before any replacement action |
| Plan expires | Stop remaining actions; keep recovered funds idle |
| Known adapter impairment | Disable deployment, record conservative loss/value cap, continue recovery |
| Allocator key compromised | On-chain recipients, adapters, routes, caps, reserves, expiry, and emergency bounds still apply |

## 11. Testing and evidence

### 11.1 Foundry

- ERC-4626 accounting, donation/inflation resistance, rounding, and cohort fairness.
- Standard user-paid deposit/mint/withdraw/redeem behavior.
- Synchronous `maxWithdraw`/`maxRedeem` under liquidity loss and races.
- Role separation, pause, adapter lifecycle, impairment, and loss recognition.
- Percentage, absolute, dependency, reserve, loss, turnover, expiry, and replay constraints.
- Staged partial-plan safety and emergency exit.
- Reward eligibility, valuation freshness, exact allowance/reset, route registry, oracle floor, minimum output, recipient, and daily limits.
- Fuzz and invariant tests proving allocator actions cannot send value outside the vault/approved protocol boundary.
- Pinned Base forks for Aave V3, Compound III, Moonwell, Chainlink, and Uniswap V3.

### 11.2 TypeScript and integration

- Pure-unit and property tests for admission, exact rate math, forecasts, reserve, optimizer, cost gate, cooldown, turnover, and deterministic hashing.
- Golden vectors matching protocol Solidity and fork execution.
- No-look-ahead and completed-label availability proofs.
- Missing/stale data, reward end-inside-horizon, code/config changes, underfunded rewards, kink/cap boundaries, irregular block times, and RPC ordering fixtures.
- PostgreSQL migration, idempotency, locking, nonce, crash, receipt, and reconciliation tests.
- Identical replay output under shuffled database retrieval order.
- End-to-end local Anvil test: deposit, observe, decide, staged deploy, accrue/simulate, reward harvest, rebalance, and synchronous redeem.

### 11.3 Paper evaluation

The implementation follows Section 11 of the paper without weakening it:

- Baselines B0 through B5 receive identical states, delays, costs, candidate sets, and safety envelopes.
- Vault sizes are 10 thousand, 100 thousand, 1 million, and 10 million USDC.
- Outcomes include net APY, share-price growth, cohort return, gas/swap cost, turnover, reversals, withdrawal success, stressed liquid coverage, drawdown, expected shortfall, unavailable assets, dependency concentration, and violations.
- H1 through H5 use controlled single-component ablations.
- Walk-forward calibration, stress tests, latency/cost sensitivity, and pinned Base-fork replays are mandatory.
- Statistically indistinguishable after-cost performance from simpler baselines fails to establish SRCLA's value.
- Failure to outperform is a failed release gate and is reported honestly.

## 12. Research and production boundaries

The research implementation may use:

- an external admin EOA;
- one hot allocator key in `/srcla`;
- one archive-capable RPC;
- admin-configured safety parameters; and
- low/canary exposure on Base after fork verification.

Production with material funds additionally requires:

- professional audits of vault, adapters, reward executor, and operational controls;
- admin multisig plus timelock and separated guardian;
- HSM/KMS-backed allocator signing and rotation;
- redundant independent RPC providers and cross-checking;
- conservative canary caps and staged rollout;
- continuous on-chain monitoring and alerting;
- incident, pause, impairment, and recovery runbooks;
- formal deployment/configuration review; and
- a public bug bounty.

These hardening items cannot be cited as completed by the research prototype.

## 13. Implementation-plan decomposition

This umbrella design spans several independently verifiable deliverables and must not be executed as one undifferentiated plan. After written-spec approval, implementation planning is decomposed in this order:

1. Base ERC-4626 core, generic policy enforcement, and Foundry invariants.
2. Aave, Compound, and Moonwell strategies plus pinned Base-fork conformance.
3. Reward accounting, `RewardExecutor`, Chainlink, and Uniswap V3 harvesting.
4. `/srcla` data collection, persistence, admission, and read-only API.
5. Deterministic forecasting, reserve, optimizer, cost gate, staged execution, and recovery.
6. NestJS farming integration and retirement of gasless farming endpoints.
7. Registered evaluation harness, B0–B5 baselines, H1–H5 ablations, and release report.

Each plan has its own tests and review checkpoint. A later plan may depend only on interfaces and evidence completed by earlier plans.

## 14. Source notes

Implementation research supporting this design:

- [`base-native-usdc-lending-adapter-implementation-research.md`](../../research/output/base-native-usdc-lending-adapter-implementation-research.md)
- [`srcla-deterministic-return-forecast-and-calibration-research.md`](../../research/output/srcla-deterministic-return-forecast-and-calibration-research.md)
- [`base-reward-auto-harvest-and-swap-research.md`](../../research/output/base-reward-auto-harvest-and-swap-research.md)

The cited research notes distinguish stable protocol mechanics from block-pinned observations. Deployment and policy activation must reverify every mutable address, implementation, parameter, emission, oracle, route, and liquidity condition against current Base state.
