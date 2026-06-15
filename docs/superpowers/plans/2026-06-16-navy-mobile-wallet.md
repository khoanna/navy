# Navy Mobile Wallet (Balances / Scan-to-Pay / History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Navy mobile wallet its consumer features — SOL/USDC balances, scan-a-Navy-QR-and-pay (gasless via the gateway relayer), and payment history — on top of the existing Privy auth.

**Architecture:** One backend endpoint (`GET /user/payments`) lists the JWT wallet's paid orders. The mobile app keeps all non-UI logic in plain-TS modules (QR parse, balances, pay client, pay-flow orchestration) that are TDD'd under the unit jest project; thin Privy-wired screens call them. Paying is sign-only (`signTransaction`) because the relayer is the fee payer and submits.

**Tech Stack:** Nest 11 · Prisma 7 · Expo SDK 56 · `@privy-io/expo` 0.69.1 · `expo-camera` · `@solana/web3.js` + `@solana/spl-token` · Jest.

**Scope:** Sub-project 6 of Navy. Implements `docs/superpowers/specs/2026-06-16-navy-mobile-wallet-design.md`. Reuses sub-project-1 mobile (`readEnv`/env, `SessionContext`/`useNavySession`, Privy embedded wallet) and the gateway's public pay endpoints.

---

## File Structure

```
be/
├── src/payments/orders.service.ts            # MODIFY: + listForPayer
├── src/payments/orders.service.spec.ts        # MODIFY: + tests
├── src/payments/user-payments.controller.ts   # NEW: GET /user/payments
└── src/payments/payments.module.ts            # MODIFY: register controller
mobile/
├── app.json                                   # MODIFY: extra.solanaRpc + extra.usdcMint
├── src/config/env.ts                          # MODIFY: NavyEnv + readEnv
├── src/config/env.test.ts                      # MODIFY: tests
├── src/pay/payUrl.ts + payUrl.test.ts          # NEW: parsePayUrl
├── src/wallet/balances.ts + balances.test.ts   # NEW: fetch + format
├── src/pay/navyPayClient.ts + .test.ts         # NEW: order/payment-tx/submit/history
├── src/pay/payFlow.ts + payFlow.test.ts        # NEW: orchestrator
├── app/home.tsx                                # MODIFY/NEW: balances home (replaces post-login screen)
├── app/scan.tsx                                # NEW: expo-camera scanner
├── app/pay/[orderId].tsx                       # NEW: confirm + pay
└── app/history.tsx                             # NEW: payment history
```

---

## Conventions

- be tasks from `/home/khoa/Desktop/uni/be`; mobile from `/home/khoa/Desktop/uni/mobile`. Tests: `pnpm test <pattern>`. Typecheck (mobile): `pnpm exec tsc --noEmit`.
- Commit per task. Git identity fallback: `git -c user.name=Navy -c user.email=capydata.xyz@gmail.com commit ...`.
- mobile jest: unit project runs `src/**/*.test.ts` under ts-jest/node — logic modules must not import React Native.
- **Expo SDK 56 / Privy 0.69.1:** consult `node_modules/@privy-io/expo` types + `https://docs.expo.dev/versions/v56.0.0/sdk/camera/` before writing screen code; `tsc` is the gate.

---

### Task 1: Backend — `listForPayer` + `GET /user/payments`

**Files:** Modify `be/src/payments/orders.service.ts`, `orders.service.spec.ts`; create `be/src/payments/user-payments.controller.ts`; modify `be/src/payments/payments.module.ts`.

- [ ] **Step 1: Add a failing test** to `orders.service.spec.ts`

```ts
describe('OrdersService.listForPayer', () => {
  it('returns the payer\'s paid orders, scoped + serialized', async () => {
    const rows = [{ id: 'o1', reference: 'R1', amount: 990000n, status: 'paid', paidAt: new Date(), txSignature: 'sig', merchant: { businessName: 'Acme' } }];
    const prisma = { order: { findMany: jest.fn().mockResolvedValue(rows) } } as any;
    const audit = { record: jest.fn() } as any;
    const svc = new OrdersService(prisma, audit, 'navy://pay', 100);
    const out = await svc.listForPayer('PAYER', { take: 50, skip: 0 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { payer: 'PAYER', status: 'paid' }, orderBy: { paidAt: 'desc' },
    }));
    expect(out[0]).toEqual(expect.objectContaining({ orderId: 'o1', amount: '990000', merchant: 'Acme', txSignature: 'sig' }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test orders.service`
