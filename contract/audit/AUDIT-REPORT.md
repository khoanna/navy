# Navy Contract System — Living Security Audit and Production Readiness Register

**Canonical status date:** 2026-08-13  
**Audit baseline:** current working tree under `contract/`  
**Targets:** Sepolia `NavyPayments`; Base mainnet `NavyVaultSRCLA`, lending adapters, oracle wrapper, and reward executor  
**Current release decision:** **NOT AUTHORIZED FOR PRODUCTION**

This is the canonical, maintained security register for the Navy contract system. The detailed evidence for the 2026-08-12 review is retained in `audit/2026-08-12-audit/`. This file records current disposition, residual risk, production gates, and the verification required after every security-relevant change.

“Fixed” means the vulnerable path was changed and covered by a relevant passing test. It does not mean the full system is production-authorized. A disabled or unreachable feature is labelled **Feature disabled**, not Fixed. An operational control is not treated as a code fix.

## Executive decision

The principal ERC-4626, adapter ABI, accounting, Merkle-plan, payment authorization, and direct reward-swap defects reported on 2026-08-12 have been remediated in the current source tree. The local Foundry gate is green: **190 passed, 0 failed, 60 skipped**. The 60 skips are RPC-dependent tests and are not evidence of live-chain behavior.

Production authorization is withheld because the remaining work crosses code, integration, governance, live-chain verification, and independent assurance:

1. **The remediated NavyPayments contract is incompatible with the current backend authorization builder.** The contract now uses `authorizationNonce(merchantId, invoiceId)`, which commits payout, treasury, fee, and configuration versions. The backend and `be/scripts/evm-e2e.mjs` still sign the legacy `invoiceKey`. The checked-in backend ABI also lacks the new nonce/config/recovery functions. The current legacy Sepolia deployment and backend remain mutually consistent, but deploying this source without a coordinated backend migration would make payments fail.
2. **First-party reward claiming remains a stub.** Aave, Compound, and Moonwell expose reward-token lists but return zero claimable rewards and never call protocol reward controllers. The Base reward-route manifest is correctly disabled and contains placeholder feed/pool values. Reward routes must remain disabled.
3. **Reward-oracle hardening is incomplete.** `RewardExecutor` has no Base sequencer-uptime/recovery check, no governed lower/upper answer bounds, no maximum allowed heartbeat bound, and cannot prove feed denomination on-chain. These gaps are not reachable while reward routes remain disabled.
4. **Privileged governance is not deployment-verified.** The Base script can hand roles to configured addresses, but no reviewed multisig/timelock address, delay, signer policy, deployment transaction, role enumeration, or deployer-role revocation evidence is recorded.
5. **Fresh live-chain acceptance evidence is incomplete.** Local RPC-dependent tests skip. A complete Base fork run and a Sepolia Circle-USDC EIP-3009 run with a plain EOA fixture must be captured against pinned block numbers before release.
6. **Independent review is still required.** This internal remediation/re-audit is not a substitute for an independent professional audit of the final commit and deployment parameters.

## Status vocabulary

| Status | Meaning | May ship? |
|---|---|---|
| Fixed | Root cause changed; regression evidence exists in the current tree. | Only if all release gates also pass. |
| Partially fixed | Material controls were added, but part of the original safety claim remains unimplemented. | No for the affected feature. |
| Feature disabled | Vulnerable/incomplete feature is intentionally not configured or reachable. | Core system may ship only if the disablement is verified on-chain and documented. |
| Operational gate | Requires governance, deployment, monitoring, or human-process evidence. | No until evidence is attached. |
| Accepted risk | Deliberate behavior with bounded impact and named owner. | Only with explicit written approval. |
| Open | Root cause remains. | No for any reachable affected path. |
| Invalid / duplicate | Finding was disproved or is tracked under another canonical ID. | Not applicable. |

## Finding disposition summary

The domain files contain 49 finding records, including intentional duplication where independent audit passes found the same root cause. Current raw-record disposition is:

