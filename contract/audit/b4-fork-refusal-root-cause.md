# B4 fork-replay refusal at 10,000 USDC — root cause

**Status:** HARNESS DEFECT
**Fork:** Base block 51266915 (the pinned prestate; the refused transaction was mined in block 51266919), anvil 1.4.4-stable (05794498bf); tier vault 0x9610BE4938d71A834CBa65162B19045bB4c4B4CE; transaction 0x1d39c3763c1d3837a60cc9f7e4caf80a61de068a6ac72e5d98208432cc7983fe

This reproduces the refusal from the 2026-09-13 registered run, which showed the same detail on both sealed eras: vault `0xEBBb24079B6fd4c26d84C2f1c66f4377Fb6B7C0e`, transaction `0x26b371ac585c3da1bdb91c63f05e0a217fd199183dcb87440da890aa4d5fdd87`, `"blockNumber": 51207219`, `"gasUsed": "302961"`. The reproduction's receipt also shows `"gasUsed": "302961"`. The original fork no longer exists, so its transaction cannot be traced. Matching gas to the unit is consistent with the same revert point, but it does not prove it.

This was a diagnostic run on `heldout-c`, which has been design data since v0.9. It is not a registered result. Its outputs went to `/tmp/b4-fork-debug`, and `git status --short report SRCLA-REPORT.json` printed nothing afterwards.

## Reproduction

### Bench (local Anvil fork only)

1. `anvil --fork-url https://mainnet.base.org --code-size-limit 100000 --print-traces`, with the fork head at `51266861`. `--print-traces` is there because `runForkReplays` calls `evm_revert` after every policy, which throws away the block holding the refused transaction (see *Trace*).
2. The deployer was funded out of band from aBasUSDC (`anvil_impersonateAccount`, then a USDC `transfer` of `11110000000000`). Its balance read back as `11110000000000`.
3. `forge script script/DeployAndFund.s.sol --fork-url http://127.0.0.1:8545 --broadcast --disable-code-size-limit --non-interactive`.
   Without the last two flags, forge's own simulation stops with `` Error: `Unknown0` is above the contract size limit (32378 > 24576). `` followed by `Error: IO error: not a terminal`, and nothing is broadcast. It still prints every address, but each one had code size `0`. With the flags it printed `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.` and the head moved to `51266915`.
   - 10k vault `0x9610BE4938d71A834CBa65162B19045bB4c4B4CE`: aave-v3-usdc `0x3c204937e8215274FaB559f58537262C96EB46f7`, compound-v3-usdc `0x8AFC41257f03cb1B10A57f0A551C4bEAE228701e`, moonwell-usdc `0xd72e18DA8c6FD4885bDEc973A3b6d38945CB4568`
   - 100k vault `0x49d7AF0c0A242Ca8178f00cE9dc5800C97d9579F`: aave-v3-usdc `0x21efb0c4fdA036F670A6a2b05b9Cb3bc3FbE006d`, compound-v3-usdc `0x85eD6e23AE72e645A12b2C802aac1e6649cdD1b2`, moonwell-usdc `0xce3bB7a49220155db97963bcC119e6430b10A2C9`
   - 1M vault `0xE959b47A1EaCb6dB2A3356A6A0cf5fb0387f0Bd4` and 10M vault `0xDdf4ae012Dab68c4Ef5C31C67113123C866407e9` were deployed and named in `SRCLA_FORK_REPLAY_TIER_VAULTS`, but neither run replayed them.
   - Values read back from the 10k vault at the prestate: `adminReserve() = 1000000000 [1e9]`, `dynamicReserve() = 0`, `minIdleBps() = 500`, `requiredIdle() = 1000000000 [1e9]`, `totalAssets 10000000000 [1e10]`. The 100k vault: `adminReserve() = 1000000000 [1e9]`, `minIdleBps() = 500`.