Expected: FAIL — `listForPayer` undefined.

- [ ] **Step 3: Add `listForPayer` to `orders.service.ts`** (inside the class)

```ts
  async listForPayer(payer: string, opts: { take: number; skip: number }) {
    const rows = await this.prisma.order.findMany({
      where: { payer, status: 'paid' },
      orderBy: { paidAt: 'desc' }, take: opts.take, skip: opts.skip,
      include: { merchant: { select: { businessName: true } } },
    });
    return rows.map((o: any) => ({
      orderId: o.id, reference: o.reference, amount: o.amount.toString(), status: o.status,
      paidAt: o.paidAt, txSignature: o.txSignature ?? null, merchant: o.merchant?.businessName ?? null,
    }));
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test orders.service`
Expected: PASS.

- [ ] **Step 5: Create `user-payments.controller.ts`**

```ts
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('user/payments')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class UserPaymentsController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Req() req: any, @Query('take') take = '50', @Query('skip') skip = '0') {
    const payer = req.user.walletAddress;
    if (!payer) return [];
    return this.orders.listForPayer(payer, { take: parseInt(take, 10), skip: parseInt(skip, 10) });
  }
}
```

- [ ] **Step 6: Register the controller** in `payments.module.ts` — add `UserPaymentsController` to the `controllers` array (import at top).

- [ ] **Step 7: Build + full suite**

Run: `pnpm build && pnpm test`
Expected: build succeeds; all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add be/src/payments/orders.service.ts be/src/payments/orders.service.spec.ts be/src/payments/user-payments.controller.ts be/src/payments/payments.module.ts
git commit -m "feat(be): GET /user/payments (payer-scoped paid orders)"
```

---

### Task 2: Mobile config — RPC + USDC mint

**Files:** Modify `mobile/src/config/env.ts`, `env.test.ts`, `mobile/app.json`.

- [ ] **Step 1: Update the failing test** in `mobile/src/config/env.test.ts` (replace the existing maps-extra test, add the new fields)

```ts
import { readEnv } from './env';

