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
it cannot honour, so the condition is visible from the read path (and to `/vault/limits`).

## Required, as `BASE_ADMIN`

1. **`accountant.setUsdcUsdFeed(<Base USDC/USD Chainlink feed>)`**
   Until this is set, `refresh()` and the §9.2 lazy refresh both return the last safe
   value without valuing anything.
   ⚠️ The `USDC_USD_FEED` constant in `DeployBaseSystem.s.sol` is **not referenced by
   `run()`** and does **not** appear in Chainlink's published Base feed directory
   (`feeds-ethereum-mainnet-base-1.json`). Read the address from that directory — do not
   copy the constant blindly.

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
