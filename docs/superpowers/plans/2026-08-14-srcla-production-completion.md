# SRCLA Production Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every reachable code and integration gate in the living contract audit, implement the approved release-one SRCLA controls, and produce a pinned-Anvil Base deployment package without broadcasting to Base mainnet.

**Architecture:** Keep custody, shares, caps, reserves, and committed plans in `NavyVaultSRCLA`; hide protocol-specific reward behavior behind `IStrategyAdapter`; concentrate conservative cached reward NAV in `RewardAccountant`; and restrict conversion to an immutable Base/USDC/Uniswap/Chainlink `RewardExecutor`. Migrate NavyPayments and its backend nonce builder atomically, then verify the full system through a deterministic deployment verifier and pinned Anvil fork.

**Tech Stack:** Solidity 0.8.24, Foundry/Anvil, OpenZeppelin Contracts 5, Uniswap V3 SwapRouter02, Chainlink Data Feeds, Aave V3, Compound III, Moonwell, TypeScript 5, ethers v6, NestJS 11, Jest, Node.js 20.

## Global Constraints

- Base chain ID is `8453`; the vault asset is native Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Work stops at a deployment-ready package. Never broadcast a Base mainnet transaction.
- Use two distinct fresh local wallets: admin/deployer/guardian and allocator.
- Never display, log, stage, commit, or push a private key. Create secret files with mode `0600` under ignored `/deploy/` only.
- Every production behavior change follows red-green TDD. Observe the focused test fail for the intended reason before changing production code.
- Reward implementation completeness does not authorize a route. Inactive, ended, unfunded, unpriceable, stale, or uneconomic rewards contribute zero and remain unswappable.
- Aave aUSDC must not advertise COMP. Compound and Moonwell reward configuration must be discovered and revalidated from their deployed controllers.
- Reward valuation uses reward/USD divided by USDC/USD, never one feed multiplied by the other.
- Price-dependent operations require the official Base sequencer feed to report up and remain up beyond a recovery grace of at least one hour.
- At most two Uniswap V3 hops are admitted; every hop commits its fee and canonical factory pool.
- Preserve unrelated working-tree changes. Do not stage or commit `De-cuong.docx` or any pre-existing unrelated edit.
- A code-complete result is not described as production-authorized until independent audit and material-fund governance gates are externally satisfied.

---

## File structure and locked interfaces

### Contract modules

- `contract/src/NavyVaultSRCLA.sol`: ERC-4626 custody, policy enforcement, persistent reserve, reward-accountant integration, claim/swap orchestration.
- `contract/src/reward/RewardAccountant.sol`: conservative cached reward NAV and issuance freshness policy.
- `contract/src/reward/RewardExecutor.sol`: immutable Base sequencer/oracle/pool/swap enforcement.
- `contract/src/interfaces/IStrategyAdapter.sol`: one strategy seam for principal plus exact-token rewards.
- `contract/src/interfaces/IRewardAccountant.sol`: narrow vault-to-accountant seam.
- `contract/src/interfaces/IRewardExecutor.sol`: route and swap seam.
- `contract/src/interfaces/IAaveV3.sol`, `IComet.sol`, `IMToken.sol`: protocol-owned surfaces only.
- `contract/src/libraries/VaultTypes.sol`: canonical policy, group, plan, action, and harvest structs.

The strategy reward interface is locked as:

```solidity
function rewardTokens() external view returns (address[] memory);
function claimableReward(address token) external returns (uint256);
function claimReward(address token, uint256 maxAmount, address recipient)
    external
    returns (uint256 claimed);
```

`claimableReward` is intentionally non-view because Compound's exact owed calculation may accrue state. Only the vault may invoke mutating reward methods. For Moonwell, `claimReward` may cause several protocol tokens to arrive at the adapter; it transfers only the admitted requested-token delta to `recipient`, leaving other exact-token deltas quarantined in the adapter.

The reward-accountant interface is locked as:

```solidity
function cachedRewardAssets() external view returns (uint256);
function issuanceReady() external view returns (bool);
function refresh(address[] calldata adapters) external returns (uint256 conservativeAssets);
function configurationDigest() external view returns (bytes32);
```

The reward-executor route stores `address[] path`, `uint24[] fees`, `address[] pools`, reward/USD and USDC/USD feed policies, `maxAmountIn`, `maxDailyNotional`, output/impact BPS, deadline policy, activation block/hash, and a canonical digest. The swap interface is:

```solidity
function swap(bytes32 routeId, uint256 amountIn, uint256 callerMinOut, uint256 deadline)
    external
    returns (uint256 amountOut);
```

### TypeScript modules

- `be/src/payments/relayer.service.ts`: obtains the exact on-chain invoice authorization nonce.
- `be/src/evm/navy-payments-abi.json`: generated ABI parity artifact.
- `be/scripts/evm-e2e.mjs`: live Sepolia authorization/cutover proof.
- `srcla/src/chain/abis/*.json`: regenerated vault/adapter/accountant/executor interfaces.
- `srcla/src/admission/*`, `collector/*`, `execution/*`: consume new policy/configuration and reward state.
- `be/scripts/generate-deploy-wallets.mjs`: local secret generator with exclusive file creation and `0600` mode.
- `contract/script/DeployBaseSystem.s.sol`: deploy/configure only.
- `contract/script/VerifyBaseSystem.s.sol`: independent read-only conformance verifier.
- `contract/test/integration/BaseDeploymentAnvil.t.sol`: pinned-fork end-to-end acceptance.

---

### Task 1: Protect and generate local deployment identities

**Files:**
- Modify: `.gitignore`
- Create: `be/scripts/generate-deploy-wallets.mjs`
- Create at runtime only: `deploy/base-wallets.env`
- Create at runtime only: `deploy/README.private.md`
- Test: `be/test/unit/scripts/generate-deploy-wallets.spec.ts`

