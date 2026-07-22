# P2P Send (USDC + ETH) + Scan-to-Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Send flow — gasless USDC or native ETH — reachable by @username, pasted 0x address, or scanned address QR, with all failures mapped to clear messages shown on the confirm card and fed back to the AI assistant.

**Architecture:** USDC reuses the existing gasless relayer rails (build→sign→submit). ETH is broadcast client-side by the Privy embedded wallet (pays its own gas), then recorded to the backend; both converge on one `Transfer` table + the existing `sweepConfirming` watcher + one history. The assistant's `build_transfer` tool gains an `asset` param.

**Tech Stack:** Nest.js 11, Prisma 7, ethers v6, Expo/React Native (`@privy-io/expo`, expo-camera, react-native-qrcode-svg), Jest.

**Builds on branch `feat/ai-assistant`** (existing: `Transfer` model, `TransferService.buildAuthorization/submit`, `TransferWatcherService`, `useMobileSigner`, agent `build_transfer`, `TransferConfirmCard`, `useCameraScanner`, `parsePayUrl`).

---

## Prerequisites

- `be/` Postgres up (`docker compose up -d`); `DATABASE_URL` in shell for prisma CLI (`set -a; source .env; set +a`).
- Migrations: for altering columns to nullable + adding a defaulted column, `pnpm prisma migrate dev --name X` usually runs non-interactively; if it aborts, hand-author the SQL in Prisma's format and `pnpm prisma migrate deploy && pnpm prisma generate`.

## File Structure

**Backend (modify):**
- `be/prisma/schema.prisma` — `Transfer.asset` + make `nonce`/`digest`/`validBefore` nullable.
- `be/src/transfer/transfer.service.ts` — `resolve()`, `recordEthSend()`, null-guards in `submit()`, `asset` in `buildAuthorization`/`history`.
- `be/src/transfer/transfer.controller.ts` — `GET /transfer/resolve`, `POST /transfer/eth/record`.
- `be/src/agent/tool-schemas.ts` — `asset` param on `build_transfer`.
- `be/src/agent/agent-tools.service.ts` — `build_transfer` ETH branch.

**Backend (create):**
- `be/scripts/eth-send-e2e.mjs` — live-Sepolia ETH send + record proof.

**Expo (create):**
- `src/lib/pay/parseSendTarget.ts` (+ test) — decode raw 0x / EIP-681.
- `src/lib/wallet/sendErrors.ts` (+ test) — `mapSendError`.
- `app/send.tsx` — the Send screen.

**Expo (modify):**
- `src/lib/wallet/useMobileSigner.ts` — `sendTransaction`.
- `src/lib/transfer/transferClient.ts` (+ test) — `resolve()`, `recordEth()`.
- `src/lib/pay/useCameraScanner.ts` — `onSend` branch.
- `app/(tabs)/scan.tsx` — navigate to `/send` on a send target.
- `app/(tabs)/home.tsx` — Send quick-action.
- `src/features/assistant/TransferConfirmCard.tsx` + `app/(tabs)/assistant.tsx` — ETH confirm branch + error feedback.

---

## Phase A — Backend

### Task A1: `Transfer.asset` + nullable auth columns + submit guard

**Files:** Modify `be/prisma/schema.prisma`, `be/src/transfer/transfer.service.ts`

