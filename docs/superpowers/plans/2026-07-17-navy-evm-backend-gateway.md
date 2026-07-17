# Backend Payments Gateway (EVM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `be/` payment gateway from Solana to the EVM `NavyPayments` contract: the user signs an EIP-712 `ReceiveWithAuthorization` (USDC EIP-3009), the backend relayer submits `payInvoice(...)` and pays gas, and settlement reconciles the on-chain `InvoicePaid` event log — preserving the order state machine, the durable single-use nonce, the atomic settlement, and the HMAC webhook.

**Architecture:** Introduce a NEW `NAVY_EVM` provider (ethers v6: JSON-RPC provider + `NavyPayments` contract + relayer/owner wallets + USDC EIP-712 domain) alongside the existing Solana `NAVY_ONCHAIN`, which stays for farming/health until Plan 3. Migrate only the payments path (`RelayerService`, `ChainWatcherService`, `OrdersController`) and the admin merchant registrar to `NAVY_EVM`. Non-UI logic (EIP-712 typed-data build, digest, signer recovery, id encoding) lives in a plain-TS, unit-tested `src/evm/payment-authorization.ts`.

**Tech Stack:** NestJS 11, Prisma 7, `ethers` v6, jest (`*.spec.ts`, ts-jest). Targets the `NavyPayments` contract from Plan 1 (deployed to Sepolia) and Circle USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.

**Spec:** `docs/superpowers/specs/2026-07-17-navy-evm-migration-design.md` (§4, §5). Depends on Plan 1 (`contract/`) being built (`contract/out/NavyPayments.sol/NavyPayments.json` must exist — run `cd contract && forge build` first).

**Deliberate deviations from spec §5.1 (documented):** (1) No Prisma migration — the Order/Merchant columns are chain-agnostic; the `txSignature` DB column + webhook field are kept (renaming to `txHash` would break the merchant webhook contract for no functional gain; the column now holds an EVM tx hash). (2) `*Lamports`/`pubkey`/farming schema renames are deferred to Plan 3, where farming actually moves to EVM.

---

## File Structure

**New (`src/evm/`):**
- `src/evm/navy-payments-abi.json` — the `NavyPayments` ABI (copied from `contract/out/...`).
- `src/evm/payment-authorization.ts` — plain-TS: id encoding (`merchantIdHex`, `invoiceIdHexFromOrderId`, `invoiceKey`), EIP-712 typed-data build, digest, signer recovery.
- `src/evm/payment-authorization.spec.ts` — unit tests (real ethers crypto).
- `src/evm/evm.module.ts` — `NAVY_EVM` provider + `NavyEvm` interface.

**Rewritten:**
- `src/payments/relayer.service.ts` (+ `.spec.ts`) — `buildAuthorization` / `verifyAndSubmit`.
- `src/payments/chain-watcher.service.ts` (+ `.spec.ts`) — receipt + `InvoicePaid` log decode.
- `src/payments/orders.controller.ts` — `GET :id/payment-authorization`, `POST :id/submit`.
- `src/payments/payments.module.ts` — inject `NAVY_EVM`.
- `src/onchain/registrar.service.ts` → `src/evm/evm-registrar.service.ts` (+ `.spec.ts`) — owner calls `registerMerchant`/`setMerchantActive`/`setMerchantPayout`.
- `src/admin-merchants/admin-merchants.module.ts` — wire the EVM registrar.
- `src/config/config.service.ts` — EVM getters.
- `be/nest-cli.json` — copy `evm/*.json` assets. `be/package.json` — add `ethers`.

**Deleted:**
- `src/onchain/payments-client.ts` (+ `.spec.ts`) — Solana PDA/tx builder (its `merchantIdFromUuid` moves to `payment-authorization.ts`).
- Old Solana `src/payments/relayer.service.spec.ts`, `src/payments/chain-watcher.service.spec.ts`, `src/onchain/registrar.service.spec.ts` (replaced).

**Untouched (stay Solana until Plan 3):** `src/onchain/onchain.module.ts`, `navy_payments.json`, `src/health/*`, all `src/farming/*`, `src/wallet/*`, `@solana/*` + `@coral-xyz/anchor` deps.

---

### Task 1: Dependency, ABI asset, config getters

**Files:**
- Modify: `be/package.json`, `be/nest-cli.json`, `be/src/config/config.service.ts`
- Create: `be/src/evm/navy-payments-abi.json`
- Test: `be/src/config/config.service.spec.ts` (append)

- [ ] **Step 1: Ensure the contract ABI exists, then add `ethers` and copy the ABI**

Run:
```bash
cd /home/khoa/Desktop/DATN/contract && forge build >/dev/null && \
cd /home/khoa/Desktop/DATN/be && mkdir -p src/evm && \
node -e "const a=require('../contract/out/NavyPayments.sol/NavyPayments.json');require('fs').writeFileSync('src/evm/navy-payments-abi.json',JSON.stringify({abi:a.abi},null,2))" && \
pnpm add ethers@^6.13.0
```
Expected: `src/evm/navy-payments-abi.json` written (contains an `abi` array with `payInvoice`, `registerMerchant`, `InvoicePaid`, etc.); `ethers` added to `package.json` dependencies.

- [ ] **Step 2: Add the `evm/*.json` asset to `be/nest-cli.json`**

Open `be/nest-cli.json`. Find the `compilerOptions.assets` array (it already includes an entry copying `src/onchain/*.json`, e.g. `{ "include": "onchain/*.json", "outDir": "dist/src" }` or a bare `"onchain/*.json"`). Add a sibling entry for evm matching the EXACT format of the existing onchain entry — if the onchain entry is the object form, add `{ "include": "evm/*.json", "outDir": "dist/src" }`; if it's the string form, add `"evm/*.json"`. This ensures `node dist` can `require` the ABI.

- [ ] **Step 3: Append EVM getters to `NavyConfigService`**

In `be/src/config/config.service.ts`, add `import { ethers } from 'ethers';` at the top, and add these getters inside the class (before the closing brace):
```typescript
  // --- EVM (Sepolia) ---
  get evmRpcUrl(): string { return this.req('SEPOLIA_RPC_URL'); }
  get evmChainId(): number {
    const n = parseInt(this.env.EVM_CHAIN_ID ?? '11155111', 10);
    return Number.isFinite(n) ? n : 11155111;
  }
  get paymentsAddress(): string { return this.req('NAVY_PAYMENTS_ADDRESS'); }
  get usdcAddress(): string { return this.req('NAVY_USDC_ADDRESS'); }
  get treasuryAddress(): string { return this.req('NAVY_TREASURY_ADDRESS'); }
  get relayerPrivateKey(): string { return this.req('NAVY_RELAYER_PRIVATE_KEY'); }
  get ownerPrivateKey(): string { return this.req('NAVY_OWNER_PRIVATE_KEY'); }
  /** USDC EIP-712 domain name/version. Circle Sepolia USDC is name "USDC", version "2"; overridable + verify against chain. */
  get usdcEip712Name(): string { return this.env.NAVY_USDC_EIP712_NAME ?? 'USDC'; }
  get usdcEip712Version(): string { return this.env.NAVY_USDC_EIP712_VERSION ?? '2'; }
  /** Min relayer ETH balance (wei) required before submitting a payment. Env is ETH; default 0.02. */
  get relayerMinBalanceWei(): bigint {
    const eth = this.env.NAVY_RELAYER_MIN_BALANCE_ETH ?? '0.02';
    try { return ethers.parseEther(eth); } catch { return ethers.parseEther('0.02'); }
  }
```

