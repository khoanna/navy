# Post-deploy steps — `DeployBaseSystem.s.sol` (Base mainnet, chainId 8453)

`run()` broadcasts from `DEPLOYER_PRIVATE_KEY`, but `RewardAccountant`'s constructor
grants `REWARD_ADMIN_ROLE` **only to `BASE_ADMIN_ADDRESS`**. Anything that role gates is
therefore impossible for the broadcaster and must be done afterwards, as `BASE_ADMIN`.
The script prints this list at the end of every run.

## Done by the script — verify, do not repeat

| Wiring | Where |
|---|---|
| `accountant.vault() == vault` | passed to `new RewardAccountant(admin, address(vault))` |
| `vault.rewardAccountant() == accountant` | `vault.setRewardAccountant(...)` |
| `vault.rewardExecutor() == rewards` | `vault.setRewardExecutor(...)` |
| adapters registered, roles granted | see `run()` |

`accountant.vault()` is the authorisation for `syncForShareAction`, which
`NavyVaultSRCLA.deposit`/`mint` call on every share-changing action (paper §9.2). If it
does not equal the vault, **every deposit and mint reverts `Unauthorized`**. The vault
reports `maxDeposit == 0` / `maxMint == 0` in that state rather than advertising capacity
it cannot honour, so the condition is visible from the read path.

## Already set by the deploy script (verify, do not re-set)

`VaultGuardrails.applyTo` runs inside `DeployBaseSystem.s.sol`, `DeployAndFund.s.sol`
and `AnvilE2ETest.s.sol`. Confirm on the deployed vault:

| Check | Value | Why |
|---|---|---|
| `adapters(a).liquidityFloorBps` for each adapter | `9000` | Amendment P5 on chain. `0` means the `_deploy` liquidity check is skipped entirely. Not `10000`: Moonwell reports `maxWithdrawable` from `exchangeRateStored()` while `sync()` uses `exchangeRateCurrent()`, and Comet floors base units, so a 100% floor would revert on rounding. |
| `maxSynchronousLossBps()` | `5` | `0` makes **any** rounding loss revert a user withdrawal. 5 bps is ~20x tighter than the per-adapter `maxLossBps` already in force. |
| `adminReserve()` | `1000000000` ($1,000) | Paper §8.1 `I^floor`. Binds only while NAV < $200,000, where the 0.5% `minIdleBps` floor is too small to service one redemption. |
| `withdrawalOrder()` | Aave, Compound, Moonwell | §5.2 determinism. The registry order is not deterministic — `_removeAdapter` swap-and-pops. Aave's exit is exact, so the venues that shed dust are drained last. |
| `getDependencyGroup(NAVY_DEPENDENCY_BASE_L2)` and `..._NATIVE_USDC` | `capBps 10000`, all three adapters | §6.1: Base and native USDC are accepted common-mode dependencies at 100% "rather than being presented as diversification". Declaratory, not binding. |

⚠️ Two consequences worth knowing before you operate the vault:

1. A 100%-capped dependency group compares the group's **raw** `strategyAssets` sum
   against NAV, which is **net** of `adapterRecognizedLoss`. After a recognized loss the
   raw sum can exceed NAV, so further deploys to group members revert
   `DependencyGroupCapExceeded` until the loss is divested. Pinned by
   `test_aRecognizedLossMakesTheHundredPercentGroupBlockFurtherDeploys`.
2. `maxSynchronousLossBps` is proportional and therefore cannot cover a fixed base-unit
   venue floor on a **residual** pull: `_ensureIdle` tops a shortfall up with a pull of
   exactly that size, and the per-adapter allowance `mulDiv(pull, maxLossBps, 10_000)`
   floors to zero for a 2-unit pull. If every venue with liquidity sheds dust, the
   redemption reverts `AdapterLossExceeded` before the aggregate guard is reached. Pinned
   by `test_aDustSheddingVenueThatIsLastWithLiquidityStillRevertsTheRedemption`. Fixing it
   needs an absolute dust allowance on the vault, not a different bps value.

## Required, as `BASE_ADMIN`

1. **`accountant.setUsdcUsdFeed(<Base USDC/USD Chainlink feed>)`**
   Until this is set, `refresh()` and the §9.2 lazy refresh both return the last safe
   value without valuing anything.
   ⚠️ `DeployBaseSystem.s.sol` used to carry a `USDC_USD_FEED` constant that `run()`
   never referenced and that did **not** appear in Chainlink's published Base feed
   directory (`feeds-ethereum-mainnet-base-1.json`). It has been deleted. Read the
   address from that directory.

2. **`accountant.setTokenPolicy(token, policy)`** for each reward token.
   `policy.maxAge` bounds that token's own feed; `policy.cacheLifetime` bounds how long a
   refresh stays valid. Set `maxAge` from the token feed's published heartbeat.

3. **`rewards.approveRoute(routeId, route)`** for each active reward route.
   `maxRewardFeedAge` and `maxUsdcFeedAge` must be non-zero and at most
   `RewardExecutor.MAX_FEED_AGE` (48 hours).

## Optional, as `BASE_ADMIN`

- **`accountant.setUsdcFeedMaxAge(seconds)`** — defaults to
  `DEFAULT_USDC_FEED_MAX_AGE` (24 hours), sized to the published heartbeat of Chainlink's
  USDC/USD feed on Base (86400 s, 0.3 % deviation threshold). Because a stable asset
  rarely breaches a 0.3 % band, that feed normally publishes only on its heartbeat: a
  bound shorter than the heartbeat makes the USDC leg invalid for most of any given day,
  which turns the §9.2 lazy refresh into a no-op and leaves deposits closed. Only tighten
  it if the feed in use publishes more often. Accepted range is
  `(0, MAX_USDC_FEED_MAX_AGE]` = `(0, 48 hours]`.

## Re-pointing the accountant later

`vault.setRewardAccountant(newAccountant)` does **not** authorise the vault on the new
accountant. Either construct the replacement with
`new RewardAccountant(admin, address(vault))`, or call
`newAccountant.setVault(address(vault))` as `BASE_ADMIN` in the same operation. Until
then the vault reports zero deposit capacity and every deposit reverts.
