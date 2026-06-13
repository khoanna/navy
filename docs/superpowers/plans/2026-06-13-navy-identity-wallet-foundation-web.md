# Navy Identity & Wallet Foundation — Web (Next.js) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js web app for **admin** (email+password+TOTP) and **merchant** (email/password dashboard, API-key issuance, signature-verified payout address) authentication, as a backend-for-frontend over the existing Nest API, holding the Navy JWT in an httpOnly cookie.

**Architecture:** Next.js App Router as a BFF. Browser forms POST credentials to Next **route handlers** (`app/api/**`), which call the Nest backend, then set the Navy access/refresh tokens as **httpOnly cookies** — the token never touches client JS. Protected pages are gated by `middleware.ts` (cookie + decoded role). Merchant payout uses the **Solana wallet adapter** in the browser to sign a server-templated message, forwarded through a route handler to the backend. All non-React logic (API client, session/cookie helpers, payout-message builder) lives in plain-TS modules unit-tested with Jest; pages/handlers are verified by `next build` + manual smoke.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript · `@solana/wallet-adapter-react`/`-react-ui`/`-wallets` · `@solana/web3.js` · `bs58` · Jest + ts-jest (logic only).

**Scope:** This is **Plan 3 of 3** for the foundation (Web auth). Plan 1 = Backend (done). Plan 2 = Mobile auth (done). Implements spec §3.2 (merchant) and §3.3 (admin) of `docs/superpowers/specs/2026-06-13-navy-identity-wallet-foundation-design.md`. Depends on the backend endpoints (already built & tested): `POST /auth/admin`, `POST /auth/merchant`, `POST /auth/merchant/signup`, `POST /merchant/api-keys`, `POST /merchant/payout`.

---

## File Structure

All paths under `/home/khoa/Desktop/uni/fe/`.

```
fe/
├── package.json · tsconfig.json · next.config.ts · jest.config.js
├── .env.example / .env.local        # NAVY_API_URL (server-only)
├── middleware.ts                    # gate /admin/** and /merchant/** on cookie+role
├── src/
│   ├── lib/
│   │   ├── env.ts                   # server config (NAVY_API_URL)
│   │   ├── navyApi.ts               # typed server-side fetch to the Nest backend
│   │   ├── navyApi.test.ts
│   │   ├── session.ts               # cookie names, decodeJwtRole, setSessionCookies helper shape
│   │   ├── session.test.ts
│   │   ├── payoutMessage.ts         # server-templated payout-binding message builder
│   │   └── payoutMessage.test.ts
│   └── app/
│       ├── layout.tsx               # root layout
│       ├── page.tsx                 # redirect to /admin/login or /merchant/login
│       ├── api/
│       │   ├── auth/admin/route.ts          # POST creds -> backend -> set cookies
│       │   ├── auth/merchant/route.ts       # POST login -> set cookies
│       │   ├── auth/merchant/signup/route.ts
│       │   ├── auth/logout/route.ts         # clear cookies
│       │   ├── merchant/api-keys/route.ts   # forward (Bearer from cookie) -> backend
│       │   └── merchant/payout/route.ts     # forward signed payout -> backend
│       ├── admin/
│       │   ├── login/page.tsx
│       │   └── page.tsx             # dashboard (role + logout)
│       └── merchant/
│           ├── login/page.tsx       # login + signup
│           ├── page.tsx             # dashboard (create API key, set payout)
│           └── WalletConnect.tsx    # "use client" wallet-adapter provider + sign payout
└── (next scaffold files)
```

Logic modules in `src/lib/*` import no React/Next runtime, so Jest tests them directly. Route handlers and pages are thin and verified by `next build` typecheck + the Task 12 manual smoke.

---

## Conventions for every task

- Run from `/home/khoa/Desktop/uni/fe`. Package manager **pnpm**.
- Logic tests: `pnpm test <pattern>`. Typecheck/build: `pnpm exec tsc --noEmit` and/or `pnpm build`.
- Commit after each task with the message in its final step. Git identity fallback: `git -c user.name=Navy -c user.email=capydata.xyz@gmail.com commit ...`.
- The backend must be running for the Task 12 manual smoke; unit tests never hit the network.

---

### Task 1: Scaffold Next.js app + Jest