- [ ] **Step 4: Append a config test**

In `be/src/config/config.service.spec.ts`, add (inside the top-level `describe`, adapting the env-stub style already used in that file — it constructs `new NavyConfigService(env)` with a fake env object that includes a valid 64-hex `SUBWALLET_MASTER_KEY`):
```typescript
  it('exposes EVM getters with sensible defaults', () => {
    const base = { SUBWALLET_MASTER_KEY: 'a'.repeat(64) } as any;
    const cfg = new (require('./config.service').NavyConfigService)({
      ...base,
      SEPOLIA_RPC_URL: 'https://sepolia.example',
      NAVY_PAYMENTS_ADDRESS: '0x1111111111111111111111111111111111111111',
      NAVY_USDC_ADDRESS: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      NAVY_TREASURY_ADDRESS: '0x2222222222222222222222222222222222222222',
      NAVY_RELAYER_PRIVATE_KEY: '0x' + '1'.repeat(64),
      NAVY_OWNER_PRIVATE_KEY: '0x' + '2'.repeat(64),
    });
    expect(cfg.evmChainId).toBe(11155111);
    expect(cfg.usdcEip712Name).toBe('USDC');
    expect(cfg.usdcEip712Version).toBe('2');
    expect(cfg.relayerMinBalanceWei).toBe(20000000000000000n); // 0.02 ETH
  });
```

- [ ] **Step 5: Run the config test**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test config.service`
Expected: the new test plus existing config tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add be/package.json be/pnpm-lock.yaml be/nest-cli.json be/src/evm/navy-payments-abi.json be/src/config/config.service.ts be/src/config/config.service.spec.ts && git commit -m "feat(be): add ethers + NavyPayments ABI asset + EVM config getters"
```

---

### Task 2: `payment-authorization.ts` — EIP-712 plain-TS core

**Files:**
- Create: `be/src/evm/payment-authorization.ts`
- Test: `be/src/evm/payment-authorization.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `be/src/evm/payment-authorization.spec.ts`:
```typescript
import { ethers } from 'ethers';
import {
  merchantIdHex,
  invoiceIdHexFromOrderId,
  invoiceKey,
  buildAuthorizationTypedData,
  authorizationDigest,
  recoverAuthorizationSigner,
  type UsdcDomain,
} from './payment-authorization';

const DOMAIN: UsdcDomain = { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };
const PAYMENTS = '0x1111111111111111111111111111111111111111';