4. **`script/POST_DEPLOY.md` "Required, as `BASE_ADMIN`" was NOT applied.** That section covers `DeployBaseSystem.s.sol`, where `RewardAccountant`'s admin is `BASE_ADMIN` rather than the broadcaster. Its three steps (`setUsdcUsdFeed`, `setTokenPolicy`, `approveRoute`) configure reward valuation and harvest routes. The plan path touches the accountant in only two places. First, `currentConfigurationDigest()` folds in `accountant.configurationDigest()`, a view that works with no feed set; `buildForkPlan` reads the digest from the live vault, so the two always agree. Second, `_refreshRewardsForAllocatorAction()` calls `syncForShareAction(false)` inside `try/catch`, and that function returns `lastSafeValue` at once while `usdcUsdFeed == address(0)`. The deposit path, which does need the accountant, is never used: `DeployAndFund.s.sol` seeds each vault with a plain USDC `transfer`, and it already runs `accountant.setVault(address(_vault))` as the deployer, who is the accountant's admin there. Setting a feed would also have changed the configuration digest and the refresh behaviour compared with the bench the registered run used.

### Run

```bash
cd /home/khoa/Desktop/DATN/srcla
DATABASE_URL='postgresql://user:password@localhost:5433/srcla' \
  pnpm exec tsx scripts/run-phase4.ts --eras heldout-c --tiers 10000 --policies b4,srcla \
  --figure-stride 100000 --out-dir /tmp/b4-fork-debug > /tmp/b4-fork-debug/run.log 2>&1
```

(The `SRCLA_FORK_REPLAY_*` variables named the four vaults above. The run was started detached, so output went to `run.log` instead of through `tee`.) The §11.1 line it printed:

```
    §11.1 fork replay: 1/2 EXECUTED (0 HOLD — no chain interaction) against http://127.0.0.1:8545 at pinned block 51266915
```

The fork-replay details in `/tmp/b4-fork-debug/SRCLA-REPORT.json` (the `logsBloom` value, 512 zero hex digits, is elided):

```
srcla 10000000000: origin 0: 3 action(s) executed on the fork from pinned prestate 0x102cfe34d5d29b45724eb20db96710e129084c71030da263163f309b2ad1857e; gas 2336559; strategyAssets 0x8afc41257f03cb1b10a57f0a551c4beae228701e:+957446806,0x3c204937e8215274fab559f58537262c96eb46f7:+2340425530,0xd72e18da8c6fd4885bdec973a3b6d38945cb4568:+1702127658

b4 10000000000: b4@10000000000 REFUSED BY THE CHAIN: the vault reverted the plan: transaction execution reverted (action="sendTransaction", data=null, reason=null, invocation=null, revert=null, transaction={ "data": "", "from": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "to": "0x9610BE4938d71A834CBa65162B19045bB4c4B4CE" }, receipt={ "_type": "TransactionReceipt", "blobGasPrice": "1", "blobGasUsed": null, "blockHash": "0xddb68e4f3f831745d8cf964c97ed7f94776f115b6d773c2735f284cb38cd18a9", "blockNumber": 51266919, "contractAddress": null, "cumulativeGasUsed": "302961", "from": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "gasPrice": "1000001383", "gasUsed": "302961", "hash": "0x1d39c3763c1d3837a60cc9f7e4caf80a61de068a6ac72e5d98208432cc7983fe", "index": 0, "logs": [  ], "logsBloom": "0x…", "root": null, "status": 0, "to": "0x9610BE4938d71A834CBa65162B19045bB4c4B4CE" }, code=CALL_EXCEPTION, version=6.17.0)
```

For comparison, the same fork and prestate with `--tiers 100000 --policies b4 --out-dir /tmp/b4-fork-debug/b4-100k` printed:

```
    §11.1 fork replay: 1/1 EXECUTED (0 HOLD — no chain interaction) against http://127.0.0.1:8545 at pinned block 51266915
b4 100000000000: origin 0: 3 action(s) executed on the fork from pinned prestate 0x3f83caf8462d1eabd272a4bc55b8974f84a16520f1bc1d7a15e8104b55a8fc46; gas 2336607; strategyAssets 0x85ed6e23ae72e645a12b2c802aac1e6649cdd1b2:+31666666665,0x21efb0c4fda036f670a6a2b05b9cb3bc3fbe006d:+31666666665,0xce3bb7a49220155db97963bcc119e6430b10a2c9:+31666666665
```