| Disposition | Count | Notes |
|---|---:|---|
| Fixed (unqualified) | 37 | Code and regression coverage present. |
| Fixed in Solidity; integration gate open | 2 | Duplicate payment-routing findings; contract fix exists but backend migration is incomplete. |
| Fixed in scripts | 1 | Chain/asset deployment checks exist; no production deployment evidence yet. |
| Fixed by restriction | 1 | Unsupported multi-hop reward routes are rejected. |
| Partially fixed | 2 | `AMMORACLE-3` and duplicate `MATH-6`; feed denomination remains governed configuration. |
| Feature disabled | 2 | `ERC20-5` and duplicate `LENDACCESS-5`; first-party reward claiming is not implemented. |
| Open | 2 | `AMMORACLE-7` and `AMMORACLE-8`; sequencer/heartbeat and answer-bound controls. |
| Operational gate | 1 | `LENDACCESS-6`; privileged governance can still install a malicious adapter. |
| Accepted risk | 1 | `MATH-9`; merchant-favoring fee floor below one USDC base unit per invoice. |
| **Total** | **49** | Counts include duplicates across specialist passes. |

### Canonical root-cause view

| Root cause | Historical IDs | Current status | Current evidence / residual risk |
|---|---|---|---|
| ERC-4626 donation/inflation and rounding | `GENERAL-1`, `ERC20-1`, `ERC4626-1..2`, `MATH-1..2` | Fixed | OpenZeppelin ERC-4626 conversion paths and six-decimal virtual share offset; donation, one-unit withdrawal, and yield-pricing tests. |
| Vault/adapter runtime ABI mismatch | `GENERAL-2`, `ERC20-2` | Fixed | Unified `IStrategyAdapter.deposit/withdraw` return ABI; adapter and fork fixtures compile. |
| Advertised but unavailable withdrawals | `ERC20-3`, `ERC4626-3`, `LENDACCESS-4` | Fixed | `synchronousLiquidity`, protocol cash bounds, and `_ensureIdle` sourcing; local withdrawal regression test. Live protocol behavior still requires fork acceptance. |
| Duplicate/unbounded adapters and NAV inflation | `GENERAL-3`, `ERC4626-4`, `LENDACCESS-7` | Fixed | Permanent registration guard, `MAX_ADAPTERS = 16`, asset/vault identity checks. |
| Stale strategy cohort pricing | `ERC4626-5` | Fixed | Strict strategy synchronization before ERC-4626 state changes. This increases gas linearly with registered adapters; see performance gate. |
| Reward/loss double accounting | `ERC20-4`, `ERC4626-6`, `MATH-3`, `MATH-8` | Fixed | Counters are telemetry only; post-divest strategy state is strictly resynchronized; actual token and USDC deltas are checked. |
| Paused mint false success / exit asymmetry | `GENERAL-4`, `ERC4626-7` | Fixed | Deposit/mint revert when paused; withdraw/redeem remain available. |
| Moonwell integration and math | `LENDACCESS-1`, `MATH-4` | Fixed | Correct selectors, approvals, numeric return checks, identities, exchange-rate scale, supply cap, and liquidity handling. Requires pinned Base fork acceptance. |
| Aave APR scale | `LENDACCESS-10`, `MATH-5` | Fixed | Annualized ray converted directly to WAD. |
| Merkle plan commitments and replay | `LENDACCESS-3`, `SIGCHAIN-2` | Fixed | Chain/vault/asset/header/config domain, ordered actions, risk commitments, cancellation consumption; legacy plan path disabled. |
| Risk parameter bounds | `LENDACCESS-8` | Fixed | BPS and adapter-count bounds plus active-plan risk enforcement. |
| Reward route administration | `AMMORACLE-1`, `LENDACCESS-2` | Fixed | Deployer and vault receive initial administration; Base deployment transfers roles to governance. Actual on-chain handoff remains an operational gate. |
| SwapRouter02 ABI | `AMMORACLE-2` | Fixed | Base router-compatible no-deadline structs and direct-route execution tests. Pinned Base fork required. |
| Swap execution-value controls | `AMMORACLE-3`, `MATH-6` | Partially fixed | Oracle-normalized expected output, protocol minimum, actual impact, and output checks exist. Exact feed pair/direction is still a governance assertion; do not enable placeholder routes. |
| Daily notional bypass | `AMMORACLE-4`, `MATH-7` | Fixed | Both conservative pre-check and actual-output post-check enforce the route cap. |
| Route endpoint/digest mismatch | `AMMORACLE-5` | Fixed by restriction | Endpoints must match and paths must contain exactly two tokens; unsupported multi-hop routes are rejected. |
| Permissionless deviation reset | `AMMORACLE-6` | Fixed | Rotatable updater authority and equality with fresh feed value. |
| Sequencer, heartbeat, and recovery safety | `AMMORACLE-7` | Open | No Base sequencer uptime feed/grace period; route `maxFeedAge` has no governed upper bound. Reward routes must remain disabled. |
| Chainlink economic answer bounds | `AMMORACLE-8` | Open | Positive/fresh/complete rounds are enforced, but governed min/max answers are absent. Reward routes must remain disabled. |
| First-party reward claiming | `ERC20-5`, `LENDACCESS-5` | Feature disabled | All first-party claimable values are zero; protocol claim calls are absent; checked-in routes are disabled. |
| Payment self-payout / stranded assets | `ERC20-6` | Fixed | Invalid payout destinations rejected; SafeERC20 and excess/native recovery added. |
| Mutable payment routing after signature | `LENDACCESS-9`, `SIGCHAIN-1` | Fixed in Solidity; integration gate open | Authorization nonce commits payout/treasury/fee and versions. Backend still signs legacy nonce and must migrate atomically with deployment. |
| Privileged malicious-adapter path | `LENDACCESS-6` | Operational gate | A default admin can ultimately grant roles and register an adapter that lies while reporting the expected vault/asset. Require timelock + multisig + adapter codehash/review procedure. |
| Deployment chain/asset identity | `GENERAL-5` | Fixed in scripts | Base and Sepolia scripts enforce chain and canonical USDC/protocol identities. Deployment evidence is not yet recorded. |
| Broken full compile gate | `GENERAL-6` | Fixed | Fresh full build and local test suite pass. |
| Deployment fee narrowing | `GENERAL-7` | Fixed | Raw `uint256` environment value is bounded before `uint16` cast. |
| Invoice fee flooring | `MATH-9` | Accepted risk pending owner sign-off | Merchant-favoring rounding differs from the exact percentage by less than one USDC base unit per invoice. Document policy and reconciliation. |