describe('payment-authorization', () => {
  it('encodes a uuid to a 16-byte 0x hex string', () => {
    expect(merchantIdHex('11111111-2222-3333-4444-555555555555')).toBe('0x11111111222233334444555555555555');
    expect(invoiceIdHexFromOrderId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('0xaaaaaaaabbbbccccddddeeeeeeeeeeee');
  });

  it('rejects a non-uuid', () => {
    expect(() => merchantIdHex('not-a-uuid')).toThrow(/invalid uuid/);
  });

  it('derives the invoice key as keccak256(merchantId ++ invoiceId), matching the contract', () => {
    const m = merchantIdHex('11111111-2222-3333-4444-555555555555');
    const i = invoiceIdHexFromOrderId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    const expected = ethers.keccak256(ethers.concat([m, i]));
    expect(invoiceKey(m, i)).toBe(expected);
  });

  it('builds typed data whose digest a wallet signs and we recover', async () => {
    const wallet = ethers.Wallet.createRandom();
    const m = merchantIdHex('11111111-2222-3333-4444-555555555555');
    const i = invoiceIdHexFromOrderId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    const td = buildAuthorizationTypedData({
      domain: DOMAIN, payer: wallet.address, to: PAYMENTS,
      amount: 1_000_000n, validAfter: 0, validBefore: 9_999_999_999, nonce: invoiceKey(m, i),
    });
    const sig = await wallet.signTypedData(td.domain, td.types, td.message);
    expect(recoverAuthorizationSigner(td, sig)).toBe(wallet.address);
    // The digest we persist equals ethers' TypedDataEncoder hash and recovers via raw ecrecover too.
    expect(ethers.recoverAddress(authorizationDigest(td), sig)).toBe(wallet.address);
  });

  it('recovers a DIFFERENT address for a tampered amount (signature no longer matches)', async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonce = invoiceKey(merchantIdHex('11111111-2222-3333-4444-555555555555'), invoiceIdHexFromOrderId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
    const signed = buildAuthorizationTypedData({ domain: DOMAIN, payer: wallet.address, to: PAYMENTS, amount: 1_000_000n, validAfter: 0, validBefore: 9_999_999_999, nonce });
    const sig = await wallet.signTypedData(signed.domain, signed.types, signed.message);
    const tampered = buildAuthorizationTypedData({ domain: DOMAIN, payer: wallet.address, to: PAYMENTS, amount: 2_000_000n, validAfter: 0, validBefore: 9_999_999_999, nonce });
    expect(recoverAuthorizationSigner(tampered, sig)).not.toBe(wallet.address);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test payment-authorization`
Expected: FAIL — cannot find module `./payment-authorization`.

- [ ] **Step 3: Implement `payment-authorization.ts`**

Create `be/src/evm/payment-authorization.ts`:
```typescript
import { ethers } from 'ethers';

export interface UsdcDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface AuthorizationTypedData {
  domain: UsdcDomain;
  types: typeof RECEIVE_WITH_AUTHORIZATION_TYPES;
  primaryType: 'ReceiveWithAuthorization';
  message: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

/** uuid (v4) -> 0x-prefixed 16-byte hex (matches the contract's bytes16 merchantId / invoiceId). */
function uuidToBytes16Hex(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`invalid uuid: ${uuid}`);
  return '0x' + hex;
}

export function merchantIdHex(merchantUuid: string): string {
  return uuidToBytes16Hex(merchantUuid);
}

export function invoiceIdHexFromOrderId(orderId: string): string {
  return uuidToBytes16Hex(orderId);
}

/** keccak256(abi.encodePacked(bytes16 merchantId, bytes16 invoiceId)) — the EIP-3009 nonce + contract invoice key. */
export function invoiceKey(merchantIdHex16: string, invoiceIdHex16: string): string {
  return ethers.keccak256(ethers.concat([merchantIdHex16, invoiceIdHex16]));
}

export function buildAuthorizationTypedData(p: {
  domain: UsdcDomain;
  payer: string;
  to: string;
  amount: bigint;
  validAfter: number;
  validBefore: number;
  nonce: string;
}): AuthorizationTypedData {
  return {
    domain: p.domain,
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from: p.payer,
      to: p.to,
      value: p.amount.toString(),
      validAfter: p.validAfter.toString(),
      validBefore: p.validBefore.toString(),
      nonce: p.nonce,
    },
  };
}

/** The EIP-712 digest the wallet signs; persisted as the order's durable single-use nonce. */
export function authorizationDigest(td: AuthorizationTypedData): string {
  return ethers.TypedDataEncoder.hash(td.domain, td.types as any, td.message);
}

/** Recover the signer address from typed data + a 65-byte signature. */
export function recoverAuthorizationSigner(td: AuthorizationTypedData, signature: string): string {
  return ethers.verifyTypedData(td.domain, td.types as any, td.message, signature);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test payment-authorization`
Expected: all 5 tests PASS (id encoding, uuid rejection, invoice-key parity with `ethers.concat`, sign→recover round-trip, tamper detection).

- [ ] **Step 5: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add be/src/evm/payment-authorization.ts be/src/evm/payment-authorization.spec.ts && git commit -m "feat(be): EIP-712 ReceiveWithAuthorization builder + signer recovery"
```

---

### Task 3: `evm.module.ts` — the `NAVY_EVM` provider

**Files:**
- Create: `be/src/evm/evm.module.ts`

No unit test (DI wiring + live ethers objects); verified by `tsc` in Task 6 and the relayer/watcher tests that mock this shape.

- [ ] **Step 1: Write `evm.module.ts`**

Create `be/src/evm/evm.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { ethers } from 'ethers';
import { NavyConfigService } from '../config/config.service';
import type { UsdcDomain } from './payment-authorization';

// require avoids nodenext JSON-import assertions (same pattern as the Solana IDL).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const artifact = require('./navy-payments-abi.json');

export const NAVY_EVM = Symbol('NAVY_EVM');

export interface NavyEvm {
  provider: ethers.JsonRpcProvider;
  payments: ethers.Contract;      // connected to the relayer wallet (payInvoice submitter)
  paymentsAsOwner: ethers.Contract; // connected to the owner wallet (admin ops)
  relayer: ethers.Wallet;
  owner: ethers.Wallet;
  usdcAddress: string;
  treasury: string;
  paymentsAddress: string;
  usdcDomain: UsdcDomain;
}

@Global()
@Module({
  providers: [{
    provide: NAVY_EVM,
    inject: [NavyConfigService],
    useFactory: (cfg: NavyConfigService): NavyEvm => {
      const provider = new ethers.JsonRpcProvider(cfg.evmRpcUrl, cfg.evmChainId);
      const relayer = new ethers.Wallet(cfg.relayerPrivateKey, provider);
      const owner = new ethers.Wallet(cfg.ownerPrivateKey, provider);
      const payments = new ethers.Contract(cfg.paymentsAddress, artifact.abi, relayer);
      const paymentsAsOwner = new ethers.Contract(cfg.paymentsAddress, artifact.abi, owner);
      const usdcDomain: UsdcDomain = {
        name: cfg.usdcEip712Name,
        version: cfg.usdcEip712Version,
        chainId: cfg.evmChainId,
        verifyingContract: cfg.usdcAddress,
      };
      return {
        provider, payments, paymentsAsOwner, relayer, owner,
        usdcAddress: cfg.usdcAddress, treasury: cfg.treasuryAddress,
        paymentsAddress: cfg.paymentsAddress, usdcDomain,
      };
    },
  }],
  exports: [NAVY_EVM],
})
export class EvmModule {}
```

- [ ] **Step 2: Typecheck compiles**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "evm/evm.module|payment-authorization" || echo "no evm-module type errors"`
Expected: `no evm-module type errors` (other pre-existing files may still be mid-migration; we only care this file is type-clean).

- [ ] **Step 3: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add be/src/evm/evm.module.ts && git commit -m "feat(be): NAVY_EVM ethers provider module"
```

---

### Task 4: Rewrite `RelayerService` (build authorization + verify/submit)

**Files:**
- Rewrite: `be/src/payments/relayer.service.ts`
- Replace: `be/src/payments/relayer.service.spec.ts`

- [ ] **Step 1: Replace the spec with EVM tests**

Overwrite `be/src/payments/relayer.service.spec.ts`:
```typescript
import { ethers } from 'ethers';
import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { RelayerService } from './relayer.service';
import { buildAuthorizationTypedData, invoiceKey, merchantIdHex, invoiceIdHexFromOrderId, authorizationDigest, type UsdcDomain } from '../evm/payment-authorization';

const DOMAIN: UsdcDomain = { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };
const PAYMENTS = '0x1111111111111111111111111111111111111111';
const MERCHANT_UUID = '11111111-2222-3333-4444-555555555555';
const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeChain(balance = 10n ** 18n, payInvoice = jest.fn()) {
  return {
    provider: { getBalance: jest.fn().mockResolvedValue(balance) },
    payments: { payInvoice },
    relayer: { address: '0x9999999999999999999999999999999999999999' },
    paymentsAddress: PAYMENTS,
    usdcDomain: DOMAIN,
    treasury: '0x2222222222222222222222222222222222222222',
  } as any;
}
function makePrisma(order: any, consumeCount = 1) {
  return { order: {
    findUnique: jest.fn().mockResolvedValue(order),
    update: jest.fn().mockResolvedValue(order),
    updateMany: jest.fn().mockResolvedValue({ count: consumeCount }),
  } } as any;
}
function makeCfg(minWei = 20000000000000000n) { return { relayerMinBalanceWei: minWei } as any; }

async function signFor(wallet: ethers.HDNodeWallet, amount: bigint, expiresAt: Date) {
  const nonce = invoiceKey(merchantIdHex(MERCHANT_UUID), invoiceIdHexFromOrderId(ORDER_ID));
  const td = buildAuthorizationTypedData({ domain: DOMAIN, payer: wallet.address, to: PAYMENTS, amount, validAfter: 0, validBefore: Math.floor(expiresAt.getTime() / 1000), nonce });
  return { sig: await wallet.signTypedData(td.domain, td.types, td.message), digest: authorizationDigest(td) };
}

describe('RelayerService (EVM)', () => {
  it('buildAuthorization persists the digest as the single-use nonce + returns typed data', async () => {
    const chain = makeChain();
    const prisma = makePrisma({ id: ORDER_ID });
    const svc = new RelayerService(chain, prisma, makeCfg());
    const expiresAt = new Date(Date.now() + 600_000);
    const payer = ethers.Wallet.createRandom().address;

    const out = await svc.buildAuthorization({ id: ORDER_ID, amount: 1_000_000n, expiresAt }, merchantIdHex(MERCHANT_UUID), payer);

    expect(out.typedData.message.from).toBe(payer);
    expect(out.typedData.message.value).toBe('1000000');
    const expectedDigest = authorizationDigest(out.typedData);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { issuedTxHash: expectedDigest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null },
    });
  });

  it('buildAuthorization throws 503 when relayer ETH is below min, and does NOT persist', async () => {
    const chain = makeChain(19999999999999999n); // just under 0.02 ETH
    const prisma = makePrisma({ id: ORDER_ID });
    const svc = new RelayerService(chain, prisma, makeCfg(20000000000000000n));
    await expect(svc.buildAuthorization({ id: ORDER_ID, amount: 1_000_000n, expiresAt: new Date(Date.now() + 600_000) }, merchantIdHex(MERCHANT_UUID), '0x1234567890123456789012345678901234567890'))
      .rejects.toThrow(ServiceUnavailableException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('verifyAndSubmit happy path: recovers payer, consumes atomically before submit, returns {txHash,payer,err:null}', async () => {
    const wallet = ethers.Wallet.createRandom();
    const expiresAt = new Date(Date.now() + 600_000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, expiresAt);
    const wait = jest.fn().mockResolvedValue({ status: 1 });
    const payInvoice = jest.fn().mockResolvedValue({ hash: '0xtxhash', wait });
    const chain = makeChain(10n ** 18n, payInvoice);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null };
    const prisma = makePrisma(order);
    const svc = new RelayerService(chain, prisma, makeCfg());

    const res = await svc.verifyAndSubmit(ORDER_ID, sig, wallet.address);

    expect(res).toEqual({ txHash: '0xtxhash', payer: wallet.address, err: null });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: ORDER_ID, issuedTxConsumedAt: null }, data: { issuedTxConsumedAt: expect.any(Date) } });
    const consumeOrder = prisma.order.updateMany.mock.invocationCallOrder[0];
    const submitOrder = payInvoice.mock.invocationCallOrder[0];
    expect(consumeOrder).toBeLessThan(submitOrder);
    // payInvoice called with (merchantIdHex, invoiceIdHex, amount, validAfter, validBefore, payer, v, r, s)
    const args = payInvoice.mock.calls[0];
    expect(args[0]).toBe(merchantIdHex(MERCHANT_UUID));
    expect(args[1]).toBe(invoiceIdHexFromOrderId(ORDER_ID));
    expect(args[2]).toBe(1_000_000n);
    expect(args[5]).toBe(wallet.address);
  });

  it('verifyAndSubmit rejects when the recovered signer != expected payer', async () => {
    const wallet = ethers.Wallet.createRandom();
    const expiresAt = new Date(Date.now() + 600_000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, expiresAt);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null };
    const svc = new RelayerService(makeChain(), makePrisma(order), makeCfg());
    await expect(svc.verifyAndSubmit(ORDER_ID, sig, '0x0000000000000000000000000000000000000001')).rejects.toThrow(/signature/i);
  });

  it('verifyAndSubmit rejects a concurrent second submit (atomic consume count 0) without submitting', async () => {
    const wallet = ethers.Wallet.createRandom();
    const expiresAt = new Date(Date.now() + 600_000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, expiresAt);
    const payInvoice = jest.fn();
    const chain = makeChain(10n ** 18n, payInvoice);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null };
    const prisma = makePrisma(order, 0);
    const svc = new RelayerService(chain, prisma, makeCfg());
    await expect(svc.verifyAndSubmit(ORDER_ID, sig, wallet.address)).rejects.toThrow(/already submitted/i);
    expect(payInvoice).not.toHaveBeenCalled();
  });

  it('verifyAndSubmit rejects an expired issued authorization', async () => {
    const wallet = ethers.Wallet.createRandom();
    const past = new Date(Date.now() - 1000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, past);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: past, issuedTxConsumedAt: null };
    const svc = new RelayerService(makeChain(), makePrisma(order), makeCfg());
    await expect(svc.verifyAndSubmit(ORDER_ID, sig, wallet.address)).rejects.toThrow(/expired/i);
  });

  it('verifyAndSubmit maps a reverted receipt to err', async () => {
    const wallet = ethers.Wallet.createRandom();
    const expiresAt = new Date(Date.now() + 600_000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, expiresAt);
    const payInvoice = jest.fn().mockResolvedValue({ hash: '0xrevert', wait: jest.fn().mockResolvedValue({ status: 0 }) });
    const chain = makeChain(10n ** 18n, payInvoice);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null };
    const svc = new RelayerService(chain, makePrisma(order), makeCfg());
    const res = await svc.verifyAndSubmit(ORDER_ID, sig, wallet.address);
    expect(res.txHash).toBe('0xrevert');
    expect(res.err).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test relayer.service`
Expected: FAIL — the current `RelayerService` has no `buildAuthorization`/new `verifyAndSubmit` signature (compile/type errors or assertion failures).

- [ ] **Step 3: Rewrite `relayer.service.ts`**

Overwrite `be/src/payments/relayer.service.ts`:
```typescript
import { ethers } from 'ethers';
import { Inject, Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';
import {
  buildAuthorizationTypedData,
  invoiceKey,
  invoiceIdHexFromOrderId,
  recoverAuthorizationSigner,
  authorizationDigest,
  type AuthorizationTypedData,
} from '../evm/payment-authorization';

export interface AuthorizationResult {
  typedData: AuthorizationTypedData;
  invoice: { merchant: string; amount: string; reference?: string; expiresAt: Date };
}

@Injectable()
export class RelayerService {
  constructor(
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
    private readonly prisma: PrismaService,
    private readonly cfg: NavyConfigService,
  ) {}

  /** Build the EIP-712 ReceiveWithAuthorization the wallet signs, and persist its digest as a durable single-use nonce. */
  async buildAuthorization(
    order: { id: string; amount: bigint; expiresAt: Date; reference?: string },
    merchantIdHex16: string,
    payer: string,
  ): Promise<AuthorizationResult> {
    // Guardrail: the relayer pays gas for every payInvoice. If it's low on ETH, fail fast (503).
    const balance = await this.chain.provider.getBalance(this.chain.relayer.address);
    if (balance < this.cfg.relayerMinBalanceWei) {
      throw new ServiceUnavailableException('Payment relayer is temporarily unavailable');
    }
    const invoiceIdHex16 = invoiceIdHexFromOrderId(order.id);
    const validBefore = Math.floor(order.expiresAt.getTime() / 1000);
    const typedData = buildAuthorizationTypedData({
      domain: this.chain.usdcDomain,
      payer,
      to: this.chain.paymentsAddress,
      amount: order.amount,
      validAfter: 0,
      validBefore,
      nonce: invoiceKey(merchantIdHex16, invoiceIdHex16),
    });
    const issuedTxHash = authorizationDigest(typedData);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { issuedTxHash, issuedTxExpiresAt: order.expiresAt, issuedTxConsumedAt: null },
    });
    return { typedData, invoice: { merchant: '', amount: order.amount.toString(), reference: order.reference, expiresAt: order.expiresAt } };
  }

  /** Recover the payer from the signature, atomically consume the nonce, then relay payInvoice and pay gas. */
  async verifyAndSubmit(
    orderId: string,
    signature: string,
    expectedPayer: string,
  ): Promise<{ txHash: string; payer: string; err: unknown }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order?.issuedTxHash) throw new BadRequestException('No issued authorization for this order');
    if (order.issuedTxConsumedAt) throw new BadRequestException('Authorization already submitted');
    if (order.issuedTxExpiresAt && order.issuedTxExpiresAt < new Date()) {
      throw new BadRequestException('Issued authorization expired');
    }
    // The persisted digest is exactly what the wallet signed; recover the signer via raw ecrecover.
    let signer: string;
    try {
      signer = ethers.recoverAddress(order.issuedTxHash, signature);
    } catch {
      throw new BadRequestException('Invalid signature');
    }
    if (signer.toLowerCase() !== expectedPayer.toLowerCase()) {
      throw new BadRequestException('Signature does not match the authenticated payer');
    }
    // Optimistic single-use consume BEFORE submitting, so a concurrent second submit is rejected here.
    const consumed = await this.prisma.order.updateMany({
      where: { id: orderId, issuedTxConsumedAt: null },
      data: { issuedTxConsumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Authorization already submitted');

    // Reconstruct the exact payInvoice args from the order (the on-chain USDC re-verifies the sig against these).
    const merchantIdHex16 = '0x' + order.merchantId.replace(/-/g, '').toLowerCase();
    const invoiceIdHex16 = invoiceIdHexFromOrderId(order.id);
    const validBefore = Math.floor(order.issuedTxExpiresAt!.getTime() / 1000);
    const sig = ethers.Signature.from(signature);
    const tx = await this.chain.payments.payInvoice(
      merchantIdHex16, invoiceIdHex16, order.amount, 0, validBefore, signer, sig.v, sig.r, sig.s,
    );
    const receipt = await tx.wait();
    return { txHash: tx.hash, payer: signer, err: receipt && receipt.status === 1 ? null : 'reverted' };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test relayer.service`
Expected: all 7 EVM tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add be/src/payments/relayer.service.ts be/src/payments/relayer.service.spec.ts && git commit -m "feat(be): EVM RelayerService — EIP-712 authorization build + relay submit"
```

---

### Task 5: Rewrite `ChainWatcherService` (receipt + InvoicePaid log decode)

**Files:**
- Rewrite: `be/src/payments/chain-watcher.service.ts`
- Replace: `be/src/payments/chain-watcher.service.spec.ts`

- [ ] **Step 1: Replace the spec with EVM tests**

Overwrite `be/src/payments/chain-watcher.service.spec.ts`:
```typescript
import { ethers } from 'ethers';
import { ChainWatcherService } from './chain-watcher.service';
import { merchantIdHex, invoiceIdHexFromOrderId } from '../evm/payment-authorization';

const MERCHANT_UUID = '11111111-2222-3333-4444-555555555555';
const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PAYER = '0x3333333333333333333333333333333333333333';

// Real ethers Interface so parseLog behaves exactly as in production.
const iface = new ethers.Interface([
  'event InvoicePaid(bytes16 indexed merchantId, bytes16 indexed invoiceId, address indexed payer, uint256 amount, uint256 fee, uint256 paidAt)',
]);
function invoicePaidLog(amount: bigint, fee: bigint) {
  return iface.encodeEventLog('InvoicePaid', [
    merchantIdHex(MERCHANT_UUID), invoiceIdHexFromOrderId(ORDER_ID), PAYER, amount, fee, 1_700_000_000n,
  ]);
}

function makeChain(receipt: any) {
  return { provider: { getTransactionReceipt: jest.fn().mockResolvedValue(receipt) }, payments: { interface: iface } } as any;
}
function makePrisma(order: any, claimCount = 1) {
  const updated = { ...order, status: 'paid', paidAt: new Date() };
  // confirmOrder reads once, markPaid reads again (guard), then re-reads the settled row for the
  // webhook payload — so the first TWO reads must be the pre-settlement order, the third the updated row.
  return { order: {
    findUnique: jest.fn().mockResolvedValueOnce(order).mockResolvedValueOnce(order).mockResolvedValue(updated),
    update: jest.fn().mockResolvedValue(order),
    updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
  } } as any;
}
const webhooks = () => ({ deliver: jest.fn().mockResolvedValue(undefined) }) as any;
const secrets = () => ({ secretForMerchant: jest.fn().mockResolvedValue('shh') }) as any;

describe('ChainWatcherService (EVM)', () => {
  const baseOrder = { id: ORDER_ID, merchantId: MERCHANT_UUID, status: 'confirming', txSignature: '0xtx', amount: 1_000_000n, feeBps: 100, reference: 'ORD-1', callbackUrl: 'https://cb', paidAt: null };

  it('confirmOrder settles + fires webhook when the receipt has a matching InvoicePaid log', async () => {
    const log = invoicePaidLog(1_000_000n, 10_000n);
    const chain = makeChain({ status: 1, logs: [{ topics: log.topics, data: log.data }] });
    const prisma = makePrisma(baseOrder);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(prisma.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ORDER_ID, status: { not: 'paid' } } }));
    expect(w.deliver).toHaveBeenCalled();
    const payload = w.deliver.mock.calls[0][3];
    expect(payload.payer).toBe(PAYER);
    expect(payload.fee).toBe('10000');
    expect(payload.status).toBe('paid');
  });

  it('confirmOrder marks failed (no webhook) when the receipt reverted', async () => {
    const chain = makeChain({ status: 0, logs: [] });
    const prisma = makePrisma(baseOrder);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: ORDER_ID }, data: { status: 'failed' } });
    expect(w.deliver).not.toHaveBeenCalled();
  });

  it('confirmOrder is a no-op while the receipt is not yet mined (null)', async () => {
    const chain = makeChain(null);
    const prisma = makePrisma(baseOrder);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(w.deliver).not.toHaveBeenCalled();
  });

  it('confirmOrder does not settle when no matching InvoicePaid log is present', async () => {
    const chain = makeChain({ status: 1, logs: [] });
    const prisma = makePrisma(baseOrder);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(w.deliver).not.toHaveBeenCalled();
  });

  it('markPaid loser (claim count 0) does not fire the webhook', async () => {
    const log = invoicePaidLog(1_000_000n, 10_000n);
    const chain = makeChain({ status: 1, logs: [{ topics: log.topics, data: log.data }] });
    const prisma = makePrisma(baseOrder, 0);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(w.deliver).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test chain-watcher.service`
Expected: FAIL — the current watcher uses the Solana `connection`/`EventParser` shape.

- [ ] **Step 3: Rewrite `chain-watcher.service.ts`**

Overwrite `be/src/payments/chain-watcher.service.ts`:
```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from './webhook.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { merchantIdHex, invoiceIdHexFromOrderId } from '../evm/payment-authorization';

export interface SecretLookup { secretForMerchant(merchantId: string): Promise<string | null>; }

@Injectable()
export class ChainWatcherService {
  private readonly logger = new Logger(ChainWatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
    private readonly secrets: SecretLookup,
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
  ) {}

  async markPaid(orderId: string, info: { payer: string; txHash: string; fee?: bigint }): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'paid') return;
    // Atomic guarded write: only ONE concurrent caller (submit fast-path vs. sweep) flips → paid.
    const claimed = await this.prisma.order.updateMany({
      where: { id: orderId, status: { not: 'paid' } },
      data: { status: 'paid', payer: info.payer, txSignature: info.txHash, paidAt: new Date() },
    });
    if (claimed.count !== 1) return; // another caller already settled — do not fire the webhook
    const updated = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (order.callbackUrl && updated) {
      const secret = await this.secrets.secretForMerchant(order.merchantId);
      if (secret) {
        const fee = info.fee ?? (updated.amount * BigInt(updated.feeBps)) / 10000n;
        await this.webhooks.deliver(orderId, order.callbackUrl, secret, {
          orderId, reference: updated.reference, amount: updated.amount.toString(),
          fee: fee.toString(), payer: info.payer, txSignature: info.txHash,
          status: 'paid', paidAt: updated.paidAt,
        });
      }
    }
  }

  /** Settlement source of truth: settle only if the tx mined successfully AND emitted a matching InvoicePaid. */
  async confirmOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'paid') return;
    if (!order.txSignature) return; // submit hasn't recorded a tx hash yet

    const receipt = await this.chain.provider.getTransactionReceipt(order.txSignature);
    if (receipt == null) return; // not yet mined — a later sweep retries
    if (receipt.status !== 1) {
      await this.prisma.order.update({ where: { id: orderId }, data: { status: 'failed' } });
      return;
    }
    const event = this.findInvoicePaid(order.merchantId, order.id, receipt.logs ?? []);
    if (!event) return; // don't settle without the event; a sweep retries
    await this.markPaid(orderId, { payer: event.payer, txHash: order.txSignature, fee: event.fee });
  }

  /** Decode InvoicePaid logs and return the one matching this order's (merchantId, invoiceId). */
  private findInvoicePaid(
    merchantUuid: string,
    orderId: string,
    logs: ReadonlyArray<{ topics: ReadonlyArray<string>; data: string }>,
  ): { payer: string; amount: bigint; fee: bigint } | null {
    let wantMerchant: string, wantInvoice: string;
    try {
      wantMerchant = merchantIdHex(merchantUuid);
      wantInvoice = invoiceIdHexFromOrderId(orderId);
    } catch {
      return null;
    }
    for (const log of logs) {
      let parsed: ethers.LogDescription | null;
      try {
        parsed = this.chain.payments.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        continue;
      }
      if (!parsed || parsed.name !== 'InvoicePaid') continue;
      const mId = String(parsed.args.merchantId).toLowerCase();
      const iId = String(parsed.args.invoiceId).toLowerCase();
      if (mId !== wantMerchant.toLowerCase() || iId !== wantInvoice.toLowerCase()) continue;
      return {
        payer: String(parsed.args.payer),
        amount: BigInt(parsed.args.amount.toString()),
        fee: BigInt(parsed.args.fee.toString()),
      };
    }
    return null;
  }

  @Interval(15000)
  async sweepConfirming(): Promise<void> {
    const pending = await this.prisma.order.findMany({ where: { status: 'confirming' } });
    for (const o of pending) {
      try {
        await this.confirmOrder(o.id);
      } catch (e) {
        this.logger.warn(`sweepConfirming: confirmOrder(${o.id}) failed: ${(e as Error).message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStale(): Promise<void> {
    const stale = await this.prisma.order.findMany({
      where: { status: 'awaiting_payment', expiresAt: { lt: new Date() } },
    });
    for (const o of stale) {
      await this.prisma.order.update({ where: { id: o.id }, data: { status: 'expired' } });
    }
  }
}
```
Add the ethers type import at the top: `import { ethers } from 'ethers';`

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test chain-watcher.service`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add be/src/payments/chain-watcher.service.ts be/src/payments/chain-watcher.service.spec.ts && git commit -m "feat(be): EVM ChainWatcher — receipt + InvoicePaid log settlement"
```

---

### Task 6: Rewire endpoints + payments module

**Files:**
- Modify: `be/src/payments/orders.controller.ts`
- Modify: `be/src/payments/payments.module.ts`

- [ ] **Step 1: Rewrite the two payment endpoints in `orders.controller.ts`**

In `be/src/payments/orders.controller.ts`:
1. Remove `import { PublicKey } from '@solana/web3.js';` and `import { merchantIdFromUuid } from '../onchain/payments-client';`. Add `import { merchantIdHex } from '../evm/payment-authorization';`.
2. Change the `SubmitDto` to carry a signature:
```typescript
class SubmitDto {
  @IsString() @IsNotEmpty() signature!: string;
}
```
3. Replace the `paymentTx` method (the `@Get(':id/payment-tx')` block) with:
```typescript
  @Get(':id/payment-authorization')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('user')
  async paymentAuthorization(@Param('id') id: string, @Req() req: any) {
    const order = await this.orders.get(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'awaiting_payment' || order.expiresAt < new Date()) {
      throw new BadRequestException('Order is not awaiting payment');
    }
    const payer: string = req.user.walletAddress;
    if (!payer || !/^0x[0-9a-fA-F]{40}$/.test(payer)) throw new BadRequestException('EVM wallet address required');
    const { typedData } = await this.relayer.buildAuthorization(
      { id: order.id, amount: order.amount, expiresAt: order.expiresAt, reference: order.reference },
      merchantIdHex(order.merchantId),
      payer,
    );
    return {
      typedData,
      invoice: { merchant: order.merchantId, amount: order.amount.toString(), reference: order.reference, expiresAt: order.expiresAt },
    };
  }
```
4. Replace the `submit` method body's relayer call so it passes the signature + expected payer and uses `txHash`:
```typescript
  @Post(':id/submit')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('user')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async submit(@Param('id') id: string, @Body() dto: SubmitDto, @Req() req: any) {
    const { txHash, err } = await this.relayer.verifyAndSubmit(id, dto.signature, req.user.walletAddress);
    if (err) {
      await this.prisma.order.update({ where: { id }, data: { status: 'failed', txSignature: txHash } });
      return { txHash, status: 'failed' };
    }
    await this.prisma.order.update({ where: { id }, data: { status: 'confirming', txSignature: txHash } });
    await this.watcher.confirmOrder(id);
    const settled = await this.prisma.order.findUnique({ where: { id } });
    return { txHash, status: settled?.status ?? 'confirming' };
  }
```
(The `merchant` lookup + `payoutWallet` PublicKey code from the old `paymentTx` is deleted — payout is read on-chain from the merchant registry now.)

- [ ] **Step 2: Rewire `payments.module.ts` to `NAVY_EVM`/`EvmModule`**

In `be/src/payments/payments.module.ts`:
1. Replace `import { OnchainModule, NAVY_ONCHAIN, type NavyOnchain } from '../onchain/onchain.module';` with `import { EvmModule, NAVY_EVM, type NavyEvm } from '../evm/evm.module';`.
2. In `imports`, replace `OnchainModule` with `EvmModule`.
3. In the `ChainWatcherService` provider, change `inject: [PrismaService, WebhookService, SecretLookupService, NAVY_ONCHAIN]` to `inject: [PrismaService, WebhookService, SecretLookupService, NAVY_EVM]` and the factory param type `o: NavyOnchain` → `o: NavyEvm`.
(`RelayerService` is a plain provider — Nest injects `NAVY_EVM` via its `@Inject(NAVY_EVM)` constructor decorator automatically once `EvmModule` is imported.)

- [ ] **Step 3: Typecheck the payments path**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/payments/(orders.controller|payments.module|relayer|chain-watcher)" || echo "payments path type-clean"`
Expected: `payments path type-clean`.

- [ ] **Step 4: Run the payments test suite**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test payments`
Expected: relayer + chain-watcher + orders.service + webhook + order-auth + invoice tests all PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add be/src/payments/orders.controller.ts be/src/payments/payments.module.ts && git commit -m "feat(be): EIP-712 payment-authorization + submit endpoints on EVM"
```

---

### Task 7: EVM merchant registrar (admin approval → on-chain)

**Files:**
- Create: `be/src/evm/evm-registrar.service.ts`
- Test: `be/src/evm/evm-registrar.service.spec.ts`
- Modify: `be/src/admin-merchants/admin-merchants.module.ts`
- Delete: `be/src/onchain/registrar.service.ts`, `be/src/onchain/registrar.service.spec.ts`

- [ ] **Step 1: Write the failing registrar test**

Create `be/src/evm/evm-registrar.service.spec.ts`:
```typescript
import { EvmRegistrarService } from './evm-registrar.service';
import { merchantIdHex } from './payment-authorization';

const MERCHANT_UUID = '11111111-2222-3333-4444-555555555555';
const PAYOUT = '0x4444444444444444444444444444444444444444';

function makeChain(exists = false) {
  const wait = jest.fn().mockResolvedValue({ status: 1 });
  const registerMerchant = jest.fn().mockResolvedValue({ hash: '0xreg', wait });
  const setMerchantActive = jest.fn().mockResolvedValue({ hash: '0xact', wait });
  const setMerchantPayout = jest.fn().mockResolvedValue({ hash: '0xpay', wait });
  const merchants = jest.fn().mockResolvedValue(exists ? { payout: PAYOUT, active: true, exists: true } : { payout: '0x0000000000000000000000000000000000000000', active: false, exists: false });
  return { paymentsAsOwner: { registerMerchant, setMerchantActive, setMerchantPayout, merchants } } as any;
}

describe('EvmRegistrarService', () => {
  it('registers a new merchant (payout = the merchant EVM address) when it does not exist', async () => {
    const chain = makeChain(false);
    const svc = new EvmRegistrarService(chain);
    const hash = await svc.ensureRegisteredActive({ id: MERCHANT_UUID, payoutAddress: PAYOUT });
    expect(chain.paymentsAsOwner.registerMerchant).toHaveBeenCalledWith(merchantIdHex(MERCHANT_UUID), PAYOUT);
    expect(hash).toBe('0xreg');
  });

  it('reactivates an existing merchant instead of re-registering', async () => {
    const chain = makeChain(true);
    const svc = new EvmRegistrarService(chain);
    const hash = await svc.ensureRegisteredActive({ id: MERCHANT_UUID, payoutAddress: PAYOUT });
    expect(chain.paymentsAsOwner.registerMerchant).not.toHaveBeenCalled();
    expect(chain.paymentsAsOwner.setMerchantActive).toHaveBeenCalledWith(merchantIdHex(MERCHANT_UUID), true);
    expect(hash).toBe('0xact');
  });

  it('deactivate calls setMerchantActive(false)', async () => {
    const chain = makeChain(true);
    const svc = new EvmRegistrarService(chain);
    await svc.deactivate({ id: MERCHANT_UUID, payoutAddress: PAYOUT });
    expect(chain.paymentsAsOwner.setMerchantActive).toHaveBeenCalledWith(merchantIdHex(MERCHANT_UUID), false);
  });

  it('setPayout calls setMerchantPayout with the EVM address', async () => {
    const chain = makeChain(true);
    const svc = new EvmRegistrarService(chain);
    await svc.setPayout({ id: MERCHANT_UUID, payoutAddress: PAYOUT });
    expect(chain.paymentsAsOwner.setMerchantPayout).toHaveBeenCalledWith(merchantIdHex(MERCHANT_UUID), PAYOUT);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test evm-registrar`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `evm-registrar.service.ts`**

Create `be/src/evm/evm-registrar.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import type { NavyEvm } from './evm.module';
import { merchantIdHex } from './payment-authorization';

export interface RegistrarMerchant { id: string; payoutAddress: string }

/** Admin (owner) on-chain merchant registry ops. Payout is the merchant's EVM address (no ATA). */
@Injectable()
export class EvmRegistrarService {
  constructor(private readonly chain: NavyEvm) {}

  async ensureRegisteredActive(m: RegistrarMerchant): Promise<string> {
    const id = merchantIdHex(m.id);
    const existing = await this.chain.paymentsAsOwner.merchants(id);
    if (!existing?.exists) {
      const tx = await this.chain.paymentsAsOwner.registerMerchant(id, m.payoutAddress);
      await tx.wait();
      return tx.hash;
    }
    const tx = await this.chain.paymentsAsOwner.setMerchantActive(id, true);
    await tx.wait();
    return tx.hash;
  }

  async deactivate(m: RegistrarMerchant): Promise<string> {
    const tx = await this.chain.paymentsAsOwner.setMerchantActive(merchantIdHex(m.id), false);
    await tx.wait();
    return tx.hash;
  }

  async setPayout(m: RegistrarMerchant): Promise<string> {
    const tx = await this.chain.paymentsAsOwner.setMerchantPayout(merchantIdHex(m.id), m.payoutAddress);
    await tx.wait();
    return tx.hash;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test evm-registrar`
Expected: all 4 tests PASS.

- [ ] **Step 5: Rewire `admin-merchants.module.ts` + delete the Solana registrar**

In `be/src/admin-merchants/admin-merchants.module.ts`:
1. Remove `import { Keypair } from '@solana/web3.js';`, the `OnchainModule/NAVY_ONCHAIN/NavyOnchain` imports, the `RegistrarService` import, and the entire `parseRegistrar()` function.
2. Add `import { EvmModule, NAVY_EVM, type NavyEvm } from '../evm/evm.module';` and `import { EvmRegistrarService } from '../evm/evm-registrar.service';`.
3. Change `imports: [OnchainModule]` → `imports: [EvmModule]`.
4. Replace the `RegistrarService` provider block with:
```typescript
    {
      provide: EvmRegistrarService,
      inject: [NAVY_EVM],
      useFactory: (chain: NavyEvm) => new EvmRegistrarService(chain),
    },
```
5. In the `AdminMerchantsService` provider, change `inject: [PrismaService, RegistrarService, AuditService]` → `inject: [PrismaService, EvmRegistrarService, AuditService]` and the factory param type accordingly.
6. Check `be/src/admin-merchants/admin-merchants.service.ts`: it imports/types `RegistrarService`. Update its import to `EvmRegistrarService` from `../evm/evm-registrar.service` and rename the constructor param type. Its method calls (`ensureRegisteredActive`/`deactivate`/`setPayout`) are unchanged — the interface is identical.
Then delete the old files:
```bash
cd /home/khoa/Desktop/DATN/be && rm src/onchain/registrar.service.ts src/onchain/registrar.service.spec.ts
```

- [ ] **Step 6: Typecheck + run admin-merchants tests**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "admin-merchants|evm-registrar|registrar" || echo "registrar path type-clean"` then `pnpm test admin-merchants`
Expected: `registrar path type-clean`, and admin-merchants tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add be/src/evm/evm-registrar.service.ts be/src/evm/evm-registrar.service.spec.ts be/src/admin-merchants/admin-merchants.module.ts be/src/admin-merchants/admin-merchants.service.ts && git add -u be/src/onchain && git commit -m "feat(be): EVM merchant registrar (owner registers/toggles/repays on-chain)"
```

---

### Task 8: Delete Solana payments client + full build/test gate

**Files:**
- Delete: `be/src/onchain/payments-client.ts`, `be/src/onchain/payments-client.spec.ts`
- Modify: `be/src/payments/invoice-id.ts` (keep — chain-agnostic; verify no remaining Solana importers)

- [ ] **Step 1: Confirm nothing still imports the Solana payments-client**

Run: `cd /home/khoa/Desktop/DATN/be && grep -rn "payments-client\|merchantIdFromUuid\|buildPayInvoiceTx\|invoicePda\|merchantPda\|configPda" src | grep -v '\.spec\.' | grep -v onchain/payments-client`
Expected: NO matches (all consumers now use `merchantIdHex` from `../evm/payment-authorization`). If any match remains, update that importer to the EVM helper before deleting.

- [ ] **Step 2: Delete the Solana payments client**

Run: `cd /home/khoa/Desktop/DATN/be && rm src/onchain/payments-client.ts src/onchain/payments-client.spec.ts`
Expected: files removed. (`src/onchain/onchain.module.ts`, `navy_payments.json`, and `registrar`-free onchain dir remain for farming/health until Plan 3.)

- [ ] **Step 3: Full typecheck (the controller/route gate)**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: exits 0 (no type errors). Farming/wallet still compile against the untouched Solana `NAVY_ONCHAIN`.

- [ ] **Step 4: Full unit-test suite**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm test`
Expected: all suites PASS (the `bigint-buffer` native-binding console.warn from `@solana/spl-token` is harmless noise — ignore it). If a Solana-specific test elsewhere references the deleted `payments-client`, it will surface here; fix by pointing it at the EVM helper.

- [ ] **Step 5: Full nest build (runtime gate — confirms the ABI asset copies)**

Run: `cd /home/khoa/Desktop/DATN/be && pnpm build`
Expected: `nest build` succeeds and `dist/src/evm/navy-payments-abi.json` exists (`ls dist/src/evm/navy-payments-abi.json`).

- [ ] **Step 6: Commit**

```bash
cd /home/khoa/Desktop/DATN && git add -u be/src/onchain && git commit -m "chore(be): remove Solana payments-client (payments path fully on EVM)"
```

---

## Self-Review Notes

- **Spec coverage (§4, §5):** payment-authorization endpoint returns EIP-712 typed data + persists the digest nonce (Task 4/6); submit recovers the signer, asserts against the JWT payer, atomically consumes, relays `payInvoice`, pays gas (Task 4/6); settlement reconciles the `InvoicePaid` receipt log with the same atomic `markPaid` + HMAC webhook (Task 5); admin approval registers merchants on-chain via the owner wallet (Task 7); `NAVY_EVM` ethers provider + USDC EIP-712 domain (Task 3); config envs (Task 1).
- **Documented deviations from §5.1:** kept the `txSignature` column/webhook field (now holds the EVM tx hash) rather than renaming to `txHash`, to avoid breaking the merchant webhook contract; deferred all `*Lamports`/`pubkey`/farming schema changes to Plan 3. No Prisma migration in this plan (Order/Merchant columns are chain-agnostic).
- **Sequencing invariant:** the Solana `OnchainModule`/`NAVY_ONCHAIN`, `navy_payments.json`, and `@solana/*` deps stay so farming/wallet/health keep compiling; Plan 3 migrates them and removes the Solana deps + jest `moduleNameMapper` entries.
- **Type consistency:** `merchantIdHex`/`invoiceIdHexFromOrderId` return `0x`+32-hex `bytes16`; `invoiceKey` = `keccak256(concat(...))` matches the contract's `keccak256(abi.encodePacked(merchantId, invoiceId))`; `RelayerService.verifyAndSubmit` returns `{txHash,payer,err}` and the controller reads `txHash`; `ChainWatcherService.markPaid` takes `{payer,txHash,fee}`. `payInvoice` arg order (merchantId, invoiceId, amount, validAfter=0, validBefore, payer, v, r, s) matches the contract signature from Plan 1.
- **Runtime domain caveat:** the USDC EIP-712 domain `name`/`version` default to `USDC`/`2` (Circle Sepolia) and are env-overridable; a live signature round-trip (integration/e2e, or the merchant/web-wallet in Plan 4) must confirm it against the deployed USDC before relying on production signatures.
```