**Files:** Create `fe/` (Next scaffold), `fe/jest.config.js`, `fe/.env.example`, `fe/.env.local`, `.gitignore` (append)

- [ ] **Step 1: Scaffold**

```bash
cd /home/khoa/Desktop/uni
pnpm dlx create-next-app@latest fe --ts --app --src-dir --eslint --no-tailwind --import-alias "@/*" --use-pnpm
cd fe
```

- [ ] **Step 2: Install runtime + test deps**

```bash
pnpm add @solana/web3.js @solana/wallet-adapter-base @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets bs58
pnpm add -D jest ts-jest @types/jest @types/node
```

- [ ] **Step 3: Create `fe/jest.config.js`** (logic-only, node env — does not load Next)

```js
module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }] },
  testMatch: ['<rootDir>/src/lib/**/*.test.ts'],
};
```

- [ ] **Step 4: Create `fe/.env.example` and copy to `.env.local`**

```bash
# .env.example  — server-only; NOT exposed to the browser (no NEXT_PUBLIC_ prefix)
NAVY_API_URL=http://localhost:3000
```

Run: `cp .env.example .env.local`

- [ ] **Step 5: Add `test` script + ensure gitignore**

Run: `npm pkg set scripts.test="jest"`
Ensure `fe/.gitignore` includes `.env*.local` (create-next-app adds it) and `node_modules`.

- [ ] **Step 6: Verify**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
Run: `pnpm exec jest --version`
Expected: prints a version.

> If pnpm blocks native postinstall scripts, add the offending packages to `pnpm.onlyBuiltDependencies` in `package.json` and reinstall (as was done in the backend/mobile apps).

- [ ] **Step 7: Commit**

```bash
cd /home/khoa/Desktop/uni
git add fe
git commit -m "chore(fe): scaffold Next.js App Router, Solana wallet adapter, Jest"
```

---

### Task 2: Server env config

**Files:** Create `fe/src/lib/env.ts`, `fe/src/lib/env.test.ts`

- [ ] **Step 1: Write the failing test** — `fe/src/lib/env.test.ts`

```ts
import { readServerEnv } from './env';

describe('readServerEnv', () => {
  it('returns the Navy API base url', () => {
    expect(readServerEnv({ NAVY_API_URL: 'http://api:3000' })).toEqual({ navyApiUrl: 'http://api:3000' });
  });
  it('throws when NAVY_API_URL is missing', () => {
    expect(() => readServerEnv({})).toThrow(/NAVY_API_URL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test env.test`
Expected: FAIL — cannot find `./env`.

- [ ] **Step 3: Implement `fe/src/lib/env.ts`**

```ts
export interface ServerEnv { navyApiUrl: string; }

export function readServerEnv(src: Record<string, string | undefined>): ServerEnv {
  const navyApiUrl = src.NAVY_API_URL;
  if (!navyApiUrl) throw new Error('Missing required env: NAVY_API_URL');
  return { navyApiUrl };
}

// Runtime accessor (server-side only — process.env is not exposed to the browser bundle).
export function serverEnv(): ServerEnv {
  return readServerEnv(process.env);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test env.test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/env.ts fe/src/lib/env.test.ts
git commit -m "feat(fe): server env config"
```

---

### Task 3: NavyApi client (server-side fetch to backend)

**Files:** Create `fe/src/lib/navyApi.ts`, `fe/src/lib/navyApi.test.ts`

- [ ] **Step 1: Write the failing test** — `fe/src/lib/navyApi.test.ts`