**Interfaces:**
- Produces: `BASE_ADMIN_PRIVATE_KEY`, `BASE_ADMIN_ADDRESS`, `BASE_ALLOCATOR_PRIVATE_KEY`, `BASE_ALLOCATOR_ADDRESS` in an ignored mode-`0600` env file.
- Produces: a private operator note containing addresses, role descriptions, funding/rotation instructions, and no accidental console output.

- [ ] **Step 1: Write the failing secret-generator test**

Test the exported `generateWalletFiles(outputDir)` with a temporary directory. Assert the two addresses differ, each private key matches `^0x[0-9a-f]{64}$`, `new Wallet(key).address` matches its address, both files have permission `0600`, a second invocation fails without overwriting, and captured stdout/stderr contain neither private key.

- [ ] **Step 2: Run the test and observe the missing-module failure**

Run: `cd be && pnpm test -- generate-deploy-wallets.spec.ts --runInBand`

Expected: FAIL because `scripts/generate-deploy-wallets.mjs` does not exist.

- [ ] **Step 3: Implement the generator and ignore rule**

Add `/deploy/` to the root `.gitignore`. Implement the script with `Wallet.createRandom()`, `mkdirSync(outputDir, { recursive: true, mode: 0o700 })`, and `writeFileSync(envPath, envBody, { flag: 'wx', mode: 0o600 })` plus the equivalent exclusive write for the private note. Export the function for tests; invoke it only when the module is the CLI entry point. Print only the two public addresses and created file paths.

- [ ] **Step 4: Prove ignore, permissions, no overwrite, and no tracked secrets**

Run:

```bash
cd be
pnpm test -- generate-deploy-wallets.spec.ts --runInBand
node scripts/generate-deploy-wallets.mjs ../deploy
git check-ignore -v ../deploy/base-wallets.env ../deploy/README.private.md
stat -c '%a %n' ../deploy/base-wallets.env ../deploy/README.private.md
git status --short -- ../deploy ../.gitignore scripts/generate-deploy-wallets.mjs
```

Expected: test PASS; both files ignored and mode `600`; only `.gitignore`, generator, and test are trackable.

- [ ] **Step 5: Commit only public generator files**

```bash
git add .gitignore be/scripts/generate-deploy-wallets.mjs be/test/unit/scripts/generate-deploy-wallets.spec.ts
git commit -m "chore: generate isolated Base deployment wallets"
```

### Task 2: Enforce absolute caps, dependency groups, persistent reserve, and aggregate exit loss

**Files:**
- Modify: `contract/src/NavyVaultSRCLA.sol`
- Modify: `contract/src/libraries/VaultTypes.sol`
- Modify: `contract/src/interfaces/IVaultEvents.sol`
- Test: `contract/test/vault/VaultPolicy.t.sol`
- Test: `contract/test/NavyVaultSRCLA.t.sol`

**Interfaces:**
- Produces: `setAdapterRisk(address,uint16,uint256,uint16)`, where arguments are cap BPS, absolute USDC cap, and max loss BPS.
- Produces: `setDependencyGroup(bytes32,uint16,uint256,address[])` with BPS cap, absolute cap, and at most 16 unique registered members.
- Produces: `setAdminReserve(uint256)`, `dynamicReserve()`, and `setMaxSynchronousLossBps(uint16)`.
- Changes: a completed plan persists `header.reserve` as `dynamicReserve`; required idle is `max(adminReserve, dynamicReserve, activePlanReserve)`.

- [ ] **Step 1: Write failing public-interface policy tests**

Cover: adapter absolute cap; group aggregate BPS and absolute caps; duplicate/unregistered group members; group/member bounds; plan reserve persistence after completion/expiry; inability to reduce below admin reserve; paused deploy action; aggregate loss across two adapters; exact user withdrawal or atomic revert.

- [ ] **Step 2: Run focused tests and record intended failures**

Run: `cd contract && forge test --match-path test/vault/VaultPolicy.t.sol -vv`

Expected: FAIL on missing setters/state and current per-adapter-only loss behavior.

- [ ] **Step 3: Implement bounded policy state and configuration digest**

Add `absoluteCap` to adapter config; bounded dependency groups with `MAX_DEPENDENCY_GROUPS = 16`; admin/dynamic reserve; global synchronous-loss BPS. Include every value, ordered group membership, and adapter configuration digest in `currentConfigurationDigest()` so active plans fail after policy drift.

- [ ] **Step 4: Implement enforcement and aggregate loss accounting**

Enforce `min(percentCap, absoluteCap, external headroom)` before deploy. Enforce all group caps using tracked `strategyAssets`. In `_ensureIdle`, accumulate strategy value debited and USDC received across pulls; source subsequent adapters until the exact requested USDC is idle; revert if cumulative realized loss exceeds `assets * maxSynchronousLossBps / 10_000` or exact liquidity is unavailable.

- [ ] **Step 5: Make pause and reserve behavior match the paper**

Reject Deploy and Harvest actions while paused. Permit Divest/EmergencyExit. On successful final plan action, persist its reserve before clearing the plan. Expiry stops actions but never clears the persistent reserve.

- [ ] **Step 6: Run policy and existing vault suites**

```bash
cd contract
forge test --match-path test/vault/VaultPolicy.t.sol -vv
forge test --match-path test/NavyVaultSRCLA.t.sol -vv
forge test --match-path test/vault/MerklePlanExecution.t.sol -vv
```

Expected: all focused suites PASS.

- [ ] **Step 7: Commit the policy slice**