## Trace

The brief's `cast run` did not work, because the runner's closing `evm_revert` had already removed the block:

```
Error: tx not found: 0x1d39c3763c1d3837a60cc9f7e4caf80a61de068a6ac72e5d98208432cc7983fe
```

The trace below is anvil's `--print-traces` output, recorded while the transactions ran (`/tmp/b4-fork-debug/anvil.log`; an excerpt is appended to `/tmp/b4-fork-debug/trace.txt`). B4's four transactions, top-level frames verbatim:

```
  [438727] 0x9610BE4938d71A834CBa65162B19045bB4c4B4CE::submitPlan((23829468545529661505564761026832272287558487648050297610514613803739744540442 [2.382e76], 1, 1789323209 [1.789e9], 1789326809 [1.789e9], 3, 51266915 [5.126e7], 0x447c12a30b53a6fe7cada1da6b98e26da8ed93e69301cfb0bc7e4e221ca38703, 0x34af0050f78774486ec40ac52f57a0d355cdfb806c0b1b33ed73b45f764f971a, 0xf7af064bd3493dd88741294da62e36ba2e44a17fe20cb1a56377813b3a3635ab, 0, 9905000001 [9.905e9], 94999999 [9.499e7], 9499999998 [9.499e9]), 0x8998d26d4902fc4982110718a2e419da729c92c6e76bc571c01d9bdf7de47b0f)
    Transaction: 0x2eb9e14c419dd531a93ff66eb2fe640c8279bfa79ffdda59954cc0028260ad02
  [654961] 0x9610BE4938d71A834CBa65162B19045bB4c4B4CE::executeNextActionWithProof([0xb13af577de63c6c6ea152bf938c520bae9fcb76e5c5bb41ee10d59f7c76414d4, 0xe659a1e55c4862e0c96550966a2de7d31b4935187166c2f730598459e7b08f9c], (23829468545529661505564761026832272287558487648050297610514613803739744540442 [2.382e76], 0, 0, 0x3c204937e8215274FaB559f58537262C96EB46f7, 3166666666 [3.166e9], 3134999999 [3.134e9], 0x0000000000000000000000000000000000000000000000000000000000000000))
    Transaction: 0x1b14d909c4433217ad8db464d7663bc877ecfe5839cd5ada55fbefa0402aaecc
  [514135] 0x9610BE4938d71A834CBa65162B19045bB4c4B4CE::executeNextActionWithProof([0xb9222d459b6a27bc38e48c24b28d8fed193cfe79680b5a60ed25ca25e7488ac8, 0xe659a1e55c4862e0c96550966a2de7d31b4935187166c2f730598459e7b08f9c], (23829468545529661505564761026832272287558487648050297610514613803739744540442 [2.382e76], 1, 0, 0x8AFC41257f03cb1B10A57f0A551C4bEAE228701e, 3166666666 [3.166e9], 3134999999 [3.134e9], 0x0000000000000000000000000000000000000000000000000000000000000000))
    Transaction: 0xfe9f420c7da334cc5dbaca5669b88fe7f59d58a58319b421cf4a8c570a61417a
```

The last frame of action 1, then the whole reverting frame, action 2. The Compound and Moonwell `configurationDigest()` sub-calls are cut where marked, and nothing else is changed:

```
    ├─ emit PlanActionExecuted(planId: 0x34af0050f78774486ec40ac52f57a0d355cdfb806c0b1b33ed73b45f764f971a, actionIndex: 1, kind: 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563, amount: 3166666666 [3.166e9])
...
    Transaction: 0xfe9f420c7da334cc5dbaca5669b88fe7f59d58a58319b421cf4a8c570a61417a
    Gas used: 478419

  [279501] 0x9610BE4938d71A834CBa65162B19045bB4c4B4CE::executeNextActionWithProof([0x1da18fc0533605278a821e852739c10603c5504a92147ddf57f800c3062d1241], (23829468545529661505564761026832272287558487648050297610514613803739744540442 [2.382e76], 2, 0, 0xd72e18DA8c6FD4885bDEc973A3b6d38945CB4568, 3166666666 [3.166e9], 3134999999 [3.134e9], 0x0000000000000000000000000000000000000000000000000000000000000000))
    ├─ [7010] 0x27bF87949D47a423baAdeEbbd9Fd64353e1ffb47::configurationDigest() [staticcall]
    │   └─ ← [Return] 0x4c24fe0b814299e0c90ab7e1b888f04bb606ec1622ccfdcaa3a02efff689e5dd
    ├─ [567] 0x3c204937e8215274FaB559f58537262C96EB46f7::configurationDigest() [staticcall]
    │   └─ ← [Return] 0x36096cf184ce042a7207c22397243c57cddb366fe6f8f5e31d89beb01bd6a5f0
    ├─ [26667] 0x8AFC41257f03cb1B10A57f0A551C4bEAE228701e::configurationDigest() [staticcall]
    │   └─ … (Comet rewardConfig / extensionDelegate / baseTrackingSupplySpeed / baseMinForRewards reads elided)
    │   └─ ← [Return] 0x31858d39d12a08e67e4a2a85d87f1fc1e126602bb657887cda48fd725bfa7374
    ├─ [80950] 0xd72e18DA8c6FD4885bDEc973A3b6d38945CB4568::configurationDigest() [staticcall]
    │   └─ … (Moonwell rewardDistributor / getAllMarketConfigs reads elided)
    │   └─ ← [Return] 0xb3a0e9eb21d9b7ea5e1ba751a4c01d931cff0f4d6c6be6118ccd9fcc83c37468
    ├─ [9750] 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913::balanceOf(0x9610BE4938d71A834CBa65162B19045bB4c4B4CE) [staticcall]
    │   ├─ [2553] 0x2Ce6311ddAE708829bc0784C967b7d77D19FD779::balanceOf(0x9610BE4938d71A834CBa65162B19045bB4c4B4CE) [delegatecall]
    │   │   └─ ← [Return] 0x00000000000000000000000000000000000000000000000000000000da8ce4ac
    │   └─ ← [Return] 0x00000000000000000000000000000000000000000000000000000000da8ce4ac
    ├─ [1250] 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913::balanceOf(0x9610BE4938d71A834CBa65162B19045bB4c4B4CE) [staticcall]
    │   ├─ [553] 0x2Ce6311ddAE708829bc0784C967b7d77D19FD779::balanceOf(0x9610BE4938d71A834CBa65162B19045bB4c4B4CE) [delegatecall]
    │   │   └─ ← [Return] 0x00000000000000000000000000000000000000000000000000000000da8ce4ac
    │   └─ ← [Return] 0x00000000000000000000000000000000000000000000000000000000da8ce4ac
    ├─ [2412] 0x27bF87949D47a423baAdeEbbd9Fd64353e1ffb47::cachedRewardAssets() [staticcall]
    │   └─ ← [Return] 0x0000000000000000000000000000000000000000000000000000000000000000
    └─ ← [Revert] custom error 0xff669004


    Transaction: 0x1d39c3763c1d3837a60cc9f7e4caf80a61de068a6ac72e5d98208432cc7983fe
    Gas used: 302961
    Error: reverted with: custom error 0xff669004

    Block Number: 51266919
    Block Hash: 0xddb68e4f3f831745d8cf964c97ed7f94776f115b6d773c2735f284cb38cd18a9
```

Decoding it:

- **Function called:** `executeNextActionWithProof`, action index `2`, kind `0` (Deploy), adapter `0xd72e18DA8c6FD4885bDEc973A3b6d38945CB4568` (moonwell-usdc), amount `3166666666`, minOut `3134999999`. The plan itself had been accepted: `submitPlan` and actions 0 and 1 were mined successfully.
- **Innermost reverting frame:** the vault itself. No adapter was called. `forge inspect NavyVaultSRCLA errors` gives `| InsufficientIdle() | ff669004 |`.
- **The check that fired:** `NavyVaultSRCLA._deploy` (`contract/src/NavyVaultSRCLA.sol:1037-1040`) reads `idle = balanceOf(vault)`, which is the `balanceOf` returns above. It then calls `_requiredIdle()`, whose `minIdleBps` term calls `totalAssets()`, which is the second `balanceOf` plus `cachedRewardAssets()`. Then comes `if (idle < amount || idle - amount < idleRequirement) revert InsufficientIdle();`. The trace stops before `_enforceExposureCaps`, `maxDeployable()` and the adapter `deposit`.
- **The numbers:** `0xda8ce4ac` = `3666666668` idle, so `3666666668 - 3166666666 = 500000002`. `requiredIdle()` on this vault = `1000000000`, which is `adminReserve() = 1000000000` and binds over `minIdleBps 500 × 10000000000 / 10000 = 500000000`. `dynamicReserve() = 0` and the plan's `reserve` is `0`. `500000002 < 1000000000` → `InsufficientIdle()`.
- **Why Moonwell:** nothing specific to Moonwell. `buildForkPlan` sorts actions by `marketId` (`aave-v3-usdc` < `compound-v3-usdc` < `moonwell-usdc`), so Moonwell is always the third deploy, and the third deploy is the one that crosses the floor.
- **`data=null, reason=null` is not "empty revert data".** `runForkReplays` sets an explicit `gasLimit`, so ethers sends without an `eth_estimateGas`/`eth_call` preflight. The error comes from `tx.wait()` on a status-0 receipt, and a receipt never carries revert data. The chain did return data: `custom error 0xff669004`.

## The plan that reverted vs the one that executed

Both plans were built on the same fork and prestate block, from the `submitPlan` and `executeNextActionWithProof` frames in the anvil trace. The 100k frames are in `anvil.log` after line 4389.

| Field | `b4@10000000000` (REFUSED) | `b4@100000000000` (EXECUTED) |
|---|---|---|
| `planId` | `23829468545529661505564761026832272287558487648050297610514613803739744540442` | `15345769880895853843414864047157022153133827921263880935052313448373836811996` |
| `policyVersion` / `actionCount` | `1` / `3` | `1` / `3` |
| `createdAt` / `expiresAt` | `1789323209` / `1789326809` | `1789323209` / `1789326809` |
| `snapshotBlockNumber` | `51266915` | `51266915` |
| `reserve` | `0` | `0` |
| `minFinalAssets` | `9905000001` | `99050000001` |
| `maxRecognizedLoss` | `94999999` | `949999999` |
| `turnoverLimit` | `9499999998` | `94999999998` |
| action 0 (Deploy, aave-v3-usdc) `amount` / `minOut` | `3166666666` / `3134999999`, executed | `31666666666` / `31349999999`, executed |
| action 1 (Deploy, compound-v3-usdc) `amount` / `minOut` | `3166666666` / `3134999999`, executed | `31666666666` / `31349999999`, executed |
| action 2 (Deploy, moonwell-usdc) `amount` / `minOut` | `3166666666` / `3134999999`, **reverted `InsufficientIdle()`** | `31666666666` / `31349999999`, executed (`Gas used: 755156`) |
| vault `totalAssets` at prestate | `10000000000` | `100000000000` |
| vault `adminReserve()` / `minIdleBps()` | `1000000000` / `500` | `1000000000` / `500` |
| vault `requiredIdle()` at prestate | `1000000000` (admin reserve binds) | `5000000000` (read back; `500 × 100000000000 / 10000`, the bps floor binds) |
| idle left by the plan (derived: `totalAssets − turnoverLimit`) | `500000002` — below `requiredIdle` | `5000000002` — at or above `requiredIdle` |

The two plans have the same shape: each deploys `totalAssets − 5%` as three equal legs. The fork runner encoded both correctly. The configuration digest matched, every Merkle proof verified, and every guard ran against the vault's own NAV. The only difference is which reserve term binds on the vault. At 100k the `minIdleBps` floor, 5,000 USDC, is above the 1,000 USDC `adminReserve`, so the harness's floor and the vault's floor are the same number. At 10k the vault's `adminReserve`, 1,000 USDC, binds, but the harness only knew about 500 USDC.

## Classification and evidence