```ts
import { NavyApi, NavyApiError } from './navyApi';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status, json: async () => body,
  }) as unknown as typeof fetch;
}

describe('NavyApi', () => {
  it('adminLogin posts credentials and returns tokens', async () => {
    const f = mockFetch(201, { accessToken: 'a', refreshToken: 'r' });
    const api = new NavyApi('http://api', f);
    const out = await api.adminLogin({ email: 'a@x.com', password: 'pw', totp: '123456' });
    expect(f).toHaveBeenCalledWith('http://api/auth/admin', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@x.com', password: 'pw', totp: '123456' }),
    }));
    expect(out).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('merchantLogin posts credentials and returns tokens', async () => {
    const f = mockFetch(201, { accessToken: 'a', refreshToken: 'r' });
    const api = new NavyApi('http://api', f);
    const out = await api.merchantLogin({ email: 'm@x.com', password: 'pw' });
    expect(f).toHaveBeenCalledWith('http://api/auth/merchant', expect.objectContaining({ method: 'POST' }));
    expect(out).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('merchantSignup posts and returns tokens', async () => {
    const f = mockFetch(201, { accessToken: 'a', refreshToken: 'r' });
    const api = new NavyApi('http://api', f);
    await api.merchantSignup({ email: 'm@x.com', password: 'pw', businessName: 'Acme' });
    expect(f).toHaveBeenCalledWith('http://api/auth/merchant/signup', expect.objectContaining({ method: 'POST' }));
  });

  it('createApiKey sends the bearer token', async () => {
    const f = mockFetch(201, { apiKey: 'navy_pk_x', apiSecret: 'navy_sk_y' });
    const api = new NavyApi('http://api', f);
    const out = await api.createApiKey('navy-jwt');
    expect(f).toHaveBeenCalledWith('http://api/merchant/api-keys', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer navy-jwt' }),
    }));
    expect(out).toEqual({ apiKey: 'navy_pk_x', apiSecret: 'navy_sk_y' });
  });

  it('setPayout forwards address/message/signature with bearer', async () => {
    const f = mockFetch(201, { payoutAddress: 'PK' });
    const api = new NavyApi('http://api', f);
    const out = await api.setPayout('navy-jwt', { address: 'PK', message: 'm', signature: 's' });
    expect(f).toHaveBeenCalledWith('http://api/merchant/payout', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer navy-jwt' }),
      body: JSON.stringify({ address: 'PK', message: 'm', signature: 's' }),
    }));
    expect(out).toEqual({ payoutAddress: 'PK' });
  });

  it('throws NavyApiError with status on a non-2xx response', async () => {
    const api = new NavyApi('http://api', mockFetch(401, { message: 'bad' }));
    await expect(api.adminLogin({ email: 'a', password: 'b', totp: 'c' })).rejects.toMatchObject({ status: 401 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test navyApi`
Expected: FAIL — cannot find `./navyApi`.

- [ ] **Step 3: Implement `fe/src/lib/navyApi.ts`**

```ts
export interface NavyTokens { accessToken: string; refreshToken: string; }
export interface AdminCreds { email: string; password: string; totp: string; }
export interface MerchantCreds { email: string; password: string; }
export interface MerchantSignup { email: string; password: string; businessName: string; }
export interface IssuedApiKey { apiKey: string; apiSecret: string; }
export interface PayoutInput { address: string; message: string; signature: string; }

export class NavyApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'NavyApiError'; }
}

export class NavyApi {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async post<T>(path: string, body: unknown, bearer?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new NavyApiError(`Navy API ${path} failed (HTTP ${res.status})`, res.status);
    return (await res.json()) as T;
  }

  adminLogin(c: AdminCreds): Promise<NavyTokens> { return this.post('/auth/admin', c); }
  merchantLogin(c: MerchantCreds): Promise<NavyTokens> { return this.post('/auth/merchant', c); }
  merchantSignup(c: MerchantSignup): Promise<NavyTokens> { return this.post('/auth/merchant/signup', c); }
  createApiKey(bearer: string): Promise<IssuedApiKey> { return this.post('/merchant/api-keys', {}, bearer); }
  setPayout(bearer: string, p: PayoutInput): Promise<{ payoutAddress: string }> { return this.post('/merchant/payout', p, bearer); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test navyApi`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/navyApi.ts fe/src/lib/navyApi.test.ts
git commit -m "feat(fe): typed NavyApi backend client"
```

---

### Task 4: Session/cookie helpers

**Files:** Create `fe/src/lib/session.ts`, `fe/src/lib/session.test.ts`

- [ ] **Step 1: Write the failing test** — `fe/src/lib/session.test.ts`

```ts
import { ACCESS_COOKIE, REFRESH_COOKIE, decodeJwtRole } from './session';

