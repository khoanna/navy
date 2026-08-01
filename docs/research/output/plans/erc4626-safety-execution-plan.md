# ERC-4626 Safety Execution Implementation Plan

**Goal:** Make NavyVault execute SRCLA proposals within deterministic accounting, liquidity, loss, and destination bounds.

## Current gaps to resolve

Current withdrawals use adapter registration order; targets are advisory; idle reserve is static; reverting adapters contribute zero NAV; proposals lack deadlines and state tolerances; only Compound and Morpho adapters exist. Each behavior requires an explicit test and approved replacement, not silent refactoring.

## Files

- Modify `contract/src/NavyVault.sol`
- Modify `contract/src/interfaces/IYieldAdapter.sol`
- Create `contract/src/interfaces/IAllocationPolicy.sol`
- Create `contract/src/adapters/{AaveV3Adapter,MoonwellAdapter}.sol`
- Create/modify Foundry unit, fuzz, invariant, and Base-fork tests
- Modify `be/src/vault/{rebalance.logic,rebalancer.service}.ts` and tests

### Task 1: Proposal envelope

- [ ] Test proposal deadline, state hash/tolerance, movement maximum, minimum idle, maximum loss, and policy version.
- [ ] Add typed bounded proposal execution restricted to allowlisted adapters.
- [ ] Preserve existing allocator authorization and reentrancy protection.
- [ ] Run `forge test --match-contract NavyVaultProposalTest`.
- [ ] Commit `feat: bound vault allocation proposals`.

### Task 2: Honest liquidity and withdrawal ordering

- [ ] Test `maxWithdraw/maxRedeem` against idle plus executable adapter liquidity.
- [ ] Replace registration-order unwind with keeper/policy-provided safe order bounded on chain.
- [ ] Test no exiting user receives more than their claim or socializes excess loss.
- [ ] Commit `feat: expose honest vault withdrawal liquidity`.

### Task 3: NAV failure policy

- [ ] Test healthy, stale, reverting, and written-down adapters.
- [ ] Replace implicit zero valuation with explicit adapter status and conservative loss recognition approved by owner/emergency role.
- [ ] Test deposits pause when NAV is unreliable while withdrawals of known liquid assets remain bounded.
- [ ] Commit `feat: make adapter valuation failure explicit`.

### Task 4: Aave and Moonwell adapters

- [ ] Write constructor, asset, deposit, withdraw, totalAssets, liquidity, and rate tests first.
- [ ] Implement minimal adapters with official Base addresses injected at deployment.
- [ ] Add pinned Base block fork tests and destination/approval invariants.
- [ ] Commit each adapter independently.

### Task 5: Keeper integration

- [ ] Define JSON-compatible ActionPlan identical to research controller output.
- [ ] Test stale rejection, passive deploy, economic reallocation, safety exit, idempotency, and database decision hashes.
- [ ] Implement submission and watcher state transitions.
- [ ] Run backend unit tests and Foundry suite.
- [ ] Commit `feat: execute versioned SRCLA allocation plans`.

### Task 6: Security verification

- [ ] Run unit, fuzz, invariant, and pinned Base fork suites.
- [ ] Verify share non-dilution, assets conserved modulo declared costs/loss, caps, no arbitrary destination, reserve, pause, and safety authority.
- [ ] Update threat model and audit notes with exact residual risks.
- [ ] Commit `test: verify SRCLA vault safety invariants`.
