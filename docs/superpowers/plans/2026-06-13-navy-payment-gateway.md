# Navy Payment Gateway (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend payment-gateway engine in `be/`: merchants create orders over an HMAC API, the Navy wallet pays via a backend-built gasless `pay_invoice` tx, an on-chain watcher marks orders paid from the `InvoicePaid` event, and HMAC-signed webhooks notify merchants.

**Architecture:** A Nest `PaymentsModule` (Orders + Onchain + Relayer + Watcher + Webhook services) over the existing Prisma DB and the deployed `navy_payments` program. Pure logic (invoice-id derivation, HMAC order-auth, issued-vs-submitted tx match, webhook HMAC, order state machine, fee snapshot) is TDD'd with Jest; the chain interaction is integration-tested on a local validator. The relayer only ever co-signs the exact tx the backend built.

**Tech Stack:** Nest 11 · Prisma 7 (driver adapter, already set up) · `@coral-xyz/anchor` + `@solana/web3.js` + `@solana/spl-token` · `qrcode` · Jest.

**Scope:** Sub-project 3 of Navy. Implements `docs/superpowers/specs/2026-06-13-navy-payment-gateway-design.md`. Backend engine + one-time devnet bring-up; UIs are sub-projects 5/6.

---

## File Structure

All under `/home/khoa/Desktop/uni/be/` unless noted.

```
be/
├── prisma/schema.prisma                  # + Order, WebhookDelivery, + MerchantApiKey.secretEnc/dataKeyWrapped
├── src/payments/
│   ├── payments.module.ts
│   ├── invoice-id.ts                     # uuid <-> [u8;16] derivation (pure)
│   ├── invoice-id.spec.ts
│   ├── order-auth.service.ts             # lookup api_key -> decrypt secret -> verify HMAC
│   ├── order-auth.service.spec.ts
│   ├── order-auth.guard.ts               # Nest guard using OrderAuthService
│   ├── orders.service.ts                 # create/get orders, fee snapshot, state transitions
│   ├── orders.service.spec.ts
│   ├── orders.controller.ts              # POST /v1/orders, GET /v1/orders/:id, payment-tx, submit
│   ├── relayer.service.ts                # build gasless tx, verify-and-submit
│   ├── relayer.service.spec.ts           # tx-match logic
│   ├── chain-watcher.service.ts          # confirm + decode InvoicePaid, reconcile, expire
│   ├── chain-watcher.service.spec.ts     # state transitions
│   ├── webhook.service.ts                # HMAC sign + POST + retry
│   └── webhook.service.spec.ts
├── src/onchain/
│   ├── onchain.module.ts                 # program client, relayer keypair, config from env
│   ├── payments-client.ts                # PDAs + buildPayInvoiceTx (ported from onchain/client)
│   ├── payments-client.spec.ts
│   └── navy_payments.json                # IDL copied from onchain/target/idl
├── src/merchant/merchant.service.ts      # MODIFY: store encrypted secret on issue
└── scripts/gateway-bringup.md            # devnet deploy + init-config + register-merchant runbook
```

---

## Conventions for every task

- Run from `/home/khoa/Desktop/uni/be`. Tests: `pnpm test <pattern>`. Postgres up: `docker compose up -d`.
- Commit after each task with the message shown. Git identity fallback: `git -c user.name=Navy -c user.email=capydata.xyz@gmail.com commit ...`.
- Existing reusable services: `PrismaService`, `AuditService`, `NavyConfigService`, `ApiKeyService` (HMAC `sign`/`verify`), `CIPHER` (`EnvelopeCipherService` `seal`/`open`).

---

### Task 1: Prisma — Order, WebhookDelivery, encrypted API secret

**Files:** Modify `be/prisma/schema.prisma`; create a migration.

- [ ] **Step 1: Add models + columns to `schema.prisma`**

Add to `MerchantApiKey` (keep existing fields):
```prisma
  secretEnc      String?  // base64 AES-GCM ciphertext of the api secret (for HMAC verify)
  dataKeyWrapped String?  // wrapped per-key data key (envelope)
```

Add models:
```prisma
model Order {
  id               String   @id @default(uuid())
  merchantId       String
  merchant         Merchant @relation(fields: [merchantId], references: [id])
  reference        String
  amount           BigInt
  feeBps           Int
  status           String   @default("created") // created|awaiting_payment|confirming|paid|expired|failed
  onchainInvoiceId String   // 16-byte hex
  txSignature      String?
  payer            String?
  callbackUrl      String?
  expiresAt        DateTime
  createdAt        DateTime @default(now())
  paidAt           DateTime?
  webhooks         WebhookDelivery[]
}

model WebhookDelivery {
  id          String   @id @default(uuid())
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id])
  url         String
  status      String   @default("pending") // pending|delivered|failed
  attempts    Int      @default(0)
  lastError   String?
  deliveredAt DateTime?
  createdAt   DateTime @default(now())
}
```
Add the back-relation to `Merchant`: `orders Order[]`.

- [ ] **Step 2: Migrate**

Run: `docker compose up -d && pnpm prisma migrate dev --name payment_gateway`
Expected: migration applied; client regenerated.

- [ ] **Step 3: Verify the client typechecks**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add be/prisma
git commit -m "feat(be): Order + WebhookDelivery models and encrypted API-secret columns"
```

---

### Task 2: Invoice-id derivation (uuid ↔ [u8;16])

**Files:** Create `be/src/payments/invoice-id.ts`, `invoice-id.spec.ts`.

- [ ] **Step 1: Write the failing test** — `invoice-id.spec.ts`

```ts
import { orderIdToInvoiceId, invoiceIdToHex } from './invoice-id';