// Build an unsigned-but-well-formed JWT (header.payload.signature) for payload decoding.
function fakeJwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('session helpers', () => {
  it('exposes stable cookie names', () => {
    expect(ACCESS_COOKIE).toBe('navy_access');
    expect(REFRESH_COOKIE).toBe('navy_refresh');
  });

  it('decodes the role from a Navy JWT payload', () => {
    expect(decodeJwtRole(fakeJwt({ sub: 'm1', role: 'merchant' }))).toBe('merchant');
    expect(decodeJwtRole(fakeJwt({ sub: 'ad1', role: 'admin' }))).toBe('admin');
  });

  it('returns null for a malformed token', () => {
    expect(decodeJwtRole('not-a-jwt')).toBeNull();
    expect(decodeJwtRole('')).toBeNull();
  });

  it('returns null when role claim is absent', () => {
    expect(decodeJwtRole(fakeJwt({ sub: 'x' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test session.test`
Expected: FAIL — cannot find `./session`.

- [ ] **Step 3: Implement `fe/src/lib/session.ts`**

```ts
export const ACCESS_COOKIE = 'navy_access';
export const REFRESH_COOKIE = 'navy_refresh';
export type NavyRole = 'user' | 'merchant' | 'admin';

/**
 * Decode the `role` claim from a Navy JWT WITHOUT verifying the signature.
 * Used only for UX routing in middleware; the backend remains the authority
 * on every protected API call.
 */
export function decodeJwtRole(token: string): NavyRole | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const role = (JSON.parse(json) as { role?: string }).role;
    return role === 'user' || role === 'merchant' || role === 'admin' ? role : null;
  } catch {
    return null;
  }
}
```

> Note: `middleware.ts` runs on the Edge runtime where Node's `Buffer` may be unavailable. The middleware will decode via `atob` there; this module's `Buffer` form is for Node/server-component/test use. Task 8 handles the Edge decode explicitly to avoid relying on `Buffer` in middleware.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test session.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/session.ts fe/src/lib/session.test.ts
git commit -m "feat(fe): session cookie names and JWT role decode"
```

---

### Task 5: Payout-binding message builder

**Files:** Create `fe/src/lib/payoutMessage.ts`, `fe/src/lib/payoutMessage.test.ts`

- [ ] **Step 1: Write the failing test** — `fe/src/lib/payoutMessage.test.ts`

```ts
import { buildPayoutMessage } from './payoutMessage';

describe('buildPayoutMessage', () => {
  it('templates a binding message with merchant id, address, and nonce', () => {
    const msg = buildPayoutMessage({ merchantId: 'm1', address: 'PK', nonce: 'abc', issuedAt: '2026-06-13T00:00:00Z' });
    expect(msg).toContain('Navy payout authorization');
    expect(msg).toContain('merchant: m1');
    expect(msg).toContain('address: PK');
    expect(msg).toContain('nonce: abc');
    expect(msg).toContain('issuedAt: 2026-06-13T00:00:00Z');
  });

  it('is deterministic for the same inputs', () => {
    const args = { merchantId: 'm1', address: 'PK', nonce: 'abc', issuedAt: '2026-06-13T00:00:00Z' };
    expect(buildPayoutMessage(args)).toBe(buildPayoutMessage(args));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test payoutMessage`
Expected: FAIL — cannot find `./payoutMessage`.

- [ ] **Step 3: Implement `fe/src/lib/payoutMessage.ts`**

```ts
export interface PayoutMessageArgs {
  merchantId: string;
  address: string;
  nonce: string;
  issuedAt: string; // ISO 8601
}

/**
 * Server-templated message the merchant signs with their wallet to prove control
 * of the payout address. Including merchantId + nonce + issuedAt makes the binding
 * explicit and is the basis for replay protection once the backend enforces nonces.
 */
export function buildPayoutMessage(a: PayoutMessageArgs): string {
  return [
    'Navy payout authorization',
    `merchant: ${a.merchantId}`,
    `address: ${a.address}`,
    `nonce: ${a.nonce}`,
    `issuedAt: ${a.issuedAt}`,
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test payoutMessage`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add fe/src/lib/payoutMessage.ts fe/src/lib/payoutMessage.test.ts
git commit -m "feat(fe): server-templated payout-binding message builder"
```

---

### Task 6: Auth route handlers (set httpOnly cookies)

**Files:** Create `fe/src/app/api/auth/admin/route.ts`, `fe/src/app/api/auth/merchant/route.ts`, `fe/src/app/api/auth/merchant/signup/route.ts`, `fe/src/app/api/auth/logout/route.ts`

- [ ] **Step 1: Implement `fe/src/app/api/auth/admin/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

export async function POST(req: NextRequest) {
  const { email, password, totp } = await req.json();
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const tokens = await api.adminLogin({ email, password, totp });
    const res = NextResponse.json({ ok: true, role: 'admin' });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res;
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Login failed' }, { status });
  }
}

export function setAuthCookies(res: NextResponse, access: string, refresh: string) {
  const common = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
  res.cookies.set(ACCESS_COOKIE, access, { ...common, maxAge: 60 * 15 });
  res.cookies.set(REFRESH_COOKIE, refresh, { ...common, maxAge: 60 * 60 * 24 * 30 });
}
```

- [ ] **Step 2: Implement `fe/src/app/api/auth/merchant/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { setAuthCookies } from '../admin/route';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const tokens = await api.merchantLogin({ email, password });
    const res = NextResponse.json({ ok: true, role: 'merchant' });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res;
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Login failed' }, { status });
  }
}
```

- [ ] **Step 3: Implement `fe/src/app/api/auth/merchant/signup/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { setAuthCookies } from '../../admin/route';

export async function POST(req: NextRequest) {
  const { email, password, businessName } = await req.json();
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const tokens = await api.merchantSignup({ email, password, businessName });
    const res = NextResponse.json({ ok: true, role: 'merchant' });
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return res;
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Signup failed' }, { status });
  }
}
```

- [ ] **Step 4: Implement `fe/src/app/api/auth/logout/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add fe/src/app/api/auth
git commit -m "feat(fe): auth route handlers set httpOnly Navy cookies"
```

---

### Task 7: Merchant action route handlers (forward with bearer)

**Files:** Create `fe/src/app/api/merchant/api-keys/route.ts`, `fe/src/app/api/merchant/payout/route.ts`

- [ ] **Step 1: Implement `fe/src/app/api/merchant/api-keys/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { ACCESS_COOKIE } from '@/lib/session';

export async function POST() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const issued = await api.createApiKey(token);
    return NextResponse.json({ ok: true, ...issued });
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Could not create API key' }, { status });
  }
}
```

- [ ] **Step 2: Implement `fe/src/app/api/merchant/payout/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { NavyApi, NavyApiError } from '@/lib/navyApi';
import { serverEnv } from '@/lib/env';
import { ACCESS_COOKIE } from '@/lib/session';

