# SRCLA Production Completion Design

**Date:** 2026-08-14

**Status:** Approved in conversation; written-spec review requested

## Purpose

Close every code and integration gate in `contract/audit/AUDIT-REPORT.md` and implement the release-one contract requirements in `docs/research/output/srcla-paper.md`. Produce a deployment-ready Base package verified through a pinned Anvil Base-mainnet fork. Do not broadcast a Base mainnet transaction.

The implementation must preserve historical audit traceability. A disabled feature is not labelled fixed, an inactive upstream reward is not fabricated as claimable yield, and a green local test is not substituted for pinned live-protocol evidence.

## Release boundary

- Base mainnet chain ID is `8453`.
- The sole vault asset is Circle native Base USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Release-one lending markets are Aave V3 Base USDC, Compound III Base USDC, and Moonwell Base mUSDC.
- Users interact through standard synchronous ERC-4626 calls and pay Base gas.
- The contracts are immutable and non-proxy.
- Reward claiming, conservative reward NAV, and safe Uniswap V3 conversion are implemented, but activation is fail-closed and depends on current emissions, funding, feeds, pools, and fork evidence.
- Work stops at a deployment-ready package. No Base transaction is broadcast.
- An independent audit remains required before material real-fund deployment; this implementation cannot self-authorize that external assurance.

## Authority model for this phase

Two fresh local wallets are used:

1. **Admin/deployer/guardian** deploys the system, manages admitted adapters, caps, dependency groups, reward policies/routes, pause, recovery, and emergency actions.
2. **Allocator** submits and executes committed SRCLA plans and economically approved harvest actions.

The deployer is intentionally the admin for this phase and does not renounce admin authority. Admin and allocator addresses must be distinct. Private keys exist only in local files under `/deploy/`, are mode `0600`, and are excluded by the root `.gitignore` before generation. No private key may be printed to chat, emitted by a script, written into a contract/configuration artifact, staged, committed, or pushed.

This two-key model is acceptable only for the requested research/canary phase. The audit register retains migration to a separate guardian and reviewed multisig/timelock as a material-funds gate.

## Architecture

### Vault custody and accounting module

`NavyVaultSRCLA` remains the authority for USDC custody, ERC-4626 shares, adapter admission, accounting, synchronous exits, plan execution, and pause state.

The vault enforces:

- standard OpenZeppelin ERC-4626 rounding and donation resistance;
- strict strategy synchronization before share-changing operations;
- percentage and absolute exposure caps per adapter;
- administrator-defined dependency groups and aggregate group caps;
- an administrator floor plus persistent active dynamic reserve;
- deterministic synchronous withdrawal sourcing;
- a maximum aggregate realized withdrawal loss, not merely one bound per adapter pull;
- domain-separated, ordered, expiring, configuration-bound Merkle plans;
- pause behavior that blocks deposit, mint, new deployment, and non-recovery reward conversion while preserving bounded withdraw, redeem, divest, recovery, and emergency exit;
- bounded adapter count and gas-tested worst-case behavior.

The dynamic reserve activated by a completed plan persists after plan expiry. A later valid plan may replace it but cannot reduce it below the administrator floor.

### Strategy adapter seam

`IStrategyAdapter` stays small and vault-bound. Protocol-specific reward complexity remains behind each adapter implementation. The interface supports:

- immutable `vault` and `asset` identity;
- measured deposit and withdrawal;
- conservative position and synchronous-liquidity reporting;
- a configuration digest that includes material external dependencies;
- exact reward-token discovery;
- conservative claimable discovery;
- vault-only reward claiming to a fixed recipient with measured token deltas.

Adapters cannot borrow, enter collateral positions, bridge, call allocator-selected targets, select arbitrary recipients/spenders, or contain forecasting/allocation policy.

Protocol behavior:

- **Aave:** derive and verify the incentives controller from aUSDC, enumerate controller rewards, reject ended/zero-emission streams, and remove the false COMP declaration. The observed aUSDC reward ended in 2024 and therefore contributes zero.
- **Compound:** bind official CometRewards, verify its reward configuration token, supply tracking speed, threshold, owed amount, and funding. The observed COMP stream has zero speed/funding and therefore contributes zero until reactivated upstream.
- **Moonwell:** derive the Comptroller from mUSDC and reward distributor from the Comptroller, enumerate all market reward configs, and measure every token delta produced by the all-stream claim. Ended or unsupported tokens are never mislabelled as WELL. The WELL stream observed before 2026-08-15 must be revalidated and is expected to expire.

### Reward accounting module

A dedicated reward-accounting module concentrates conservative reward NAV and freshness policy. The vault uses its small interface to refresh and read one capped USDC value.

For each admitted token, policy commits:

- exact token and decimals;
- reward/USD feed and USDC/USD feed;
- exact feed descriptions/directions and decimals;
- maximum age no greater than the reviewed heartbeat;
- governance-set lower and upper economic answer bounds;
- token-specific haircut;
- absolute USDC contribution cap;
- materiality threshold and cache lifetime;
- allowed adapters and claim sources;
- policy/configuration digest.

