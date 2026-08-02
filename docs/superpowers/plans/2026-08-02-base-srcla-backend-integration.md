# Base SRCLA NestJS Integration Implementation Plan (Plan 6 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/be` farming into a Base read/proposal integration: users submit standard ERC-4626 transactions themselves, NestJS reads user positions directly from Base, and strategy history comes only from the read-only `/srcla` API.

**Architecture:** Payments keep the existing Sepolia `NAVY_EVM` provider and relayer. Farming receives a separate read-only `FARMING_CHAIN` Base provider and vault contract. `VaultService` reads chain state and builds unsigned transaction proposals; `SrclaClient` reads strategy decisions over HTTP. The old farming relayer, keeper, nonce records, watchers, and rebalancer are removed.

**Tech Stack:** NestJS 11, ethers 6.17, Prisma 7, Jest 30, Node 24 built-in `fetch`.

## Global Constraints

- Depends on contract ABIs from Plans 1–3 and the SRCLA API from Plans 4–5.
- Payments remain on Sepolia and must not switch to Base.
- Farming Base chain ID is exactly `8453`; vault asset is exact Circle native Base USDC.
- Backend stores no farming allocator/admin key and submits no farming transaction.
- Remove farming EIP-3009 authorization, relayed permit redemption, keeper, and receipt watcher paths.
- User transaction proposals contain exact chain ID, target, calldata, value, and human-readable summary; private keys/signatures never enter `/be`.
- Money values are integer decimal strings at every JSON boundary.
- `/be` never connects to the SRCLA database.

---

### Task 1: Add a Base-only farming chain provider without changing payments

**Files:**
- Create: `be/src/farming-chain/farming-chain.module.ts`
- Create: `be/src/farming-chain/farming-chain.types.ts`
- Create: `be/src/farming-chain/farming-chain.module.spec.ts`
- Copy: `be/src/farming-chain/navy-vault-base-abi.json`
- Copy: `be/src/farming-chain/usdc-erc20-abi.json`
- Modify: `be/src/config/config.service.ts`
- Modify: `be/test/unit/config/config.service.spec.ts`
- Modify: `be/src/app.module.ts`

**Interfaces:**
- Produces: `FARMING_CHAIN` with `{ provider, chainId, usdc, vault, usdcAddress, vaultAddress }`.

- [ ] **Step 1: Write provider separation tests**

```typescript
it('uses Base for farming while NAVY_EVM remains Sepolia', async () => {
  expect(farming.chainId).toBe(8453);
  expect(await farming.vault.asset()).toBe(BASE_USDC);
  expect(paymentConfig.evmChainId).toBe(11155111);
});
```

Test exact USDC literal, missing URL/address, no wallet signer, and startup identity mismatch.

- [ ] **Step 2: Run and confirm failure**

Run: `cd be && pnpm test farming-chain config.service`

Expected: FAIL before module/config getters exist.

- [ ] **Step 3: Implement the read-only provider**

```typescript
export const FARMING_CHAIN = Symbol('FARMING_CHAIN');

const provider = new ethers.JsonRpcProvider(cfg.farmingBaseRpcUrl, 8453);
const vault = new ethers.Contract(cfg.farmingVaultAddress, vaultAbi, provider);
const usdc = new ethers.Contract(cfg.farmingBaseUsdcAddress, usdcAbi, provider);
return { provider, chainId: 8453, vault, usdc, vaultAddress: cfg.farmingVaultAddress, usdcAddress: cfg.farmingBaseUsdcAddress };
```

Add `FARMING_BASE_RPC_URL`, `FARMING_BASE_CHAIN_ID=8453`, `FARMING_BASE_USDC_ADDRESS`, `FARMING_VAULT_ADDRESS`, and `SRCLA_API_URL`. Verify `vault.asset()` and `provider.getNetwork()` during application bootstrap without loading a wallet.

- [ ] **Step 4: Run tests and build**

Run: `cd be && pnpm test farming-chain config.service && pnpm build`

Expected: PASS; existing payment tests still construct `NAVY_EVM` unchanged.

- [ ] **Step 5: Commit**

```bash
git add be/src/farming-chain be/src/config/config.service.ts be/test/unit/config/config.service.spec.ts be/src/app.module.ts
git commit -m "feat(be): add separate read-only Base farming provider"
```

---

### Task 2: Detach the old farming rebalancer and watcher from runtime wiring