export async function POST(req: NextRequest) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
  const { address, message, signature } = await req.json();
  const api = new NavyApi(serverEnv().navyApiUrl);
  try {
    const out = await api.setPayout(token, { address, message, signature });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const status = e instanceof NavyApiError ? e.status : 500;
    return NextResponse.json({ ok: false, error: 'Could not set payout address' }, { status });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add fe/src/app/api/merchant
git commit -m "feat(fe): merchant api-key and payout forwarding handlers"
```

---

### Task 8: Route protection middleware

**Files:** Create `fe/middleware.ts`

- [ ] **Step 1: Implement `fe/middleware.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/session';

// Edge-safe role decode (no Node Buffer): base64url -> JSON -> role.
function roleFromToken(token: string | undefined): 'user' | 'merchant' | 'admin' | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    const role = (JSON.parse(json) as { role?: string }).role;
    return role === 'user' || role === 'merchant' || role === 'admin' ? role : null;
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const role = roleFromToken(req.cookies.get(ACCESS_COOKIE)?.value);

  const needs = (area: 'admin' | 'merchant') => {
    if (role === area) return null;
    const url = req.nextUrl.clone();
    url.pathname = `/${area}/login`;
    return NextResponse.redirect(url);
  };

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (pathname.startsWith('/admin/login')) return NextResponse.next();
    return needs('admin') ?? NextResponse.next();
  }
  if (pathname === '/merchant' || pathname.startsWith('/merchant/')) {
    if (pathname.startsWith('/merchant/login')) return NextResponse.next();
    return needs('merchant') ?? NextResponse.next();
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*', '/merchant/:path*'] };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe/middleware.ts
git commit -m "feat(fe): middleware gating /admin and /merchant on cookie role"
```

---

### Task 9: Root + admin pages

**Files:** Create/replace `fe/src/app/page.tsx`, `fe/src/app/admin/login/page.tsx`, `fe/src/app/admin/page.tsx`

- [ ] **Step 1: Replace `fe/src/app/page.tsx`** (landing → choose area)

```tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Navy Console</h1>
      <p><Link href="/admin/login">Admin sign in</Link></p>
      <p><Link href="/merchant/login">Merchant sign in</Link></p>
    </main>
  );
}
```

- [ ] **Step 2: Implement `fe/src/app/admin/login/page.tsx`** (client form)

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/auth/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, totp }),
    });
    if (res.ok) router.replace('/admin');
    else setError('Invalid credentials or TOTP');
  }

  return (
    <main style={{ padding: 32, maxWidth: 360, fontFamily: 'sans-serif' }}>
      <h1>Admin sign in</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
        <input placeholder="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input placeholder="TOTP code" value={totp} onChange={(e) => setTotp(e.target.value)} />
        <button type="submit">Sign in</button>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Implement `fe/src/app/admin/page.tsx`** (dashboard; server component reads cookie)

```tsx
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, decodeJwtRole } from '@/lib/session';
import LogoutButton from './LogoutButton';