```bash
git add contract/src/NavyVaultSRCLA.sol contract/src/libraries/VaultTypes.sol contract/src/interfaces/IVaultEvents.sol contract/test/vault/VaultPolicy.t.sol contract/test/NavyVaultSRCLA.t.sol
git commit -m "feat(contract): enforce full vault risk policy"
```

### Task 3: Deepen the strategy reward seam and fix Aave reward discovery

**Files:**
- Modify: `contract/src/interfaces/IStrategyAdapter.sol`
- Modify: `contract/src/interfaces/IRewardSource.sol`
- Modify: `contract/src/interfaces/IAaveV3.sol`
- Modify: `contract/src/adapters/AaveV3Adapter.sol`
- Test: `contract/test/adapters/AaveV3AdapterRewards.t.sol`
- Test: `contract/test/AaveV3AdapterFork.t.sol`

**Interfaces:**
- Consumes: Aave aUSDC-derived incentives controller.
- Produces: dynamic exact-token discovery and vault-only bounded `claimReward(token,maxAmount,recipient)`.
- Invariant: Aave never advertises COMP unless the deployed controller actually returns COMP for aUSDC.

- [ ] **Step 1: Replace hard-coded COMP tests with failing live-controller behavior tests**

Unit mocks cover ended reward, zero emission, unsupported token, maximum amount, recipient delta, and non-vault caller. Fork tests assert `aUSDC.getIncentivesController`, enumerate `getRewardsByAsset(aUSDC)`, and prove the pinned ended aUSDC stream contributes zero.

- [ ] **Step 2: Run tests and observe the false-COMP and missing-claim failures**

Run: `cd contract && forge test --match-path test/adapters/AaveV3AdapterRewards.t.sol -vv`

- [ ] **Step 3: Implement exact Aave reward interfaces and adapter logic**

Add `getIncentivesController`, `getRewardsByAsset`, `getRewardsData`, `getUserRewards`, and `claimRewards`. Derive controller identity in the constructor, include it in `configurationDigest`, filter ended/zero-emission tokens, measure recipient balance delta, and reject a controller return that disagrees with the delta.

- [ ] **Step 4: Run unit and pinned fork tests**

```bash
cd contract
forge test --match-path test/adapters/AaveV3AdapterRewards.t.sol -vv
BASE_RPC_URL="$BASE_RPC_URL" BASE_FORK_BLOCK=49926094 forge test --match-path test/AaveV3AdapterFork.t.sol -vv
```

- [ ] **Step 5: Commit the Aave reward slice**

```bash
git add contract/src/interfaces/IStrategyAdapter.sol contract/src/interfaces/IRewardSource.sol contract/src/interfaces/IAaveV3.sol contract/src/adapters/AaveV3Adapter.sol contract/test/adapters/AaveV3AdapterRewards.t.sol contract/test/AaveV3AdapterFork.t.sol
git commit -m "feat(contract): discover and claim exact Aave rewards"
```

### Task 4: Implement exact Compound III rewards

**Files:**
- Modify: `contract/src/interfaces/IComet.sol`
- Modify: `contract/src/adapters/CompoundAdapter.sol`
- Test: `contract/test/adapters/CompoundAdapterRewards.t.sol`
- Test: `contract/test/CompoundAdapterFork.t.sol`

**Interfaces:**
- Consumes: official CometRewards at `0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1`.
- Produces: exact configured token discovery, accrued owed amount, funding/emission checks, and vault-only bounded claim.

- [ ] **Step 1: Write failing reward configuration and funding tests**

Cover token mismatch, zero `baseTrackingSupplySpeed`, supply below `baseMinForRewards`, zero owed, insufficient rewards balance, maximum claim, exact recipient delta, and non-vault caller.

- [ ] **Step 2: Observe the current zero-stub failure**

Run: `cd contract && forge test --match-path test/adapters/CompoundAdapterRewards.t.sol -vv`

- [ ] **Step 3: Implement `ICometRewards` and Compound claim logic**

Constructor-bind CometRewards and verify `rewardConfig(comet).token`. Use `getRewardOwed` where state accrual is required, `claim(comet,address(this),true)`, measured adapter and recipient deltas, and `maxAmount`. Report zero when speed/funding/threshold/owed checks fail.

- [ ] **Step 4: Run unit and pinned fork tests**

```bash
cd contract
forge test --match-path test/adapters/CompoundAdapterRewards.t.sol -vv
BASE_RPC_URL="$BASE_RPC_URL" BASE_FORK_BLOCK=49926094 forge test --match-path test/CompoundAdapterFork.t.sol -vv
```

- [ ] **Step 5: Commit the Compound reward slice**

```bash
git add contract/src/interfaces/IComet.sol contract/src/adapters/CompoundAdapter.sol contract/test/adapters/CompoundAdapterRewards.t.sol contract/test/CompoundAdapterFork.t.sol
git commit -m "feat(contract): integrate Compound III rewards"
```

### Task 5: Implement multi-token Moonwell reward safety

**Files:**
- Modify: `contract/src/interfaces/IMToken.sol`
- Modify: `contract/src/adapters/MoonwellAdapter.sol`
- Test: `contract/test/adapters/MoonwellAdapterRewards.t.sol`
- Test: `contract/test/MoonwellAdapterFork.t.sol`

**Interfaces:**
- Consumes: `mUSDC.comptroller()` then `comptroller.rewardDistributor()`.
- Produces: exact MRD token enumeration, active-stream filtering, requested-token transfer, and quarantine of all other claimed token deltas.
- Produces: admin-only `recoverUnsupportedReward(address token,address recipient,uint256 amount)` with no allocator authority and no USDC/mUSDC recovery.

- [ ] **Step 1: Write failing multi-stream and quarantine tests**