**Files:**
- Modify: `be/src/vault/vault.module.ts`
- Create: `be/src/vault/vault.module.spec.ts`

**Interfaces:**
- Removes the old rebalancer and watcher from the running dependency graph while leaving their files and tables intact until the final cleanup task.

- [ ] **Step 1: Add a module metadata test**

```typescript
it('registers only the read/proposal vault service', () => {
  const providers = (Reflect.getMetadata('providers', VaultModule) ?? []).map((p: { name: string }) => p.name);
  expect(providers).toEqual(['VaultService']);
});
```

- [ ] **Step 2: Run and confirm the old module still registers execution providers**

Run: `cd be && pnpm test vault.module`

Expected: FAIL because `RebalancerService` and `VaultWatcherService` are still providers.

- [ ] **Step 3: Reduce `VaultModule` to controller, service, and SRCLA client wiring**

```typescript
@Module({
  imports: [FarmingChainModule],
  controllers: [VaultController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
```

- [ ] **Step 4: Run module test and build**

Run: `cd be && pnpm test vault.module && pnpm build`

Expected: PASS. Unreferenced old source files are cleaned up after replacement routes/services land.

- [ ] **Step 5: Commit**

```bash
git add be/src/vault/vault.module.ts be/src/vault/vault.module.spec.ts
git commit -m "refactor(be): detach old farming execution providers"
```

---

### Task 3: Implement chain-read position/limit service and unsigned ERC-4626 proposals

**Files:**
- Replace: `be/src/vault/vault.service.ts`
- Replace: `be/src/vault/dto.ts`
- Create: `be/src/vault/transaction-proposal.ts`
- Create: `be/src/vault/vault.service.spec.ts`

**Interfaces:**
- Produces: `getPosition(address)`, `getLimits(address)`, `buildDepositTransactions(address,assetsBase)`, and `buildRedeemTransaction(address,sharesBase)`.

- [ ] **Step 1: Write chain-read and calldata tests**

```typescript
it('returns shares, assets, max withdraw, and max redeem as strings', async () => {
  expect(await service.getPosition(USER)).toEqual({
    sharesBase: '500000000000000', assetsBase: '505000000', maxWithdrawBase: '400000000', maxRedeemBase: '396039603960396'
  });
});

it('builds approval only for the missing allowance then standard deposit', async () => {
  const txs = await service.buildDepositTransactions(USER, 100_000_000n);
  expect(txs.map((x) => x.function)).toEqual(['approve', 'deposit']);
  expect(txs.every((x) => x.chainId === 8453 && x.value === '0')).toBe(true);
});
```

Cover sufficient allowance omitting approval, zero/negative/above-max input, deposit receiver fixed to user, redeem owner/receiver fixed to user, paused issuance, synchronous limits, and ABI-decodable calldata.

- [ ] **Step 2: Run and confirm failure**

Run: `cd be && pnpm test vault.service`

Expected: FAIL against the old authorization service.

- [ ] **Step 3: Implement direct read/proposal methods**

```typescript
export interface TransactionProposal {
  chainId: 8453;
  to: string;
  data: string;
  value: '0';
  function: 'approve' | 'deposit' | 'redeem';
  summary: string;
}
```

Use ethers `Interface.encodeFunctionData`. Never accept a receiver/owner/spender from the request; bind them to authenticated `walletAddress` and configured vault. Validate checksummed addresses and serialize every bigint.

- [ ] **Step 4: Run unit tests and build**

Run: `cd be && pnpm test vault.service && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/vault/vault.service.ts be/src/vault/dto.ts be/src/vault/transaction-proposal.ts be/src/vault/vault.service.spec.ts
git commit -m "feat(be): read Base vault and build direct transaction proposals"
```

---

### Task 4: Add resilient read-only SRCLA client

**Files:**
- Create: `be/src/vault/srcla.client.ts`
- Create: `be/src/vault/srcla.client.spec.ts`
- Modify: `be/src/vault/vault.module.ts`

**Interfaces:**
- Produces: `SrclaClient.getCurrentStrategy()`, `getDecisions(cursor)`, `getDecision(hash)`, and `getHarvests(cursor)`.

- [ ] **Step 1: Write timeout, schema, and no-mutation tests**