export default async function AdminDashboard() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? '';
  const role = decodeJwtRole(token);
  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <h1>Admin dashboard</h1>
      <p>Signed in as role: <b>{role ?? 'unknown'}</b></p>
      <p>Merchant approval management arrives in the Admin Panel sub-project.</p>
      <LogoutButton />
    </main>
  );
}
```

- [ ] **Step 4: Implement `fe/src/app/admin/LogoutButton.tsx`**

```tsx
'use client';
import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.replace('/admin/login'); }}>
      Sign out
    </button>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add fe/src/app/page.tsx fe/src/app/admin
git commit -m "feat(fe): landing page and admin login + dashboard"
```

---

### Task 10: Merchant login/signup page

**Files:** Create `fe/src/app/merchant/login/page.tsx`

- [ ] **Step 1: Implement `fe/src/app/merchant/login/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MerchantLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const url = mode === 'login' ? '/api/auth/merchant' : '/api/auth/merchant/signup';
    const body = mode === 'login' ? { email, password } : { email, password, businessName };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) router.replace('/merchant');
    else setError(mode === 'login' ? 'Invalid credentials' : 'Signup failed');
  }

  return (
    <main style={{ padding: 32, maxWidth: 360, fontFamily: 'sans-serif' }}>
      <h1>Merchant {mode === 'login' ? 'sign in' : 'sign up'}</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 8 }}>
        <input placeholder="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === 'signup' && (
          <input placeholder="business name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
        )}
        <button type="submit">{mode === 'login' ? 'Sign in' : 'Create account'}</button>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </form>
      <button style={{ marginTop: 12 }} onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add fe/src/app/merchant/login
git commit -m "feat(fe): merchant login and signup page"
```

---

### Task 11: Merchant dashboard — API key + wallet-adapter payout

**Files:** Create `fe/src/app/merchant/page.tsx`, `fe/src/app/merchant/WalletConnect.tsx`

- [ ] **Step 1: Implement `fe/src/app/merchant/WalletConnect.tsx`** (client wallet-adapter provider + payout signer)

```tsx
'use client';
import React, { useMemo, useState, useCallback } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import bs58 from 'bs58';
import '@solana/wallet-adapter-react-ui/styles.css';

function PayoutInner() {
  const { publicKey, signMessage, connected } = useWallet();
  const [status, setStatus] = useState('');

  const setPayout = useCallback(async () => {
    if (!publicKey || !signMessage) { setStatus('Connect a wallet first'); return; }
    setStatus('Requesting signature…');
    try {
      const address = publicKey.toBase58();
      // Server templates the binding message (merchant id from the session cookie).
      const prep = await fetch('/api/merchant/payout/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }),
      }).then((r) => r.json());
      const message: string = prep.message;
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const res = await fetch('/api/merchant/payout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, message, signature }),
      });
      setStatus(res.ok ? `Payout address set: ${address}` : 'Backend rejected the payout binding');
    } catch (e) {
      setStatus(`Failed: ${(e as Error).message}`);
    }
  }, [publicKey, signMessage]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <WalletMultiButton />
      <button onClick={setPayout} disabled={!connected}>Sign & set payout address</button>
      {status && <p>{status}</p>}
    </div>
  );
}