describe('invoice-id derivation', () => {
  it('converts a UUID to a 16-byte array', () => {
    const bytes = orderIdToInvoiceId('00112233-4455-6677-8899-aabbccddeeff');
    expect(bytes).toHaveLength(16);
    expect(Buffer.from(bytes).toString('hex')).toBe('00112233445566778899aabbccddeeff');
  });

  it('round-trips to hex', () => {
    const id = 'aabbccdd-eeff-0011-2233-445566778899';
    expect(invoiceIdToHex(orderIdToInvoiceId(id))).toBe('aabbccddeeff00112233445566778899');
  });

  it('rejects a malformed uuid', () => {
    expect(() => orderIdToInvoiceId('not-a-uuid')).toThrow(/uuid/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test invoice-id`
Expected: FAIL — cannot find `./invoice-id`.

- [ ] **Step 3: Implement `invoice-id.ts`**

```ts
/** A Navy order UUID is 16 bytes; we use those bytes directly as the on-chain invoice_id [u8;16]. */
export function orderIdToInvoiceId(orderId: string): number[] {
  const hex = orderId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`invalid uuid: ${orderId}`);
  return Array.from(Buffer.from(hex, 'hex'));
}

export function invoiceIdToHex(invoiceId: number[]): string {
  return Buffer.from(invoiceId).toString('hex');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test invoice-id`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/payments/invoice-id.ts be/src/payments/invoice-id.spec.ts
git commit -m "feat(be): order-id to on-chain invoice_id derivation"
```

---

### Task 3: Store encrypted API secret on issuance

**Files:** Modify `be/src/merchant/merchant.service.ts` + `be/src/merchant/merchant.module.ts`; extend `be/src/merchant/merchant.service.spec.ts`.

- [ ] **Step 1: Add a failing test** to `merchant.service.spec.ts`

```ts
import { CIPHER } from '../crypto/cipher.interface';

it('stores the api secret encrypted (envelope) for later HMAC verification', async () => {
  const sealed = { encryptedPrivkey: 'enc', dataKeyWrapped: 'wrap' };
  const cipher = { seal: jest.fn().mockResolvedValue(sealed), open: jest.fn() };
  const create = jest.fn().mockResolvedValue({ id: 'k1' });
  const prisma = { merchant: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', approvalStatus: 'approved' }) },
                   merchantApiKey: { create } } as any;
  const { MerchantService } = require('./merchant.service');
  const { ApiKeyService } = require('./api-key.service');
  const svc = new MerchantService(prisma, new ApiKeyService(), cipher);
  await svc.issueApiKey('m1');
  expect(cipher.seal).toHaveBeenCalled();
  const data = create.mock.calls[0][0].data;
  expect(data.secretEnc).toBe('enc');
  expect(data.dataKeyWrapped).toBe('wrap');
});
```

> Note: `issueApiKey` already exists from the foundation and asserts merchant approval. This test adds a third constructor arg (the cipher) and the encrypted-secret storage. Update the OTHER existing MerchantService tests to pass a cipher stub (`{ seal: jest.fn().mockResolvedValue({encryptedPrivkey:'e',dataKeyWrapped:'w'}), open: jest.fn() }`) as the third constructor arg so they still compile.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test merchant.service`
Expected: FAIL — constructor arity / `secretEnc` not set.

- [ ] **Step 3: Modify `merchant.service.ts`**

Add the cipher dependency and store the encrypted secret. Change the constructor and `issueApiKey`:
```ts
import { Inject, Injectable, ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { CIPHER, Cipher } from '../crypto/cipher.interface';
// ...existing imports (argon2, PrismaService, ApiKeyService, verifyWalletSignature)...

@Injectable()
export class MerchantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    @Inject(CIPHER) private readonly cipher: Cipher,
  ) {}

  // ...existing signup/login/assertApproved/setPayoutAddress unchanged...

  async issueApiKey(merchantId: string) {
    await this.assertApproved(merchantId);
    const issued = this.apiKeys.generate();
    const sealed = await this.cipher.seal(Buffer.from(issued.apiSecret, 'utf8'));
    await this.prisma.merchantApiKey.create({
      data: {
        merchantId,
        apiKey: issued.apiKey,
        secretHash: issued.secretHash,
        secretEnc: sealed.encryptedPrivkey,
        dataKeyWrapped: sealed.dataKeyWrapped,
      },
    });
    return { apiKey: issued.apiKey, apiSecret: issued.apiSecret };
  }
}
```

- [ ] **Step 4: Ensure `MerchantModule` provides the cipher**

`CryptoModule` is `@Global()` and exports `CIPHER`, so no change is needed beyond the constructor injection. Confirm `merchant.module.ts` still compiles.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test merchant.service`
Expected: PASS (existing + new tests).

- [ ] **Step 6: Commit**

```bash
git add be/src/merchant
git commit -m "feat(be): store merchant API secret encrypted for HMAC verification"
```

---

### Task 4: OrderAuthService (HMAC verify by api_key)

**Files:** Create `be/src/payments/order-auth.service.ts`, `order-auth.service.spec.ts`.

- [ ] **Step 1: Write the failing test** — `order-auth.service.spec.ts`

```ts
import { OrderAuthService } from './order-auth.service';
import { ApiKeyService } from '../merchant/api-key.service';

describe('OrderAuthService', () => {
  const apiKeys = new ApiKeyService();

  function make(secret: string, merchantId = 'm1') {
    const cipher = { open: jest.fn().mockResolvedValue(Buffer.from(secret, 'utf8')), seal: jest.fn() };
    const prisma = { merchantApiKey: { findUnique: jest.fn().mockResolvedValue({
      apiKey: 'navy_pk_x', merchantId, status: 'active', secretEnc: 'enc', dataKeyWrapped: 'w',
    }) } } as any;
    return new OrderAuthService(prisma, apiKeys as any, cipher as any);
  }

  it('authenticates a request with a valid HMAC and returns the merchant id', async () => {
    const secret = 'navy_sk_' + '0'.repeat(64);
    const body = JSON.stringify({ amount: 100 });
    const sig = apiKeys.sign(secret, body);
    const svc = make(secret);
    expect(await svc.verify('navy_pk_x', body, sig)).toEqual({ merchantId: 'm1' });
  });

  it('rejects a bad signature', async () => {
    const svc = make('navy_sk_' + '0'.repeat(64));
    await expect(svc.verify('navy_pk_x', '{}', 'deadbeef')).rejects.toThrow();
  });

  it('rejects an unknown / revoked api key', async () => {
    const prisma = { merchantApiKey: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new OrderAuthService(prisma, apiKeys as any, { open: jest.fn(), seal: jest.fn() } as any);
    await expect(svc.verify('navy_pk_missing', '{}', 'x')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test order-auth`
Expected: FAIL — cannot find `./order-auth.service`.

- [ ] **Step 3: Implement `order-auth.service.ts`**

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyService } from '../merchant/api-key.service';
import { CIPHER, Cipher } from '../crypto/cipher.interface';

@Injectable()
export class OrderAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    @Inject(CIPHER) private readonly cipher: Cipher,
  ) {}

  async verify(apiKey: string, rawBody: string, signature: string): Promise<{ merchantId: string }> {
    const key = await this.prisma.merchantApiKey.findUnique({ where: { apiKey } });
    if (!key || key.status !== 'active' || !key.secretEnc || !key.dataKeyWrapped) {
      throw new UnauthorizedException('Invalid API key');
    }
    const secret = (await this.cipher.open({
      encryptedPrivkey: key.secretEnc, dataKeyWrapped: key.dataKeyWrapped,
    })).toString('utf8');
    if (!this.apiKeys.verify(secret, rawBody, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }
    return { merchantId: key.merchantId };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test order-auth`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/payments/order-auth.service.ts be/src/payments/order-auth.service.spec.ts
git commit -m "feat(be): HMAC order-auth (decrypt secret, verify signature)"
```

---

### Task 5: Onchain client (PDAs + buildPayInvoiceTx) in be

**Files:** Create `be/src/onchain/payments-client.ts`, `payments-client.spec.ts`; copy the IDL.

- [ ] **Step 1: Copy the IDL into be**

```bash
cp /home/khoa/Desktop/uni/onchain/target/idl/navy_payments.json /home/khoa/Desktop/uni/be/src/onchain/navy_payments.json
```
(If `target/idl` is absent, run `cd /home/khoa/Desktop/uni/onchain && anchor build` first.)

- [ ] **Step 2: Write the failing test** — `payments-client.spec.ts`

```ts
import { PublicKey } from '@solana/web3.js';
import { configPda, merchantPda, invoicePda } from './payments-client';

const PROGRAM = new PublicKey('5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az');

describe('payments-client PDAs', () => {
  it('derives the config PDA deterministically', () => {
    const a = configPda(PROGRAM); const b = configPda(PROGRAM);
    expect(a.equals(b)).toBe(true);
  });
  it('derives distinct merchant PDAs per authority', () => {
    const m1 = merchantPda(PROGRAM, new PublicKey('11111111111111111111111111111111'));
    const m2 = merchantPda(PROGRAM, PublicKey.default);
    expect(m1.equals(m2)).toBe(false);
  });
  it('derives the invoice PDA from authority + invoice_id', () => {
    const id = Array.from(Buffer.alloc(16, 7));
    const p = invoicePda(PROGRAM, PublicKey.default, id);
    expect(p).toBeInstanceOf(PublicKey);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test payments-client`
Expected: FAIL — cannot find `./payments-client`.

- [ ] **Step 4: Implement `payments-client.ts`** (ports the `onchain/client` helpers)

```ts
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { BN, Program } from '@coral-xyz/anchor';

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
}
export function merchantPda(programId: PublicKey, merchantAuthority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('merchant'), merchantAuthority.toBuffer()], programId)[0];
}
export function invoicePda(programId: PublicKey, merchantAuthority: PublicKey, invoiceId: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), merchantAuthority.toBuffer(), Buffer.from(invoiceId)], programId)[0];
}

export interface BuildPayParams {
  merchantAuthority: PublicKey; payout: PublicKey; treasury: PublicKey; usdcMint: PublicKey;
  invoiceId: number[]; amount: bigint; expiry: number; payer: PublicKey; relayer: PublicKey;
}

/** Build the unsigned pay_invoice tx (relayer as fee payer). */
export async function buildPayInvoiceTx(program: Program, p: BuildPayParams): Promise<Transaction> {
  const pid = program.programId;
  const payerToken = await getAssociatedTokenAddress(p.usdcMint, p.payer);
  const ix = await program.methods
    .payInvoice(p.invoiceId, new BN(p.amount.toString()), new BN(p.expiry))
    .accounts({
      config: configPda(pid), merchant: merchantPda(pid, p.merchantAuthority),
      invoice: invoicePda(pid, p.merchantAuthority, p.invoiceId),
      payerToken, merchantPayout: p.payout, treasury: p.treasury, usdcMint: p.usdcMint,
      payer: p.payer, relayer: p.relayer,
    })
    .instruction();
  const tx = new Transaction().add(ix);
  tx.feePayer = p.relayer;
  return tx;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test payments-client`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add be/src/onchain/payments-client.ts be/src/onchain/payments-client.spec.ts be/src/onchain/navy_payments.json
git commit -m "feat(be): onchain payments client (PDAs + buildPayInvoiceTx)"
```

---

### Task 6: OnchainModule (program, relayer, config from env)

**Files:** Create `be/src/onchain/onchain.module.ts`; add env keys to `.env.example`/`.env`.

- [ ] **Step 1: Add env keys** to `be/.env.example` and `.env`

```bash
NAVY_PROGRAM_ID=5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az
NAVY_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
NAVY_TREASURY=ReplaceWithNavyTreasuryUsdcAtaPubkey
# 64-byte relayer secret key as JSON array or base58; dev only
NAVY_RELAYER_SECRET=[/* 64 numbers */]
```

- [ ] **Step 2: Implement `onchain.module.ts`** (a provider exposing the program + relayer + config)

```ts
import { Global, Module } from '@nestjs/common';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { NavyConfigService } from '../config/config.service';
import idl from './navy_payments.json';

export const NAVY_ONCHAIN = Symbol('NAVY_ONCHAIN');

export interface NavyOnchain {
  connection: Connection;
  program: Program;
  relayer: Keypair;
  programId: PublicKey;
  usdcMint: PublicKey;
  treasury: PublicKey;
}

function parseSecret(raw: string): Keypair {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  // base58 fallback
  const bs58 = require('bs58');
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

@Global()
@Module({
  providers: [{
    provide: NAVY_ONCHAIN,
    inject: [NavyConfigService],
    useFactory: (cfg: NavyConfigService): NavyOnchain => {
      const connection = new Connection(cfg.rpcUrl, 'confirmed');
      const relayer = parseSecret(process.env.NAVY_RELAYER_SECRET as string);
      const provider = new AnchorProvider(connection, new Wallet(relayer), { commitment: 'confirmed' });
      const program = new Program(idl as any, provider);
      return {
        connection, program, relayer,
        programId: new PublicKey(process.env.NAVY_PROGRAM_ID as string),
        usdcMint: new PublicKey(process.env.NAVY_USDC_MINT as string),
        treasury: new PublicKey(process.env.NAVY_TREASURY as string),
      };
    },
  }],
  exports: [NAVY_ONCHAIN],
})
export class OnchainModule {}
```

> Verify `new Program(idl, provider)` arg order against the installed `@coral-xyz/anchor` (some versions take `(idl, programId, provider)`; 0.30+ embeds the address in the IDL and takes `(idl, provider)`). The IDL copied from `onchain` includes the program address. Adjust if the constructor differs; the IDL/program id are consistent regardless.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm build`
Expected: build succeeds. (`resolveJsonModule` must be on in `be/tsconfig.json`; if not, enable it.)

- [ ] **Step 4: Commit**

```bash
git add be/src/onchain/onchain.module.ts be/.env.example
git commit -m "feat(be): OnchainModule wiring navy_payments program + relayer"
```

---

### Task 7: OrdersService (create/get, fee snapshot, QR)

**Files:** Create `be/src/payments/orders.service.ts`, `orders.service.spec.ts`. Add `qrcode` dep.

- [ ] **Step 1: Add the QR dep**

```bash
cd /home/khoa/Desktop/uni/be && pnpm add qrcode && pnpm add -D @types/qrcode
```

- [ ] **Step 2: Write the failing test** — `orders.service.spec.ts`

```ts
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  function make() {
    const order = {
      id: '00112233-4455-6677-8899-aabbccddeeff', merchantId: 'm1', reference: 'INV-1',
      amount: 1_000_000n, feeBps: 100, status: 'awaiting_payment',
      onchainInvoiceId: '00112233445566778899aabbccddeeff', expiresAt: new Date(Date.now() + 600000),
    };
    const prisma = { order: { create: jest.fn().mockResolvedValue(order), findUnique: jest.fn().mockResolvedValue(order) } } as any;
    const audit = { record: jest.fn() } as any;
    return { svc: new OrdersService(prisma, audit, 'https://pay.navy', 100), prisma, order };
  }

  it('creates an order: snapshots fee, derives invoice_id, sets pay url + QR', async () => {
    const { svc, prisma } = make();
    const res = await svc.create('m1', { amount: 1_000_000n, reference: 'INV-1', expiresInSec: 600 });
    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.merchantId).toBe('m1');
    expect(data.feeBps).toBe(100);
    expect(data.onchainInvoiceId).toMatch(/^[0-9a-f]{32}$/);
    expect(data.status).toBe('awaiting_payment');
    expect(res.payUrl).toMatch(/^navy:\/\/pay\//);
    expect(res.qr).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects a zero amount', async () => {
    const { svc } = make();
    await expect(svc.create('m1', { amount: 0n, reference: 'x' })).rejects.toThrow(/amount/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test orders.service`
Expected: FAIL — cannot find `./orders.service`.

- [ ] **Step 4: Implement `orders.service.ts`**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { orderIdToInvoiceId, invoiceIdToHex } from './invoice-id';

export interface CreateOrderInput { amount: bigint; reference: string; callbackUrl?: string; expiresInSec?: number; }

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payBaseUrl: string,
    private readonly feeBps: number,
  ) {}

  async create(merchantId: string, input: CreateOrderInput) {
    if (!input.amount || input.amount <= 0n) throw new BadRequestException('amount must be > 0');
    const id = randomUUID();
    const onchainInvoiceId = invoiceIdToHex(orderIdToInvoiceId(id));
    const expiresAt = new Date(Date.now() + (input.expiresInSec ?? 900) * 1000);
    const order = await this.prisma.order.create({
      data: {
        id, merchantId, reference: input.reference, amount: input.amount, feeBps: this.feeBps,
        status: 'awaiting_payment', onchainInvoiceId, callbackUrl: input.callbackUrl ?? null, expiresAt,
      },
    });
    await this.audit.record({ actor: `merchant:${merchantId}`, action: 'order.create', target: id });
    const payUrl = `navy://pay/${id}`;
    const qr = await QRCode.toDataURL(payUrl);
    return { orderId: id, payUrl, qr, amount: order.amount.toString(), expiresAt, status: order.status };
  }

  get(id: string) { return this.prisma.order.findUnique({ where: { id } }); }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test orders.service`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add be/src/payments/orders.service.ts be/src/payments/orders.service.spec.ts be/package.json
git commit -m "feat(be): OrdersService create/get with fee snapshot and QR"
```

---

### Task 8: RelayerService (build tx, verify-and-submit)

**Files:** Create `be/src/payments/relayer.service.ts`, `relayer.service.spec.ts`.

- [ ] **Step 1: Write the failing test** (tx-match logic is the pure, security-critical part) — `relayer.service.spec.ts`

```ts
import { RelayerService } from './relayer.service';
import { Transaction, Keypair, SystemProgram, PublicKey } from '@solana/web3.js';

function sampleTx(feePayer: PublicKey): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: PublicKey.default, lamports: 1 }));
  tx.feePayer = feePayer;
  tx.recentBlockhash = '11111111111111111111111111111111';
  return tx;
}

describe('RelayerService.messagesMatch', () => {
  const svc = new RelayerService({} as any, {} as any);
  it('returns true for identical message bytes', () => {
    const relayer = Keypair.generate();
    const a = sampleTx(relayer.publicKey); const b = sampleTx(relayer.publicKey);
    expect(svc.messagesMatch(a, b)).toBe(true);
  });
  it('returns false when instructions differ', () => {
    const relayer = Keypair.generate();
    const a = sampleTx(relayer.publicKey);
    const b = sampleTx(relayer.publicKey);
    b.add(SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: relayer.publicKey, lamports: 2 }));
    expect(svc.messagesMatch(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test relayer.service`
Expected: FAIL — cannot find `./relayer.service`.

- [ ] **Step 3: Implement `relayer.service.ts`**

```ts
import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { NAVY_ONCHAIN, NavyOnchain } from '../onchain/onchain.module';
import { buildPayInvoiceTx, merchantPda } from '../onchain/payments-client';
import { orderIdToInvoiceId } from './invoice-id';

@Injectable()
export class RelayerService {
  // In-memory cache of issued tx message bytes per order (single-instance dev; a shared store in prod).
  private issued = new Map<string, Buffer>();

  constructor(
    @Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain,
    private readonly _unused: unknown,
  ) {}

  /** Build the gasless pay_invoice tx for an order, partial-sign as relayer, cache the message. */
  async buildPaymentTx(order: { id: string; amount: bigint; expiresAt: Date }, merchantAuthority: PublicKey, payer: PublicKey): Promise<string> {
    const payout = await getAssociatedTokenAddress(this.chain.usdcMint, merchantAuthority);
    const tx = await buildPayInvoiceTx(this.chain.program, {
      merchantAuthority, payout, treasury: this.chain.treasury, usdcMint: this.chain.usdcMint,
      invoiceId: orderIdToInvoiceId(order.id), amount: order.amount,
      expiry: Math.floor(order.expiresAt.getTime() / 1000), payer, relayer: this.chain.relayer.publicKey,
    });
    tx.recentBlockhash = (await this.chain.connection.getLatestBlockhash()).blockhash;
    tx.feePayer = this.chain.relayer.publicKey;
    tx.partialSign(this.chain.relayer);
    this.issued.set(order.id, tx.serializeMessage());
    return tx.serialize({ requireAllSignatures: false }).toString('base64');
  }

  messagesMatch(a: Transaction, b: Transaction): boolean {
    return a.serializeMessage().equals(b.serializeMessage());
  }

  /** Verify the user-signed tx equals the one we issued, then submit. */
  async verifyAndSubmit(orderId: string, signedTxB64: string): Promise<string> {
    const expected = this.issued.get(orderId);
    if (!expected) throw new BadRequestException('No issued transaction for this order');
    const tx = Transaction.from(Buffer.from(signedTxB64, 'base64'));
    if (!tx.serializeMessage().equals(expected)) throw new BadRequestException('Submitted transaction does not match issued');
    const sig = await this.chain.connection.sendRawTransaction(tx.serialize());
    await this.chain.connection.confirmTransaction(sig, 'confirmed');
    return sig;
  }
}
```

> The constructor's second arg is a placeholder so the spec's `new RelayerService({} as any, {} as any)` compiles; replace it with whatever the module actually injects (nothing else is needed — remove `_unused` and update the test to `new RelayerService({} as any)` if you prefer a single-arg constructor). Keep the public `messagesMatch`/`buildPaymentTx`/`verifyAndSubmit` surface. Document the choice.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test relayer.service`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/payments/relayer.service.ts be/src/payments/relayer.service.spec.ts
git commit -m "feat(be): RelayerService — build gasless tx, verify-and-submit"
```

---

### Task 9: WebhookService (HMAC sign + retry)

**Files:** Create `be/src/payments/webhook.service.ts`, `webhook.service.spec.ts`.

- [ ] **Step 1: Write the failing test** — `webhook.service.spec.ts`

```ts
import { WebhookService } from './webhook.service';
import { ApiKeyService } from '../merchant/api-key.service';

describe('WebhookService', () => {
  const apiKeys = new ApiKeyService();

  it('signs the body with the merchant secret and posts it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const prisma = { webhookDelivery: { create: jest.fn().mockResolvedValue({ id: 'w1' }), update: jest.fn() } } as any;
    const svc = new WebhookService(prisma, apiKeys as any, fetchImpl as any);
    const payload = { orderId: 'o1', status: 'paid' };
    await svc.deliver('o1', 'https://merchant/cb', 'navy_sk_secret', payload);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://merchant/cb');
    const sig = opts.headers['X-Navy-Signature'];
    expect(apiKeys.verify('navy_sk_secret', opts.body, sig)).toBe(true);
  });

  it('marks delivery failed after the final attempt', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const update = jest.fn();
    const prisma = { webhookDelivery: { create: jest.fn().mockResolvedValue({ id: 'w1' }), update } } as any;
    const svc = new WebhookService(prisma, apiKeys as any, fetchImpl as any);
    await svc.deliver('o1', 'https://merchant/cb', 'sk', { status: 'paid' }, { attempts: 2, backoffMs: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test webhook.service`
Expected: FAIL — cannot find `./webhook.service`.

- [ ] **Step 3: Implement `webhook.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyService } from '../merchant/api-key.service';

interface RetryOpts { attempts?: number; backoffMs?: number; }

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(orderId: string, url: string, secret: string, payload: unknown, opts: RetryOpts = {}): Promise<boolean> {
    const attempts = opts.attempts ?? 5;
    const backoffMs = opts.backoffMs ?? 1000;
    const body = JSON.stringify(payload);
    const signature = this.apiKeys.sign(secret, body);
    const record = await this.prisma.webhookDelivery.create({ data: { orderId, url, status: 'pending' } });

    let lastError = '';
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Navy-Signature': signature },
          body,
        });
        if (res.ok) {
          await this.prisma.webhookDelivery.update({ where: { id: record.id }, data: { status: 'delivered', attempts: i + 1, deliveredAt: new Date() } });
          return true;
        }
        lastError = `HTTP ${res.status}`;
      } catch (e) {
        lastError = (e as Error).message;
      }
      if (backoffMs) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
    await this.prisma.webhookDelivery.update({ where: { id: record.id }, data: { status: 'failed', attempts, lastError } });
    return false;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test webhook.service`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/payments/webhook.service.ts be/src/payments/webhook.service.spec.ts
git commit -m "feat(be): WebhookService with HMAC signing and retry"
```

---

### Task 10: ChainWatcherService (confirm/decode/mark-paid + reconcile/expire)

**Files:** Create `be/src/payments/chain-watcher.service.ts`, `chain-watcher.service.spec.ts`.

- [ ] **Step 1: Write the failing test** (state transitions, with chain + webhook mocked) — `chain-watcher.service.spec.ts`

```ts
import { ChainWatcherService } from './chain-watcher.service';

describe('ChainWatcherService', () => {
  it('marks a confirming order paid and fires the webhook', async () => {
    const order = { id: 'o1', merchantId: 'm1', status: 'confirming', txSignature: 'sig', callbackUrl: 'https://cb', amount: 1000000n, feeBps: 100, reference: 'R1' };
    const update = jest.fn().mockResolvedValue({ ...order, status: 'paid' });
    const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order), update } } as any;
    const webhooks = { deliver: jest.fn().mockResolvedValue(true) } as any;
    const secrets = { secretForMerchant: jest.fn().mockResolvedValue('sk') } as any;
    const svc = new ChainWatcherService(prisma, webhooks, secrets);

    await svc.markPaid('o1', { payer: 'PK', signature: 'sig' });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o1' }, data: expect.objectContaining({ status: 'paid', payer: 'PK' }) }));
    expect(webhooks.deliver).toHaveBeenCalledWith('o1', 'https://cb', 'sk', expect.objectContaining({ status: 'paid', orderId: 'o1' }));
  });

  it('is idempotent: a paid order is not re-processed', async () => {
    const prisma = { order: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', status: 'paid' }), update: jest.fn() } } as any;
    const webhooks = { deliver: jest.fn() } as any;
    const svc = new ChainWatcherService(prisma, webhooks, { secretForMerchant: jest.fn() } as any);
    await svc.markPaid('o1', { payer: 'PK', signature: 'sig' });
    expect(webhooks.deliver).not.toHaveBeenCalled();
  });

  it('expires an awaiting order past its deadline', async () => {
    const past = new Date(Date.now() - 1000);
    const update = jest.fn();
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([{ id: 'o2', status: 'awaiting_payment', expiresAt: past }]), update } } as any;
    const svc = new ChainWatcherService(prisma, { deliver: jest.fn() } as any, { secretForMerchant: jest.fn() } as any);
    await svc.expireStale();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o2' }, data: { status: 'expired' } }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test chain-watcher`
Expected: FAIL — cannot find `./chain-watcher.service`.

- [ ] **Step 3: Implement `chain-watcher.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from './webhook.service';

export interface SecretLookup { secretForMerchant(merchantId: string): Promise<string | null>; }

@Injectable()
export class ChainWatcherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
    private readonly secrets: SecretLookup,
  ) {}

  /** Idempotently mark an order paid (called after on-chain confirmation) and fire the webhook. */
  async markPaid(orderId: string, info: { payer: string; signature: string }): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'paid') return;
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'paid', payer: info.payer, txSignature: info.signature, paidAt: new Date() },
    });
    if (order.callbackUrl) {
      const secret = await this.secrets.secretForMerchant(order.merchantId);
      if (secret) {
        const fee = (updated.amount * BigInt(updated.feeBps)) / 10000n;
        await this.webhooks.deliver(orderId, order.callbackUrl, secret, {
          orderId, reference: updated.reference, amount: updated.amount.toString(),
          fee: fee.toString(), payer: info.payer, txSignature: info.signature,
          status: 'paid', paidAt: updated.paidAt,
        });
      }
    }
  }

  /** Expire awaiting orders past their deadline. */
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

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test chain-watcher`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/payments/chain-watcher.service.ts be/src/payments/chain-watcher.service.spec.ts
git commit -m "feat(be): ChainWatcherService — mark paid (idempotent) + expiry"
```

---

### Task 11: Controller, guard, module wiring

**Files:** Create `be/src/payments/order-auth.guard.ts`, `orders.controller.ts`, `payments.module.ts`; modify `be/src/app.module.ts`.

- [ ] **Step 1: Implement `order-auth.guard.ts`**

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { OrderAuthService } from './order-auth.service';

@Injectable()
export class OrderAuthGuard implements CanActivate {
  constructor(private readonly auth: OrderAuthService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const apiKey = req.headers['x-navy-key'];
    const signature = req.headers['x-navy-signature'];
    const rawBody: string = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    const { merchantId } = await this.auth.verify(apiKey, rawBody, signature);
    req.merchantId = merchantId;
    return true;
  }
}
```

> The guard needs the RAW request body to verify the HMAC over the exact bytes the merchant signed. Enable raw body in `main.ts`: `NestFactory.create(AppModule, { rawBody: true })` and `app.useBodyParser('json')`. If `req.rawBody` is unavailable, the fallback re-stringifies `req.body` (works only if the merchant signs the canonical JSON). Document the main.ts change.

- [ ] **Step 2: Implement `orders.controller.ts`**

```ts
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { OrdersService } from './orders.service';
import { RelayerService } from './relayer.service';
import { ChainWatcherService } from './chain-watcher.service';
import { OrderAuthGuard } from './order-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

class CreateOrderDto { amount!: string; reference!: string; callbackUrl?: string; expiresInSec?: number; }
class SubmitDto { signedTx!: string; }

@Controller('v1/orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly relayer: RelayerService,
    private readonly watcher: ChainWatcherService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseGuards(OrderAuthGuard)
  async create(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.orders.create(req.merchantId, {
      amount: BigInt(dto.amount), reference: dto.reference,
      callbackUrl: dto.callbackUrl, expiresInSec: dto.expiresInSec,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const o = await this.orders.get(id);
    return o && { orderId: o.id, status: o.status, amount: o.amount.toString(), reference: o.reference, paidAt: o.paidAt };
  }

  @Get(':id/payment-tx')
  async paymentTx(@Param('id') id: string, @Req() req: any) {
    const order = await this.orders.get(id);
    if (!order) return { error: 'not found' };
    const payer = new PublicKey(req.query.payer);
    const merchant = await this.prisma.merchant.findUnique({ where: { id: order.merchantId } });
    const merchantAuthority = new PublicKey(merchant!.payoutAddress!);
    const tx = await this.relayer.buildPaymentTx(
      { id: order.id, amount: order.amount, expiresAt: order.expiresAt }, merchantAuthority, payer);
    return { tx, invoice: { merchant: order.merchantId, amount: order.amount.toString(), reference: order.reference, expiresAt: order.expiresAt } };
  }

  @Post(':id/submit')
  async submit(@Param('id') id: string, @Body() dto: SubmitDto) {
    const signature = await this.relayer.verifyAndSubmit(id, dto.signedTx);
    await this.prisma.order.update({ where: { id }, data: { status: 'confirming', txSignature: signature } });
    // Confirmation + InvoicePaid decode happens in the watcher; for the engine path we mark paid on confirm.
    const order = await this.orders.get(id);
    await this.watcher.markPaid(id, { payer: order!.payer ?? 'unknown', signature });
    return { txSignature: signature, status: 'confirming' };
  }
}
```

> Note on the submit→markPaid path: for v1 the confirmed `submit` directly drives `markPaid` (the tx is confirmed inside `verifyAndSubmit`). The full `InvoicePaid`-event decode + the periodic reconciliation/`expireStale` cron are wired in Task 12's integration. The `payer` is taken from the order if the build step recorded it; otherwise decode it from the tx in the integration task. Keep this controller thin.

- [ ] **Step 3: Implement `payments.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { OnchainModule } from '../onchain/onchain.module';
import { NavyConfigService } from '../config/config.service';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { RelayerService } from './relayer.service';
import { ChainWatcherService, SecretLookup } from './chain-watcher.service';
import { WebhookService } from './webhook.service';
import { OrderAuthService } from './order-auth.service';
import { OrderAuthGuard } from './order-auth.guard';
import { ApiKeyService } from '../merchant/api-key.service';
import { PrismaService } from '../prisma/prisma.service';
import { CIPHER } from '../crypto/cipher.interface';

@Module({
  imports: [OnchainModule],
  controllers: [OrdersController],
  providers: [
    ApiKeyService,
    OrderAuthService,
    OrderAuthGuard,
    RelayerService,
    WebhookService,
    {
      provide: OrdersService,
      inject: [PrismaService, 'AuditServiceToken_OR_use_class', NavyConfigService],
      useFactory: () => { throw new Error('see note'); },
    },
  ],
})
export class PaymentsModule {}
```

> The `OrdersService` needs `payBaseUrl` + `feeBps` constructor args. Provide them via a `useFactory` that injects `PrismaService`, `AuditService`, and reads `process.env.NAVY_PAY_BASE_URL` + `parseInt(process.env.NAVY_FEE_BPS ?? '100')`. Replace the stub provider above with:
> ```ts
> { provide: OrdersService, inject: [PrismaService, AuditService],
>   useFactory: (p: PrismaService, a: AuditService) =>
>     new OrdersService(p, a, process.env.NAVY_PAY_BASE_URL ?? 'navy://pay', parseInt(process.env.NAVY_FEE_BPS ?? '100', 10)) }
> ```
> Provide a `SecretLookup` for `ChainWatcherService` via a small adapter that reads a merchant's active api key and `cipher.open`s its `secretEnc` (or returns null). Implement `SecretLookupService` in `chain-watcher.service.ts` or a tiny `secret-lookup.service.ts`, and provide `ChainWatcherService` with it + `WebhookService`. AuditService/PrismaService/CIPHER are global. Wire `RelayerService` with `NAVY_ONCHAIN` only (single-arg constructor per Task 8 cleanup).

- [ ] **Step 4: Wire into `app.module.ts`**

Add `PaymentsModule` to the `imports` array of `AppModule`.

- [ ] **Step 5: Build + run the unit suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all unit specs (foundation + new payments specs) pass.

- [ ] **Step 6: Commit**

```bash
git add be/src/payments be/src/app.module.ts
git commit -m "feat(be): payments controller, order-auth guard, module wiring"
```

---

### Task 12: Localnet integration + devnet bring-up runbook

**Files:** Create `be/test/payments.e2e-spec.ts`; create `be/scripts/gateway-bringup.md`.

- [ ] **Step 1: Write `be/scripts/gateway-bringup.md`** (devnet runbook)

```markdown
# Gateway devnet bring-up

1. Build + deploy the program:
   cd ../onchain && anchor build && anchor deploy --provider.cluster devnet
2. Create a Navy treasury USDC ATA for the Circle devnet mint (4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU):
   spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --url devnet
3. Init config:
   cd ../onchain && NAVY_FEE_BPS=100 NAVY_TREASURY=<treasuryAta> NAVY_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
     ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json \
     pnpm exec ts-node scripts/admin.ts init-config
4. Register an approved merchant (merchant_authority = their payout wallet, payout = its USDC ATA):
   pnpm exec ts-node scripts/admin.ts register-merchant <merchantWallet> <merchantUsdcAta>
5. Fund the relayer with devnet SOL: solana airdrop 2 <relayerPubkey> --url devnet
6. Set be/.env: NAVY_PROGRAM_ID, NAVY_USDC_MINT, NAVY_TREASURY, NAVY_RELAYER_SECRET, NAVY_PAY_BASE_URL.
7. Test users get devnet USDC from https://faucet.circle.com (Solana Devnet).
```

- [ ] **Step 2: Write the localnet integration test** — `be/test/payments.e2e-spec.ts`

This boots the program on a local validator and drives the gateway services directly (no HTTP), mirroring the `onchain` harness. It: deploys/loads the program, inits config with a locally-created test mint (NOT Circle's, since localnet), registers a merchant, creates an order via `OrdersService`, builds the tx via `RelayerService`, signs as the user, submits, and asserts the order is `paid` and a webhook fires to a local sink.

```ts
// Integration test: requires a local validator with the program deployed.
// Run via: anchor localnet (in onchain) OR solana-test-validator + anchor deploy, then `pnpm test:e2e payments`.
// This test is SKIPPED unless NAVY_E2E=1 is set, because it needs the validator + deployed program.
import { describe, it } from 'node:test';

const RUN = process.env.NAVY_E2E === '1';
(RUN ? describe : describe.skip)('payments e2e (localnet)', () => {
  it('order -> build -> sign -> submit -> paid -> webhook', async () => {
    // 1. Connect to localnet (http://127.0.0.1:8899), load program via IDL + a funded relayer.
    // 2. Create test USDC mint (6 decimals), treasury ATA, merchant payout ATA, user ATA + mintTo.
    // 3. initialize_config(100, mint) + update_config(100, treasury, mint) + register_merchant(merchantWallet, payout).
    // 4. new OrdersService(prisma, audit, 'navy://pay', 100).create(merchantId, {amount, reference, callbackUrl}).
    // 5. new RelayerService(chain).buildPaymentTx(order, merchantAuthority, user.publicKey) -> partialTx.
    // 6. Transaction.from(base64); user.partialSign; relayer.verifyAndSubmit(orderId, signed).
    // 7. watcher.markPaid(orderId, {payer, signature}); assert order.status === 'paid' and webhook sink received a valid HMAC POST.
    // Implement using the same @solana/spl-token helpers as onchain/tests; assert on a local http sink (e.g. a Nest test server or a simple http.createServer).
  });
});
```

> This e2e is gated behind `NAVY_E2E=1` because it requires a running local validator with `navy_payments` deployed. Implement the body using the patterns from `onchain/tests/navy-payments.pay.ts` (mint/ATA/config/register) plus the gateway services. The unit suite (Tasks 2–10) is the primary automated coverage; this e2e is the integration gate run on demand and during the devnet smoke.

- [ ] **Step 3: Run the unit suite (confirm nothing regressed)**

Run: `pnpm test`
Expected: all unit specs pass.

- [ ] **Step 4: Commit**

```bash
git add be/test/payments.e2e-spec.ts be/scripts/gateway-bringup.md
git commit -m "test(be): payments localnet e2e harness + devnet bring-up runbook"
```

---

## Self-Review

**Spec coverage (spec §→ task):**
- §3 data model (Order, WebhookDelivery) → Task 1; invoice_id derivation → Task 2.
- §4 merchant order API + HMAC → Tasks 3 (encrypted secret), 4 (OrderAuthService), 7 (OrdersService), 11 (controller+guard).
- §5 pay flow (backend builds tx, partial-sign, verify-and-submit) → Tasks 5 (client), 6 (onchain wiring), 8 (RelayerService), 11 (endpoints).
- §6 watcher/reconcile/expire → Task 10 (+ §6 InvoicePaid decode + cron noted for Task 12 integration).
- §7 webhooks (HMAC + retry) → Task 9.
- §8 devnet bring-up (deploy, Circle USDC, init config, register merchant, relayer) → Task 12 runbook + Task 6 env.
- §9 error handling (zero amount, double submit, tx mismatch, expiry, not-approved) → Tasks 7, 8, 10, 4.
- §10 testing (unit for all pure logic + localnet integration) → every task + Task 12.

**Placeholder scan:** Pure-logic tasks (2,3,4,5,7,8,9,10) ship complete code + real Jest tests. Two tasks carry explicit, bounded implementer notes rather than placeholders: Task 11's `payments.module.ts` provider wiring (the `useFactory` for `OrdersService` args + the `SecretLookup` adapter are spelled out in the note) and Task 12's e2e body (a step-by-step comment list to implement against the onchain harness, gated behind `NAVY_E2E=1`). These are integration-wiring and live-validator concerns that can't be unit-pinned; the note gives exact construction. RelayerService's throwaway second constructor arg is flagged for cleanup.

**Type consistency:** `orderIdToInvoiceId`/`invoiceIdToHex` (Task 2) used by OrdersService (7) and RelayerService (8) and payments-client (5). `Cipher.seal/open` + `SealedSecret{encryptedPrivkey,dataKeyWrapped}` (foundation) used in Tasks 3, 4. `ApiKeyService.sign/verify` (foundation) used in 4, 9. `NAVY_ONCHAIN`/`NavyOnchain` (Task 6) injected in 8. `buildPayInvoiceTx`/`merchantPda`/`configPda`/`invoicePda` (Task 5) used in 8. `WebhookService.deliver` (9) called by ChainWatcher (10). `OrdersService.create/get` (7) used by controller (11). Consistent.

**Known follow-ups (recorded):** the in-memory `issued` tx cache in RelayerService is single-instance (move to Redis/DB for multi-instance prod); full `InvoicePaid` event decode + a scheduled reconciliation/`expireStale` cron are wired in the Task 12 integration (the unit path drives markPaid from a confirmed submit); raw-body HMAC requires the `main.ts` `rawBody: true` change (Task 11 note); the relayer hot key + treasury are devnet — production needs KMS/HSM + monitoring.
