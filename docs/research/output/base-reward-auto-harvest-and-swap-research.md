# Base reward auto-harvest and swap research

**Scope.** This note evaluates how a Base-native SRCLA vault could automatically claim verifiable lending incentives and convert them to Circle native USDC. It covers the initial Compound III and Moonwell rewards (`COMP` and Base-native `WELL`), execution venues, oracle checks, transaction protections, historical cost reconstruction, and three possible contract boundaries. It compares options; it does **not** select the project architecture.

**Research date:** 2026-08-02. Stable mechanics below come from protocol-owned documentation, source repositories, and deployment registries. Live observations are separately pinned to a Base block and must not be treated as permanent configuration.

## Main findings

1. Reward eligibility must be discovered and verified on-chain. A token appearing in a deployment configuration is not proof of a currently funded emission. At the observation block, Moonwell mUSDC had an active native-WELL supply emission, but Compound's Base USDC Comet had zero supply tracking speed and its rewards contract held zero COMP.
2. The current Moonwell reward token should be called **Base-native WELL**, address `0xA88594D404727625A9437C3f886C7643872296AE`. It implements the xERC20 multichain model. The older Wormhole-wrapped WELL at `0xFF8adeC2221f9f4D8dfbAFa6B9a297d17603493D` is deprecated; “xWELL” is too ambiguous for a policy key. Use chain ID plus token address.
3. Pool existence is not evidence of usable execution. At the pinned block, the direct native-WELL/USDC pools were extremely thin. A two-hop WELL→WETH→USDC route had materially deeper reserves. For COMP, the credible observed route was also COMP→WETH→USDC rather than a direct COMP/USDC pool.
4. An off-chain DEX quote cannot be the on-chain safety control. The contract needs a fresh independent reference-price bound, a minimum USDC output, a short expiry, admitted route identity, and a balance-delta check.
5. Base has no first-party documented private-orderflow endpoint comparable to Flashbots Protect. The reproducible baseline should assume public submission and bound its exposure with small harvest batches, pending-state simulation, tight expiry, and conservative `minOut`.
6. Historical costs must include both Base L2 execution cost and L1 data-availability cost. A fork replay at a pinned block is the reproducible method; `gasUsed × gasPrice` alone is incomplete.

## 1. Reward identity and claim mechanics

### Compound III