export default function WalletConnect() {
  const endpoint = useMemo(() => clusterApiUrl('devnet'), []);
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <PayoutInner />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

- [ ] **Step 2: Add the payout-prepare route handler** — `fe/src/app/api/merchant/payout/prepare/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, decodeJwtRole } from '@/lib/session';
import { buildPayoutMessage } from '@/lib/payoutMessage';

// Decode merchant id (sub) from the Navy JWT payload (server-side, Node Buffer ok).
function subFromToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try { return (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: string }).sub ?? null; }
  catch { return null; }
}

export async function POST(req: NextRequest) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? '';
  if (decodeJwtRole(token) !== 'merchant') return NextResponse.json({ ok: false }, { status: 401 });
  const merchantId = subFromToken(token);
  if (!merchantId) return NextResponse.json({ ok: false }, { status: 401 });
  const { address } = await req.json();
  // Nonce is random per request; issuedAt stamped server-side. (Full replay protection
  // requires the backend to persist/verify the nonce — tracked as a backend follow-up.)
  const nonce = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const message = buildPayoutMessage({ merchantId, address, nonce, issuedAt });
  return NextResponse.json({ ok: true, message });
}
```

- [ ] **Step 3: Implement `fe/src/app/merchant/page.tsx`** (dashboard)

```tsx
import WalletConnect from './WalletConnect';
import ApiKeyPanel from './ApiKeyPanel';
import LogoutButton from '../admin/LogoutButton';

export default function MerchantDashboard() {
  return (
    <main style={{ padding: 32, maxWidth: 560, fontFamily: 'sans-serif' }}>
      <h1>Merchant dashboard</h1>
      <section style={{ marginTop: 16 }}>
        <h2>API credentials</h2>
        <ApiKeyPanel />
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Payout wallet</h2>
        <p>Connect your Phantom/Solflare wallet and sign to register your payout address.</p>
        <WalletConnect />
      </section>
      <section style={{ marginTop: 24 }}><LogoutButton /></section>
    </main>
  );
}
```

- [ ] **Step 4: Implement `fe/src/app/merchant/ApiKeyPanel.tsx`** (client; create key, show secret once)

```tsx
'use client';
import { useState } from 'react';

export default function ApiKeyPanel() {
  const [issued, setIssued] = useState<{ apiKey: string; apiSecret: string } | null>(null);
  const [error, setError] = useState('');

  async function create() {
    setError('');
    const res = await fetch('/api/merchant/api-keys', { method: 'POST' });
    const body = await res.json();
    if (res.ok) setIssued({ apiKey: body.apiKey, apiSecret: body.apiSecret });
    else setError(body.error ?? 'Failed (is your merchant account approved?)');
  }

  return (
    <div>
      <button onClick={create}>Generate API key</button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {issued && (
        <div style={{ marginTop: 8 }}>
          <p><b>API key:</b> <code>{issued.apiKey}</code></p>
          <p><b>API secret (shown once):</b> <code>{issued.apiSecret}</code></p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Typecheck and build**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.
Run: `pnpm build`
Expected: build succeeds (this compiles the wallet-adapter client components and validates SSR boundaries).

> If `pnpm build` fails on wallet-adapter ESM/SSR (e.g. `window is not defined`), ensure `WalletConnect.tsx` and its consumers are `'use client'` (they are) and that `@solana/wallet-adapter-react-ui/styles.css` import resolves; if a specific adapter pulls a Node polyfill, follow the adapter's Next.js note. Document any `next.config.ts` adjustment (e.g. `transpilePackages`).

- [ ] **Step 6: Commit**

```bash
git add fe/src/app/merchant fe/src/app/api/merchant/payout/prepare
git commit -m "feat(fe): merchant dashboard with API-key issuance and wallet-adapter payout signing"
```

---

### Task 12: Full verification — tests, build, manual smoke

**Files:** none

- [ ] **Step 1: Run the logic unit suite**

Run: `pnpm test`
Expected: all logic specs pass — `env` (2), `navyApi` (6), `session` (4), `payoutMessage` (2) = 14 tests.

- [ ] **Step 2: Typecheck + production build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: no type errors; Next build succeeds.

- [ ] **Step 3: Manual smoke (record results)**

Start the backend: `cd /home/khoa/Desktop/uni/be && docker compose up -d && pnpm start`.
Seed an admin row (the backend has no admin-signup endpoint by design): in `be`, run a one-off Prisma script or `psql` to insert an `Admin` with a known email, an Argon2 password hash, and a TOTP secret (use the same `otplib` `authenticator.generateSecret()` + an authenticator app). Record the secret.
Start the web app: `cd /home/khoa/Desktop/uni/fe && pnpm dev`.
Verify:
1. `/merchant/login` → sign up a merchant → redirected to `/merchant`. Unauthenticated access to `/merchant` (incognito) redirects to `/merchant/login`.
2. On `/merchant`, "Generate API key" → if the merchant is unapproved it shows the approval error (expected — approval is admin-gated). Approve via DB (`UPDATE "Merchant" SET "approvalStatus"='approved'`), retry → an `apiKey`/`apiSecret` pair shows once.
3. Connect Phantom/Solflare (devnet) → "Sign & set payout address" → wallet prompts to sign the templated message → backend accepts → address shown. Confirm the `Merchant.payoutAddress` row updated.
4. `/admin/login` → sign in with the seeded admin email/password/TOTP → `/admin` shows role `admin`. A bad TOTP is rejected; repeated failures lock the account (backend behavior).
5. "Sign out" on either dashboard clears cookies and returns to the login page.

Record outcomes in the commit/PR notes. This manual smoke is the integration test across the Next BFF ↔ backend ↔ wallet boundaries that unit tests mock.

- [ ] **Step 4: Commit any config changes**

```bash
git add -A fe
git commit -m "chore(fe): config adjustments from web auth smoke test" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (spec §→ task):**
- §3.2 merchant ZaloPay model — dashboard login + signup → Tasks 6, 10; API-key issuance → Tasks 3/7/11; signature-verified payout address (server-templated message + wallet-adapter signing) → Tasks 5, 11. Merchant approval is enforced by the backend (Plan 1 fix C1); the UI surfaces the approval error (Task 11 `ApiKeyPanel`).
- §3.3 admin password+TOTP → Tasks 6, 9; lockout is backend behavior, surfaced as a login error.
- Unified Navy JWT held as httpOnly cookie; role-based routing → Tasks 4 (decode), 6 (set), 8 (middleware).
- Networks devnet → Task 11 (`clusterApiUrl('devnet')`), Task 12 (backend on devnet).

**Placeholder scan:** No TBD/TODO-as-implementation. Logic modules (Tasks 2–5) ship complete code + real Jest tests (14 tests). Route handlers and pages ship complete code; verified by `tsc`/`next build` + the enumerated manual smoke (Next route handlers and wallet-adapter UI can't be meaningfully unit-tested). The wallet-adapter SSR risk is flagged with a concrete fallback (Task 11 Step 5).

**Type consistency:** `NavyTokens`/`AdminCreds`/`MerchantCreds`/`IssuedApiKey`/`PayoutInput` (Task 3) consumed by route handlers (Tasks 6, 7). `ACCESS_COOKIE`/`REFRESH_COOKIE`/`decodeJwtRole` (Task 4) used by handlers (6), middleware (8 — Edge re-implements decode intentionally, same role values), and dashboards (9, 11). `setAuthCookies` (Task 6 admin route) reused by merchant/signup routes. `buildPayoutMessage` args (Task 5) match the `payout/prepare` handler call (Task 11). `serverEnv()`/`readServerEnv` (Task 2) used by every handler. Consistent.

**Known follow-ups (recorded):** backend nonce persistence/verification for true payout-replay protection (the web already sends a nonce + server-templated message — backend enforcement is the remaining half); access-token refresh via the stored `navy_refresh` cookie on 401 (mirrors the backend's deferred refresh endpoint); admin account creation/seed UI (admins are seeded out-of-band by design).