**HARNESS DEFECT: the plan was sized against a reserve floor the vault does not have.** The trace shows the vault refusing B4's third deploy with its own `InsufficientIdle()` guard. That deploy would leave `500000002` idle against `requiredIdle() = 1000000000`, and the `1000000000` is the bench vault's `adminReserve`, set by `contract/script/VaultGuardrails.sol:84` (`uint256 internal constant ADMIN_RESERVE_BASE = 1_000e6;`, applied at `:123` by `DeployAndFund.s.sol`). The contract did what it is specified to do, and a correctly built plan could not have been accepted. This is not a vault or adapter defect: the frame reverts in the vault's idle check before any adapter call. It is also not an encoding defect in `fork-runner.ts`, since the submit and two actions went through. The fault is the amounts. B4's target came from the evaluation harness's vault model, which leaves out the $1,000 admin floor:

- `srcla/scripts/run-phase4.ts:238` (`harnessConfig`): `adminReserveBase: 0n,` beside `minIdleBps: 500`
- `srcla/src/evaluation/kernel/decision-input.ts:283`: `adminReserveBase: config.vault.adminReserveBase,`
- `srcla/src/policy/steps/reserve.ts:143`: `let floorBase = adminReserveBase > bpsFloor ? adminReserveBase : bpsFloor;` → `500000000` at 10k
- `srcla/src/evaluation/kernel/registry.ts#frozenEqualWeightTarget`: `deployable = totalAssetsBase − floor` = `9500000000`, split three ways, giving `3166666666` per leg. The 5000 bps cap (`5000000000`) does not bind.

The live keeper does not have this gap. `srcla/src/runtime/decision-driver.ts:410` takes `adminReserveBase: snap.vault.reserve.admin` from the chain, so the mismatch exists only in the evaluation harness. SRCLA and the other kernel policies passed at 10k because their plans happened to leave more idle: SRCLA's deployed `957446806 + 2340425530 + 1702127658`, about 5,000 USDC, well above 1,000 USDC. They were sized under the same $500 floor, though, so the gap is latent for them too.

**Where the fix belongs (not made here).** Some change has to make the harness's floor and the bench's floor the same number. That means either `harnessConfig`'s `adminReserveBase`, which is a registered configuration value and changes every policy's inputs at the 10k tier, or the `adminReserve` the §11.1 bench vaults are deployed with (`DeployAndFund.s.sol` via `VaultGuardrails`). Choosing between them is a registered-configuration decision. Either way the change is not in `buildForkPlan`'s encoding. A regression test can reproduce the shape from this trace: B4's 10k target of three `3166666666` deploys against a vault with `totalAssets 10000000000`, `minIdleBps 500` and `adminReserve 1000000000` must have its third deploy refused.

## Resolution

**Ruling: the bench is aligned with the registration, not the other way round.** `harnessConfig` is a registered configuration. Changing `vault.adminReserveBase` would move a registered value and change every policy's inputs at the 10k tier, which the spec's integrity rule 1 forbids. `CLAUDE.md` already required every §11.1 tier vault to carry `harnessConfig`'s registered values, and this bench did not. `VaultGuardrails.sol` and `DeployBaseSystem.s.sol` are unchanged: the deploy-ready package keeps the $1,000 `adminReserve` as a production guardrail. `harnessConfig`, `NavyVaultSRCLA.sol` and every registered threshold are unchanged too.

### The script change (`contract/script/DeployAndFund.s.sol`)

Immediately after `VaultGuardrails.applyTo(_vault, ordered);`, each tier vault gets `_vault.setAdminReserve(0)`, the registered `harnessConfig.vault.adminReserveBase = 0n`. The header now says that a run without a terminal needs `--disable-code-size-limit --non-interactive`.