Mock three streams: ended Wormhole WELL, ended USDC, active native WELL. Prove only active native WELL is advertised; `claimReward(WELL, maxAmount, recipient)` measures all post-claim balances, transfers bounded WELL, leaves other token deltas in the adapter, and cannot recover principal/receipt tokens.

- [ ] **Step 2: Observe current WELL-only stub failure**

Run: `cd contract && forge test --match-path test/adapters/MoonwellAdapterRewards.t.sol -vv`

- [ ] **Step 3: Implement MRD discovery, claim, and recovery**

Add exact `MarketConfig`/`RewardInfo` layouts, `rewardDistributor`, `paused`, `getAllMarketConfigs`, and `getOutstandingRewardsForUser`. Resolve dependency identity in the constructor and digest. Treat `supplyEmissionsPerSec > 0 && block.timestamp < endTime && !paused` as necessary, not sufficient; also require positive outstanding/funding.

- [ ] **Step 4: Run unit and pinned fork tests**

```bash
cd contract
forge test --match-path test/adapters/MoonwellAdapterRewards.t.sol -vv
BASE_RPC_URL="$BASE_RPC_URL" BASE_FORK_BLOCK=49926094 forge test --match-path test/MoonwellAdapterFork.t.sol -vv
```

- [ ] **Step 5: Commit the Moonwell reward slice**

```bash
git add contract/src/interfaces/IMToken.sol contract/src/adapters/MoonwellAdapter.sol contract/test/adapters/MoonwellAdapterRewards.t.sol contract/test/MoonwellAdapterFork.t.sol
git commit -m "feat(contract): secure Moonwell multi-token rewards"
```

### Task 6: Add conservative cached reward NAV

**Files:**
- Create: `contract/src/reward/RewardAccountant.sol`
- Modify: `contract/src/interfaces/IRewardAccountant.sol`
- Modify: `contract/src/NavyVaultSRCLA.sol`
- Modify: `contract/src/libraries/VaultTypes.sol`
- Test: `contract/test/reward/RewardAccountant.t.sol`
- Test: `contract/test/vault/VaultRewardAccounting.t.sol`

**Interfaces:**
- Produces: admin-managed `TokenPolicy` containing exact token/feed identities, feed descriptions, decimals, maximum ages, inclusive unsafe bounds, haircut BPS, contribution cap, materiality threshold, cache lifetime, and allowed adapters.
- Produces: `refresh(adapters)` and read-only `cachedRewardAssets/issuanceReady/configurationDigest`.
- Vault total assets become idle USDC + strategy assets + conservative cached rewards.

- [ ] **Step 1: Write failing oracle-math and cache tests**

Cover reward/USD divided by USDC/USD across 6/8/18 decimals, haircut rounding down, absolute cap, held+claimable aggregation, duplicate token prevention, unsupported adapter, stale feed, bound equality, incomplete round, sequencer down, recovery grace, stale cache, immaterial expired cache, and failure never increasing prior NAV.

- [ ] **Step 2: Write failing vault issuance tests**

Prove `maxDeposit/maxMint == 0` and deposit/mint revert when a material cache is stale/invalid; withdrawal/redeem exclude reward value from synchronous liquidity; successful refresh changes share NAV conservatively without minting assets.

- [ ] **Step 3: Observe failures before implementation**

```bash
cd contract
forge test --match-path test/reward/RewardAccountant.t.sol -vv
forge test --match-path test/vault/VaultRewardAccounting.t.sol -vv
```

- [ ] **Step 4: Implement the accountant and one-way safety rules**

Validate sequencer first, then both feed rounds. Calculate:

```text
reward base units
× reward/USD answer
÷ reward token scale
× USDC scale
÷ USDC/USD answer
× haircutBps
÷ 10_000
```

Round every value contribution down. Cap per token before summing. On invalid refresh, preserve no value greater than the last safe cache and mark material issuance unready.

- [ ] **Step 5: Integrate the vault seam**

Add a one-time-or-governed `setRewardAccountant` with vault/asset identity validation. Include its configuration digest in the vault configuration digest. Invoke refresh before share issuance; read cached value in `totalAssets`; never include it in `synchronousLiquidity`.

- [ ] **Step 6: Run accountant, vault, and invariant-adjacent suites**

```bash
cd contract
forge test --match-path test/reward/RewardAccountant.t.sol -vv
forge test --match-path test/vault/VaultRewardAccounting.t.sol -vv
forge test --match-path test/NavyVaultSRCLA.t.sol -vv
```

- [ ] **Step 7: Commit reward accounting**

```bash
git add contract/src/reward/RewardAccountant.sol contract/src/interfaces/IRewardAccountant.sol contract/src/NavyVaultSRCLA.sol contract/src/libraries/VaultTypes.sol contract/test/reward/RewardAccountant.t.sol contract/test/vault/VaultRewardAccounting.t.sol
git commit -m "feat(contract): account for conservative reward NAV"
```

### Task 7: Replace direct-only swaps with strictly admitted one/two-hop routes

**Files:**
- Modify: `contract/src/interfaces/IRewardExecutor.sol`
- Modify: `contract/src/reward/RewardExecutor.sol`
- Test: `contract/test/reward/RewardExecutor.t.sol`
- Create: `contract/test/reward/RewardExecutorBaseFork.t.sol`

**Interfaces:**
- Constructor consumes vault, admin, canonical USDC, factory, router, sequencer feed, and recovery grace.
- Route consumes `path.length` 2 or 3, `fees.length == pools.length == path.length - 1`, two feed policies, max input, daily notional, bounds, and activation evidence.
- Swap consumes route ID, exact input, caller minimum, and deadline.

- [ ] **Step 1: Write failing constructor/route tests**

