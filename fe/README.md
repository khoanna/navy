# fe — Navy admin + merchant web

Next.js 16 (App Router) + React 19. This app serves **admins** and **merchants** only; the end-user wallet is
[`expo-wallet/`](../expo-wallet). See [`AGENTS.md`](AGENTS.md) for SDK-drift traps and the proxy pattern, and the
root [`CLAUDE.md`](../CLAUDE.md) for cross-app architecture.

## Run

```bash
pnpm install
pnpm dev            # http://localhost:3001  (3000 belongs to be/)
```

Requires the backend running on `:3000`. Copy `.env.example` to `.env.local`:

| Var | Purpose |
|---|---|
| `NAVY_API_URL` | Backend base URL the **server-side** proxy calls (`http://localhost:3000`) |
| `NEXT_PUBLIC_WEB_WALLET_ORIGIN` | Origin allowed to embed / call the pay flow |

Read config through `src/lib/env.ts` (`serverEnv()`), never `process.env` directly.

## Verify

```bash
pnpm exec tsc --noEmit   # THE gate for pages, layouts, and route handlers
pnpm build               # next build
pnpm test                # jest — testMatch is ONLY src/lib/**/*.test.ts
pnpm lint
```

`pnpm test` silently ignores any test outside `src/lib/`, so testable logic must live there as plain TS
(no `next/*`, no React). That is why `money.ts`, `invoice-totals.ts`, `origin-guard.ts`,
`mapError.ts`, and `session.ts` are decorator-free modules with sibling `.test.ts` files.

## Layout

```
src/app/       App Router: admin/, merchant/, api/ (the BFF proxy routes)
src/lib/       plain-TS logic + the backend proxy helpers
src/ui/        design tokens + shared presentational components
src/components/
middleware.ts  role-gated redirects
```

## How it talks to the backend

The browser never holds the Navy JWT. `src/lib/session-backend.ts` reads the access-token cookie **server-side**
and forwards it as `Authorization: Bearer …`:

- `sessionBackendFetch(path, init)` — JSON; forces `Content-Type: application/json`.
- `sessionBackendFetchRaw(path, init)` — **no** forced content type; required for forwarding
  `multipart/form-data` (product images), otherwise the boundary header is clobbered.

⚠️ `middleware.ts` decodes the `role`/`exp` claims **without verifying the signature**. It is a redirect
convenience only — the real authorization is the backend's `JwtGuard` / `RolesGuard`. Never treat it as a
security boundary.

## Merchant onboarding order (enforced by the backend)

signup → payout challenge → set payout (wallet-signed via the injected wallet,
`src/app/merchant/WalletConnect.tsx`) → admin approval → API key.
Payout must exist *before* approval; API keys require approval.
