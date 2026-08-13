# Base reward and oracle production dependencies

**Research date:** 2026-08-14  
**Purpose:** close Navy audit gates `ERC20-5` / `LENDACCESS-5`, `AMMORACLE-7`, and `AMMORACLE-8` without admitting stale or fictional reward routes.  
**Scope:** Base mainnet Aave V3 USDC, Compound III USDC, Moonwell mUSDC, Chainlink reference feeds and sequencer feed, and canonical Uniswap V3 pools.  
**Source policy:** protocol-owned documentation, repositories/deployment registries, and verified Base contracts only.

## Executive decision

The contracts can implement the three protocol-specific claim mechanisms now, but **no reward route should be enabled merely from a token constant**:

- Aave Base aUSDC is not a COMP reward source. Its only configured first-party reward at the observation block was aUSDC itself, and that distribution ended in 2024.
- Compound's Base USDC Comet is configured to pay Base COMP, but its live supply tracking speed and CometRewards COMP balance were both zero.
- Moonwell mUSDC had a live native-WELL supply stream, but it was scheduled to end on **2026-08-15 00:00:00 UTC**, less than two days after the pinned observation. Its claim entry point claims every configured token stream for the market, not only WELL.
- Chainlink now publishes an official Base sequencer uptime feed. The earlier conclusion that Base lacked one is obsolete.
- Canonical direct COMP/USDC and WELL/USDC Uniswap V3 pool objects exist, but they were not production routes at the observation block: three COMP pools and both WELL pools had zero active liquidity; the one active direct COMP pool quoted only `0.722347 USDC` for `1 COMP`. The viable observed routes were two-hop routes through WETH, which Navy's current direct-only executor cannot use.

Therefore, “ready” means: implement dynamic, exact-token claims; require active/funded emissions at activation and harvest time; add sequencer/freshness/bounds checks; support and admit a verified two-hop route (or choose a different governed venue); and leave every route disabled until a pinned activation-block conformance run succeeds.

## Observation anchor

All live values below were read with an explicit Base block tag:

| Field | Value |
|---|---|
| Chain ID | `8453` |
| Block | [`49,926,094`](https://basescan.org/block/49926094) |
| Block hash | `0xb0814321bf0e80894112f59df791bc1e471d6d63d0adfe5ff23f4b8eecaf004c` |
| Timestamp | `2026-08-13T17:18:55Z` |

This anchor makes the observations reproducible. It is **not** an activation block; every live field must be read again at deployment and immediately before enabling a route.

## 1. Aave V3 Base USDC

### Stable integration facts

The official Aave address book identifies the Base Pool, default incentives controller, USDC, and aUSDC addresses below ([Aave Base address book at commit `70e2f303`](https://github.com/aave-dao/aave-address-book/blob/70e2f303fe93616784148d6827df6644e5dda4db/src/AaveV3Base.sol)):

| Dependency | Address |
|---|---|
| Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| Default incentives controller | `0xf9cc4F0D883F1a1eb2c253bdb46c254Ca51E1F44` |
| Circle native USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| aUSDC (`aBasUSDC`, 6 decimals) | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |

The deployed aUSDC's `getIncentivesController()` returned the controller above. Aave's controller exposes the required discovery and claim surface:

```solidity
getRewardsByAsset(address asset) view returns (address[]);
getRewardsData(address asset, address reward)
  view returns (uint256 index, uint256 emissionPerSecond,
                uint256 lastUpdateTimestamp, uint256 distributionEnd);
getUserRewards(address[] assets, address user, address reward)
  view returns (uint256);
claimRewards(address[] assets, uint256 amount, address to, address reward)
  returns (uint256);
claimAllRewards(address[] assets, address to)
  returns (address[] rewardsList, uint256[] claimedAmounts);
```

These methods and the fact that reward transfer is delegated to a per-reward transfer strategy are defined by Aave's official [`RewardsController`](https://github.com/aave/aave-v3-periphery/blob/master/contracts/rewards/RewardsController.sol).

### Pinned live result

At block `49,926,094`:

- `getRewardsByAsset(aUSDC)` returned `[aUSDC]`, **not COMP**.
- `getRewardsData(aUSDC, aUSDC)` returned `emissionPerSecond = 23,148` and `distributionEnd = 1,725,375,600` (`2024-09-03T15:00:00Z`). Stored nonzero emission after the end timestamp is not a live reward.
- `getUserRewards([aUSDC], 0x...01, aUSDC)` returned zero. A newly deployed adapter cannot have historical accrual.
- The configured transfer strategy was `0x401bfC40e431fD7a340BDE4e416a08932Df40f25` and the reward oracle was `0x978D8878b53Fbe40dab7D4AB47b97AB622FFeF9f`.

The current Navy Aave adapter's hard-coded COMP declaration is therefore false and must be removed. Production code must enumerate `getRewardsByAsset(aUSDC)` and admit only exact tokens with `block.timestamp < distributionEnd`, positive emission, a positive claimable amount for the adapter, and a successful claim simulation. Off-chain Aave Merit rewards are outside this controller and must not be represented as first-party on-chain claimable rewards.

### Claim implementation requirement

The adapter owns its aUSDC position, so it is the `user` whose rewards accrue. It should query `getUserRewards([aUSDC], address(this), reward)` and call `claimRewards([aUSDC], boundedAmount, recipient, reward)`. Verify the exact reward-token balance delta at the fixed recipient. Do not use a hard-coded reward symbol or assume a reward remains configured or active.

## 2. Compound III Base USDC

### Stable integration facts

Compound's official Base USDC deployment artifacts identify the following addresses ([roots](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/deployments/base/usdc/roots.json), [configuration](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/deployments/base/usdc/configuration.json)):

| Dependency | Address |
|---|---|
| USDC Comet | `0xb125E6687d4313864e53df431d5425969c15Eb2F` |
| CometRewards | `0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1` |
| Base COMP | `0x9e1028F5F1D5eDE59748FFceE5532509976840E0` |
| Circle native USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

The deployed Comet's `baseToken()` matched native USDC. Compound's official [`CometRewards.sol`](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/contracts/CometRewards.sol) defines:

```solidity
rewardConfig(address comet)
  view returns (address token, uint64 rescaleFactor, bool shouldUpscale, uint256 multiplier);
getRewardOwed(address comet, address account)
  returns (RewardOwed memory); // accrues the account; intentionally not view
claim(address comet, address src, bool shouldAccrue);
claimTo(address comet, address src, address to, bool shouldAccrue);
```

`claim` is permissionless but pays `src`. `claimTo` redirects payment only when the caller has Comet permission from `src`. For Navy, the simplest least-authority path is `claim(COMET, address(adapter), true)`, measure COMP received by the adapter, then transfer exactly that delta to the fixed executor/vault. There is no reason to grant the allocator Comet manager permission.

### Pinned live result

At block `49,926,094`:

- `rewardConfig(COMET)` named Base COMP and returned `(rescaleFactor = 1e12, shouldUpscale = true)`.
- `baseTrackingSupplySpeed()` returned `0`.
- `baseMinForRewards()` returned `1,000,000,000` base units (`1,000 USDC`).
- `COMP.balanceOf(CometRewards)` returned `0`.
- A sampled `getRewardOwed` returned `(COMP, 0)`.

Thus COMP is the correct configured token, but this Comet was neither emitting supply rewards nor funded at the pinned block. A route must remain disabled unless all of the following are true at activation and harvest: exact reward-config token match, positive supply tracking speed, market supply at least `baseMinForRewards`, positive adapter owed amount after accrual, sufficient CometRewards token funding, and successful exact claim simulation.

## 3. Moonwell Base mUSDC

### Stable integration facts

Moonwell's official contract table and repository describe its multi-token reward distributor ([contract table](https://docs.moonwell.fi/moonwell/protocol-information/contracts), [MRD design](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/8c39a28fe6dd9dcd7aa2255c7a5ad0461d9813d3/docs/core/MULTIREWARDDISTRIBUTOR.md), [MRD interface](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/8c39a28fe6dd9dcd7aa2255c7a5ad0461d9813d3/src/rewards/IMultiRewardDistributor.sol)):

| Dependency | Address |
|---|---|
| mUSDC | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` |
| mUSDC-resolved Comptroller proxy | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` |
| Comptroller-resolved MRD | `0xe9005b078701e2A0948D2EaC43010D35870Ad9d2` |
| Native Base WELL | `0xA88594D404727625A9437C3f886C7643872296AE` |
| Deprecated Wormhole WELL | `0xFF8adeC2221f9f4D8dfbAFa6B9a297d17603493D` |
| Circle native USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Resolve the Comptroller from `mUSDC.comptroller()` and the MRD from `comptroller.rewardDistributor()` rather than relying on a stale label. Moonwell's checked-in `chains/8453.json` currently has a `COMPTROLLER` label that does not equal the proxy returned by mUSDC; the deployed market relationship is the authoritative dependency.

The MRD supports multiple reward streams for one mToken. Its stable view surface is:

```solidity
getAllMarketConfigs(mUSDC) returns (MarketConfig[]);
getOutstandingRewardsForUser(mUSDC, user) returns (RewardInfo[]);
```

Claims must be made through the Comptroller. Its official implementation exposes `claimReward(holder, mTokens)` and the expanded `claimReward(holders, mTokens, borrowers, suppliers)`; it updates and disburses every configured stream for the requested market and side ([Comptroller claim implementation](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/8c39a28fe6dd9dcd7aa2255c7a5ad0461d9813d3/src/Comptroller.sol#L1300-L1380)). Rewards are paid to each holder.

### Pinned live result

At block `49,926,094`, `getAllMarketConfigs(mUSDC)` returned three streams:

| Token | Supply speed | End | Status at observation |
|---|---:|---:|---|
| Deprecated Wormhole WELL `0xFF8a...493D` | `0` | `2024-04-19T18:00:00Z` | ended |
| Native USDC `0x8335...2913` | `24,801` base units/s | `2024-12-09T22:00:00Z` | ended; stored speed must be ignored |
| Native WELL `0xA885...96AE` | `505,295,011,690,177,700` wei/s | `2026-08-15T00:00:00Z` | active, but imminent expiry |

MRD `paused()` returned false and held balances of all three configured tokens. Funding alone is not evidence of an active stream.

### Claim implementation requirement

`Comptroller.claimReward(address(adapter), [mUSDC])` may transfer **all** configured emission tokens to the adapter. Therefore:

1. Enumerate configs and outstanding rewards by exact address before claiming.
2. Treat a stream as active only when supply speed is positive, current time is before `endTime`, MRD is not paused, funding is sufficient, and an exact simulation succeeds.
3. Snapshot balances for every token returned by `getAllMarketConfigs`, claim supply-side rewards, and measure every balance delta.
4. Transfer only admitted exact-token deltas to the fixed executor. Retain/recover unsupported historical-token deltas under a governed, non-allocator recovery path; never silently mislabel them as native WELL.

Because the native-WELL stream expires on 2026-08-15, it must be revalidated and should be expected to be inactive by deployment unless Moonwell governance extends or replaces it.

## 4. Chainlink Base feeds

### Official proxies, direction, and heartbeat

The current official Chainlink reference-data directory records these **standard** proxies ([Base feed registry JSON](https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json)):

| Feed | Standard proxy | Decimals | Heartbeat | Deviation | Category |
|---|---|---:|---:|---:|---|
| COMP/USD | `0x9DDa783DE64A9d1A60c49ca761EbE528C35BA428` | 8 | 86,400 s | 0.5% | low market risk |
| WELL/USD | `0xc15d9944dAefE2dB03e53bef8DDA25a56832C5fe` | 8 | 86,400 s | 0.5% | medium market risk |
| USDC/USD | `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B` | 8 | 86,400 s | 0.3% | low market risk |

The feeds are reward-token **per USD** and USDC **per USD**, so expected USDC output is:

```text
rewardAmount × rewardUsdAnswer / usdcUsdAnswer
```

with explicit adjustment for reward-token, feed, and USDC decimals. Do not multiply the two USD feeds. At the pinned block, on-chain `description()` returned exactly `COMP / USD`, `WELL / USD`, and `USDC / USD`; all three returned 8 decimals and valid completed rounds.

The checked-in Navy manifest value `0x7E8600988E4eB2Bf8a7e70082037cf5a2B3A9b56` is not the official Base standard USDC/USD proxy. The correct standard proxy is `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B`. Chainlink also lists distinct SVR proxies; Navy should use the standard proxy unless its architecture explicitly integrates and audits SVR semantics.

### Sequencer feed and recovery semantics

Chainlink now officially lists the Base Mainnet sequencer uptime proxy:

```text
0xBCF85224fc0756B9Fa45aA7892530B47e10b6433
```

Chainlink specifies `answer == 0` as up and `answer == 1` as down. Its example blocks operations while down and until `block.timestamp - startedAt` exceeds a one-hour recovery grace period ([official L2 sequencer uptime documentation](https://docs.chain.link/data-feeds/l2-sequencer-feeds)). At the pinned block the feed description was `L2 Sequencer Uptime Status Feed`, decimals were `0`, and the answer was `0`.

Required order before any price-dependent reward valuation or swap:

1. Read sequencer `latestRoundData()`.
2. Require a recognized answer (`0` or `1`), `answer == 0`, nonzero `startedAt`, and no future timestamp.
3. Require `block.timestamp - startedAt > recoveryGracePeriod`; configure a governed lower bound of at least the documented one-hour example.
4. Only then read both price feeds and validate positive answer, nonzero/nonfuture `updatedAt`, and completed round.

### Freshness and governed economic bounds

All three registry heartbeats are 86,400 seconds. Navy should store each feed's observed heartbeat in the admission record and enforce a governed **maximum permitted** `maxFeedAge` no greater than that heartbeat; a route may choose a tighter value. Heartbeat metadata and proxy identities can change, so they must be revalidated at activation.

The Chainlink proxy does not encode Navy's economic safety envelope. To close `AMMORACLE-8`, each policy needs governance-set `minAnswer` and `maxAnswer` in feed decimals and must reject answers at or beyond unsafe bounds. These are application risk parameters, not immutable facts. Select them through documented risk sign-off, add a timelocked update, and test zero, negative, lower-bound, upper-bound, stale, incomplete, sequencer-down, and recovery-grace cases. Chainlink explicitly assigns integrators responsibility for feed suitability, circuit breakers, value bounds, freshness checks, monitoring, and pause behavior ([quality and risk guidance](https://docs.chain.link/data-feeds/selecting-data-feeds#risk-mitigation)).

## 5. Canonical Uniswap V3 pool evidence

Uniswap's official Base deployment registry identifies Factory `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`, QuoterV2 `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`, and SwapRouter02 `0x2626664c2603336E57B271c5C0b26F421741e481` ([official Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments)). “Canonical” below means returned by that Factory's `getPool(tokenA, tokenB, fee)`; it does not mean Uniswap endorses the pool or that the pool has usable liquidity.

### Direct reward/USDC pools at block 49,926,094

| Pair | Fee | Factory result | Active `liquidity()` | Result |
|---|---:|---|---:|---|
| COMP/USDC | 0.01% (`100`) | `0xD8788855A5831c0D0BF097f86A981a925C837131` | `0` | unusable |
| COMP/USDC | 0.05% (`500`) | `0x80cfB9d554d6C31E377Ea379A1B4F8Cc9c8C7239` | `0` | unusable |
| COMP/USDC | 0.30% (`3000`) | `0xBCff326Ee018660D626B4781E2F9A558C5621D8a` | `0` | unusable |
| COMP/USDC | 1.00% (`10000`) | `0xc337cAb302c6BD9e77B1aC1C2B42702eBDfd4606` | `3,080,924,015,790` | initialized but economically poor |
| WELL/USDC | 0.01% (`100`) | `0x79782961eC13f27d63307CF58C391777Ecb3abCB` | `0` | unusable |
| WELL/USDC | 0.05% (`500`) | zero address | n/a | does not exist |
| WELL/USDC | 0.30% (`3000`) | zero address | n/a | does not exist |
| WELL/USDC | 1.00% (`10000`) | `0xA9b2Fb693Cad6e4B3d5364A6bA8C21B77a0EA2Bc` | `0` | unusable |

QuoterV2 returned `722,347` USDC base units for `1 COMP` through the direct 1% pool, while the canonical two-hop route below returned `16,022,990` USDC base units. Direct WELL quotes reverted because no direct pool had active liquidity. Pool existence alone cannot satisfy route admission.

### Viable observed two-hop identities

At the same block, the canonical factory returned active pools for:

| Hop | Fee | Pool | Active `liquidity()` |
|---|---:|---|---:|
| COMP/WETH | 1.00% | `0x3367fEDd8Ad5a8Cf01cFE89Df3c697D3A59A1cAD` | `394,653,221,064,370,001,746` |
| WELL/WETH | 1.00% | `0x722BcF6c16dAdcC29914E4E64290C46aa1406DE8` | `1,248,217,321,552,247,566,640` |
| WETH/USDC | 0.05% | `0xd0b53D9277642d899DF5C87A3966A349A798F224` | `1,058,562,476,635,386,968` |

QuoterV2 returned `16.022990 USDC` for `1 COMP` via COMP → WETH (1%) → USDC (0.05%), and `2.814435 USDC` for `1,000 WELL` via WELL → WETH (1%) → USDC (0.05%). These are observations for those exact amounts and block, not execution guarantees.

Navy's current direct-only route restriction cannot execute the observed viable paths. Production has two defensible choices: add a strictly encoded two-hop path whose tokens, fees, factory pools, token ordering, code hashes, maximum input, oracle floor, and balance deltas are all validated; or keep reward swapping disabled. Do not enable the poor direct COMP pool merely to preserve the current ABI.

## 6. Deployment-time revalidation checklist

The following are **immutable within one deployed Navy contract only if constructor-bound**: chain ID, native USDC, protocol market, controller/rewards/distributor address, executor router/factory, sequencer proxy, and admitted token/pool path. The upstream protocols and proxy implementations remain governable/upgradable.

At the recorded activation block and again immediately before activation:

- [ ] Prove chain ID `8453` and native USDC code/address/decimals.
- [ ] Aave: prove `aUSDC.UNDERLYING_ASSET_ADDRESS == USDC`, Pool reserve aToken identity, and `aUSDC.getIncentivesController`; enumerate rewards, end times, emissions, transfer strategies, funding/allowance, and adapter claimable values. Remove COMP from Aave unconditionally.
- [ ] Compound: prove Comet `baseToken`, CometRewards `rewardConfig.token`, positive supply speed, minimum threshold, adapter owed amount, and reward-contract funding.
- [ ] Moonwell: derive Comptroller from mUSDC and MRD from Comptroller; enumerate every market config, exact token, end time, supply speed, paused state, outstanding adapter rewards, and funding.
- [ ] Chainlink: prove each proxy's `description`, decimals, positive/completed fresh round, registry heartbeat/category, current proxy implementation, and no announced deprecation.
- [ ] Sequencer: prove official proxy identity, description/decimals, up status, and completed recovery grace.
- [ ] Uniswap: prove official router/factory, `factory.getPool` for every hop, pool `factory/token0/token1/fee`, nonzero active liquidity, runtime code hashes, exact-input quote for Navy's maximum batch, and a successful fork swap whose USDC balance delta meets the oracle floor.
- [ ] Pin block number/hash, all code hashes, commands, output, policy bounds, maximum ages, maximum input/notional, and governance approval in the activation evidence.
- [ ] Keep route `enabled = false` when any reward is inactive/unfunded, any feed is stale/deprecated/out of bounds, the sequencer is down/in grace, or a route fails quote/simulation.

## 7. Minimal Base call transcript

These signatures reproduce the critical live facts with `cast call ... --block 49926094 --rpc-url <trusted Base archive RPC>`:

```text
aUSDC.getIncentivesController()(address)
RewardsController.getRewardsByAsset(address)(address[])
RewardsController.getRewardsData(address,address)(uint256,uint256,uint256,uint256)

Comet.baseToken()(address)
Comet.baseTrackingSupplySpeed()(uint64)
Comet.baseMinForRewards()(uint104)
CometRewards.rewardConfig(address)((address,uint64,bool,uint256))
COMP.balanceOf(CometRewards)(uint256)

mUSDC.comptroller()(address)
Comptroller.rewardDistributor()(address)
MRD.getAllMarketConfigs(address)((address,address,uint256,uint224,uint32,uint224,uint32,uint256,uint256)[])
MRD.paused()(bool)

AggregatorV3.description()(string)
AggregatorV3.decimals()(uint8)
AggregatorV3.latestRoundData()(uint80,int256,uint256,uint256,uint80)

UniswapV3Factory.getPool(address,address,uint24)(address)
UniswapV3Pool.factory()(address)
UniswapV3Pool.token0()(address)
UniswapV3Pool.token1()(address)
UniswapV3Pool.fee()(uint24)
UniswapV3Pool.liquidity()(uint128)
QuoterV2.quoteExactInput(bytes,uint256)(uint256,uint160[],uint32[],uint256)
```

## Conclusion

The exact dependency work closes the research uncertainty but does not justify enabling rewards today. Implement the dynamic claim adapters and oracle/sequencer safeguards, support the verified two-hop route shape, and gate activation on fresh emissions and fork evidence. At the pinned state, Aave and Compound had no live reward yield, Moonwell's only live stream was about to expire, and no direct Uniswap V3 route met production expectations.