Reject wrong chain, non-USDC output, wrong router/factory/sequencer identity, invalid path lengths, repeated/zero tokens, mismatched arrays, invalid fee tiers including unsupported fee, wrong factory pool, wrong pool token order/fee/factory/codehash, no liquidity, stale activation block hash, and noncanonical digest.

- [ ] **Step 2: Write failing oracle and execution tests**

Cover sequencer answer 1/unknown, zero/future `startedAt`, grace boundary, stale/incomplete/future feed rounds, description/decimal mismatch, lower/upper bound equality, reward/USD divided by USDC/USD, expired deadline, max input, daily cap, exact allowance reset, router return/balance-delta mismatch, output below floor, excessive impact, and trapped token prevention.

- [ ] **Step 3: Observe failures against current direct-only executor**

Run: `cd contract && forge test --match-path test/reward/RewardExecutor.t.sol -vv`

- [ ] **Step 4: Implement immutable dependencies and route admission**

Use canonical factory `getPool` for every hop and validate each pool interface. Store canonical route digest over all fields except the caller-supplied digest; require `routeId == digest` to eliminate mutable aliases. Allow fee tiers `100`, `500`, `3000`, and `10000` only when a canonical pool exists and passes policy.

- [ ] **Step 5: Implement dual-feed oracle math and two-hop SwapRouter02 calldata**

Encode `token,fee,token[,fee,token]`; enforce deadline before transfer. Measure executor balances rather than trusting only router return. Reset router allowance before sending exact USDC delta to the vault.

- [ ] **Step 6: Run unit and pinned Base route tests**

```bash
cd contract
forge test --match-path test/reward/RewardExecutor.t.sol -vv
BASE_RPC_URL="$BASE_RPC_URL" BASE_FORK_BLOCK=49926094 forge test --match-path test/reward/RewardExecutorBaseFork.t.sol -vv
```

Fork assertions include canonical COMP/WETH 1% and WELL/WETH 1% pools, WETH/USDC 0.05%, exact pool metadata, official feeds, sequencer state, and quoted/synthetic-funded swap behavior clearly separated from activation evidence.

- [ ] **Step 7: Commit the executor replacement**

```bash
git add contract/src/interfaces/IRewardExecutor.sol contract/src/reward/RewardExecutor.sol contract/test/reward/RewardExecutor.t.sol contract/test/reward/RewardExecutorBaseFork.t.sol
git commit -m "feat(contract): enforce Base reward conversion policy"
```

### Task 8: Make vault harvest atomic and exact-token aware

**Files:**
- Modify: `contract/src/NavyVaultSRCLA.sol`
- Modify: `contract/src/libraries/VaultTypes.sol`
- Modify: `contract/src/interfaces/IVaultEvents.sol`
- Modify: `contract/test/vault/VaultHarvest.t.sol`
- Modify: `contract/test/integration/RewardFlowFork.t.sol`

**Interfaces:**
- Produces: `harvest(address adapter,address token,uint256 maxClaim,bytes32 routeId,uint256 minOut,uint256 deadline)`.
- Plan Harvest action commits a hash of the complete harvest request rather than interpreting `amount` as a route ID.
- Invariant: only measured admitted token delta is approved/swapped; no route means claimed token stays at its defined custody location and contributes only through conservative accounting.

- [ ] **Step 1: Write failing exact claim/swap tests**

Cover unsupported token, inactive adapter, zero claim, bounded partial claim, wrong returned amount, unexpected token, route/token mismatch, paused ordinary harvest, deadline, allowance reset, exact USDC delta, cached reward refresh after claim/swap, and no reward/NAV double count.

- [ ] **Step 2: Observe failure against current pre-funded-vault assumption**

Run: `cd contract && forge test --match-path test/vault/VaultHarvest.t.sol -vv`

- [ ] **Step 3: Implement atomic adapter claim and executor swap**

Snapshot vault token balance, call adapter claim to vault, require the measured delta equals returned claim and is no greater than `maxClaim`, then swap exactly the delta. Remove fallback route IDs and caller ambiguity. Refresh reward accounting after state changes.

- [ ] **Step 4: Commit full harvest requests in Merkle actions**

Extend the canonical action struct with `bytes32 dataHash`, hash `abi.encode(HarvestRequest)`, and require the supplied request hash during execution. Preserve strict ordering/domain/configuration checks.

- [ ] **Step 5: Run local and fork integration tests**

```bash
cd contract
forge test --match-path test/vault/VaultHarvest.t.sol -vv
BASE_RPC_URL="$BASE_RPC_URL" BASE_FORK_BLOCK=49926094 forge test --match-path test/integration/RewardFlowFork.t.sol -vv
forge test --match-path test/vault/MerklePlanExecution.t.sol -vv
```

- [ ] **Step 6: Commit harvest integration**

```bash
git add contract/src/NavyVaultSRCLA.sol contract/src/libraries/VaultTypes.sol contract/src/interfaces/IVaultEvents.sol contract/test/vault/VaultHarvest.t.sol contract/test/integration/RewardFlowFork.t.sol contract/test/vault/MerklePlanExecution.t.sol
git commit -m "feat(contract): claim and convert exact strategy rewards"
```

### Task 9: Close the invoice fee rounding risk

**Files:**
- Modify: `contract/src/NavyPayments.sol`
- Modify: `contract/test/NavyPayments.t.sol`
- Modify: `contract/test/NavyPayments.fuzz.t.sol`

**Interfaces:**
- Changes: `fee = Math.mulDiv(amount, feeBps, 10_000, Math.Rounding.Ceil)` when `feeBps > 0`; zero BPS remains zero.
- Invariant: merchant amount + fee equals invoice amount and fee differs from the exact rational fee by less than one base unit.

- [ ] **Step 1: Write failing boundary and fuzz tests**