- [ ] **Step 1: Edit the `Transfer` model** — add `asset`, make the EIP-3009-only columns nullable (ETH rows don't have them):

```prisma
model Transfer {
  id          String    @id @default(uuid())
  fromUserId  String
  fromAddress String
  toAddress   String
  toUsername  String?
  amount      BigInt
  asset       String    @default("USDC")  // "USDC" | "ETH" (amount is USDC 6-dec base units, or ETH wei)
  nonce       String?   @unique   // USDC only (EIP-3009 nonce)
  digest      String?   @unique   // USDC only (EIP-712 digest)
  validBefore DateTime?           // USDC only
  status      String    @default("awaiting_signature")
  txHash      String?
  consumedAt  DateTime?
  createdAt   DateTime  @default(now())

  @@index([fromUserId, createdAt])
  @@index([status])
}
```

- [ ] **Step 2: Migrate**

Run: `cd be && set -a; source .env; set +a; DATABASE_URL="$DATABASE_URL" pnpm prisma migrate dev --name transfer_asset_and_nullable_auth`
Expected: applied + client regenerated. (Fallback: hand-author SQL — `ALTER TABLE "Transfer" ADD COLUMN "asset" TEXT NOT NULL DEFAULT 'USDC'; ALTER TABLE "Transfer" ALTER COLUMN "nonce" DROP NOT NULL; ALTER COLUMN "digest" DROP NOT NULL; ALTER COLUMN "validBefore" DROP NOT NULL;` — then `migrate deploy && prisma generate`.)

- [ ] **Step 3: Add null-guards + asset in `transfer.service.ts`.** The now-nullable columns break the `submit()` typecheck. At the TOP of `submit()`, right after loading `t` and the ownership check, add a guard; and set `asset:'USDC'` in `buildAuthorization`'s `create`, and return `asset` from `history`.

In `submit()`, after `if (!t || t.fromUserId !== userId) throw new BadRequestException('Transfer not found');` add:

```ts
    if (!t.nonce || !t.digest || !t.validBefore) throw new BadRequestException('Transfer is not signable');
```

In `buildAuthorization`'s `this.prisma.transfer.create({ data: { ... } })`, add `asset: 'USDC',` to the data object.

In `history`, change the map to include asset:

```ts
    return rows.map((r) => ({
      id: r.id, toAddress: r.toAddress, toUsername: r.toUsername, asset: r.asset,
      amount: r.amount.toString(), status: r.status, txHash: r.txHash, createdAt: r.createdAt,
    }));
```

- [ ] **Step 4: Verify build + existing transfer tests**

Run: `cd be && pnpm build && pnpm test transfer.service.spec`
Expected: build clean; existing 4 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add be/prisma/schema.prisma be/prisma/migrations be/src/transfer/transfer.service.ts
git commit -m "feat(be): Transfer.asset + nullable auth cols + submit null-guard"
```

### Task A2: `resolve()` service + `GET /transfer/resolve`

**Files:** Modify `be/src/transfer/transfer.service.ts`, `be/src/transfer/transfer.controller.ts`; Test `be/src/transfer/transfer.service.spec.ts`

- [ ] **Step 1: Add a failing test** (append inside the existing `describe`, reusing the `deps()` helper already in the file):

```ts
describe('TransferService.resolve', () => {
  it('returns the address for a 0x recipient (username null)', async () => {
    const { svc } = deps();
    const r = await svc.resolve('0x0000000000000000000000000000000000000001');
    expect(r).toEqual({ address: '0x0000000000000000000000000000000000000001', username: null });
  });
  it('resolves a @username via UserService', async () => {
    const { svc } = deps();
    const r = await svc.resolve('@linh');
    expect(r).toEqual({ address: '0x000000000000000000000000000000000000dEaD', username: 'linh' });
  });
  it('throws on an unknown @username', async () => {
    const { svc } = deps({ users: { resolveUsername: jest.fn(async () => null) } });
    await expect(svc.resolve('@ghost')).rejects.toThrow(/not found/i);
  });
  it('throws on garbage', async () => {
    const { svc } = deps();
    await expect(svc.resolve('not-an-address')).rejects.toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2: Run** `cd be && pnpm test transfer.service.spec` → FAIL.

- [ ] **Step 3: Implement `resolve()`** in `TransferService`:

```ts
  /** Resolve a @username or 0x address to a wallet address (for the Send UI / ETH broadcast). */
  async resolve(recipient: string): Promise<{ address: string; username: string | null }> {
    const parsed = parseRecipient(recipient);
    if (!parsed) throw new BadRequestException('Invalid recipient');
    if (parsed.kind === 'address') return { address: parsed.value, username: null };
    const r = await this.users.resolveUsername(parsed.value);
    if (!r) throw new BadRequestException(`User @${parsed.value} not found`);
    return { address: r.address, username: r.username };
  }
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Add the controller route** in `transfer.controller.ts` (add `Get`, `Query` to the `@nestjs/common` import if missing):

```ts
  @Get('resolve')
  @Throttle({ default: { ttl: 60000, limit: 40 } })
  resolve(@Query('recipient') recipient: string) {
    return this.transfers.resolve(recipient ?? '');
  }
```

- [ ] **Step 6: Build + commit**

Run: `cd be && pnpm build` → clean.

```bash
git add be/src/transfer/transfer.service.ts be/src/transfer/transfer.controller.ts be/src/transfer/transfer.service.spec.ts
git commit -m "feat(be): GET /transfer/resolve (@username|0x -> address)"
```

### Task A3: `recordEthSend()` + `POST /transfer/eth/record`

**Files:** Modify `be/src/transfer/transfer.service.ts`, `be/src/transfer/transfer.controller.ts`; Test `be/src/transfer/transfer.service.spec.ts`

- [ ] **Step 1: Add a failing test** (append inside the existing `describe`; the `deps()` `prisma` fake needs `findFirst` — extend it inline in the test):

```ts
describe('TransferService.recordEthSend', () => {
  function ethDeps() {
    const rows: any[] = [];
    const prisma = {
      transfer: {
        findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.txHash === where.txHash) ?? null),
        create: jest.fn(async ({ data }: any) => { const row = { id: 'e1', ...data }; rows.push(row); return row; }),
      },
    };
    const chain = { provider: {}, relayer: { address: '0xr' }, usdc: {}, usdcDomain: {} };
    const svc = new TransferService(chain as any, prisma as any, {} as any, { relayerMinBalanceWei: 0n } as any);
    return { svc, prisma, rows };
  }
  const TX = '0x' + 'a'.repeat(64);
  it('inserts an ETH transfer row (asset ETH, confirming)', async () => {
    const { svc, rows } = ethDeps();
    const r = await svc.recordEthSend('u1', '0x1111111111111111111111111111111111111111', '0x0000000000000000000000000000000000000002', 1000000000000000n, TX);
    expect(r.status).toBe('confirming');
    expect(rows[0].asset).toBe('ETH');
    expect(rows[0].amount).toBe(1000000000000000n);
    expect(rows[0].txHash).toBe(TX);
  });
  it('is idempotent on txHash (double-report returns the existing row)', async () => {
    const { svc, prisma } = ethDeps();
    await svc.recordEthSend('u1', '0x1111111111111111111111111111111111111111', '0x0000000000000000000000000000000000000002', 5n, TX);
    await svc.recordEthSend('u1', '0x1111111111111111111111111111111111111111', '0x0000000000000000000000000000000000000002', 5n, TX);
    expect(prisma.transfer.create).toHaveBeenCalledTimes(1);
  });
  it('rejects an invalid recipient address', async () => {
    const { svc } = ethDeps();
    await expect(svc.recordEthSend('u1', '0x1111111111111111111111111111111111111111', 'nope', 5n, TX)).rejects.toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2: Run** `cd be && pnpm test transfer.service.spec` → FAIL.

- [ ] **Step 3: Implement `recordEthSend()`** in `TransferService` (`ethers` is already imported):

```ts
  /** Record an ETH send the client already broadcast. Idempotent on txHash; the watcher reconciles it. */
  async recordEthSend(userId: string, fromAddress: string, to: string, amountWei: bigint, txHash: string): Promise<{ id: string; status: string }> {
    const existing = await this.prisma.transfer.findFirst({ where: { txHash } });
    if (existing) return { id: existing.id, status: existing.status };
    if (!ethers.isAddress(to)) throw new BadRequestException('invalid recipient address');
    if (amountWei <= 0n) throw new BadRequestException('amount must be positive');
    const row = await this.prisma.transfer.create({
      data: {
        fromUserId: userId, fromAddress, toAddress: ethers.getAddress(to), toUsername: null,
        amount: amountWei, asset: 'ETH', status: 'confirming', txHash, consumedAt: new Date(),
      },
    });
    return { id: row.id, status: row.status };
  }
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Add the controller route + DTO** in `transfer.controller.ts`:

```ts
class EthRecordDto {
  @IsString() @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'to must be a 0x address' }) to!: string;
  @IsString() @Matches(/^\d+$/, { message: 'amountWei must be an integer string' }) amountWei!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{64}$/, { message: 'txHash must be a 0x 32-byte hash' }) txHash!: string;
}
```

and the route in the controller class:

```ts
  @Post('eth/record')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  recordEth(@Req() req: any, @Body() dto: EthRecordDto) {
    return this.transfers.recordEthSend(req.user.sub, req.user.walletAddress, dto.to, BigInt(dto.amountWei), dto.txHash);
  }
```

- [ ] **Step 6: Build + commit**

Run: `cd be && pnpm build` → clean.

```bash
git add be/src/transfer/transfer.service.ts be/src/transfer/transfer.controller.ts be/src/transfer/transfer.service.spec.ts
git commit -m "feat(be): POST /transfer/eth/record (client-broadcast ETH into unified history)"
```

### Task A4: Assistant `build_transfer` gains `asset` (ETH branch)

**Files:** Modify `be/src/agent/tool-schemas.ts`, `be/src/agent/agent-tools.service.ts`

- [ ] **Step 1: Update the `build_transfer` schema** in `tool-schemas.ts` — add an optional `asset` enum and clarify amount units. Replace the `build_transfer` entry with:

```ts
  { type: 'function', function: { name: 'build_transfer', description: 'Build a peer-to-peer send proposal for the user to confirm and sign. Call this DIRECTLY with the recipient the user named (do NOT ask for a 0x address when they gave a @username; the backend resolves usernames). amountBase is base units of the chosen asset: USDC has 6 decimals (1 USDC = 1000000); ETH is wei (1 ETH = 1000000000000000000). Default asset is USDC (gasless).', parameters: { type: 'object', properties: { recipient: { type: 'string', description: 'A @username or a 0x wallet address; pass the @username as-is.' }, amountBase: { type: 'string', description: 'Amount in base units of the asset (USDC 6-decimals, or ETH wei).' }, asset: { type: 'string', enum: ['USDC', 'ETH'], description: 'Which asset to send. Defaults to USDC.' } }, required: ['recipient', 'amountBase'], additionalProperties: false } } },
```

- [ ] **Step 2: Verify the schema test still passes** (it checks names + required params, which are unchanged): `cd be && pnpm test tool-schemas.spec` → PASS.

- [ ] **Step 3: Branch the handler** in `agent-tools.service.ts`. Replace the `build_transfer` handler with:

```ts
      build_transfer: async (a) => {
        const asset = a.asset === 'ETH' ? 'ETH' : 'USDC';
        if (asset === 'ETH') {
          const resolved = await this.transfers.resolve(String(a.recipient));
          const amountWei = BigInt(String(a.amountBase));
          const bal = await this.chain.provider.getBalance(walletAddress);
          // Leave a little headroom for gas; if the balance can't cover amount + a nominal reserve, refuse.
          if (bal <= amountWei) return { error: 'Not enough ETH to cover that amount plus gas. Add ETH and try again.' };
          return { display: { kind: 'action', action: 'transfer' }, asset: 'ETH', to: resolved.address, amountWei: amountWei.toString(), recipient: resolved };
        }
        const res = await this.transfers.buildAuthorization(userId, walletAddress, String(a.recipient), BigInt(String(a.amountBase)));
        return { display: { kind: 'action', action: 'transfer' }, asset: 'USDC', ...res };
      },
```

- [ ] **Step 4: Build + commit**

Run: `cd be && pnpm build` → clean.

```bash
git add be/src/agent/tool-schemas.ts be/src/agent/agent-tools.service.ts
git commit -m "feat(be): assistant build_transfer supports asset=ETH proposals"
```

---

## Phase B — Expo pure libs

### Task B1: `parseSendTarget` (raw 0x + EIP-681)

**Files:** Create `expo-wallet/src/lib/pay/parseSendTarget.ts` + `.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseSendTarget } from './parseSendTarget';

describe('parseSendTarget', () => {
  it('decodes a raw checksummed 0x address', () => {
    expect(parseSendTarget('0x0000000000000000000000000000000000000001'))
      .toEqual({ address: '0x0000000000000000000000000000000000000001' });
  });
  it('decodes an EIP-681 URI with a value', () => {
    expect(parseSendTarget('ethereum:0x0000000000000000000000000000000000000001@11155111?value=1000000000000000'))
      .toEqual({ address: '0x0000000000000000000000000000000000000001', amountWei: '1000000000000000' });
  });
  it('decodes an EIP-681 URI without a value', () => {
    expect(parseSendTarget('ethereum:0x0000000000000000000000000000000000000001'))
      .toEqual({ address: '0x0000000000000000000000000000000000000001' });
  });
  it('returns null for a pay URL or garbage', () => {
    expect(parseSendTarget('https://pay.navy/pay/abc')).toBeNull();
    expect(parseSendTarget('hello')).toBeNull();
    expect(parseSendTarget('0xnothex')).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `cd expo-wallet && pnpm test parseSendTarget.test` → FAIL.

- [ ] **Step 3: Implement** (uses `ethers.isAddress`/`getAddress`, already a dep):

```ts
import { isAddress, getAddress } from 'ethers';

export interface SendTarget { address: string; amountWei?: string }

/** Decode a scanned/pasted string into a send target: a raw 0x address or an EIP-681 URI. Null if neither. */
export function parseSendTarget(raw: string): SendTarget | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith('ethereum:')) {
    // ethereum:0xADDR[@chainId][?value=WEI&...]
    const rest = s.slice('ethereum:'.length);
    const at = rest.split('@')[0];
    const q = rest.indexOf('?');
    const addr = (q === -1 ? at : rest.slice(0, q).split('@')[0]).trim();
    if (!isAddress(addr)) return null;
    let amountWei: string | undefined;
    if (q !== -1) {
      const params = new URLSearchParams(rest.slice(q + 1));
      const v = params.get('value');
      if (v && /^\d+$/.test(v)) amountWei = v;
    }
    return amountWei ? { address: getAddress(addr), amountWei } : { address: getAddress(addr) };
  }
  if (isAddress(s)) return { address: getAddress(s) };
  return null;
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/pay/parseSendTarget.ts expo-wallet/src/lib/pay/parseSendTarget.test.ts
git commit -m "feat(expo): parseSendTarget (raw 0x + EIP-681)"
```

### Task B2: `sendErrors.mapSendError`

**Files:** Create `expo-wallet/src/lib/wallet/sendErrors.ts` + `.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mapSendError } from './sendErrors';

describe('mapSendError', () => {
  const t = (input: any) => mapSendError(input).title;
  it('maps insufficient ETH for gas', () => {
    expect(t(new Error('insufficient funds for intrinsic transaction cost'))).toMatch(/gas/i);
  });
  it('maps user rejection', () => {
    expect(t({ code: 4001, message: 'User rejected the request' })).toMatch(/cancell?ed/i);
  });
  it('maps an on-chain revert', () => {
    expect(t(new Error('execution reverted'))).toMatch(/revert|fail/i);
  });
  it('maps insufficient USDC (from the backend 400 message)', () => {
    expect(t(new Error('Insufficient USDC balance'))).toMatch(/usdc/i);
  });
  it('maps relayer unavailable (503)', () => {
    expect(t(new Error('Transfer relayer temporarily unavailable'))).toMatch(/temporar|relayer|try again/i);
  });
  it('always returns a non-empty title + detail for unknown errors', () => {
    const r = mapSendError(null);
    expect(r.title.length).toBeGreaterThan(0);
    expect(typeof r.detail).toBe('string');
  });
});
```

- [ ] **Step 2: Run** `cd expo-wallet && pnpm test sendErrors.test` → FAIL.

- [ ] **Step 3: Implement**

```ts
export interface MappedError { title: string; detail: string }

/** Turn any raw send failure (chain, RPC, Privy, backend 4xx/5xx) into friendly, actionable text. */
export function mapSendError(raw: unknown): MappedError {
  const code = (raw as any)?.code;
  const msg = ((raw as any)?.message ?? String(raw ?? '')).toString();
  const m = msg.toLowerCase();

  if (code === 4001 || m.includes('user rejected') || m.includes('rejected the request') || m.includes('cancelled') || m.includes('denied')) {
    return { title: 'Cancelled', detail: 'You dismissed the signature request.' };
  }
  if (m.includes('insufficient funds') || m.includes('intrinsic transaction cost') || m.includes('out of gas') || m.includes('gas required exceeds')) {
    return { title: 'Not enough ETH for gas', detail: 'Your wallet needs a little more ETH to cover the network fee. Top up ETH and try again.' };
  }
  if (m.includes('insufficient usdc')) {
    return { title: 'Not enough USDC', detail: 'Your USDC balance is lower than the amount you tried to send.' };
  }
  if (m.includes('relayer') || m.includes('503') || m.includes('temporarily unavailable')) {
    return { title: 'Try again shortly', detail: 'The gasless relayer is temporarily unavailable. Please retry in a moment.' };
  }
  if (m.includes('expired')) {
    return { title: 'Request expired', detail: 'This transfer request timed out. Start it again to get a fresh one.' };
  }
  if (m.includes('yourself')) {
    return { title: "Can't send to yourself", detail: 'Pick a different recipient.' };
  }
  if (m.includes('not found') || m.includes('invalid recipient') || m.includes('invalid address')) {
    return { title: 'Recipient not found', detail: 'Check the @username or wallet address and try again.' };
  }
  if (m.includes('execution reverted') || m.includes('revert') || m.includes('call_exception')) {
    return { title: 'Transfer failed on-chain', detail: 'The network rejected the transaction. Nothing was sent — you can try again.' };
  }
  if (m.includes('network') || m.includes('timeout') || m.includes('fetch') || m.includes('econn')) {
    return { title: 'Network problem', detail: 'Could not reach the network. Check your connection and retry.' };
  }
  return { title: "Couldn't send", detail: msg ? msg.slice(0, 140) : 'Something went wrong. Please try again.' };
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/wallet/sendErrors.ts expo-wallet/src/lib/wallet/sendErrors.test.ts
git commit -m "feat(expo): mapSendError friendly error mapper"
```

### Task B3: `useMobileSigner.sendTransaction` (ETH broadcast)

**Files:** Modify `expo-wallet/src/lib/wallet/useMobileSigner.ts`

- [ ] **Step 1: Add a `sendTransaction` method** that broadcasts native ETH via the Privy embedded wallet provider. Inside `useMobileSigner`, alongside `signTypedData`, add:

```ts
  const sendTransaction = async ({ to, valueWei }: { to: string; valueWei: string }): Promise<string> => {
    if (!wallet) throw new Error('No embedded Ethereum wallet available');
    const provider = await wallet.getProvider();
    const valueHex = '0x' + BigInt(valueWei).toString(16);
    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from: wallet.address, to, value: valueHex }],
    });
    return txHash as string;
  };
```

and add `sendTransaction` to the returned object: `return { address, signTypedData, sendTransaction, wallets, ready: !!isReady };`

- [ ] **Step 2: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors. (Verify `provider.request` accepts `eth_sendTransaction` in the installed `@privy-io/expo` provider types; the shape mirrors the existing `eth_signTypedData_v4` call.)

- [ ] **Step 3: Commit**

```bash
git add expo-wallet/src/lib/wallet/useMobileSigner.ts
git commit -m "feat(expo): useMobileSigner.sendTransaction for native ETH"
```

### Task B4: `TransferClient.resolve()` + `recordEth()`

**Files:** Modify `expo-wallet/src/lib/transfer/transferClient.ts`; Test `expo-wallet/src/lib/transfer/transferClient.test.ts` (create if absent)

- [ ] **Step 1: Write a failing test**

```ts
import { TransferClient } from './transferClient';

function fakeFetch(handler: (url: string, init?: RequestInit) => any) {
  return async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => handler(url, init) }) as Response;
}

describe('TransferClient resolve/recordEth', () => {
  it('resolve GETs /transfer/resolve with the recipient', async () => {
    let seenUrl = '';
    const c = new TransferClient('http://x', fakeFetch((u) => { seenUrl = u; return { address: '0xabc', username: 'linh' }; }) as any);
    expect(await c.resolve('@linh')).toEqual({ address: '0xabc', username: 'linh' });
    expect(seenUrl).toContain('/transfer/resolve?recipient=%40linh');
  });
  it('recordEth POSTs the txHash', async () => {
    let seen: any;
    const c = new TransferClient('http://x', fakeFetch((_u, init) => { seen = init; return { id: 'e1', status: 'confirming' }; }) as any);
    expect(await c.recordEth('0xTo', '1000', '0xhash')).toEqual({ id: 'e1', status: 'confirming' });
    expect(seen.method).toBe('POST');
    expect(JSON.parse(seen.body)).toEqual({ to: '0xTo', amountWei: '1000', txHash: '0xhash' });
  });
});
```

- [ ] **Step 2: Run** `cd expo-wallet && pnpm test transferClient.test` → FAIL.

- [ ] **Step 3: Add the two methods** to the `TransferClient` class:

```ts
  resolve(recipient: string) {
    return this.json<{ address: string; username: string | null }>(`/transfer/resolve?recipient=${encodeURIComponent(recipient)}`);
  }
  recordEth(to: string, amountWei: string, txHash: string) {
    return this.json<{ id: string; status: string }>('/transfer/eth/record', { method: 'POST', body: JSON.stringify({ to, amountWei, txHash }) });
  }
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit**

```bash
git add expo-wallet/src/lib/transfer/transferClient.ts expo-wallet/src/lib/transfer/transferClient.test.ts
git commit -m "feat(expo): TransferClient resolve + recordEth"
```

---

## Phase C — Expo UI

### Task C1: Scanner branch (address QR → Send)

**Files:** Modify `expo-wallet/src/lib/pay/useCameraScanner.ts`, `app/(tabs)/scan.tsx`

- [ ] **Step 1: Extend `useCameraScanner`** — add an `onSend` option and branch the decode. In `UseCameraScannerOptions` add `onSend?: (target: { address: string; amountWei?: string }) => void;`. In `handleBarcode`, after the existing `parsePayUrl` try/catch that calls `onOrder`, change the failure path so that instead of immediately calling `onInvalid`, it first tries `parseSendTarget`:

```ts
      // (inside handleBarcode, replacing the current invalid path)
      try {
        const orderId = parsePayUrl(data);
        doneRef.current = true;
        onOrder(orderId);
        return;
      } catch { /* not an invoice — try a send target next */ }
      const target = parseSendTarget(data);
      if (target) { doneRef.current = true; onSend?.(target); return; }
      onInvalid?.(data);
```

Add `import { parseSendTarget } from '@/lib/pay/parseSendTarget';` at the top.

- [ ] **Step 2: Wire the Scan screen** — in `app/(tabs)/scan.tsx`, pass an `onSend` that navigates to the Send screen:

```ts
    onSend: (target) => {
      const q = new URLSearchParams({ to: target.address, ...(target.amountWei ? { amountWei: target.amountWei } : {}) }).toString();
      router.replace(`/send?${q}`);
    },
```

- [ ] **Step 3: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors (the `/send` route is created in C2 — if tsc flags the route string, it's fine; expo-router route strings are plain strings. If `router.replace` is typed against known routes and errors, create `app/send.tsx` first via C2 then return).

- [ ] **Step 4: Commit**

```bash
git add expo-wallet/src/lib/pay/useCameraScanner.ts expo-wallet/app/(tabs)/scan.tsx
git commit -m "feat(expo): scan address QR -> open Send"
```

### Task C2: Send screen

**Files:** Create `expo-wallet/app/send.tsx`

- [ ] **Step 1: Build the Send screen.** Read `app/(tabs)/receive.tsx` and `src/features/assistant/TransferConfirmCard.tsx` first for theme/layout + confirm patterns. Requirements:
  - Route params via `useLocalSearchParams()`: `to` (address or @username), optional `amountWei`, optional `asset`.
  - On mount, call `new TransferClient(getEnv().navyApiUrl, authedFetch!).resolve(to)` → show recipient (`@username · short(address)` or `short(address)`), with a source label. On resolve error, show `mapSendError`.
  - Asset toggle `USDC | ETH` (default from `?asset` or USDC). Amount input. Live balances via `fetchBalances` (`src/lib/wallet/balances.ts`) — USDC shows `usdcBaseToDisplay`, ETH shows `weiToEth`. **MAX**: USDC → full USDC balance; ETH → balance minus a gas reserve (`const GAS_RESERVE_WEI = 300000000000000n;` ≈ 0.0003 ETH).
  - Fee bar: USDC "Gasless · $0.00 (relayed)"; ETH "Network fee paid from your ETH".
  - `SlideToConfirm` → on confirm:
    - USDC: `runTransferFlow(new TransferClient(base, authedFetch!), signTypedData, { recipient: resolvedAddress, amountBase: usdcAmountBase })`.
    - ETH: `const txHash = await sendTransaction({ to: resolvedAddress, valueWei }); await new TransferClient(base, authedFetch!).recordEth(resolvedAddress, valueWei, txHash);`
  - Convert the typed amount to base units: USDC → `Math.round(Number(amount) * 1e6)` as a string (or a safe string parser); ETH → `ethers.parseEther(amount).toString()`.
  - On any failure, show a Failed state using `mapSendError(e)` (title + detail) + a retry.
  - Success → toast + `router.back()`.
  - Guard `!authedFetch`/`!token` with a sign-in prompt.

Keep it structured like the mockup: header, recipient row, toggle, big amount, available+MAX, fee bar, slide-to-confirm. Use `SafeAreaView` + the theme tokens.

- [ ] **Step 2: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add expo-wallet/app/send.tsx
git commit -m "feat(expo): Send screen (USDC gasless + ETH native, MAX, error states)"
```

### Task C3: Home Send quick-action

**Files:** Modify `expo-wallet/app/(tabs)/home.tsx`

- [ ] **Step 1: Add a Send action** to the quick-actions row. The row currently renders `<Action icon="receive" .../> <Action icon="scan" primary/> <Action icon="sprout" .../>`. Add a Send tile navigating to the Send screen (recipient chosen there — open with no `to`, or route to a simple recipient-entry state). Use an existing `IconName` (check `src/ui/Icon.tsx`; e.g. `arrowUpRight`). Insert:

```tsx
          <Action icon="arrowUpRight" label="Send" onPress={() => router.push('/send')} />
```

Place it so the row reads Receive · Send · Pay · Earn (4 tiles) — if 4 tiles crowd the layout, keep Pay primary and let them wrap; verify visually later.

Note: the Send screen must handle **no `to` param** (Step from C2) by showing a recipient input (paste address / type @username) before the amount. If C2 didn't cover the empty-recipient case, add a minimal recipient `TextInput` that calls `resolve()` on submit.

- [ ] **Step 2: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add expo-wallet/app/(tabs)/home.tsx
git commit -m "feat(expo): Send quick-action on Home"
```

### Task C4: Assistant confirm-card ETH branch + error-feedback loop

**Files:** Modify `expo-wallet/src/features/assistant/TransferConfirmCard.tsx`, `app/(tabs)/assistant.tsx`

- [ ] **Step 1: TransferConfirmCard — show asset + amount by asset.** It currently renders USDC via `usdcBaseToDisplay(result.amount)`. Make it asset-aware: if `result.asset === 'ETH'`, show `weiToEth(result.amountWei)` + "ETH" and "network fee paid from your ETH"; else the existing USDC gasless text. The `onConfirm` prop stays (the screen supplies the branching logic). On failure, render the Failed state using `mapSendError` (import it) — title + detail.

- [ ] **Step 2: assistant.tsx — branch `onConfirmTransfer` on asset + add error feedback.** Replace `onConfirmTransfer`:

```ts
  const onConfirmTransfer = useCallback(
    (result: any) => async () => {
      try {
        if (result.asset === 'ETH') {
          const txHash = await sendTransaction({ to: result.to, valueWei: result.amountWei });
          await new TransferClient(getEnv().navyApiUrl, authedFetch!).recordEth(result.to, result.amountWei, txHash);
        } else {
          const sig = await signTypedData(result.typedData);
          await new TransferClient(getEnv().navyApiUrl, authedFetch!).submit(result.transferId, sig);
        }
      } catch (e) {
        const { title, detail } = mapSendError(e);
        // Feed the failure back so the assistant explains it and suggests a fix.
        void send(`The send failed: ${title} — ${detail}. Briefly explain and tell me what to do next.`);
        throw e; // let the card show its Failed state too
      }
    },
    [signTypedData, sendTransaction, authedFetch],
  );
```

where `send(text)` is the screen's existing "send a chat message" function (the one the input box calls). If it's inline, extract it into a `const send = useCallback(async (text: string) => { ... dispatch({type:'send',text}); await streamAgentChat(...) }, [...])` so it can be reused. Import `mapSendError` from `@/lib/wallet/sendErrors` and `sendTransaction` from `useMobileSigner()`.

- [ ] **Step 3: Typecheck**

Run: `cd expo-wallet && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add expo-wallet/src/features/assistant/TransferConfirmCard.tsx expo-wallet/app/(tabs)/assistant.tsx
git commit -m "feat(expo): assistant ETH send confirm + error-feedback loop"
```

---

## Phase D — Verification

### Task D1: Live-Sepolia ETH send + record script

**Files:** Create `be/scripts/eth-send-e2e.mjs`

- [ ] **Step 1: Implement** a standalone script that broadcasts a tiny ETH send from a funded key and asserts confirmation (record endpoint is exercised separately in D2 against the running API):

```js
// be/scripts/eth-send-e2e.mjs  (run: node scripts/eth-send-e2e.mjs)
import 'dotenv/config';
import { ethers } from 'ethers';

const RPC = process.env.SEPOLIA_RPC_URL;
const senderPk = process.env.E2E_SENDER_PK;         // funded plain EOA with a little ETH
const recipient = process.env.E2E_RECIPIENT_ADDR;   // any address
const chainId = Number(process.env.EVM_CHAIN_ID ?? 11155111);

const provider = new ethers.JsonRpcProvider(RPC, chainId);
const sender = new ethers.Wallet(senderPk, provider);
const value = 100000000000000n; // 0.0001 ETH

const before = await provider.getBalance(recipient);
const tx = await sender.sendTransaction({ to: recipient, value });
console.log('submitted', tx.hash);
const receipt = await tx.wait();
const after = await provider.getBalance(recipient);
if (receipt.status !== 1) throw new Error('eth send reverted');
if (after - before !== value) throw new Error(`balance delta ${after - before} != ${value}`);
console.log('OK native ETH send confirmed; recipient +0.0001 ETH; txHash', tx.hash);
```

- [ ] **Step 2: Syntax check**

Run: `cd be && node --check scripts/eth-send-e2e.mjs`
Expected: no output (valid).

- [ ] **Step 3: Commit**

```bash
git add be/scripts/eth-send-e2e.mjs
git commit -m "test(be): live-Sepolia native ETH send proof"
```

### Task D2: Full end-to-end (running backend + free-model assistant)

Requires: backend running with `OPENROUTER_API_KEY` set + Postgres up, a dev user JWT (mint via the same approach used previously), and the test wallet holding a little ETH + USDC.

- [ ] **Step 1: Unit + build gates**

Run: `cd be && pnpm test && pnpm build` (expect all pass) and `cd expo-wallet && pnpm test && pnpm exec tsc --noEmit` (expect all pass).

- [ ] **Step 2: Backend up + assistant ETH proposal**

Start the backend. With a dev JWT, POST `/agent/chat` `{"message":"Send 0.001 ETH to @<devhandle>"}` and assert an SSE `tool_result` with `{"asset":"ETH","to":...,"amountWei":"1000000000000000"}` (no typedData). Then POST the USDC variant `{"message":"Send 1 USDC to @<devhandle>"}` and assert a USDC proposal with `typedData`.

- [ ] **Step 3: ETH record endpoint**

Broadcast an ETH send (via `eth-send-e2e.mjs` or the app), then `POST /transfer/eth/record {to, amountWei, txHash}` with the dev JWT; assert `{status:'confirming'}`, and after ~1 min assert `GET /transfer/history` shows the row flipping to `confirmed` (watcher reconciliation) with `asset:'ETH'`.

- [ ] **Step 4: Scan-to-send + Send UI (device)**

On the EAS dev client: open the Assistant recipient's Receive QR on one device, scan it from another → Send screen opens prefilled → send 0.5 USDC (gasless) and a tiny ETH amount → both appear in history. Force an ETH send with near-zero ETH to confirm the "Not enough ETH for gas" mapped error shows on the card and (for an agent-proposed send) the assistant explains it.

- [ ] **Step 5: Record results** in `be/scripts/gateway-bringup.md` under a "P2P send bring-up" note.

---

## Self-Review notes (addressed)

- **Spec coverage:** `Transfer.asset` ✓ (A1); `/transfer/resolve` ✓ (A2); `/transfer/eth/record` + idempotency ✓ (A3); assistant `asset` param + ETH branch ✓ (A4); `parseSendTarget` raw+EIP-681 ✓ (B1); `mapSendError` all cases ✓ (B2); `sendTransaction` ✓ (B3); client `resolve`/`recordEth` ✓ (B4); scanner branch ✓ (C1); Send screen USDC+ETH+MAX+errors ✓ (C2); Home Send action ✓ (C3); confirm-card ETH + error-feedback loop ✓ (C4); live ETH proof ✓ (D1); full e2e incl. scan + free-model assistant ✓ (D2).
- **Type consistency:** `SendTarget {address, amountWei?}`, `MappedError {title, detail}`, `sendTransaction({to, valueWei})`, `TransferClient.resolve/recordEth`, agent result `{asset:'ETH', to, amountWei, recipient}` vs `{asset:'USDC', transferId, typedData, recipient, amount}` — used consistently across backend handler, confirm card, and screen.
- **Nullable migration:** `submit()` null-guard added in A1 so the USDC path still typechecks after `nonce`/`digest`/`validBefore` become nullable; ETH rows never hit `submit()`.
- **Device/secret-gated:** D2 steps 2-4 need a running backend + OpenRouter key + funded wallet + device — flagged as such (the controller can run them once inputs exist).
```