Value is based on exact held plus conservatively queryable claimable amounts. It uses reward/USD divided by USDC/USD with full decimal normalization. Haircuts and absolute caps apply before the value enters NAV. Reward value never increases synchronous withdrawal capacity.

If a material reward cache is stale or any sequencer/feed/claimable read is invalid, `maxDeposit` and `maxMint` return zero and deposit/mint revert until a safe refresh succeeds. Invalid data can never increase NAV. Withdraw/redeem use the last non-inflating safe value and remain bounded by USDC synchronous liquidity.

### Reward executor module

`RewardExecutor` is immutable and constructor-bound to:

- chain ID `8453`;
- canonical Base USDC;
- canonical Uniswap V3 Factory `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`;
- SwapRouter02 `0x2626664c2603336E57B271c5C0b26F421741e481`;
- official Base sequencer uptime feed `0xBCF85224fc0756B9Fa45aA7892530B47e10b6433`;
- vault and admin.

Only the vault can swap; only admin can approve/revoke routes. Output is always canonical USDC sent directly to the vault.

Each route commits:

- chain, executor, input reward token, USDC output, and canonical route digest;
- an ordered one-hop or two-hop token path;
- an exact fee tier and factory-derived pool for every hop;
- pool factory, token ordering, fee, nonzero code, and activation codehash;
- reward/USD and USDC/USD feed identities/directions/decimals;
- heartbeat-derived maximum ages and economic answer bounds;
- sequencer recovery grace of at least one hour;
- route minimum output BPS and maximum execution impact;
- maximum input per swap and maximum daily USDC notional;
- short caller deadline;
- active status and activation block/hash evidence.

Before valuation or swap, the executor requires sequencer answer `0`, a valid nonfuture `startedAt`, and elapsed recovery grace. It then validates both completed positive fresh price rounds and economic bounds. It derives expected USDC by dividing reward/USD by USDC/USD, normalizes decimals, and enforces the stricter oracle/caller floor.

The executor validates every pool through the canonical factory, measures input/output balance deltas, gives the router only the exact allowance, resets the allowance to zero, enforces actual impact and daily notional, rejects repeated/zero path tokens, and prevents trapped outputs.

Two-hop support is mandatory because pinned Base evidence found viable COMP/WETH and WELL/WETH 1% pools followed by WETH/USDC 0.05%, while direct WELL/USDC was unavailable and direct COMP/USDC was economically unusable. The implementation supports at most two hops; no arbitrary path or generalized router calldata is admitted.

### Reward activation policy

Implementation completeness and route activation are separate states. A reward token contributes zero and cannot swap unless all checks pass at the pinned activation block and immediately before use:

- active positive emission before its end time;
- adequate distributor/rewards funding;
- positive exact adapter claimable amount and successful claim simulation;
- admitted exact token;
- sequencer up and outside recovery grace;
- both approved feeds fresh, in bounds, correctly directed, and not deprecated;
- canonical pools/codehashes active with adequate liquidity;
- maximum-input quote and fork swap meet the oracle floor;
- route/configuration digest matches deployment evidence.

At the research block, Aave and Compound produce zero active incentive yield and Moonwell is near expiry. Deployment-ready code must cleanly report zero with no active routes if upstream rewards remain inactive. It must never enable an uneconomic route merely to demonstrate a successful harvest.

### Payment module and backend migration

`NavyPayments` changes invoice fee calculation to ceiling rounding, so the configured fee is a minimum and the difference from exact arithmetic is at most one USDC base unit.

The configuration-bound `authorizationNonce(merchantId, invoiceId)` remains the only EIP-3009 nonce for new deployments. The NestJS backend obtains this value from the configured NavyPayments contract before constructing typed data. It does not locally substitute the legacy stable invoice key.

The generated NavyPayments ABI, backend contract binding, unit tests, watcher recovery, and `be/scripts/evm-e2e.mjs` migrate atomically. Deployment cutover invalidates outstanding old-contract authorizations and requires a new signature; no authorization is submitted across versions.

### Deployment and evidence modules

Deployment is split into deterministic configuration, execution, and verification:

- configuration contains public addresses, caps, dependency groups, routes, feeds, bounds, and expected code/configuration hashes;
- execution deploys and configures contracts from environment-provided wallet keys without logging secrets;
- verification independently reads all constructor values, dependencies, roles, caps, routes, policies, bytecode hashes, and pause state.

Deployment fails closed on wrong chain, wrong USDC, missing/mismatched code, mutable external identity drift, equal admin/allocator addresses, unsupported reward data, or incomplete role/configuration state.

The output manifest contains no secrets. It records commit, compiler, chain, pinned block/hash, deployed addresses, constructor arguments, bytecode hashes, roles, protocol identities, reward policies, routes, feed rounds/bounds, pool identities/liquidity, commands, gas, and test results.

## Error handling and safety behavior