## Production release gates

Every box below is release-blocking unless explicitly scoped to the optional reward subsystem. Evidence must include the commit hash, chain ID, block number where applicable, command, exit code, and artifact/transaction link.

### P0 — final code and independent assurance

- [ ] Freeze a release commit; regenerate all ABIs from that exact commit; record compiler and dependency lockfiles.
- [ ] Obtain an independent audit of the frozen commit and close or formally accept every finding.
- [ ] Run `forge fmt --check`, `forge build`, the complete local suite, fuzz/invariant suite, static analysis, and coverage in CI with zero unexpected failures/skips.
- [ ] Review every Foundry lint warning. Resolve or document safe casts, unused imports, and code-size/gas warnings; do not silently suppress security-relevant warnings.

### P0 — NavyPayments migration

- [ ] Update the backend payment authorization builder to obtain or exactly reproduce `authorizationNonce(merchantId, invoiceId)` from the target contract configuration; prefer an on-chain view call.
- [ ] Regenerate and copy `NavyPayments` ABI to `be/src/evm/navy-payments-abi.json`; update `be/scripts/evm-e2e.mjs` and backend tests.
- [ ] Define a coordinated deployment cutover so no authorization signed for the old nonce is submitted to the new contract and no authorization signed for the new nonce is sent to the old contract.
- [ ] Run a live Sepolia EIP-3009 payment using a verified plain EOA: authorization, relayer submission, 99/1 split, event reconciliation, replay rejection, and invalidation after configuration change.
- [ ] Update `contract/DEPLOYMENTS.md`, backend environment, runbooks, and user-facing clients to the new address only after the E2E succeeds.

### P0 — Base vault deployment and governance