```typescript
it('times out without affecting chain position reads', async () => {
  fetchMock.neverResolves();
  await expect(client.getCurrentStrategy()).rejects.toThrow(/timeout/i);
  await expect(vault.getPosition(USER)).resolves.toBeDefined();
});
```

Test non-2xx errors, malformed BigInt strings, pagination passthrough, base URL containment, and that the client only sends `GET`.

- [ ] **Step 2: Run and confirm failure**

Run: `cd be && pnpm test srcla.client`

Expected: FAIL because client is absent.

- [ ] **Step 3: Implement validated GET-only client**

Run: `cd be && pnpm add zod@^4`

```typescript
private async get<T>(path: string, schema: ZodSchema<T>): Promise<T> {
  const signal = AbortSignal.timeout(3_000);
  const response = await fetch(new URL(path, this.baseUrl), { method: 'GET', signal });
  if (!response.ok) throw new ServiceUnavailableException('SRCLA read API unavailable');
  return schema.parse(await response.json());
}
```

If adding Zod to `/be`, pin the same major used by `/srcla`. Never proxy arbitrary paths or forward Navy auth tokens to SRCLA.

- [ ] **Step 4: Run tests and build**

Run: `cd be && pnpm test srcla.client && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/package.json be/pnpm-lock.yaml be/src/vault/srcla.client.ts be/src/vault/srcla.client.spec.ts be/src/vault/vault.module.ts
git commit -m "feat(be): consume read-only SRCLA strategy API"
```

---

### Task 5: Replace vault routes with direct-user and strategy-history APIs

**Files:**
- Replace: `be/src/vault/vault.controller.ts`
- Modify: `be/src/vault/dto.ts`
- Create: `be/src/vault/vault.controller.spec.ts`
- Modify: `be/test/farming.e2e-spec.ts`

**Interfaces:**
- Produces authenticated endpoints `GET /vault/position`, `GET /vault/limits`, `POST /vault/transactions/deposit`, `POST /vault/transactions/redeem`, `GET /vault/strategy`, `GET /vault/decisions`, and `GET /vault/harvests`.

- [ ] **Step 1: Write route and removed-endpoint tests**

```typescript
it.each([
  '/vault/deposit/authorization', '/vault/deposit/submit', '/vault/redeem/permit', '/vault/redeem/submit'
])('removes legacy %s', async (path) => {
  await request(app.getHttpServer()).post(path).set(userAuth).expect(404);
});
```

Test user role, wallet binding, decimal-string validation, proposal schema, SRCLA outage returning 503 only on strategy routes, and position routes still succeeding.

- [ ] **Step 2: Run and confirm old route behavior fails expectations**

Run: `cd be && pnpm test vault.controller && pnpm test:e2e -- farming.e2e-spec`

Expected: FAIL until controller routes are replaced.

- [ ] **Step 3: Implement thin controllers**

```typescript
@Post('transactions/deposit')
deposit(@Req() req: AuthenticatedRequest, @Body() dto: AmountBaseDto) {
  return this.vault.buildDepositTransactions(req.user.walletAddress, BigInt(dto.amountBase));
}
```

Controllers perform DTO/auth binding only. Services own chain/API logic. Return `{ transactions: TransactionProposal[] }` for deposit and `{ transaction }` for redeem.

- [ ] **Step 4: Run controller, E2E, and build gates**

Run: `cd be && pnpm test vault.controller vault.service srcla.client && pnpm test:e2e -- farming.e2e-spec && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/vault/vault.controller.ts be/src/vault/dto.ts be/src/vault/vault.controller.spec.ts be/test/farming.e2e-spec.ts
git commit -m "feat(be): expose direct Base vault transaction API"
```

---

### Task 6: Repoint AI farming tools and document consumer migration

**Files:**
- Modify: `be/src/agent/agent-tools.service.ts`
- Modify: `be/src/agent/tool-schemas.ts`
- Modify: `be/src/agent/prompt/tools/build-farming-deposit.ts`
- Modify: `be/src/agent/prompt/tools/build-farming-withdraw.ts`
- Modify: `be/src/agent/prompt/tools/get-farming-summary.ts`
- Modify: `be/test/unit/agent/tool-dispatch.spec.ts`
- Modify: `be/test/unit/agent/tool-schemas.spec.ts`
- Create: `docs/api/base-vault-client-migration.md`

**Interfaces:**
- Agent remains read-and-propose-only; it returns standard Base transaction proposals and never executes or requests signatures in `/be`.