The same block also sets each adapter's `absoluteCap` to `HARNESS_ABSOLUTE_CAP_BASE = 1e15`, through `setAdapterRisk`. It reads back `capBps`, `maxLossBps` and `applyTo`'s `liquidityFloorBps` and passes them through unchanged. The brief named only `adminReserve`, so this goes further than the brief. It was needed because `registerAdapter` leaves `absoluteCap` at `type(uint256).max` while `harnessConfig.defaultMarket` registers `absoluteCapBase: 10n ** 15n`, and the guard below compares registered values exactly, so a bench that fixed only the reserve would still be refused. The cap binds at no registered tier: at 10M, 5000 bps is `5e12` base units, far below `1e15`. It does change the vault's `currentConfigurationDigest()`, which covers each adapter's `absoluteCap` and the `adminReserve`. `buildForkPlan` reads that digest from the live vault, so the plan and the vault still agree.

### The guard (`srcla/src/evaluation/fork-runner.ts`)

- `forkBenchMismatches(onChain, registered)` is pure. It returns one entry per field that differs (`adminReserve`, `minIdleBps`, and each adapter's `capBps` / `absoluteCap` / `maxLossBps`), plus an entry for any adapter present on only one side. It returns an empty list when the two agree. Tests: `srcla/test/unit/evaluation/fork-bench-config.spec.ts`.
- In `runForkReplays`, `contextFor` reads each tier vault's `adminReserve()`, `minIdleBps()`, `registeredAdapters(address)` and `adapters(address)` at the untouched prestate, before the first `evm_snapshot`, and compares them with `opts.registeredBench`.
- If the list is not empty, every (policy, tier) on that vault is recorded before its `evm_revert` and before anything is submitted. Each gets `executed: false` and a detail beginning `fork bench does not carry the registered harness values:`, followed by the entries and `NOT PRODUCED: no plan was submitted … so this is not a chain verdict on the allocation`. It is never an execution and never `REFUSED BY THE CHAIN`. On an aligned bench, or when no `registeredBench` is supplied, every other result path is unchanged.
- `kernel/harness.ts#runRegisteredForkReplays` now requires `registeredBench` in its type, so the registered path cannot skip the check by leaving it out. `scripts/run-phase4.ts` builds it with `registeredForkBench(config, <the dataset's marketIds>)` from the same `config` the evaluation ran on. `registeredForkBench` resolves each market the way `kernel/decision-input.ts` does: `config.markets[id] ?? config.defaultMarket`.
- At the gate, a NOT PRODUCED entry is `executed: false`. §11.1's check therefore lists it under `did not execute on fork` and blocks, like the existing infrastructure path. `ForkReplayResult` has no per-entry NOT PRODUCED state, and `gates.ts` was not changed.

### Verification on a fresh fork (local Anvil only)

This was a diagnostic run on `heldout-c`, which has been design data since v0.9. It is not a registered result. Outputs went to `/tmp/b4-fork-fix` and `/tmp/b4-fork-guard`, and `git status --short report SRCLA-REPORT.json` printed nothing after both runs.

**Bench.** anvil 1.4.4-stable (05794498bf), `anvil --fork-url https://mainnet.base.org --code-size-limit 100000`, with the fork head at `51267808`. The deployer was funded out of band from aBasUSDC: a USDC `transfer` of `11110000000000` in block `51267809`, read back as `11110000000000`. Then `forge script script/DeployAndFund.s.sol --fork-url http://127.0.0.1:8545 --broadcast --disable-code-size-limit --non-interactive` printed `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.`, and the head moved to `51267872`, the pinned prestate. All four vaults read back code size `32378`.

- 10k vault `0x9610BE4938d71A834CBa65162B19045bB4c4B4CE`: aave-v3-usdc `0x3c204937e8215274FaB559f58537262C96EB46f7`, compound-v3-usdc `0x8AFC41257f03cb1B10A57f0A551C4bEAE228701e`, moonwell-usdc `0xd72e18DA8c6FD4885bDEc973A3b6d38945CB4568`. Values read back: `adminReserve() = 0`, `dynamicReserve() = 0`, `minIdleBps() = 500`, `requiredIdle() = 500000000`, `totalAssets() = 10000000000`. Every adapter reads `adapters(address) = 5000 1000000000000000 50 0 0 9000 <uint256 max>` (capBps, absoluteCap, maxLossBps, state, lastSyncIdleBase, liquidityFloorBps, accountingCap).
- 100k vault `0xf1f41918Eb5073831837e94bE7B73E59c1d2752a`, 1M vault `0x28eFddd2837C78ef109b5FC0C8E63A27ADFe55ea`, and 10M vault `0x2FDe3713B8bD2C181F9721282c236722E1801F20`: each reads `adminReserve=0 minIdleBps=500`, with its aave adapter at `5000 1e15 50`. These addresses differ from the reproduction's because the new per-vault admin transactions change the deployer's nonces. All four were named in `SRCLA_FORK_REPLAY_TIER_VAULTS`; only the 10k tier was replayed.

**Positive check.** `pnpm exec tsx scripts/run-phase4.ts --eras heldout-c --tiers 10000 --policies b4,srcla --figure-stride 100000 --out-dir /tmp/b4-fork-fix`:

```
    §11.1 fork replay: 2/2 EXECUTED (0 HOLD — no chain interaction) against http://127.0.0.1:8545 at pinned block 51267872
```

The fork-replay details in `/tmp/b4-fork-fix/SRCLA-REPORT.json`:

```
b4 10000000000: origin 0: 3 action(s) executed on the fork from pinned prestate 0x93ec1c82c3e1566e5824b43dc69821652dd78d627474a33b9737dbb8972ba568; gas 2353587; strategyAssets 0x3c204937e8215274fab559f58537262c96eb46f7:+3166666665,0x8afc41257f03cb1b10a57f0a551c4beae228701e:+3166666664,0xd72e18da8c6fd4885bdec973a3b6d38945cb4568:+3166666665

srcla 10000000000: origin 0: 3 action(s) executed on the fork from pinned prestate 0x93ec1c82c3e1566e5824b43dc69821652dd78d627474a33b9737dbb8972ba568; gas 2353647; strategyAssets 0x3c204937e8215274fab559f58537262c96eb46f7:+2340425530,0x8afc41257f03cb1b10a57f0a551c4beae228701e:+957446807,0xd72e18da8c6fd4885bdec973a3b6d38945cb4568:+1702127658
```

B4's plan, previously refused, now executes all three deploys, and SRCLA's still executes. The §11.1 check still reads `FAILED`, but only on completeness (`no fork replay for: b0@10000000000, …`), and the gate blocks, as it must for a restricted run. `run-phase4.ts` sets `process.exitCode = 1` whenever a gate fails.

**Negative check.** On the same fork, the 10k vault's admin (the deployer, `--unlocked`) ran `cast send 0x9610BE4938d71A834CBa65162B19045bB4c4B4CE "setAdminReserve(uint256)" 1000000000`: block `51267873`, status 1, transaction `0x4a9e2d1aecf903047d38e87fc30864b3acab7a47845e05fb08718724e320ccaa`. It then read back `adminReserve=1000000000 requiredIdle=1000000000`. The same command with `--out-dir /tmp/b4-fork-guard` printed:

```
    §11.1 fork replay: 0/2 EXECUTED (0 HOLD — no chain interaction) against http://127.0.0.1:8545 at pinned block 51267873
```

and wrote these details to `/tmp/b4-fork-guard/SRCLA-REPORT.json`:

```
b4 10000000000: fork bench does not carry the registered harness values: adminReserve: on-chain 1000000000, registered 0. b4@10000000000 NOT PRODUCED: no plan was submitted to 0x9610BE4938d71A834CBa65162B19045bB4c4B4CE, so this is not a chain verdict on the allocation

srcla 10000000000: fork bench does not carry the registered harness values: adminReserve: on-chain 1000000000, registered 0. srcla@10000000000 NOT PRODUCED: no plan was submitted to 0x9610BE4938d71A834CBa65162B19045bB4c4B4CE, so this is not a chain verdict on the allocation
```

Both results are `executed: false`, and neither says `REFUSED BY THE CHAIN`. The run exited `1`. The anvil log after the `setAdminReserve` send holds no `eth_sendRawTransaction` at all, only `eth_call`, `eth_blockNumber`, `eth_chainId`, `eth_getTransactionCount`, `eth_getTransactionReceipt`, and one `evm_snapshot` and one `evm_revert`, so nothing was submitted to the vault.