- [ ] Use a reviewed multisig controlling a timelock as `NAVY_GOVERNANCE_ADDRESS`; document signers, threshold, delay, proposer, executor, cancellation, and emergency policy.
- [ ] Use a distinct allocator identity with narrowly documented key custody and rotation. Do not use the deployer or a single development key.
- [ ] Dry-run `DeployBaseSystem.s.sol` on a pinned Base fork and verify canonical USDC, Aave, Compound, Moonwell, router, adapter vault/asset identities, caps, and loss limits.
- [ ] After deployment, enumerate every role on vault and reward executor; prove deployer admin roles are revoked and governance/allocator roles exactly match policy.
- [ ] Verify source and constructor parameters on the explorer; record deployed bytecode hashes and all transaction hashes.
- [ ] Keep deposits paused or frontends disabled until post-deploy deposits, strategy deploy/divest, forced liquidity sourcing, pause, and emergency-exit drills pass with bounded amounts.

### P0 — optional reward subsystem

The vault may be considered for launch without reward harvesting only if this subsystem remains disabled and that limitation is disclosed.

- [ ] Keep all reward routes absent on-chain and `enabled: false` in configuration until every item below passes.
- [ ] Implement real Aave/Compound/Moonwell reward claims that transfer measured token balance deltas to the vault; remove incorrect token declarations from protocols that do not emit that reward.
- [ ] Bind executor output to canonical Base USDC and verify exact input-token/USD feed direction, feed proxy, decimals, heartbeat, and pool fee tier.
- [ ] Add Base sequencer-up validation and a recovery grace period to every price-dependent reward swap.
- [ ] Add governance-reviewed maximum feed age and economic min/max answer bounds with explicit fail-closed behavior.
- [ ] Add pinned Base fork tests for claim -> approve -> swap -> USDC receipt -> allowance reset -> NAV invariants, including stale feed, sequencer down/recovery, bound hit, low liquidity, cap exhaustion, and revoked route.

### P1 — operations, monitoring, and incident response

- [ ] Define monitoring for share price, adapter balance drift, idle ratio, realized loss, failed syncs, withdrawal failures, plan expiry/config mismatch, oracle freshness, reward caps, and role changes.
- [ ] Establish alert thresholds, on-call ownership, and tested pause/emergency-exit procedures. Document which exits remain possible during pause.
- [ ] Add a transaction simulation and independent-review checklist for every adapter registration, cap/loss change, route approval, feed change, and role grant.
- [ ] Maintain an allowlist registry with chain, address, implementation/codehash, protocol documentation, audit provenance, and last verification block for every external dependency.
- [ ] Document upgrade/migration strategy. These contracts are not proxies; replacement requires explicit user and backend migration.

### P1 — performance and gas regression controls

- [ ] Establish gas budgets for deposit, mint, withdraw, redeem, plan execution, harvest, and emergency exit at 0, 1, typical, and `MAX_ADAPTERS` registered adapters.
- [ ] Add CI gas snapshots and fail on unexplained regressions above the approved tolerance.
- [ ] Test worst-case `sync()` and withdrawal sourcing at 16 adapters. All ERC-4626 mutations synchronize every active adapter, so gas and external-call failure probability grow linearly.
- [ ] Load-test backend authorization/relay/reconciliation independently of Solidity and define RPC timeout/retry/idempotency budgets.
- [ ] Track deployed bytecode size and constructor/deployment gas; verify transactions remain below chain and operational gas limits.

## Required verification matrix

| Gate | Minimum command/evidence | Current status |
|---|---|---|
| Formatting | `forge fmt --check` | Passed during the 2026-08-13 reconciliation. |
| Compile | `forge build` | Passed during the 2026-08-13 reconciliation; lint warnings remain for review. |
| Local tests | `forge test` | 190 passed, 0 failed, 60 skipped during the 2026-08-13 reconciliation. |
| Base fork | `BASE_RPC_URL=<trusted> forge test` at a recorded block | Prior ad-hoc evidence exists; release-grade pinned evidence not attached here. |
| Sepolia payment fork | `SEPOLIA_RPC_URL=<trusted> forge test --match-path test/NavyPaymentsFork.t.sol -vv` | Not accepted: current fixture may skip when its deterministic payer has code. |
| Static analysis | Slither or equivalent with reviewed output | No current evidence. |
| Coverage | `forge coverage` with critical-path branch review | No current threshold/evidence. |
| Invariants/fuzz | Stateful ERC-4626/accounting/plan/reward invariants with configured run budget | Payment split fuzz exists; full system invariant evidence incomplete. |
| Backend compatibility | Backend unit/build + live authorization/relay/reconciliation against new deployment | Failing by inspection: backend uses legacy nonce/ABI. |
| Governance | On-chain role enumeration + multisig/timelock configuration | Not deployed/verified. |
| Independent audit | Signed report for frozen commit and deployment configuration | Not complete. |