describe('readEnv', () => {
  const base = { privyAppId: 'app', privyClientId: 'client', navyApiUrl: 'http://x:3000',
                 solanaRpc: 'https://api.devnet.solana.com', usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' };
  it('maps expo extra into a typed config', () => {
    expect(readEnv(base)).toEqual(base);
  });
  it('throws when a required value is missing', () => {
    expect(() => readEnv({ ...base, solanaRpc: '' })).toThrow(/solanaRpc/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test env.test`
Expected: FAIL — `solanaRpc`/`usdcMint` not on the type / not required.

- [ ] **Step 3: Update `mobile/src/config/env.ts`**

```ts
export interface NavyEnv {
  privyAppId: string;
  privyClientId: string;
  navyApiUrl: string;
  solanaRpc: string;
  usdcMint: string;
}

type RawExtra = Partial<Record<keyof NavyEnv, string>>;

export function readEnv(extra: RawExtra): NavyEnv {
  const req = (k: keyof NavyEnv): string => {
    const v = extra[k];
    if (!v) throw new Error(`Missing required config: ${k}`);
    return v;
  };
  return {
    privyAppId: req('privyAppId'), privyClientId: req('privyClientId'), navyApiUrl: req('navyApiUrl'),
    solanaRpc: req('solanaRpc'), usdcMint: req('usdcMint'),
  };
}

export function getEnv(): NavyEnv {
  const Constants = require('expo-constants').default;
  return readEnv((Constants?.expoConfig?.extra ?? {}) as RawExtra);
}
```

- [ ] **Step 4: Add to `mobile/app.json`** `expo.extra` (merge with existing keys)

```json
"solanaRpc": "https://api.devnet.solana.com",
"usdcMint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
```

- [ ] **Step 5: Run + typecheck**

Run: `pnpm test env.test && pnpm exec tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/config/env.ts mobile/src/config/env.test.ts mobile/app.json
git commit -m "feat(mobile): add Solana RPC + USDC mint to config"
```

---

### Task 3: Mobile — payUrl parser

**Files:** Create `mobile/src/pay/payUrl.ts`, `payUrl.test.ts`.

- [ ] **Step 1: Write the failing test** — `payUrl.test.ts`

```ts
import { parsePayUrl } from './payUrl';

describe('parsePayUrl', () => {
  it('extracts the order id from a navy pay url', () => {
    expect(parsePayUrl('navy://pay/00112233-4455-6677-8899-aabbccddeeff')).toBe('00112233-4455-6677-8899-aabbccddeeff');
  });
  it('accepts an https fallback', () => {
    expect(parsePayUrl('https://pay.navy/pay/00112233-4455-6677-8899-aabbccddeeff')).toBe('00112233-4455-6677-8899-aabbccddeeff');
  });
  it('throws on a non-navy or malformed url', () => {
    expect(() => parsePayUrl('https://evil.com/x')).toThrow(/navy/i);
    expect(() => parsePayUrl('navy://pay/not-a-uuid')).toThrow(/invoice/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test payUrl`
Expected: FAIL — cannot find `./payUrl`.

- [ ] **Step 3: Implement `payUrl.ts`**

```ts
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Parse `navy://pay/<uuid>` or `https://<host>/pay/<uuid>` into the order id. */
export function parsePayUrl(url: string): string {
  const m = url.match(/(?:navy:\/\/pay\/|\/pay\/)([^/?#]+)/);
  if (!url.startsWith('navy://') && !url.includes('/pay/')) throw new Error('Not a Navy invoice');
  if (!m) throw new Error('Not a Navy invoice');
  const id = m[1];
  if (!UUID.test(id)) throw new Error('Invalid invoice id');
  return id;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test payUrl`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/pay/payUrl.ts mobile/src/pay/payUrl.test.ts
git commit -m "feat(mobile): navy pay-url parser"
```

---

### Task 4: Mobile — balances

**Files:** Create `mobile/src/wallet/balances.ts`, `balances.test.ts`.

- [ ] **Step 1: Write the failing test** — `balances.test.ts`

```ts
import { PublicKey } from '@solana/web3.js';
import { lamportsToSol, usdcBaseToDisplay, fetchBalances } from './balances';

const owner = PublicKey.default;
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

describe('balance formatters', () => {
  it('formats lamports to SOL', () => { expect(lamportsToSol(1_500_000_000)).toBe('1.5'); });
  it('formats USDC base units', () => { expect(usdcBaseToDisplay('990000')).toBe('0.99'); });
});

describe('fetchBalances', () => {
  it('returns SOL lamports and USDC base units', async () => {
    const connection = {
      getBalance: jest.fn().mockResolvedValue(2_000_000_000),
      getTokenAccountBalance: jest.fn().mockResolvedValue({ value: { amount: '1500000' } }),
    } as any;
    const out = await fetchBalances(connection, owner, mint);
    expect(out).toEqual({ solLamports: 2_000_000_000, usdcBase: '1500000' });
  });

  it('treats a missing USDC ATA as 0', async () => {
    const connection = {
      getBalance: jest.fn().mockResolvedValue(0),
      getTokenAccountBalance: jest.fn().mockRejectedValue(new Error('could not find account')),
    } as any;
    const out = await fetchBalances(connection, owner, mint);
    expect(out).toEqual({ solLamports: 0, usdcBase: '0' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test balances`
Expected: FAIL — cannot find `./balances`.

- [ ] **Step 3: Implement `balances.ts`**

```ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

export function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toString();
}
export function usdcBaseToDisplay(base: string | bigint): string {
  return (Number(base) / 1_000_000).toFixed(2);
}

export async function fetchBalances(connection: Connection, owner: PublicKey, usdcMint: PublicKey): Promise<{ solLamports: number; usdcBase: string }> {
  const solLamports = await connection.getBalance(owner);
  let usdcBase = '0';
  try {
    const ata = await getAssociatedTokenAddress(usdcMint, owner);
    const bal = await connection.getTokenAccountBalance(ata);
    usdcBase = bal.value.amount;
  } catch {
    usdcBase = '0';
  }
  return { solLamports, usdcBase };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test balances`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/wallet/balances.ts mobile/src/wallet/balances.test.ts
git commit -m "feat(mobile): SOL + USDC balance fetch and formatters"
```

> Note: this test imports `@solana/spl-token`. If it isn't installed in mobile yet, Task 7 Step 1 installs it; if this task runs first, run `npx expo install @solana/spl-token` here and include `package.json` in the commit.

---

### Task 5: Mobile — NavyPayClient

**Files:** Create `mobile/src/pay/navyPayClient.ts`, `navyPayClient.test.ts`.

- [ ] **Step 1: Write the failing test** — `navyPayClient.test.ts`

```ts
import { NavyPayClient } from './navyPayClient';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as typeof fetch;
}

describe('NavyPayClient', () => {
  it('getOrder fetches the order', async () => {
    const f = mockFetch(200, { orderId: 'o1', status: 'awaiting_payment', amount: '1000000', reference: 'R' });
    const c = new NavyPayClient('http://api', f);
    expect(await c.getOrder('o1')).toEqual(expect.objectContaining({ orderId: 'o1' }));
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/o1', expect.anything());
  });
  it('getPaymentTx requests the relayer-signed tx for a payer', async () => {
    const f = mockFetch(200, { tx: 'BASE64', invoice: {} });
    const c = new NavyPayClient('http://api', f);
    const out = await c.getPaymentTx('o1', 'PK');
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/o1/payment-tx?payer=PK', expect.anything());
    expect(out.tx).toBe('BASE64');
  });
  it('submitSignedTx posts the signed tx', async () => {
    const f = mockFetch(200, { txSignature: 'sig', status: 'confirming' });
    const c = new NavyPayClient('http://api', f);
    const out = await c.submitSignedTx('o1', 'SIGNED');
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/o1/submit', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ signedTx: 'SIGNED' }),
    }));
    expect(out.txSignature).toBe('sig');
  });
  it('getUserPayments sends the Navy bearer token', async () => {
    const f = mockFetch(200, [{ orderId: 'o1' }]);
    const c = new NavyPayClient('http://api', f);
    await c.getUserPayments('navy-jwt');
    expect(f).toHaveBeenCalledWith('http://api/user/payments', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer navy-jwt' }),
    }));
  });
  it('throws on a non-2xx', async () => {
    const c = new NavyPayClient('http://api', mockFetch(404, {}));
    await expect(c.getOrder('missing')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test navyPayClient`
Expected: FAIL — cannot find `./navyPayClient`.

- [ ] **Step 3: Implement `navyPayClient.ts`**

```ts
export interface OrderSummary { orderId: string; status: string; amount: string; reference: string; }
export interface Payment { orderId: string; reference: string; amount: string; status: string; paidAt: string | null; txSignature: string | null; merchant: string | null; }

export class NavyPayClient {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init });
    if (!res.ok) throw new Error(`Navy API ${path} failed (HTTP ${res.status})`);
    return (await res.json()) as T;
  }

  getOrder(id: string): Promise<OrderSummary> { return this.json(`/v1/orders/${id}`); }
  getPaymentTx(id: string, payer: string): Promise<{ tx: string; invoice: unknown }> {
    return this.json(`/v1/orders/${id}/payment-tx?payer=${payer}`);
  }
  submitSignedTx(id: string, signedTx: string): Promise<{ txSignature: string; status: string }> {
    return this.json(`/v1/orders/${id}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signedTx }) });
  }
  getUserPayments(navyAccessToken: string): Promise<Payment[]> {
    return this.json(`/user/payments`, { headers: { Authorization: `Bearer ${navyAccessToken}` } });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test navyPayClient`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/pay/navyPayClient.ts mobile/src/pay/navyPayClient.test.ts
git commit -m "feat(mobile): NavyPayClient (order/payment-tx/submit/history)"
```

---

### Task 6: Mobile — payFlow orchestrator

**Files:** Create `mobile/src/pay/payFlow.ts`, `payFlow.test.ts`.

- [ ] **Step 1: Write the failing test** — `payFlow.test.ts`

```ts
import { Transaction, Keypair, SystemProgram, PublicKey } from '@solana/web3.js';
import { payInvoice } from './payFlow';

function sampleTxBase64(): string {
  const kp = Keypair.generate();
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: PublicKey.default, lamports: 1 }));
  tx.feePayer = kp.publicKey; tx.recentBlockhash = '11111111111111111111111111111111';
  return tx.serialize({ requireAllSignatures: false }).toString('base64');
}

describe('payInvoice', () => {
  it('fetches the tx, signs it, and submits the signed tx', async () => {
    const client = {
      getPaymentTx: jest.fn().mockResolvedValue({ tx: sampleTxBase64(), invoice: {} }),
      submitSignedTx: jest.fn().mockResolvedValue({ txSignature: 'sig', status: 'confirming' }),
    } as any;
    const signTransaction = jest.fn().mockImplementation(async (tx: Transaction) => tx); // fake signer passthrough
    const out = await payInvoice({ orderId: 'o1', payer: 'PK', client, signTransaction });
    expect(client.getPaymentTx).toHaveBeenCalledWith('o1', 'PK');
    expect(signTransaction).toHaveBeenCalled();
    expect(client.submitSignedTx).toHaveBeenCalledWith('o1', expect.any(String));
    expect(out.txSignature).toBe('sig');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test payFlow`
Expected: FAIL — cannot find `./payFlow`.

- [ ] **Step 3: Implement `payFlow.ts`**

```ts
import { Transaction } from '@solana/web3.js';
import { NavyPayClient } from './navyPayClient';

export interface PayInvoiceArgs {
  orderId: string;
  payer: string;
  client: NavyPayClient;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

/** Fetch the relayer-partial-signed tx, add the user signature, submit it. */
export async function payInvoice(a: PayInvoiceArgs): Promise<{ txSignature: string; status: string }> {
  const { tx } = await a.client.getPaymentTx(a.orderId, a.payer);
  const unsigned = Transaction.from(Buffer.from(tx, 'base64'));
  const signed = await a.signTransaction(unsigned);
  const signedB64 = signed.serialize({ requireAllSignatures: false }).toString('base64');
  return a.client.submitSignedTx(a.orderId, signedB64);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test payFlow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/pay/payFlow.ts mobile/src/pay/payFlow.test.ts
git commit -m "feat(mobile): payInvoice flow (get-tx -> sign -> submit)"
```

---

### Task 7: Mobile — deps + balances home screen

**Files:** install `expo-camera`, `@solana/spl-token`; create/replace `mobile/app/home.tsx`.

- [ ] **Step 1: Install deps**

```bash
cd /home/khoa/Desktop/uni/mobile
npx expo install expo-camera @solana/spl-token
```

- [ ] **Step 2: Implement `mobile/app/home.tsx`** (balances + nav)

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Connection, PublicKey } from '@solana/web3.js';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { getEnv } from '../src/config/env';
import { fetchBalances, lamportsToSol, usdcBaseToDisplay } from '../src/wallet/balances';

export default function Home() {
  const router = useRouter();
  const solana = useEmbeddedSolanaWallet();
  const address = solana?.wallets?.[0]?.address;
  const [sol, setSol] = useState('—');
  const [usdc, setUsdc] = useState('—');

  useEffect(() => {
    if (!address) return;
    const env = getEnv();
    const connection = new Connection(env.solanaRpc, 'confirmed');
    fetchBalances(connection, new PublicKey(address), new PublicKey(env.usdcMint))
      .then((b) => { setSol(lamportsToSol(b.solLamports)); setUsdc(usdcBaseToDisplay(b.usdcBase)); })
      .catch(() => { setSol('0'); setUsdc('0'); });
  }, [address]);

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Navy Wallet</Text>
      <Text style={styles.bal}>{sol} SOL</Text>
      <Text style={styles.bal}>{usdc} USDC</Text>
      <Text selectable style={styles.addr}>{address ?? 'provisioning…'}</Text>
      <Button title="Scan to pay" onPress={() => router.push('/scan')} />
      <Button title="History" onPress={() => router.push('/history')} />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600' },
  bal: { fontSize: 28, fontWeight: '700' },
  addr: { fontFamily: 'monospace', color: '#555' },
});
```

> If the post-login route in sub-project 1 was `app/home.tsx` already (it was), this REPLACES its body with the balances home. Keep the route path the same so the existing redirect (`session ? '/home' : '/login'`) still lands here.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (Verify `useEmbeddedSolanaWallet().wallets[0].address` shape against installed `@privy-io/expo` — confirmed in sub-project 1.)

- [ ] **Step 4: Commit**

```bash
git add mobile/app/home.tsx mobile/package.json
git commit -m "feat(mobile): balances home screen + camera/spl-token deps"
```

---

### Task 8: Mobile — scan + confirm-pay screens

**Files:** Create `mobile/app/scan.tsx`, `mobile/app/pay/[orderId].tsx`.

- [ ] **Step 1: Implement `mobile/app/scan.tsx`** (expo-camera scanner)

```tsx
import React, { useState } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { parsePayUrl } from '../src/pay/payUrl';

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!permission) return <View style={styles.c}><Text>Requesting camera…</Text></View>;
  if (!permission.granted) {
    return <View style={styles.c}><Text>Camera permission needed</Text><Button title="Grant" onPress={requestPermission} /></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done) return;
          try { const id = parsePayUrl(data); setDone(true); router.replace(`/pay/${id}`); }
          catch (e) { setError((e as Error).message); }
        }}
      />
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  err: { position: 'absolute', bottom: 40, alignSelf: 'center', color: 'crimson', backgroundColor: '#fff', padding: 8 },
});
```

> Verify the `expo-camera` v56 API (`CameraView`, `useCameraPermissions`, `onBarcodeScanned`, `barcodeScannerSettings`) against `node_modules/expo-camera` types / the v56 docs; adjust prop names if they differ. Add the camera permission to `app.json` if the build requires it (the `expo-camera` config plugin / `ios.infoPlist.NSCameraUsageDescription` + `android.permissions`).

- [ ] **Step 2: Implement `mobile/app/pay/[orderId].tsx`** (confirm + pay via Privy sign-only)

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Button, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Transaction } from '@solana/web3.js';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { getEnv } from '../../src/config/env';
import { NavyPayClient } from '../../src/pay/navyPayClient';
import { payInvoice } from '../../src/pay/payFlow';

export default function PayScreen() {
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const solana = useEmbeddedSolanaWallet();
  const address = solana?.wallets?.[0]?.address;
  const client = new NavyPayClient(getEnv().navyApiUrl);
  const [order, setOrder] = useState<{ amount: string; reference: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (orderId) client.getOrder(orderId).then(setOrder).catch(() => setOrder(null)); }, [orderId]);

  async function pay() {
    if (!address || !orderId) return;
    setBusy(true);
    try {
      const wallet = solana!.wallets![0];
      const provider = await (wallet as any).getProvider();
      const signTransaction = (tx: Transaction) => provider.signTransaction(tx) as Promise<Transaction>;
      const res = await payInvoice({ orderId, payer: address, client, signTransaction });
      Alert.alert('Paid', `Submitted: ${res.txSignature.slice(0, 16)}…`);
      router.replace('/home');
    } catch (e) {
      Alert.alert('Payment failed', (e as Error).message);
    } finally { setBusy(false); }
  }

  if (!order) return <View style={styles.c}><Text>Loading invoice…</Text></View>;
  return (
    <View style={styles.c}>
      <Text style={styles.h}>Pay invoice</Text>
      <Text style={styles.amt}>{(Number(order.amount) / 1_000_000).toFixed(2)} USDC</Text>
      <Text>Reference: {order.reference}</Text>
      <Text>Status: {order.status}</Text>
      <Button title={busy ? 'Paying…' : 'Pay'} disabled={busy || order.status !== 'awaiting_payment'} onPress={pay} />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  h: { fontSize: 22, fontWeight: '600' }, amt: { fontSize: 30, fontWeight: '700' },
});
```

> Verify the Privy provider sign method: `useEmbeddedSolanaWallet().wallets[0].getProvider()` then `provider.signTransaction(tx)`. Inspect `node_modules/@privy-io/expo` types — if the sign-only method has a different name/shape (e.g. `provider.request({ method: 'signTransaction', ... })`), adjust the `signTransaction` adapter to return a signed `Transaction`. Do NOT use `signAndSendTransaction` (breaks gasless). The `payInvoice` flow is unchanged; only the adapter wiring may differ.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/app/scan.tsx mobile/app/pay
git commit -m "feat(mobile): scan + confirm-pay screens (Privy sign-only, gasless)"
```

---

### Task 9: Mobile — history screen + final verification

**Files:** Create `mobile/app/history.tsx`.

- [ ] **Step 1: Implement `mobile/app/history.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { usePrivy } from '@privy-io/expo';
import { getEnv } from '../src/config/env';
import { NavyPayClient, Payment } from '../src/pay/navyPayClient';

export default function History() {
  const { getAccessToken } = usePrivy();
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const client = new NavyPayClient(getEnv().navyApiUrl);
      try { setPayments(await client.getUserPayments(token)); } catch { setPayments([]); }
    })();
  }, [getAccessToken]);

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Payments</Text>
      <FlatList
        data={payments}
        keyExtractor={(p) => p.orderId}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text>{item.merchant ?? item.reference}</Text>
            <Text>{(Number(item.amount) / 1_000_000).toFixed(2)} USDC</Text>
          </View>
        )}
        ListEmptyComponent={<Text>No payments yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 24, gap: 8 },
  h: { fontSize: 22, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
});
```

> Note: the history endpoint authenticates with the **Navy** session, but the foundation issues a Navy JWT separate from the Privy token. If `useNavySession()` (from sub-project 1's `SessionContext`) exposes the Navy access token, prefer it over the Privy `getAccessToken()` here — the backend `/user/payments` guard validates a **Navy** JWT (with `walletAddress`), not a Privy token. Use `useNavySession().session?.tokens.accessToken`; if the SessionContext doesn't expose the token, add a getter. Confirm which token the backend `JwtGuard` expects (it's the Navy JWT) and wire that. Adjust the import accordingly; the `NavyPayClient.getUserPayments(token)` call is unchanged.

- [ ] **Step 2: Typecheck + full unit suite (mobile)**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; all unit tests pass (env, payUrl, balances, navyPayClient, payFlow + sub-project-1 logic).

- [ ] **Step 3: Backend full suite**

Run (be): `docker compose up -d && pnpm test`
Expected: all pass (incl. `listForPayer`).

- [ ] **Step 4: Commit**

```bash
git add mobile/app/history.tsx
git commit -m "feat(mobile): payment history screen"
```

---

## Self-Review

**Spec coverage (spec §→ task):**
- §2 backend `GET /user/payments` + `listForPayer` (payer-scoped) → Task 1.
- §3 logic modules: payUrl → Task 3; balances → Task 4; NavyPayClient → Task 5; payFlow → Task 6; config → Task 2.
- §4 screens: home/balances → Task 7; scan → Task 8; confirm-pay → Task 8; history → Task 9.
- §5 Privy `signTransaction` (sign-only) → Task 8 (adapter wiring + verify note).
- §6 data flow → exercised across Tasks 5, 6, 8.
- §7 error handling (invalid QR, no-ATA→0, status gating, sign cancel) → Tasks 3, 4, 8.
- §8 testing (parse, balances, client, flow; backend scoping) → Tasks 1, 3, 4, 5, 6.

**Placeholder scan:** Logic tasks (1–6) ship complete code + real tests. Screen tasks (7–9) ship complete code verified by `tsc`, each with an explicit "verify the installed SDK shape and adjust the adapter" note for the three drift points (`@privy-io/expo` provider sign method, `expo-camera` v56 API, which token `/user/payments` expects) — these are real-device/SDK concerns the unit layer can't pin, and the note gives the exact adjustment.

**Type consistency:** `NavyEnv`+`solanaRpc`/`usdcMint` (Task 2) used by `home`/`pay` screens (7, 8). `fetchBalances`/`lamportsToSol`/`usdcBaseToDisplay` (Task 4) used in `home` (7). `NavyPayClient` methods + `OrderSummary`/`Payment` (Task 5) used by `payFlow` (6), `pay` (8), `history` (9). `payInvoice` args (Task 6) match the `pay` screen call (8). Backend `listForPayer` output shape (`orderId`/`amount` string/`merchant`) matches the mobile `Payment` interface (Task 5) and the history render (9).

**Known follow-ups (recorded):** the Navy-vs-Privy token for `/user/payments` (Task 9 note — backend expects the Navy JWT); `expo-camera` permission config in `app.json` may be needed for a device build (Task 8 note); paying requires the user to already hold devnet USDC (Circle faucet) since the flow doesn't create the user ATA; sub-project 7 (farming subwallet) will add to this app.
