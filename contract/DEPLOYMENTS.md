# NavyVaultSRCLA — Deployments

## ⚠️ Phase 2 (2026-09-08) — every recorded address refers to SUPERSEDED bytecode

The SRCLA paper-conformance Phase 2 work (branch `feat/srcla-paper-conformance`, commits
`22d59355` … `71958a21`) changed `NavyVaultSRCLA`, `RewardExecutor` and `RewardAccountant`.
**No redeploy has happened, and no new addresses exist.** Any address recorded anywhere in
this file — or in `srcla/.env.anvil` — was produced by bytecode that predates these changes
and is not compatible with the current source.

What changed that makes a redeploy mandatory before any further integration testing:

- **`RewardAccountant`'s constructor signature changed** to `constructor(address admin, address vault_)`.
  Recorded constructor arguments for any prior deployment are invalid against this bytecode.
- **`RewardAccountant.syncForShareAction` is no longer `view`** and is called by
  `NavyVaultSRCLA.deposit`/`mint`.
- **Five external vault functions were deleted from the bytecode** (`executeAction`, legacy
  `executePlan`, `executeNextAction`, the legacy 3-arg `harvest`, `getActivePlanAction`), and
  `RewardExecutor.setDailyVolume` was removed.
- **`setAdapterRisk` gained a fifth argument** and `AdapterRiskSet`'s event shape changed.
- **Every previously computed vault configuration digest and route digest is invalidated.**

Full change record, including what an auditor must re-examine and three findings left open:
`audit/2026-09-07-phase2-changes.md`. The audit register `audit/AUDIT-REPORT.md` carries a
matching staleness banner.

**A REQUIRED post-deploy step now exists** — see `script/POST_DEPLOY.md`. If the reward
accountant does not authorise the deployed vault, every deposit and mint reverts.

⚠️ The `Chainlink USDC/USD` address in the Base table below
(`0x7E8600988E4eB2Bf8a7e70082037cf5a2B3A9b56`) **does not appear in Chainlink's Base feed
directory** and is unresolved — do not configure a feed from it without on-chain
verification. See the change record.

## Vault review follow-ups (tracked)

From the final security review of the contracts (branch `feat/navy-vault-rebalancing`). No Critical issues; the custody invariant (allocator can only move funds between owner-allowlisted adapters, never to an EOA; adapters return funds only to the vault) is verified correct. Follow-ups before this vault holds real money:

1. **`_ensureIdle` aggregate-loss semantics (mainnet gate).** The `maxLossBps` bound is enforced per-adapter-pull, not aggregated across the redemption. Under genuinely lossy withdrawals across multiple venues the total realized shortfall could exceed `maxLossBps` of the redeemed amount (socialized loss). Before mainnet: bound total realized loss across the `_ensureIdle` loop, or reprice `assets` after the pulls.
2. **SafeERC20 — intentionally NOT adopted.** The money layer uses bare `transfer`/`approve` on Circle USDC (which reverts on failure). The vault asset is fixed to Circle USDC at construction, so this is correct here. Recorded so it isn't "fixed" later by mistake.

## Base SRCLA vault — deployment package

**Not yet deployed.** The deployment package is ready; production deployment requires the mainnet gates
(independent audit, owner → multisig/timelock, KMS/HSM key custody, monitoring, a bug bounty) and a redeploy
against the Phase 2 bytecode (see the top of this file).

### Deployment artifacts

| Artifact | Location |
|---|---|
| Deploy script | `script/DeployBaseSystem.s.sol` |
| Verifier | `script/VerifyBaseSystem.s.sol` |
| Conformance tests | `test/script/DeployBaseSystem.t.sol` |
| Verifier tests | `test/script/VerifyBaseSystem.t.sol` |
| Strategy config | `config/base-strategies.json` |
| Reward routes | `config/base-reward-routes.json` |
| Reward policies | `config/base-reward-policies.json` |

### Key addresses (Base mainnet)

| Contract | Address |
|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Aave V3 Pool | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |
| aUSDC | `0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB` |
| Compound III Comet | `0xb125E6687d4313864e53df431d5425969c15Eb2F` |
| Moonwell mUSDC | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` |
| Moonwell Comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` |
| Uniswap Factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` |
| Uniswap Router02 | `0x2626664C2603336E57b271C5c0b26F42121e30D0` |
| Chainlink Sequencer | `0x3D2E4d978Ba8351b82fe2d6E3b3DcEe9FA6307f7` |
| Chainlink USDC/USD | `0x7E8600988E4eB2Bf8a7e70082037cf5a2B3A9b56` |
| Chainlink WETH/USD | `0x7105EC27F7f0ad0fec6FF5cAAc52d34B8cd6d10e` |

### Role separation

- **Admin** (multi-sig): gets `DEFAULT_ADMIN_ROLE` + `ADMIN_ROLE`
- **Allocator** (keeper bot): gets `ONLY ALLOCATOR_ROLE`
- Admin and allocator MUST be different addresses

### Adapter allocation weights

| Adapter | Target Weight | Max Slippage |
|---|---|---|
| Aave V3 | 40% | 100 bps |
| Compound III | 40% | 100 bps |
| Moonwell | 20% | 150 bps |

### Reward tokens

COMP and WELL routes are configured but inactive:
- COMP: rewards ended on Base
- WELL: rewards currently unfunded

### Test results

```
DeployBaseSystemTest:    27 passed
VerifyBaseSystemTest:    13 passed (USDC decimals check requires forked mainnet)
BaseDeploymentAcceptanceTest: 6 tests (requires running Anvil fork)
```

### Acceptance tests (Task 14)

```
forge test --match-path test/integration/BaseDeploymentAnvil.t.sol --fork-url http://127.0.0.1:8545
```

Run Anvil fork:
```bash
anvil --fork-url "$BASE_RPC_URL" --fork-block-number 49926094 --chain-id 8453 --port 8545
```

Acceptance test coverage:
- deposit/mint: verifies shares minted and balance tracking
- withdraw/redeem: verifies exact asset withdrawal
- pause: verifies deposits blocked, withdrawals allowed
- NAV conservation: verifies share price positive, assets >= idle

### Evidence package

Full verification evidence: `audit/RELEASE-EVIDENCE-2026-08-14.md`

Run conformance: `forge test --match-contract DeployBaseSystemTest`
Run verifier tests: `forge test --match-contract VerifyBaseSystemTest`
Verify deployment: `forge script script/VerifyBaseSystem.s.sol --fork-url $BASE_RPC_URL --sig "run(address,address,address,address,address,address,address)" <vault> <aave> <compound> <moonwell> <rewards> <admin> <allocator>`

## History

The retired Ethereum Sepolia testnet deployments (the `NavyPayments` gateway and an earlier `NavyVaultSRCLA`)
and the payment gateway itself were removed from this repository on 2026-09-13. Their record survives in git
history: `git show deae8408:contract/DEPLOYMENTS.md`.