## Maintainer procedure

For every contract, adapter, deployment, oracle, role, fee, or backend-ABI change:

1. Create a new finding or change record with a stable ID; never delete historical evidence.
2. Record affected contracts, threat model, reachability, assets at risk, and exact deployment scope.
3. Add a regression test that fails before the fix and passes after it. For live integrations, add a pinned fork test.
4. Update the relevant domain file first, then this canonical register. A status change must link to source/test evidence and the verifying commit.
5. Re-run the complete verification matrix. Do not infer full-suite success from a focused test.
6. Re-evaluate duplicate findings together so one root cause cannot be marked Fixed in one domain and Open in another.
7. Any newly enabled reward route, adapter, token, oracle, chain, or governance address reopens the related threat-model sections and requires independent review.

### Review cadence and ownership

- Assign one named security owner and one independent approver for each release. The author of a security-sensitive change must not be its sole approver.
- Reconcile this register on every release candidate and after any incident, external-protocol upgrade, address/codehash change, new chain, new adapter, new oracle, or governance change.
- Review external dependency addresses, proxy implementations, feed status/heartbeat, protocol pause state, and configured caps at least monthly while funds are active.
- Exercise pause, role rotation, plan cancellation, and emergency exit at least quarterly with bounded funds and retain transaction evidence.
- Treat an unexplained share-price discontinuity, adapter accounting drift, repeated sync failure, oracle-bound hit, or role change as an incident requiring immediate deposit pause and reconciliation.

## Change history

| Date | Change | Verification |
|---|---|---|
| 2026-08-12 | Seven-domain audit and remediation baseline created. | Detailed specialist files under `2026-08-12-audit/`. |
| 2026-08-13 | Rewritten as the canonical living register; all 49 finding records reconciled against current source; backend nonce/ABI migration, governance, oracle, reward, fork, quality, and performance gates made explicit. | `forge fmt --check`, `forge build`, `forge test`: 190 passed, 0 failed, 60 RPC-dependent skips; document reconciliation and whitespace checks passed. |

## Scope and limitations

The 2026-08-12 audit covered `NavyPayments.sol`, `NavyVaultSRCLA.sol`, Aave V3 / Compound III / Moonwell adapters, `RewardExecutor`, `ChainlinkPriceFeed`, vault math, Merkle plans, deployment scripts, and their Foundry tests. This reconciliation additionally inspected the backend payment nonce builder and ABI solely to determine deployment compatibility.

It does not certify frontend/mobile behavior, backend authorization as a whole, key custody, infrastructure, legal/compliance obligations, external protocol solvency, oracle correctness, governance signer security, or deployed bytecode. External protocols and feeds remain trusted dependencies whose pauses, upgrades, insolvency, censorship, or governance failures can affect Navy.

## Detailed evidence

- [General](2026-08-12-audit/findings-evm-audit-general.md)
- [ERC-20 / native USDC](2026-08-12-audit/findings-evm-audit-erc20.md)
- [ERC-4626](2026-08-12-audit/findings-evm-audit-erc4626.md)
- [Precision and math](2026-08-12-audit/findings-evm-audit-precision-math.md)
- [AMM and oracles](2026-08-12-audit/findings-evm-audit-amm-oracles.md)
- [Lending, access control, and DoS](2026-08-12-audit/findings-evm-audit-lending-access-dos.md)
- [Signatures and chain-specific behavior](2026-08-12-audit/findings-evm-audit-signatures-chain.md)

Historical descriptions and severities in those files describe the vulnerable audit baseline. Their current reconciliation blocks control present status.