Add examples `10_001` at 100 BPS => fee `101`, exact multiples unchanged, zero BPS zero, maximum BPS, minimum invoice, and fuzz conservation/ceiling inequalities.

- [ ] **Step 2: Observe the floor-rounding failure**

Run: `cd contract && forge test --match-contract NavyPaymentsTest --match-test test_feeRoundsUp -vv`

- [ ] **Step 3: Implement OpenZeppelin ceiling multiplication/division**

Import `Math`, branch zero BPS to avoid charging one unit, and leave the atomic EIP-3009/split flow unchanged.

- [ ] **Step 4: Run payment unit and fuzz suites**

```bash
cd contract
forge test --match-path test/NavyPayments.t.sol -vv
forge test --match-path test/NavyPayments.fuzz.t.sol -vv
```

- [ ] **Step 5: Commit fee policy**

```bash
git add contract/src/NavyPayments.sol contract/test/NavyPayments.t.sol contract/test/NavyPayments.fuzz.t.sol
git commit -m "fix(contract): round invoice fees up"
```

### Task 10: Migrate backend authorization nonce and ABI atomically

**Files:**
- Modify: `be/src/payments/relayer.service.ts`
- Modify: `be/src/evm/payment-authorization.ts`
- Regenerate: `be/src/evm/navy-payments-abi.json`
- Modify: `be/test/unit/payments/relayer.service.spec.ts`
- Modify: `be/test/unit/evm/payment-authorization.spec.ts`
- Modify: `be/scripts/evm-e2e.mjs`
- Create: `be/scripts/check-contract-abi-parity.mjs`

**Interfaces:**
- Consumes: `payments.authorizationNonce(bytes16 merchantId,bytes16 invoiceId) -> bytes32` from the configured deployment.
- Produces: typed data containing that exact nonce; local `invoiceKey` remains only for stable paid-state/watcher lookup.
- Failure: contract-read or chain/address mismatch returns service unavailable and persists no authorization digest.

- [ ] **Step 1: Rewrite relayer tests to require the contract nonce**

Mock `payments.authorizationNonce` with a value distinct from `invoiceKey`. Assert it is called with exact bytes16 IDs, returned in typed data, and used in the persisted digest. Assert rejection and no database update on read failure.

- [ ] **Step 2: Observe the legacy local-nonce failure**

Run: `cd be && pnpm test -- relayer.service.spec.ts payment-authorization.spec.ts --runInBand`

- [ ] **Step 3: Implement on-chain nonce retrieval and remove misleading comments**

Keep `invoiceKey` exported for watcher state only. In `buildAuthorization`, call the configured contract before typed-data construction and validate returned `bytes32` shape.

- [ ] **Step 4: Regenerate ABI and add parity check**

Extract `.abi` from `contract/out/NavyPayments.sol/NavyPayments.json` into the backend runtime JSON using the existing artifact shape. The parity script canonicalizes function/event/error fragments and fails on any difference.

- [ ] **Step 5: Update the live E2E script**

Read `authorizationNonce` from NavyPayments, assert it differs after payout/config changes, sign it, verify ceiling split, replay rejection, and invalidation of the pre-change signature.

- [ ] **Step 6: Run focused tests, ABI parity, and backend build**

```bash
cd contract && forge build
cd ../be
pnpm test -- relayer.service.spec.ts payment-authorization.spec.ts chain-watcher.service.spec.ts --runInBand
node scripts/check-contract-abi-parity.mjs
pnpm build
```

- [ ] **Step 7: Commit the atomic integration migration**

```bash
git add be/src/payments/relayer.service.ts be/src/evm/payment-authorization.ts be/src/evm/navy-payments-abi.json be/test/unit/payments/relayer.service.spec.ts be/test/unit/evm/payment-authorization.spec.ts be/scripts/evm-e2e.mjs be/scripts/check-contract-abi-parity.mjs
git commit -m "fix(payments): use configuration-bound authorization nonce"
```

### Task 11: Align the SRCLA service with on-chain policy and reward state

**Files:**
- Regenerate: `srcla/src/chain/abis/vault.json`
- Create: `srcla/src/chain/abis/reward-accountant.json`
- Create: `srcla/src/chain/abis/reward-executor.json`
- Modify: `srcla/src/collector/types.ts`
- Modify: `srcla/src/collector/snapshot-collector.ts`
- Modify: `srcla/src/admission/engine.ts`
- Modify: `srcla/src/execution/plan-builder.ts`
- Modify: `srcla/src/execution/executor.ts`
- Modify: `srcla/src/execution/preflight.ts`
- Modify: `srcla/src/execution/reconciler.ts`
- Modify tests beside each module.

**Interfaces:**
- Consumes: absolute caps, dependency groups, persistent reserve, reward cache/readiness/configuration digest, exact harvest request/hash, and route status.
- Produces: snapshots and plans whose on-chain configuration digest and reserve/reward commitments match exactly.

- [ ] **Step 1: Add failing collector/admission tests**

Snapshots must include absolute caps, group exposure/caps, admin/dynamic reserve, reward cache timestamp/value/readiness, reward policy digest, route digest/status, sequencer/feed rounds, and quality flags. Admission rejects any mismatch or stale material reward state.

- [ ] **Step 2: Add failing plan/execution tests**

Plan builder persists dynamic reserve, exact configuration digest, action data hash, and harvest deadline/minimum. Preflight rejects changed code/configuration/route/reward state. Reconciler verifies exact balance and cache deltas.

- [ ] **Step 3: Observe focused failures**

```bash
cd srcla
pnpm test -- collector.spec.ts admission.spec.ts executor.spec.ts controller.spec.ts --runInBand
```