| Failure | Required behavior |
|---|---|
| Strategy value sync fails before issuance | Deposit/mint close; no zero valuation. |
| Strategy loses synchronous cash | Max functions shrink; an over-ambitious exit reverts atomically. |
| Aggregate withdrawal loss exceeds bound | Entire exit reverts. |
| Dependency or absolute cap exceeded | Deploy action reverts before funds move. |
| Plan configuration changes | Remaining action proofs become unusable. |
| Reward emission ended/unfunded | Claimable and NAV contribution are zero; route remains inactive. |
| Claim transfers unexpected token | Measure and quarantine/recover under admin; never mislabel or value it. |
| Reward cache/feed invalid | No upward NAV; issuance closes when material. |
| Sequencer down or in grace | No valuation refresh or reward swap. |
| Pool/feed/codehash changed | Route is inactive until new reviewed activation evidence. |
| Swap fails or output is below floor | Atomic revert; allowances/state do not remain unsafe. |
| Pause active | No issuance, deployment, or ordinary harvest; exits and bounded recovery remain. |
| Backend reads wrong/new contract during cutover | Authorization is rejected and must be rebuilt/signed. |

## Test and acceptance strategy

Every behavior change follows red-green TDD: add one failing public-interface test, observe the expected failure, implement the minimum safe behavior, run the focused test, then run the surrounding suite.

### Foundry verification

- Unit and fuzz tests for ERC-4626 rounding, donations, fee ceiling, caps, reserves, dependency groups, aggregate loss, plan domains, pause, roles, reward discovery, reward NAV, cache freshness, feed math, bounds, sequencer behavior, route digests, pool validation, exact allowances, output deltas, maximum input, and daily notional.
- Stateful invariants for asset/share conservation, non-inflating failed reward data, allocator inability to redirect assets, cap/reserve preservation, and pause/exit properties.
- Gas snapshots for deposit, mint, withdraw, redeem, plan actions, harvest, and emergency exit at 0, 1, typical, and 16 adapters.
- Coverage and static analysis with every security-relevant warning resolved or documented.

### Backend verification

- Unit tests prove the backend uses the on-chain authorization nonce and rejects contract-read failure.
- NavyPayments ABI parity is checked against the Foundry artifact.
- NestJS unit suite and build pass.
- The EIP-3009 E2E proves authorization, relay, ceiling split, event reconciliation, replay rejection, and configuration-change invalidation.

### Pinned Anvil Base-mainnet acceptance

Start Anvil from a trusted archive-capable Base RPC at one recorded block and hash. Deploy the full system from the local admin/deployer account and use the distinct allocator account.

Acceptance covers:

1. constructor and dependency identity verification;
2. final role and configuration enumeration;
3. user deposit/mint and share accounting;
4. ordered plan deployment across Aave, Compound, and Moonwell;
5. strategy accrual/synchronization and cohort fairness;
6. percentage, absolute, dependency, reserve, turnover, and loss rejection paths;
7. synchronous withdrawal/redeem sourcing from each protocol;
8. reward discovery and exact zero behavior for inactive streams;
9. claim plus admitted two-hop conversion only when the pinned stream/funding/route is live;
10. stale/out-of-bound feeds, sequencer down/recovery, changed pool identity, low liquidity, input limit, daily cap, and deadline failures;
11. pause, divest, reward recovery, emergency exit, and resumed operation;
12. bytecode, gas, role, allowance, balance-delta, and NAV invariant reconciliation.

If no reward stream is live at the acceptance block, the reward tests must demonstrate inactive zero contribution and rejection of route activation. A separate controlled fork test may alter upstream state only to exercise the code path; such a test is labelled synthetic and is not activation evidence.

## Documentation and audit maintenance

On completion:

- update `contract/audit/AUDIT-REPORT.md` and all affected domain finding files;
- mark a finding fixed only with source, regression, and pinned-fork evidence appropriate to its reachability;
- retain multisig/timelock, independent audit, live deployment, monitoring, key custody, public bug bounty, and policy performance gates as external/operational gates;
- update `contract/DEPLOYMENTS.md`, Base manifests, backend runbooks, and ABI parity evidence;
- record exact commands, pass/fail/skip counts, block/hash, and unresolved warnings;
- state clearly that paper forecast calibration and after-cost outperformance gates are distinct from contract correctness.

## Success criteria

The implementation is deployment-ready when:

1. every reachable code/integration issue in the living audit is fixed with regression evidence;
2. full paper-required on-chain controls in this design are implemented;
3. both local and pinned Anvil Base acceptance suites pass without unexpected skips;
4. payment ABI/nonce migration passes backend and Sepolia E2E verification;
5. fresh local wallets exist only under ignored `/deploy/` with correct permissions;
6. a complete public deployment manifest and private local operator note exist;
7. no Base mainnet transaction was broadcast;
8. remaining external gates are accurately documented rather than claimed complete.

## Primary dependency evidence

Exact Base addresses, reward interfaces, emissions/funding observations, Chainlink feeds and heartbeat/direction, sequencer semantics, Uniswap pools, pinned quotes, and activation revalidation are recorded in `docs/research/output/2026-08-14-base-reward-oracle-production-dependencies.md`.
