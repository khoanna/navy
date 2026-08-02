# Base-native USDC lending adapter implementation research

**Scope:** implementation data for an SRCLA allocator over Aave V3, Compound III, and Moonwell on Base, including incentive rewards. This is research input, not an architecture decision.

**Research date:** 2026-08-02. Changeable on-chain observations below are pinned to Base block **49,436,925** (`0x8bedd2443739be6ab20ae135ef9ae1b031c8ddcc1157e45f9f5e7e129bc42f90`, 2026-08-02 09:33:17 UTC). Addresses and mechanics were checked only against protocol-owned documentation, protocol source/deployment registries, Circle documentation, and deployed contracts.

## 1. Shared asset and verification method

Circle's canonical native USDC contract on Base is:

`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

This is the Base address published by [Circle's official USDC contract registry](https://developers.circle.com/stablecoins/usdc-contract-addresses). It is distinct from the older bridged USDbC token (`0xd9aA...b6CA`). Every market in this report was also verified through an on-chain identity getter: Aave's registered reserve underlying is this address, Compound Comet's `baseToken()` returns it, and Moonwell mUSDC's `underlying()` returns it.

Canonical-address admission should be verified through three independent primary-source checks:

1. Match the protocol-owned address/deployment registry.
2. Read live identity and relationship getters (`baseToken`, `underlying`, pool/comptroller/controller pointers, registered reserve tokens).
3. Resolve every proxy/delegator to its live implementation, verify published source on BaseScan, and pin runtime bytecode hashes at admission. Re-read the implementation slot/delegator getter and code hashes before every policy-version activation because all three external protocols retain governance-controlled upgrade/configuration paths.

Explorer verification is useful but not sufficient by itself. The integration should fail admission if the protocol registry, live relationship getters, proxy implementation, or expected code identity disagree.

## 2. Canonical Base markets

| Venue | User-facing protocol position | Canonical contracts | Native-USDC proof |
|---|---|---|---|
| Aave V3 Base | aBaseUSDC (`aUSDC`) | Pool Addresses Provider `0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D`; Pool proxy `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`; Protocol Data Provider `0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A`; aUSDC `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB`; default incentives controller `0xf9cc4F0D883F1a1eb2c253bdb46c254Ca51E1F44` | The DAO-maintained [Aave Base address book](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol) maps `USDC_UNDERLYING` to Circle's address and maps its aToken and rate strategy. Live `aUSDC.UNDERLYING_ASSET_ADDRESS()` also returns Circle USDC. |
| Compound III Base USDC market | cUSDCv3/Comet positive base balance | Comet proxy `0xb125E6687d4313864e53df431d5425969c15Eb2F`; Configurator `0x45939657d1CA34A8FA39A924B71D28Fe8431e581`; Rewards `0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1`; Bulker `0x78D0677032A35c63D142a48A2037048871212a8C` | Compound's official [Base USDC deployment roots](https://github.com/compound-finance/comet/blob/main/deployments/base/usdc/roots.json) identify the contracts, and its [market configuration](https://github.com/compound-finance/comet/blob/main/deployments/base/usdc/configuration.json) names Circle's Base USDC address as `baseTokenAddress`. Live `Comet.baseToken()` agrees. |
| Moonwell Base USDC market | mUSDC | Unitroller/Comptroller proxy `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C`; mUSDC delegator `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22`; MultiRewardDistributor proxy `0xe9005b078701e2A0948D2EaC43010D35870Ad9d2` | Moonwell's official [Base chain registry](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/chains/8453.json) lists `USDC`, `MOONWELL_USDC`, the Unitroller, implementation, and reward distributor. Live `mUSDC.underlying()` returns Circle USDC. |

### Current implementation observations

- The Aave Pool proxy's EIP-1967 implementation at the pinned block was `0xA4AbC5FcBA6D0d7E3D144d6dbF6cb6128599dFdB`, matching the current Aave address book.
- The Compound Comet proxy's EIP-1967 implementation was `0x079990620d904fb1fde68b6d54a5f8647134cde9`. The proxy is the only stable interaction address; Compound explicitly documents that deployed Comets are upgradeable through governance and that integrations should use the proxy ([official Comet repository](https://github.com/compound-finance/comet)).
- `mUSDC.implementation()` returned `0x1FADFF493529C3Fcc7EE04F1f15D19816ddA45B7`, matching Moonwell's chain registry. Moonwell documents mTokens and the Comptroller as delegator/proxy systems in its [official contracts repository](https://github.com/moonwell-fi/moonwell-contracts-v2).

These are observations, not immutable identities.

## 3. Aave V3 Base USDC

### Accounting and supply-rate mechanics

Supplying USDC through `Pool.supply(asset, amount, onBehalfOf, referralCode)` mints scaled aUSDC; its displayed `balanceOf` grows through Aave's liquidity index. The authoritative accounting inputs are Pool `getReserveData(USDC)`, aUSDC scaled balance/total supply, the liquidity index, variable-debt token scaled supply, deficit/unbacked state, reserve factor, virtual underlying balance, and the registered interest-rate strategy.

The exact post-deposit rate is not the old `currentLiquidityRate`. Aave updates indices first, then calls the registered strategy with `liquidityAdded = depositAmount`. In current Aave Origin code, the strategy receives deficit, liquidity added/taken, total variable debt, reserve factor, reserve address, and virtual underlying balance. It computes utilization from `(virtual balance + liquidityAdded - liquidityTaken)` and debt, then derives the liquidity rate as variable borrow rate × supply utilization × `(1 - reserveFactor)` ([`ReserveLogic.updateInterestRatesAndVirtualBalance`](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/protocol/libraries/logic/ReserveLogic.sol), [`DefaultReserveInterestRateStrategyV2.calculateInterestRates`](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/misc/DefaultReserveInterestRateStrategyV2.sol)).

Implementation data needed for a post-deposit quote:

- reserve's live rate-strategy address and strategy-specific rate parameters;
- next variable debt/index and total debt after accrued interest;
- virtual underlying balance, deficit, reserve factor, and proposed liquidity addition;
- aUSDC total supply and liquidity index for both cap checks and reward denominator;
- transaction-time timestamp/block context and Aave's exact ray/percentage rounding.

A forked `eth_call` of the actual supply path is the safest conformance oracle for test vectors. A TypeScript projection must reproduce Aave's integer math and be compared against fork results rather than relying on a UI APY.

### Immediately executable withdrawal liquidity

For an adapter with no debt, the conservative same-transaction amount is bounded by:

`min(adapter aUSDC underlying-equivalent balance, USDC.balanceOf(aUSDC))`

The second term is the underlying cash held by the aToken contract from which `Pool.withdraw` transfers. Aave withdrawal validation additionally requires the reserve to be active and not paused; a frozen reserve still permits withdrawals. The exact validation is visible in [`ValidationLogic.validateWithdraw`](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/protocol/libraries/logic/ValidationLogic.sol). The transaction can still lose a race to borrows/other withdrawals, so an observation is not a guarantee until execution.

At the pinned block, aUSDC held about **19.754 million USDC** of immediately visible cash. This is protocol-wide liquidity, not an amount reserved for this vault.

### Admission/configuration reads

Decision-critical on-chain reads are:

- `PoolAddressesProvider.getPool()` plus Pool proxy implementation/code hash;
- `ProtocolDataProvider.getReserveTokensAddresses(USDC)` and aUSDC identity getters;
- reserve active/frozen/paused flags, supply cap, reserve factor, decimals, borrowing flag, debt/deficit, virtual balance, and strategy address;
- aToken, variable-debt-token, strategy, incentives-controller, and transfer-strategy implementations/code hashes;
- available underlying cash and the adapter's aUSDC balance.

At the pinned block USDC was active, not frozen, not paused, with reserve factor 10%, borrow cap 207 million USDC, and supply cap 230 million USDC. These are current configuration observations and must not be compiled as permanent constants. Aave supply validation checks active/not-paused/not-frozen and the cap against indexed total supply plus accrued treasury amount ([official validation source](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/protocol/libraries/logic/ValidationLogic.sol)).

### Aave incentives

The aToken calls Aave's RewardsController as balances change. Relevant reads are `getRewardsByAsset(aUSDC)`, `getRewardsData(aUSDC,reward)`, `getAssetIndex`, `getUserRewards`, reward token decimals, `getRewardOracle`, `getTransferStrategy`, and aUSDC total supply. Claims can use `claimRewards`/`claimAllRewards` and send rewards to a chosen receiver; the controller interface and claim semantics are in Aave's official [`IRewardsController`](https://github.com/aave/aave-v3-periphery/blob/master/contracts/rewards/interfaces/IRewardsController.sol) and [`IRewardsDistributor`](https://github.com/aave/aave-v3-periphery/blob/master/contracts/rewards/interfaces/IRewardsDistributor.sol).

For a future reward APR estimate, the required inputs are each active reward's emission per second and distribution end, the post-deposit incentivized supply denominator, the adapter's projected share, reward decimals, and a conservative reward/USDC price. The estimate must become zero after `distributionEnd`, and the transfer strategy must have adequate funding/ability to pay.

Current observation: `getRewardsByAsset(aUSDC)` returned aUSDC itself, but its configured distribution ended on **2024-09-03 15:00 UTC**. Therefore the native controller exposes no forward Aave USDC incentive emission at the pinned block. This does not rule out separate off-chain programs such as Merit; such programs are not safely countable as deterministic on-chain reward APR unless their eligibility and claim path are independently integrated.

Protocol-specific edge cases:

- aUSDC balances and total supply are indexed/scaled; naïve ERC-20 balance deltas can be off by rounding.
- Supply cap usage includes accrued-to-treasury amounts, not merely `aUSDC.totalSupply()`.
- Freeze and pause have different exit behavior.
- Rate strategy, reserve token implementations, reward controller, emissions, and caps are governance mutable.
- A reward may itself be an aToken. It should be valued and unwound according to its underlying position rather than assumed to be an ordinary freely liquid reward token.

## 4. Compound III Base USDC Comet

### Accounting and supply-rate mechanics

USDC supplied through `Comet.supply(USDC, amount)` creates a positive base-asset balance in the adapter. Compound accrues base supply and borrow indices per second. Utilization is `presentValueBorrow / presentValueSupply`; `getSupplyRate(utilization)` applies the configured piecewise base/low-slope/high-slope curve around `supplyKink`. Compound documents the formula, 1e18 per-second scale, and APR conversion in its [official interest-rate documentation](https://docs.compound.finance/interest-rates/).

The exact post-deposit projection must first accrue the current supply/borrow indices to the target timestamp using the pre-deposit utilization, apply Comet's principal/present-value rounding for the new supply, then recompute utilization and pass it to `getSupplyRate`. For a positive supplier with no borrow, the approximate economic relation is `borrow / (supply + deposit)`, but exact admission/test vectors need Comet's integer conversions.

Required reads are `baseSupplyIndex`, `baseBorrowIndex`, `lastAccrualTime`, `totalSupplyBase`, `totalBorrowBase`, `totalSupply()`, `totalBorrow()`, all supply-rate parameters, `getUtilization()`, `getSupplyRate(candidateUtilization)`, and the adapter's `balanceOf`.

### Immediately executable withdrawal liquidity

Compound uses the same `withdraw` entry point for withdrawing a positive base balance and initiating a base borrow. An adapter that must never borrow therefore needs both bounds:

`min(adapter positive Comet balance, USDC.balanceOf(Comet))`

It must also require `isWithdrawPaused() == false`. Compound's official [collateral and borrowing documentation](https://docs.compound.finance/collateral-and-borrowing/) describes the dual withdrawal/borrow semantics and `type(uint256).max` behavior. Exact full exits should be fork-tested because principal-to-present-value rounding can leave or attempt a few base units.

At the pinned block, Comet held about **1.510 million USDC** cash and withdrawals were not paused. A planner must treat this as shared, raceable cash.

### Admission/configuration reads

- verify Comet proxy, live EIP-1967 implementation/code hash, Configurator, governor, pause guardian, extension delegate, and Base USDC identity;
- read supply and withdrawal pause flags independently;
- read all immutable rate/tracking parameters from the live implementation, not only the repository's initial `configuration.json` (governance migrations may have changed them);
- monitor `PauseAction`, proxy upgrade, Configurator, and governance events;
- read Comet cash and adapter positive balance.

There is no base-USDC supply cap analogous to a collateral `supplyCap`; Compound's documented supply caps apply to collateral assets. This USDC adapter supplies the base asset, so it must not incorrectly apply the WETH/cbETH collateral caps to USDC ([Compound collateral documentation](https://docs.compound.finance/collateral-and-borrowing/)).

### Compound rewards

Comet tracks supplier rewards internally; a separate CometRewards contract pays the configured reward token. `baseTrackingSupplySpeed`, `trackingIndexScale`, `baseMinForRewards`, total supply principal, and adapter principal/index state determine accrual. Rewards accrue only while total base supply meets `baseMinForRewards`. `baseTrackingAccrued(account)` is in 1e6 accrual units; CometRewards applies its reward config's rescale direction/factor and multiplier. Claims use `claim(comet, src, shouldAccrue)`; `claimTo` additionally requires Comet permission from `src` to the caller. These mechanics are documented in [Compound's protocol-rewards docs](https://docs.compound.finance/protocol-rewards/) and implemented in the official [`CometRewards.sol`](https://github.com/compound-finance/comet/blob/main/contracts/CometRewards.sol).

Future reward APR inputs are therefore the live supply speed, tracking scale, reward config (`token`, `rescaleFactor`, `shouldUpscale`, and multiplier where supported), post-deposit supply principal/share, minimum-reward threshold, remaining reward contract balance, token decimals, and conservative reward/USDC price. The safest calculation mirrors the Comet index and CometRewards rescaling code over the evaluation horizon.

Current observation: reward token is Base COMP `0x9e1028F5F1D5eDE59748FFceE5532509976840E0`, but `baseTrackingSupplySpeed()` was **zero**, so forward Compound supply reward APR was zero at the pinned block. A nonzero historic/deployment configuration must not override this live read.

Protocol-specific edge cases:

- `withdraw` can turn a supplier into a borrower if the adapter-side bound is wrong.
- Base supply and borrow use signed principal plus indices, so exact round trips can produce small rounding dust.
- CometRewards can revert on an underfunded/failed token transfer; accrued rewards are not cash until a claim succeeds.
- Comet proxy upgrades replace immutable-in-implementation parameters, so all live getters and implementation identity must be refreshed after upgrades.
- Indexed/API APRs can lag the per-second on-chain state and should not be used for transaction guardrails.

## 5. Moonwell Base mUSDC

### Accounting and supply-rate mechanics

Supplying native USDC calls mUSDC `mint(amount)` and receives 8-decimal mUSDC. The underlying-equivalent position is the mToken balance multiplied by the exchange rate. Moonwell accrues interest by timestamp, updating total borrows, total reserves, borrow index, and exchange rate before mint/redeem.

The registered JumpRateModel computes utilization as:

`borrows / (cash + borrows - reserves)`

It computes the piecewise borrow rate around `kink`, then supply rate as `utilization × borrowRate × (1 - reserveFactor)`. The model and its `timestampsPerYear = 365 days` constant are in Moonwell's official [`JumpRateModel.sol`](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/src/irm/JumpRateModel.sol). mUSDC exposes `supplyRatePerTimestamp()` and the exact cash/borrow/reserve inputs ([`MToken.sol`](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/src/MToken.sol)).

For a post-deposit quote, accrue current interest to the target timestamp first, then call the live interest model with `cash + deposit`, newly accrued borrows/reserves, and the reserve factor. Exact projected adapter value also needs the resulting exchange rate and mint-token truncation.

### Immediately executable withdrawal liquidity

For an adapter that has not entered the market as collateral, the synchronous bound is:

`min(adapter underlying-equivalent mUSDC balance after accrual, mUSDC.getCash())`

Moonwell's Comptroller deliberately does not expose a pause switch for users removing their own assets; redeem is instead restricted by market listing, the user's collateral/account-liquidity state if the market was entered, the adapter mToken balance, and available cash. `MToken.redeemFresh` returns an error for insufficient cash, and its logic is in the official [MToken source](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/src/MToken.sol). The adapter must check Moonwell's numeric return code; a low-level call succeeding does not mean `redeem` succeeded.

At the pinned block, mUSDC cash was about **2.349 million USDC**. The adapter should not enter the market or borrow, otherwise hypothetical-liquidity checks add a second withdrawal constraint.

### Admission/configuration reads

- verify mUSDC `underlying`, `comptroller`, `implementation`, `admin`, live interest-rate-model address/code hash, and Unitroller implementation/code hash;
- verify market listing, `mintGuardianPaused`, supply cap and current cap usage (`cash + borrows - reserves`), reserve factor, cash, totals, exchange rate, and accrual timestamp;
- verify MultiRewardDistributor relationship, proxy implementation, pause state, active stream configurations, balances, and event history.

At the pinned block mUSDC's supply cap was **200 million USDC**, minting was not paused, and the live rate model was `0x76e1e2F2E3239A15bAD01f027B5A4bcDE5797f3C`. Moonwell's cap check uses strict `< supplyCap`, not `<=`, after adding the proposed mint to `cash + borrows - reserves` ([`Comptroller.mintAllowed`](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/src/Comptroller.sol)).

### Moonwell rewards

The MultiRewardDistributor supports multiple simultaneous supply and borrow reward tokens per mToken. Each `MarketConfig` exposes owner, emission token, end time, global indexes/timestamps, and supply/borrow emissions per second. `getAllMarketConfigs(mUSDC)` enumerates them, while `getOutstandingRewardsForUser(mUSDC, adapter)` includes virtually accrued rewards. Users claim through the Comptroller's `claimReward` methods; the Comptroller updates indexes and asks the distributor to transfer each token. Official semantics are documented in [Moonwell's MultiRewardDistributor guide](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/docs/core/MULTIREWARDDISTRIBUTOR.md) and interfaces/source ([`IMultiRewardDistributor.sol`](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/src/rewards/IMultiRewardDistributor.sol), [`MultiRewardDistributor.sol`](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/src/rewards/MultiRewardDistributor.sol)).

Future reward APR inputs are every stream's supply speed/end time/token, the post-deposit mToken total supply and newly minted mTokens, token decimals, distributor balance, distributor pause state, and conservative reward/USDC price. Because the supply index denominator is mToken total supply, projected rewards should use the exact post-mint mToken share rather than an underlying-TVl approximation.

Current observations from `getAllMarketConfigs(mUSDC)`:

- WELL (`0xFF8a...493D`) stream ended in April 2024 and has zero supply speed.
- USDC stream ended in December 2024 (its stored supply speed is nonzero but no longer accrues).
- xWELL/Base WELL (`0xA88594D404727625A9437C3f886C7643872296AE`) has a nonzero supply stream ending **2026-08-15 00:00 UTC**; the distributor itself was not paused.

Moonwell's distributor retains unpaid accrual when paused or underfunded rather than transferring partial rewards. Its `sendReward` checks that the entire amount is funded and otherwise emits `InsufficientTokensToEmit` ([official source](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/main/src/rewards/MultiRewardDistributor.sol)). Therefore quoted rewards are receivables until claimed, and distributor token balance/funding runway is a necessary haircut input.

Protocol-specific edge cases:

- `mint` and `redeem` return numeric protocol error codes in addition to possible reverts; adapters must reject nonzero codes.
- `exchangeRateStored` and raw totals can be stale until interest accrues. `balanceOfUnderlying`/`exchangeRateCurrent` can be simulated with `eth_call`, or exact accrual math must be reproduced.
- mUSDC has 8 decimals while USDC has 6, making mint/redeem truncation explicit.
- Supply cap is checked against underlying supplied value and uses a strict inequality.
- Rewards may accrue but remain undistributed when the distributor is paused or lacks the full token amount.
- Stream owners can change speeds/end times; the distributor, Comptroller, mToken implementation, and rate model are governance mutable.

## 6. On-chain versus indexed/off-chain data

| Data | On-chain authoritative read | Indexed/off-chain role |
|---|---|---|
| Contract identity and configuration | Proxy/delegator implementation, code, relationship getters, caps, pause/freeze/listing flags, rate-model parameters | Cache and alerting only; never admission authority |
| Current position/NAV | aUSDC indexed balance; Comet balance/principal/index; mUSDC balance and current exchange rate | Historical portfolio series and reconciliation acceleration |
| Current/post-deposit base rate | Live reserve/market inputs and exact protocol model | UI APIs are useful cross-checks, not execution inputs |
| Same-transaction exit capacity | Live protocol cash, adapter position, exit flags, and a simulated/forked withdrawal | Historical liquidity distribution, stress calibration, and race/slippage statistics |
| Current incentives/claimable rewards | Controllers/distributors, schedules, indexes, balances, claimable getters | Campaign metadata, governance proposals, and historical emission analysis |
| Volatility, persistence, and stress features | Reconstructable from events and archived RPC state | Protocol subgraphs or an SRCLA-owned indexer are practical for long histories |

Aave warns in its official [protocol-subgraphs repository](https://github.com/aave/protocol-subgraphs) that indexed balances/liquidity can be snapshots and must be formatted for current interest. The same general limitation applies to every indexer: the SRCLA worker needs an archive-capable Base RPC or its own event/state snapshots for reproducible historical features, while execution guards re-read state from a current RPC immediately before submission.

## 7. Reward valuation and harvesting implications

The protocol research establishes the inputs, but does not select a swap venue or harvesting policy.

For all three venues, base lending yield can be accrued directly in native USDC position value. Incentive rewards should be separated into:

1. claimable and directly USDC-denominated rewards;
2. claimable position tokens such as aUSDC, valued through their underlying exit capacity;
3. volatile ERC-20 rewards such as COMP or xWELL, valued only with a conservative executable USDC conversion.

An executable reward value needs token decimals, claim amount, claim-contract funding/transfer state, an approved Base liquidity venue and route, current quote, price/oracle sanity reference, price impact, protocol and gas fees, minimum output, deadline, and expected MEV loss. A spot quote alone is insufficient for forecast APR. If no sufficiently independent/fresh price reference and executable route are admitted, the safe contribution of that reward to allocation yield is zero even though it may still be tracked as unpriced inventory.

Claim/harvest edge conditions differ:

- Aave claims can direct rewards to a receiver, but payout behavior is delegated to the reward's configured transfer strategy.
- Compound `claim` pays `src`; `claimTo` requires prior Comet manager permission. An unfunded transfer reverts.
- Moonwell claims are made through Comptroller and underfunding/paused distribution leaves the full amount accrued instead of paying partially.

## 8. Unresolved implementation items for discussion

These cannot be settled from the lending protocols alone and require explicit project policy or further primary-source DEX/oracle research:

1. Which Base DEX/router and exact pools are admissible for COMP and xWELL-to-USDC harvesting, and what code-identity checks apply to them?
2. Which independent price sources, staleness bounds, TWAP windows, slippage limits, minimum trade sizes, and MEV-protected submission method define an executable reward value?
3. Are expired/off-chain rewards (notably Aave Merit-type programs) intentionally excluded, or will a separately auditable eligibility/claim module be researched?
4. What haircuts apply to rewards with insufficient distributor funding runway or an end time inside the SRCLA forecast horizon?
5. What exact block/time horizon should post-deposit rate and reward projections use, and which rounding-equivalence test vectors must TypeScript match?
6. Which archive RPC/indexing source will back reproducible historical snapshots? Protocol subgraphs can supplement but not replace transaction-time reads.
7. What implementation-change response is required when an external proxy, rate model, reward controller, transfer strategy, or market configuration changes: automatic rejection, quarantine, or a new reviewed policy version?

Until these are answered, base-rate and withdrawal-liquidity integration can be specified precisely, while volatile reward conversion should remain a separately reported, conservatively valued component.