- [ ] **Step 4: Regenerate ABI files and implement data-flow changes**

Generate from current Foundry artifacts; do not hand-maintain divergent function fragments. Update raw bigint serialization and domain hashes without floating-point conversion.

- [ ] **Step 5: Run the complete SRCLA gate**

```bash
cd srcla
pnpm test
pnpm build
pnpm lint
```

- [ ] **Step 6: Commit SRCLA alignment**

```bash
git add srcla/src
git commit -m "feat(srcla): enforce production vault and reward policy"
```

### Task 12: Make Base deployment fail closed and independently verifiable

**Files:**
- Modify: `contract/script/DeployBaseSystem.s.sol`
- Create: `contract/script/VerifyBaseSystem.s.sol`
- Modify: `contract/config/base-strategies.json`
- Modify: `contract/config/base-reward-routes.json`
- Create: `contract/config/base-reward-policies.json`
- Create: `contract/test/script/DeployBaseSystem.t.sol`
- Create: `contract/test/script/VerifyBaseSystem.t.sol`
- Modify: `contract/DEPLOYMENTS.md`

**Interfaces:**
- Consumes public addresses derived from private env keys, but never serializes keys.
- Produces configured vault, adapters, accountant, executor, roles, caps, groups, policies, and only currently admissible routes.
- Verifier returns/reverts on exact conformance without mutating chain state.

- [ ] **Step 1: Write failing deployment conformance tests**

Reject wrong chain/USDC, equal admin and allocator, incorrect protocol relationship, wrong rewards controller/distributor, wrong feed description/decimals, sequencer identity, router/factory/pool mismatch, placeholder addresses, ended/unfunded reward activation, incomplete roles, allocator admin privilege, or admin/deployer allocator privilege.

- [ ] **Step 2: Observe failures against the current deployment script**

Run: `cd contract && forge test --match-path test/script/DeployBaseSystem.t.sol -vv`

- [ ] **Step 3: Correct public configuration from primary evidence**

Use the exact standard Chainlink proxies and official controller/rewards/distributor addresses in the research artifact. Remove abbreviated placeholder address strings as valid values; encode inactive routes with a reason and evidence block rather than executable configuration.

- [ ] **Step 4: Implement deployment and independent verification**

Deploy from `BASE_ADMIN_PRIVATE_KEY`; derive and assert `BASE_ADMIN_ADDRESS`; grant allocator only `ALLOCATOR_ROLE`; admin retains admin/guardian for this phase. Configure reward policies even when routes are inactive. Verify every final public state and external relationship.

- [ ] **Step 5: Run script tests on local and pinned Base forks without broadcast**

```bash
cd contract
forge test --match-path test/script/DeployBaseSystem.t.sol -vv
forge test --match-path test/script/VerifyBaseSystem.t.sol -vv
BASE_RPC_URL="$BASE_RPC_URL" BASE_FORK_BLOCK=49926094 forge test --match-path 'test/script/*.t.sol' -vv
```

- [ ] **Step 6: Commit deployment tooling and public config**

```bash
git add contract/script/DeployBaseSystem.s.sol contract/script/VerifyBaseSystem.s.sol contract/config contract/test/script contract/DEPLOYMENTS.md
git commit -m "feat(contract): add fail-closed Base deployment package"
```

### Task 13: Add stateful invariants, gas budgets, coverage, and static analysis

**Files:**
- Create: `contract/test/invariant/NavyVaultInvariant.t.sol`
- Create: `contract/test/invariant/RewardInvariant.t.sol`
- Create: `contract/test/gas/VaultGas.t.sol`
- Create: `contract/gas-snapshot`
- Create: `contract/slither.config.json`
- Create: `contract/audit/STATIC-ANALYSIS-2026-08-14.md`

**Interfaces:**
- Produces: machine-repeatable correctness and performance gates.
- Invariants: conservation, non-inflation under invalid reward data, role custody, cap/reserve preservation, exact allowance cleanup, pause exits, and used-plan monotonicity.

- [ ] **Step 1: Write invariant handlers and demonstrate a meaningful failure**

Add bounded actions for deposits, donations, sync, yield/loss, plans, claim, swap, pause, and withdrawals. Temporarily target a known-negative mock behavior to prove each invariant detects a violation, then restore the safe mock.

- [ ] **Step 2: Add gas tests at adapter counts 0, 1, 3, and 16**

Measure deposit, mint, withdraw, redeem, plan deploy/divest, harvest, and emergency exit. Define budgets in the test constants and fail when the maximum-adapter case exceeds the reviewed Base transaction budget.

- [ ] **Step 3: Run invariant, gas, and coverage gates**

```bash
cd contract
FOUNDRY_INVARIANT_RUNS=1024 FOUNDRY_INVARIANT_DEPTH=64 forge test --match-path 'test/invariant/*.t.sol' -vv
forge snapshot --check
forge coverage --report summary
```

- [ ] **Step 4: Run Slither and classify every result**

Run `slither . --config-file slither.config.json`. Record tool version, command, each finding, disposition, source evidence, and any justified suppression in `STATIC-ANALYSIS-2026-08-14.md`. Do not suppress an unresolved High/Medium issue.

- [ ] **Step 5: Commit verification assets**

```bash
git add contract/test/invariant contract/test/gas contract/gas-snapshot contract/slither.config.json contract/audit/STATIC-ANALYSIS-2026-08-14.md
git commit -m "test(contract): add production safety and gas gates"
```

### Task 14: Execute the pinned Anvil Base acceptance scenario

**Files:**
- Create: `contract/test/integration/BaseDeploymentAnvil.t.sol`
- Create: `contract/script/RunBaseAcceptance.s.sol`
- Create: `contract/script/WriteDeploymentManifest.s.sol`
- Create at runtime: `deploy/base-anvil-manifest.json`
- Create at runtime: `deploy/base-anvil-verification.md`

