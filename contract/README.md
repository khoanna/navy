# contract — the SRCLA vault on Base

Foundry / Solidity `0.8.24`. The on-chain half of SRCLA on **Base (chainId `8453`)**:

- **`NavyVaultSRCLA.sol`** — pooled ERC-4626 USDC vault, rebalanced across `IStrategyAdapter` venues by the
  `srcla/` allocator under on-chain risk guards.
- **`adapters/`** — `CompoundAdapter` (Compound III), `AaveV3Adapter`, `MoonwellAdapter`.
- **`reward/`** — `RewardAccountant` and `RewardExecutor` (paper §9.2–§9.4).

The asset is Circle native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

> **No testnet.** Local development runs against an **Anvil fork of Base mainnet**.

## Build & test

```bash
forge build                 # writes ABIs to out/<Contract>.sol/<Contract>.json
forge test                  # unit + fuzz/invariant + Base-fork tests
forge test --match-contract CompoundAdapterForkTest -vvv
forge fmt
BASE_RPC_URL=<rpc> forge test   # fork tests need a Base RPC (the local Anvil fork works)
```

## Deploy

Put values in an uncommitted `contract/.env` (see `.env.example`).

| Script | Use |
|---|---|
| `DeployNavyVaultSRCLA.s.sol` | The `NavyVaultSRCLA` core on the fork (reads `PRIVATE_KEY`, `NAVY_USDC_ADDRESS`) |
| `DeployAndFund.s.sol` | Four funded tier vaults with the three adapters registered — what §11.1's fork replay needs. The deployer must already hold USDC; fund it out of band |
| `DeployBaseSystem.s.sol` | The production Base package, with identity checks; follow it with `script/POST_DEPLOY.md` |
| `VerifyBaseSystem.s.sol` | Read-only conformance check of a deployment |
| `RunBaseAcceptance.s.sol` | Deploy + verify + acceptance in one run against local Anvil |
| `AnvilE2ETest.s.sol` | End-to-end vault + adapters + rewards run on the fork |
| `ConfigureAnvil.s.sol` / `FundVaultAnvil.s.sol` | Configure and fund a deployed vault (`VAULT_ADDRESS`) |
| `WriteDeploymentManifest.s.sol` | Record deployment artifacts for audit |

Every deploy script applies the paper's on-chain guardrails through `script/VaultGuardrails.sol`.

```bash
forge script script/DeployNavyVaultSRCLA.s.sol --fork-url http://127.0.0.1:8545 --broadcast
```

Copy the printed `VAULT_ADDRESS` / `*_STRATEGY_ADDRESS` / `REWARD_*_ADDRESS` into `srcla/.env.anvil`.
**They change on every redeploy.**

⚠️ `vm.prank` funding inside a deploy script silently fails under `--broadcast` — the prank only applies to the
simulation pass. Fund accounts with `cast rpc anvil_impersonateAccount` + `cast send` instead.

⚠️ Use `--slow` when broadcasting from an EIP-7702-delegated account — some RPCs reject gapped nonces.

## Admin operations

`NavyVaultSRCLA` (`ADMIN_ROLE`): `setAdapterRisk`, `setAdapterState`, `setAdminReserve`, `setMinIdleBps`,
`setMaxSynchronousLossBps`, `setDependencyGroup`, `setDepositCap`, `setRewardAccountant`, `setRewardExecutor`,
`setRewardTokenRoute`, `registerAdapter`, `setWithdrawalOrder`, `pause`, `unpause`. Roles are OpenZeppelin
`AccessControl`; `DEFAULT_ADMIN_ROLE` grants and revokes them. There is no `Ownable` owner.

`setDepositCap` (P37): the most `totalAssets()` deposits and mints may reach. Default `type(uint256).max`
(uncapped); `DeployBaseSystem.s.sol` sets $1,000,000, from `script/ReleaseScope.sol`. It never bounds withdrawals.

The **allocator** role is deliberately narrow: it can only move funds *between allowlisted adapters*, never to
an EOA, and every move is bounded by `capBps` / `minIdleBps` / `maxLossBps` on-chain. That allocator is the
`srcla/` service's keeper.

## Layout

```
src/NavyVaultSRCLA.sol      pooled ERC-4626 vault
src/adapters/              CompoundAdapter, AaveV3Adapter, MoonwellAdapter
src/reward/                RewardAccountant, RewardExecutor
src/oracle/                ChainlinkPriceFeed
src/libraries/             CohortLib, HarvestLib, MerkleTree, VaultTypes
src/interfaces/            IStrategyAdapter, IComet, IAaveV3, IMToken, …
script/                    deploy / verify / fund scripts, VaultGuardrails, POST_DEPLOY.md
test/                      unit + fuzz/invariant + fork tests
config/                    Base strategy, reward route and reward policy manifests
audit/                     AUDIT-REPORT.md, 2026-08-12-audit/, Phase 2 change record, release evidence
```

## Security

Audited — see [`audit/AUDIT-REPORT.md`](audit/AUDIT-REPORT.md), the per-area findings in
`audit/2026-08-12-audit/`, static analysis in `audit/STATIC-ANALYSIS-2026-08-14.md`, and release evidence in
`audit/RELEASE-EVIDENCE-2026-08-14.md`. The Phase 2 changes made after that audit are recorded in
`audit/2026-09-07-phase2-changes.md`. The audit documents also cover the `NavyPayments` gateway, which was
removed from this repository on 2026-09-13 (it survives in git history).

**Mainnet gates:** independent audit, owner → multisig/timelock, KMS/HSM key custody, monitoring, and a bug
bounty.