- [ ] **Step 1: Write agent proposal tests**

```typescript
it('build_farming_deposit returns Base approve/deposit proposals without submitting', async () => {
  const result = await tools.build_farming_deposit({ amountBase: '100000000' });
  expect(result.display.action).toBe('farming_deposit');
  expect(result.transactions.map((t: any) => t.chainId)).toEqual([8453, 8453]);
  expect(farmingChain.provider.broadcastTransaction).not.toHaveBeenCalled();
});
```

Test withdrawal limited by `maxRedeem/maxWithdraw`, SRCLA summary degradation, and no legacy `typedData`, `signature`, `depositId`, or `redeemId` fields.

- [ ] **Step 2: Run and confirm failure**

Run: `cd be && pnpm test tool-dispatch tool-schemas`

Expected: FAIL against old tool result shapes.

- [ ] **Step 3: Implement new proposal/result schemas and migration document**

Document wallet flow: switch to Base → approve if included → wait receipt → deposit; redeem is one direct transaction; refresh position from chain. Document removed endpoints, error codes, transaction fields, user-paid gas, and the fact that SRCLA history is informational.

```typescript
return {
  display: { kind: 'action', action: 'farming_deposit' },
  chainId: 8453,
  transactions: await this.vault.buildDepositTransactions(walletAddress, BigInt(a.amountBase)),
};
```

- [ ] **Step 4: Run all backend verification**

Run: `cd be && pnpm test && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add be/src/agent be/test/unit/agent docs/api/base-vault-client-migration.md
git commit -m "feat(be): propose direct Base farming transactions"
```

---

### Task 7: Delete obsolete farming execution code and database tables

**Files:**
- Modify: `be/prisma/schema.prisma`
- Create: `be/prisma/migrations/20260802000000_remove_relayed_vault_models/migration.sql`
- Delete: `be/src/vault/vault-authorization.ts`
- Delete: `be/src/vault/vault-authorization.spec.ts`
- Delete: `be/src/vault/rebalance.logic.ts`
- Delete: `be/src/vault/rebalance.logic.spec.ts`
- Delete: `be/src/vault/rebalancer.service.ts`
- Delete: `be/src/vault/vault-watcher.service.ts`
- Modify: `be/src/evm/evm.module.ts`
- Modify: `be/src/config/config.service.ts`

**Interfaces:**
- Removes `VaultDeposit`, `VaultRedeem`, `RebalanceEvent`, `vault`, `vaultAsKeeper`, `keeper`, and vault-share signing fields from the Sepolia payment provider.

- [ ] **Step 1: Add grep and schema expectations to the migration test**

```typescript
it('Prisma exposes no relayed farming execution models', () => {
  expect((prisma as any).vaultDeposit).toBeUndefined();
  expect((prisma as any).vaultRedeem).toBeUndefined();
  expect((prisma as any).rebalanceEvent).toBeUndefined();
});
```

- [ ] **Step 2: Apply the destructive migration to a disposable database copy**

```sql
DROP TABLE IF EXISTS "VaultDeposit";
DROP TABLE IF EXISTS "VaultRedeem";
DROP TABLE IF EXISTS "RebalanceEvent";
```

Run: `cd be && source .env && pnpm prisma migrate deploy && pnpm prisma generate`

Expected: migration succeeds. Before applying to any retained environment, export the three old tables for archival audit history.

- [ ] **Step 3: Delete unreferenced code and remove farming wallet/config fields**

Keep Sepolia payment `relayer`, payment `owner`, USDC, and `NavyPayments` wiring. Remove only farming vault/keeper/share-domain fields and the corresponding `NAVY_KEEPER_PRIVATE_KEY`, `NAVY_REBALANCE_*`, and old `NAVY_VAULT_*` getters.

- [ ] **Step 4: Run grep gates and complete backend verification**

Run:

```bash
rg -n 'VaultDeposit|VaultRedeem|RebalanceEvent|vaultAsKeeper|keeperPrivateKey|depositWithAuthorization|NAVY_REBALANCE_' be/src be/prisma
cd be && pnpm test && pnpm build
```

Expected: `rg` has no results; tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add be/prisma be/src/vault be/src/evm/evm.module.ts be/src/config/config.service.ts
git commit -m "refactor(be): remove obsolete relayed farming implementation"
```