**Interfaces:**
- Consumes: trusted `BASE_RPC_URL`, pinned `BASE_FORK_BLOCK`, admin/deployer key, allocator key.
- Produces: ignored private execution notes plus a sanitized public manifest copied into `contract/audit/evidence/` after secret scanning.

- [ ] **Step 1: Write the failing end-to-end acceptance test**

Exercise deployment, role enumeration, deposit/mint, three-protocol deploy/divest, sync/yield, cap/group/reserve/loss failures, exact synchronous exit, inactive reward zero paths, synthetic claim/swap path, stale/bound/sequencer/pool/deadline failures, pause/recovery/emergency exit, allowance cleanup, and final NAV/share conservation.

- [ ] **Step 2: Start pinned Anvil and prove block identity**

Run in a dedicated terminal:

```bash
anvil --fork-url "$BASE_RPC_URL" --fork-block-number 49926094 --chain-id 8453 --port 8545
```

Then assert block `49,926,094` hash equals `0xb0814321bf0e80894112f59df791bc1e471d6d63d0adfe5ff23f4b8eecaf004c` before any acceptance action.

- [ ] **Step 3: Run deployment and acceptance without Base broadcast**

Use only `http://127.0.0.1:8545`. Fund the two generated public accounts with Anvil RPC balance overrides. Run:

```bash
cd contract
forge script script/DeployBaseSystem.s.sol:DeployBaseSystem --rpc-url http://127.0.0.1:8545 --broadcast
forge script script/VerifyBaseSystem.s.sol:VerifyBaseSystem --rpc-url http://127.0.0.1:8545
forge test --match-path test/integration/BaseDeploymentAnvil.t.sol --fork-url http://127.0.0.1:8545 -vv
```

The `--broadcast` target is the local Anvil process only. Before execution, assert RPC chain ID and block hash in-script so a wrong URL cannot receive transactions.

- [ ] **Step 4: Generate and secret-scan evidence**

Manifest fields: commit, compiler, chain, pinned block/hash, public addresses, constructor args, runtime bytecode hashes, roles, caps, groups, reserves, protocol relationships, reward policies/routes, feed rounds/bounds, pool identities/liquidity, gas, test commands/counts, and timestamp. Reject any match for private-key patterns or values loaded from the private env file.

- [ ] **Step 5: Commit only sanitized acceptance code/evidence**

```bash
git add contract/test/integration/BaseDeploymentAnvil.t.sol contract/script/RunBaseAcceptance.s.sol contract/script/WriteDeploymentManifest.s.sol contract/audit/evidence
git commit -m "test(contract): verify SRCLA on pinned Base Anvil fork"
```

### Task 15: Run final cross-system verification and update the living audit

**Files:**
- Modify: `contract/audit/AUDIT-REPORT.md`
- Modify: affected files under `contract/audit/2026-08-12-audit/`
- Create: `contract/audit/RELEASE-EVIDENCE-2026-08-14.md`
- Modify: `contract/DEPLOYMENTS.md`
- Modify: `docs/PRODUCTION.md`

**Interfaces:**
- Produces: one evidence-backed release decision with code gates separated from external operational gates.

- [ ] **Step 1: Run the complete fresh verification matrix**

```bash
cd contract
forge fmt --check
forge build
forge test --summary
FOUNDRY_FUZZ_RUNS=10000 forge test --match-test 'testFuzz' -vv
FOUNDRY_INVARIANT_RUNS=1024 FOUNDRY_INVARIANT_DEPTH=64 forge test --match-path 'test/invariant/*.t.sol' -vv
forge snapshot --check
forge coverage --report summary
slither . --config-file slither.config.json

cd ../be
pnpm test -- --runInBand
pnpm build
node scripts/check-contract-abi-parity.mjs

cd ../srcla
pnpm test
pnpm build
pnpm lint
```

- [ ] **Step 2: Run available live-environment proofs**

Run the pinned Base Anvil scenario from Task 14. Run the NavyPayments Sepolia fork with a newly generated plain-EOA fixture. Run `be/scripts/evm-e2e.mjs` only against a deliberately selected Sepolia deployment and funded test actors; never against Base.

- [ ] **Step 3: Reconcile every audit finding and paper gate**

For each finding, record exact source/test/evidence or leave it Open/Operational. Close MATH-9 only after ceiling tests. Close reward/oracle findings only if implementation and fork evidence pass; distinguish inactive routes from broken code. Keep independent audit, multisig/timelock, hardware-backed keys, monitoring, bug bounty, and performance/outperformance gates open where external evidence is absent.

- [ ] **Step 4: Verify secret hygiene and repository integrity**

```bash
git check-ignore -v deploy/base-wallets.env deploy/README.private.md deploy/base-anvil-manifest.json
git ls-files deploy
git grep -n -E 'BASE_(ADMIN|ALLOCATOR)_PRIVATE_KEY=0x[0-9a-fA-F]{64}' -- . ':!deploy'
git diff --check
git status --short
```

Expected: no tracked deploy files; no private-key assignment in tracked content; clean whitespace. Review status manually so unrelated user changes remain untouched.

- [ ] **Step 5: Commit the final audit/evidence update**

```bash
git add contract/audit contract/DEPLOYMENTS.md docs/PRODUCTION.md
git commit -m "docs: record SRCLA deployment readiness evidence"
```

- [ ] **Step 6: Stop before mainnet broadcast**

Report exact pass/fail/skip counts, pinned block/hash, public deployment package locations, remaining external gates, and final token/key hygiene. Do not fund the generated keys, do not invoke a Base mainnet broadcast, and do not claim independent authorization.