The official Compound deployment artifacts identify the Base USDC Comet as `0xb125E6687d4313864e53df431d5425969c15Eb2F`, CometRewards as `0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1`, Circle native USDC as `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, and Base COMP as `0x9e1028F5F1D5eDE59748FFceE5532509976840E0` ([official roots](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/deployments/base/usdc/roots.json), [official configuration](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/deployments/base/usdc/configuration.json)).

Compound accrues tracking rewards in Comet and claims them through the separate CometRewards contract. `getRewardOwed` returns the configured reward token and amount; `claim(comet, src, shouldAccrue)` pays `src`, while `claimTo` can redirect payment only with the required account/manager permission ([Compound reward documentation](https://docs.compound.finance/protocol-rewards/), [CometRewards source](https://github.com/compound-finance/comet/blob/f766f51583c23acc33b2a7824654ef2029a96804/contracts/CometRewards.sol)). An adapter that owns the Comet position can therefore claim into itself without giving the allocator custody.

Eligibility checks before valuing COMP should include:

- `rewardConfig(comet).token == admitted COMP`;
- `baseTrackingSupplySpeed() > 0` and `totalSupply() >= baseMinForRewards()`;
- `getRewardOwed(comet, adapter)` is positive after a static simulation with accrual;
- CometRewards has enough COMP balance for the claim; and
- an exact claim simulation succeeds at the decision block.

If any check fails, expected COMP income for that horizon is zero and no harvest transaction should be scheduled.

### Moonwell

Moonwell's official Base registry identifies the Comptroller as `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C`, mUSDC as `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22`, and Multi-Reward Distributor (MRD) as `0xe9005b078701e2A0948D2EaC43010D35870Ad9d2` ([Moonwell Base registry](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/8c39a28fe6dd9dcd7aa2255c7a5ad0461d9813d3/chains/8453.json), [official contract table](https://docs.moonwell.fi/moonwell/protocol-information/contracts)). The MRD supports several emission tokens per market and exposes market configurations and outstanding reward views. Claims are initiated through Comptroller `claimReward`; supply-side rewards are disbursed to the position holder ([MRD design](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/8c39a28fe6dd9dcd7aa2255c7a5ad0461d9813d3/docs/core/MULTIREWARDDISTRIBUTOR.md), [Comptroller claim implementation](https://github.com/moonwell-fi/moonwell-contracts-v2/blob/8c39a28fe6dd9dcd7aa2255c7a5ad0461d9813d3/src/Comptroller.sol#L1300-L1380)).

Moonwell's registry distinguishes native WELL (`0xA885...96AE`) from deprecated Wormhole WELL (`0xFF8a...493D`). Moonwell states that native WELL replaced Wormhole WELL for Base emissions after the April 2024 transition ([migration guide](https://docs.moonwell.fi/moonwell/moonwell-overview/tokens/well-migration-base), [token registry](https://docs.moonwell.fi/moonwell/protocol-information/contracts)). Eligibility must nevertheless enumerate `getAllMarketConfigs(mUSDC)` and check each config's exact emission-token address, end time, positive supply speed, distributor funding, and claim simulation. Do not hard-code “WELL only” into generic accounting because MRD is intentionally multi-token.

## 2. Candidate Base execution venues

### Canonical direct routers

| Venue | Official Base identity | Quotation mechanics | Execution protections and integration notes |
|---|---|---|---|
| Aerodrome classic | PoolFactory `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`; Router `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | Router `getAmountsOut` calls the selected pools' current `getAmountOut`; pools also expose cumulative-observation `quote`, `prices`, and `sample`. | `swapExactTokensForTokens` enforces `amountOutMin` and `deadline`. A route includes `(from,to,stable,factory)`, so factory identity must be constrained; accepting arbitrary registered factories is too broad. ([deployment output](https://github.com/aerodrome-finance/contracts/blob/1ba30815bba620f7e9faa34769ffd00c214c9b82/script/constants/output/DeployCore-Base.json), [Router](https://github.com/aerodrome-finance/contracts/blob/1ba30815bba620f7e9faa34769ffd00c214c9b82/contracts/Router.sol), [Pool oracle](https://github.com/aerodrome-finance/contracts/blob/1ba30815bba620f7e9faa34769ffd00c214c9b82/contracts/Pool.sol)) |
| Aerodrome Slipstream | PoolFactory `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A`; Quoter `0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0`; SwapRouter `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5` | Concentrated-liquidity, size-specific off-chain quote. | A realistic additional route family, but route/pool/fee-spacing admission and replay tooling are separate from classic pools. Verify addresses against Aerodrome's [official security registry](https://aerodrome.finance/security) at admission time. |
| Uniswap v3 | Factory `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`; QuoterV2 `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`; SwapRouter02 `0x2626664c2603336E57B271c5C0b26F421741e481` | `Factory.getPool(tokenA,tokenB,fee)` identifies pools. QuoterV2 simulates a swap and reports amount, ticks crossed, and estimated gas. | QuoterV2 explicitly is not gas efficient and should be called off-chain. The transaction still needs `amountOutMinimum`; the SRCLA executor should add its own expiry check even where a selected router entry point lacks a deadline. ([Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments), [QuoterV2 source](https://github.com/Uniswap/v3-periphery/blob/main/contracts/lens/QuoterV2.sol), [v3 pool/oracle source](https://github.com/Uniswap/v3-core/blob/main/contracts/UniswapV3Pool.sol)) |

Aerodrome classic and Uniswap v3 are both realistic first integrations. “Choose the DEX” is insufficient: SRCLA must compare admitted routes for the actual reward amount because concentrated liquidity, pool reserves, fees, and price impact change by size and block.

### Aggregation as a comparator, not an implicit trust boundary

0x Swap API supports Base chain ID 8453 and can return executable aggregated calldata. Its AllowanceHolder address is documented, but the API is authenticated and routes/calldata change over time ([supported chains](https://docs.0x.org/docs/introduction/supported-chains), [Swap API flow](https://docs.0x.org/docs/introduction/quickstart/swap-tokens-with-0x-swap-api), [contract identities](https://docs.0x.org/docs/core-concepts/contracts)). That makes it useful as a live price comparator, but weaker for paper-level historical reproducibility unless every response, source breakdown, target, allowance target, calldata, block number, and API version is persisted. Letting an allocator pass arbitrary aggregator calldata would also create a much broader on-chain authority surface than an admitted route ID.

## 3. Pinned Base observations

Observations in this section use Base block **49,437,605**, hash `0xacfe7a05ea7bfba98dbb171be8e700a08c7dac4c3626a9758c63edb79fc2de17`, timestamp **2026-08-02 09:55:57 UTC**. Calls were made with an explicit block tag against official deployment addresses. They are evidence for route feasibility at one state, not a deployment decision.

### Reward state

- Compound Base USDC Comet returned `baseTrackingSupplySpeed = 0`, `baseMinForRewards = 1,000 USDC`, and total supply of approximately 8.426 million USDC. Its reward config still named Base COMP, but the CometRewards COMP balance was zero. Therefore current COMP yield was not eligible at this block.
- Moonwell mUSDC MRD returned three historical/configured streams. Deprecated Wormhole WELL and an older USDC stream had ended. Native WELL had an end time of `1786752000` (2026-08-15 00:00:00 UTC) and positive supply emissions of `505295011690177700` wei WELL/second. This stream was active at the pinned timestamp.

### Pools and route depth

- Aerodrome classic native-WELL/USDC volatile pool `0x81A8c12738F7346094526ECC2487a63f45dD1935` was verified against the canonical factory and token pair, but held only about **4,400.0733 WELL and 13.040492 USDC**. Its spot quote deteriorated sharply: approximately 1,000 WELL→2.395159 USDC, 10,000→9.027986 USDC, and 100,000→12.485568 USDC. It is not a credible sole production path.
- A materially deeper candidate was native-WELL→WETH through Aerodrome volatile pool `0x89D0F320ac73dd7d9513FFC5bc58D1161452a657`, then WETH→USDC through Aerodrome volatile pool `0xcDAC0d6c6C59727a65F871236188350531885C43`. At a nearby pinned observation of the same research session, those pools held about 210.34 million WELL/336.84 WETH and 2,062.38 WETH/3.85 million USDC respectively. The exact route must still be requoted at the decision block and amount.
- Uniswap v3 had four direct COMP/USDC pool addresses, but the direct route was economically poor at this state. QuoterV2 returned roughly **0.693867 USDC** for 1 COMP through the direct candidate versus **16.421041 USDC** through COMP→WETH (1% pool `0x3367fEDd8Ad5a8Cf01cFE89Df3c697D3A59A1cAD`) then WETH→USDC (0.05% pool `0xd0b53D9277642d899DF5C87A3966A349A798F224`) at Base block 49,437,627. This is an observation, not a permanent route promise.

The reproducible identity record for each admitted route should contain `chainId`, router, factory, ordered token path, pool address per hop, fee or stable flag, pool `token0/token1`, pool-reported factory, runtime bytecode hash, admission block number/hash, and policy version. Revalidate the factory→pool mapping and code hashes before execution; reject a mismatch.

## 4. Pricing and execution bounds

### Independent price sanity

Chainlink currently publishes Base COMP/USD, WELL/USD, and USDC/USD feeds ([COMP/USD](https://data.chain.link/feeds/base/base/comp-usd), [WELL/USD](https://data.chain.link/feeds/base/base/well-usd), [USDC/USD](https://data.chain.link/feeds/base/base/usdc-usd)). The WELL feed is categorized more conservatively than COMP by Chainlink, so token-specific staleness and deviation policies are appropriate. At policy admission, resolve and store the **full** current proxy addresses from Chainlink's official registry; never copy an abbreviated UI address.

For each feed, verify on-chain `description`, `decimals`, positive `answer`, nonzero `updatedAt`, `answeredInRound >= roundId`, a token-specific maximum age, and the admitted proxy/runtime identity. A conservative USDC reference output is:

```text
referenceOutUSDC = rewardAmount × rewardUSD / USDCUSD
oracleFloorUSDC  = referenceOutUSDC × (1 - maxOracleDeviationBps)
```

The submitted `minOut` must never be below `oracleFloorUSDC`. It may be higher when the executable quote supports a tighter bound. If either feed is stale/invalid, the admitted route is unavailable, or the executable quote is below the oracle floor, value the reward at zero for allocation and do not swap.

Moonwell's own oracle currently exposes a WELL price because mWELL is listed; that is useful as a cross-check, but it is not independent from Moonwell governance and should not be the only bound on harvesting Moonwell rewards. DEX TWAPs are useful manipulation/liquidity checks, not independent reference prices: Aerodrome observations are reserve-based at 30-minute cadence, and Uniswap v3 `observe` is based on the same pool that may execute the trade.

### Required transaction protections

- Exact admitted reward token, Circle native USDC output, router, factory, path, pools, and fee/stable flags; no allocator-supplied arbitrary target or calldata.
- Exact reward amount or a bounded `maxAmountIn`; never silently consume unrelated balances.
- `minOut` bounded by the fresh oracle floor and checked again as the adapter/vault's actual USDC balance delta.
- Short policy expiry checked by the vault/executor. Also pass the deadline to routers that expose one.
- A per-harvest maximum oracle deviation, maximum price impact, maximum route length, maximum notional, and daily reward-swap limit.
- Claim and swap atomically where the protocol permits it, so a failed swap reverts the claim and does not strand a newly claimed reward balance. If atomicity is not possible, reward balances remain accounted assets and only admitted recovery actions can move them.
- Re-simulate exact calldata against Base `pending` immediately before submission, but do not mistake the simulation for a guarantee.

### Approvals and token assumptions

Base COMP and native WELL are ordinary 18-decimal ERC-20 transfer assets in their protocol-owned implementations; neither integration should assume fee-on-transfer or rebasing behavior. The admitted-token policy should require that exact input debited and output credited match balance deltas. Do not use a fee-on-transfer router path merely “for compatibility”: it weakens amount accounting and is unnecessary for these admitted tokens.

Approval choices remain a trade-off:

- **Exact allowance then clear to zero:** smallest persistent exposure and easiest invariant, but costs more gas and some tokens require zero-first approval handling.
- **Bounded reusable allowance:** reduces recurring gas but leaves exposure to an admitted router between harvests.
- **Unlimited allowance:** cheapest operationally but gives the router the maximum consequence if compromised; unsuitable as a default for an immutable safety layer.

For exact-allowance operation, use safe force-approve semantics, approve only the canonical router/AllowanceHolder actually called, execute, and reset to zero. USDC is the output and needs no DEX approval. Never approve the 0x Settler directly; 0x explicitly documents AllowanceHolder or Permit2 as the allowance target.

## 5. MEV and submission on Base

Flashbots Protect's first-party supported-network table does not list Base; it documents Ethereum mainnet and Sepolia endpoints ([Flashbots Protect quick start](https://docs.flashbots.net/flashbots-protect/quick-start)). Base currently uses one active sequencer and standard raw-transaction submission. Flashblocks expose pending/preconfirmed state and transactions around 200 ms intervals, but Base does not document them as a private-orderflow service ([Base protocol overview](https://docs.base.org/base-chain/specs/protocol/overview), [Flashblocks API](https://docs.base.org/base-chain/api-reference/flashblocks-api/flashblocks-api-overview)). Consequently, privacy or sandwich protection should not be credited in the paper baseline.

The defensible public-submission baseline is small size-bounded harvests, independent oracle `minOut`, short expiry, pending-state simulation immediately before signing, nonce replacement/abort rules, and post-trade quote-versus-execution monitoring. A third-party Base private endpoint can only become a separate experimental treatment after first-party documentation, data-leak analysis, failure fallback, and empirical tests; its claimed benefit must not be folded into baseline results.

UniswapX is deployed on Base, but its intent/filler lifecycle is asynchronous relative to an atomic adapter call ([UniswapX deployments](https://developers.uniswap.org/docs/liquidity/uniswapx/deployments)). It would require a distinct inventory and order-state design rather than being substituted into the initial claim-and-swap transaction.

## 6. Reproducible historical execution-cost estimates

Base charges L2 execution fees and an L1 data-availability fee; the protocol specification explicitly separates priority, base, and L1-cost fees ([Base execution fees](https://docs.base.org/base-chain/specs/protocol/execution/index)). The GasPriceOracle predeploy is `0x420000000000000000000000000000000000000F` ([Base contract registry](https://docs.base.org/base-chain/network-information/base-contracts)). Its fee functions must be evaluated under the historical network upgrade active at the pinned block.

For every evaluation decision:

1. Pin Base block number and hash, repository commits, policy version, and route-admission record.
2. Archive-read reward configurations, funding, claimable balances, reference-price rounds, pool state, router/factory code hashes, Base fee state, and candidate exact-input quotes at that block.
3. Fork Base at the exact block and execute the exact claim-plus-swap calldata from the adapter state. Record success/revert, claimed token amount, USDC balance delta, gas used, logs, route, and storage changes.
4. Serialize the same signed transaction shape and calculate the historical L1 data fee through the pinned GasPriceOracle behavior. Record L2 execution and L1 data cost separately.
5. Convert ETH-denominated fees to USDC using the preregistered historical ETH/USD and USDC/USD observations with explicit staleness rules.
6. Report `netHarvestUSDC = actualUSDCReceived - L2FeeUSDC - L1DataFeeUSDC`. DEX fee and price impact are already embedded in actual output; do not subtract them twice.
7. Separately report oracle-mark-to-execution shortfall, quoted-to-executed shortfall (a latency/MEV proxy), ticks crossed or pool impact, claim gas, swap gas, and failed-attempt cost.

For realized production records, use actual transaction receipts and decoded balance deltas. For counterfactual baselines, run all admitted strategies on the same pre-state fork; executing one candidate and then another sequentially would contaminate the comparison. Persist raw RPC responses or content hashes so the result can be independently reconstructed. Provider trace APIs are optional diagnostics, not a required source of truth; archive state plus EVM fork execution is the reproducible core.

## 7. Contract-boundary comparison (no decision)

| Boundary | Advantages | Costs and risks | Required authority shape |
|---|---|---|---|
| Swap inside each strategy adapter | Position holder claims directly; claim and swap can be atomic; no reward custody leaves the adapter; protocol-specific claim invariants are local. | DEX/oracle logic is duplicated; adapters become wider and harder to audit; an immutable adapter pins more dependencies and route evolution may require replacement. | Vault-only `harvest(routeId, amount, minOut, deadline, decisionHash)`; admitted routers/routes/oracles; output only USDC to vault or immediate resupply. |
| Dedicated immutable harvester/executor | One implementation of route, oracle, approval, balance-delta, and event rules; strategy adapters remain narrower; unified historical traces. | Rewards must move from adapters or the harvester must be authorized as manager; cross-contract atomicity and recovery paths add interfaces; a shared bug affects all strategies. Moonwell normally pays the holder, so the adapter still must forward or invoke the executor. | Adapters expose narrowly scoped claim/forward operations; executor accepts only registered adapter/token/route tuples; never arbitrary calldata or recipient. |
| Allocator invokes bounded harvesting through vault/adapter | Keeps scheduling, size selection, and route choice off-chain; no separate always-on service role beyond allocator. | “Direct allocator swapping” cannot mean EOA custody or unrestricted router calls. If the key can choose targets, recipients, or arbitrary calldata, compromise bypasses the vault's non-bypassable policy. | Allocator can submit only a route ID and bounded numeric parameters to an on-chain enforcing entry point. Tokens and USDC remain in vault/adapter contracts throughout. |

The meaningful design distinction is therefore where reusable enforcement code lives, not whether the allocator sends the transaction. In all three options, the allocator transaction must terminate at an on-chain function that fixes recipients and enforces admitted tokens, routes, oracle bounds, amount limits, expiry, and USDC balance deltas.

## 8. Decisions still requiring project agreement

1. Which boundary from Section 7 should be used: protocol-local adapter harvesting, a shared immutable executor, or a vault entry point backed by shared libraries?
2. Should the first production route set include Aerodrome classic plus Uniswap v3 only, or also Aerodrome Slipstream? Each additional family adds distinct quoting, identity, and fork-test logic.
3. Is a fixed route per reward token acceptable, or may the allocator choose among a small admin-admitted set on every harvest? The pinned observations strongly favor an admitted set, but the allowed set size and change process remain unspecified.
4. What are the token-specific maximum oracle age, oracle-deviation bound, maximum harvest notional, batch sizing, minimum net-profit buffer, and daily swap cap? WELL's higher-risk Chainlink classification argues against blindly sharing COMP parameters.
5. Should exact allowances be cleared every harvest, or should narrowly bounded reusable allowances be accepted to reduce gas?
6. When rewards are claimable but temporarily unswappable, should ERC-4626 `totalAssets` value them at zero until conversion (most conservative), or include a haircut? This affects share accounting and withdrawal fairness.
7. Should third-party aggregation/private submission be excluded entirely from release one or retained only as an off-chain comparator/experimental evaluation arm?
