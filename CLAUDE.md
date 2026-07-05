# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Navy** — a Solana (devnet) payment ecosystem: a payment gateway + wallets. It is built as **four independent apps** in one repo (NOT a pnpm/Nx workspace — each has its own `package.json`, run `pnpm` inside each):

| Dir | Stack | Role |
|---|---|---|
| `be/` | Nest.js 11 + Prisma 7 (Postgres) | Backend API: auth, payments gateway, admin, farming agent, on-chain relayer |
| `fe/` | Next.js 16 (App Router) + React 19 | Web for **admin** + **merchant** (no end-user wallet) |
| `web-wallet/` | Next.js 16 (App Router) + `@privy-io/react-auth` | End-user wallet — mobile-first **web** app (balances, scan-to-pay, farming; phone-column layout) |
| `onchain/` | Anchor 0.32 + Solana CLI 4.0 (Agave) | `navy_payments` Anchor program |

**Development is spec-driven.** Every feature was designed → planned → built via `docs/superpowers/specs/*-design.md` and `docs/superpowers/plans/*.md`. Read the relevant spec/plan before changing a subsystem — they capture the *why* and the locked decisions. `docs/` is the source of truth for intent.

## Commands

Run inside the relevant app dir.

```bash
# be/  (Postgres must be up: docker compose up -d)
pnpm test                         # all unit tests (jest)
pnpm test <pattern>               # e.g. pnpm test signing.service
pnpm test:e2e                     # e2e (jest --config ./test/jest-e2e.js); needs the DB
pnpm build                        # nest build (also typechecks)
pnpm start                        # boot the API (loads .env via dotenv; PORT 3000)
pnpm prisma migrate dev --name X  # after schema.prisma changes (regenerates the client)

# fe/
pnpm test <pattern>               # jest — ONLY runs src/lib/**/*.test.ts (pure logic)
pnpm exec tsc --noEmit            # typecheck (the gate for pages/route handlers)
pnpm build                        # next build
pnpm dev

# web-wallet/  (needs be up + WEB_WALLET_ORIGIN set; web origin whitelisted in Privy dashboard)
pnpm test <pattern>               # jest — ONLY runs src/lib/**/*.test.ts (ported plain-TS logic)
pnpm exec tsc --noEmit            # typecheck gate for screens/components
pnpm build                        # next build — the runtime gate (catches browser polyfill/resolution issues tsc misses)
pnpm dev -p 3001                  # runs on 3001 (be is 3000, fe is 3000-range); matches WEB_WALLET_ORIGIN

# onchain/
anchor build                      # SLOW (Rust + BPF); also regenerates target/idl + target/types
anchor test                       # boots a local validator, runs tests/**/*.ts (ts-mocha)
```

**Single test:** pass a filename fragment to `pnpm test` (Jest) or run one Anchor spec via `anchor test` after a build. Most logic is unit-tested; **UI screens and the Save SDK / chain calls are NOT unit-testable** — they are verified by `tsc`/`build` + gated integration tests (`NAVY_E2E=1`, `NAVY_FARM_E2E=1`) that need a live validator.

## Architecture (the parts that span files)

**Auth — one unified Navy JWT, three front doors.** `be/src/auth` issues a single role-bearing JWT (`{sub, role: user|merchant|admin, walletAddress}`). End-user wallet users authenticate via Privy (`/auth/privy`), merchants via email+password, admins via password+TOTP. `JwtGuard + RolesGuard + @Roles(...)` gate everything. The fe proxies the backend using the session cookie as Bearer (`fe/src/lib/session-backend.ts`).

**Payments are EIP-712-style invoices on Solana.** The `navy_payments` Anchor program (`onchain/programs/navy-payments`) has `Config`/`Merchant`/lazy-`Invoice` PDAs; `pay_invoice` does an SPL `transfer_checked` split (merchant payout + 1% fee to treasury), the Invoice PDA is a **pay-once replay nonce**, and it's **gasless two-signer** (the user authorizes, a Navy **relayer** is fee payer and submits). The gateway (`be/src/payments`) is a BFF: it **builds the tx server-side**, the wallet adds the user signature, and the relayer only ever co-signs the *identical* tx it issued (security-critical — see `RelayerService`). The pay endpoints (`GET /v1/orders/:id/payment-tx`, `POST /:id/submit`) **require the Navy user JWT** — the payer is derived from the token, not a query param. The issued tx is a **durable single-use nonce** on the order row; `ChainWatcherService` settles an order to `paid` (and fires the HMAC webhook) **only after** confirming the on-chain `InvoicePaid` event, reconciling amount/fee/payer from it. Auth adds refresh-rotation + logout + session revocation (the JWT carries `sid`; `JwtGuard` rejects revoked `AuthSession`s).

**The farming subwallet security model (most sensitive code).** Users farm via a **Navy-generated subwallet** whose private key is **AES-256-GCM envelope-encrypted** (`be/src/crypto`, `Cipher` interface, master key from env — KMS is the mainnet gate). Keys are *never* held by the agent: every subwallet tx goes through the isolated `SigningService` (`be/src/wallet/signing.service.ts`) which decrypts transiently → runs the `PolicyValidator` → signs → wipes. The policy is **authoritative**: `deriveTxSummary` decodes program IDs + transfer destinations from the *actual tx* (never trusts the caller) and checks them against per-subwallet allowlists. The farming agent (`be/src/farming`) targets **Save (Solend)'s devnet SOL reserve** behind a `YieldAdapter` (Kamino is the documented mainnet swap). Read `docs/superpowers/specs/2026-06-16-navy-farming-agent-design.md` before touching this.

## Critical conventions & gotchas

- **Devnet only.** USDC = Circle devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Farming uses **native SOL** on devnet (no devnet DeFi pool uses Circle USDC). Mainnet work (audit, KMS, real-protocol adapters) is deferred everywhere it appears in specs.
- **SDK drift is real — verify before coding.** `fe/AGENTS.md` warns that Next has breaking changes vs training data; consult the installed `node_modules` types / versioned docs. This applies to `web-wallet/` too — verify `@privy-io/react-auth` (v2) and `@zxing/library` APIs against the installed `.d.ts`, not memory. Known pins/workarounds already in place: **otplib v12** (v13 dropped `authenticator`), **Prisma 7 driver adapter** via `be/prisma.config.ts` + `PrismaPg`, **jest `moduleNameMapper`** for ESM-only `uuid` (and `rpc-websockets` in `be/`) so `@solana/web3.js`/spl-token load under ts-jest. Privy web signing is `useSignTransaction().signTransaction({transaction, connection, address}) → SupportedSolanaTransaction` (sign-only — the relayer pays gas).
- **`web-wallet/`: verify by building, not just `tsc`.** `pnpm build` (`next build`) is the runtime gate — `tsc --noEmit` passes clean but does NOT catch browser bundle issues (`@solana/web3.js` Buffer/crypto resolution). If a loaded page throws a `Buffer`/`crypto` error, add a polyfill (webpack `resolve.fallback` in `next.config.ts` or a client `globalThis.Buffer ??= Buffer`). As of the initial port none is needed. Runs on port 3001 (matches `WEB_WALLET_ORIGIN`); a live login also needs the web origin whitelisted in the Privy dashboard.
- **`web-wallet/` auth & wallet lifecycle.** Route gating: root `/` redirects by session; `src/app/(tabs)/layout.tsx` is a client auth-guard that renders `<Splash>` until Privy `ready` **and** `useNavySession().initializing` settle, then redirects to `/login` when there's no `session`; `/login` bounces already-authenticated users to `/home` (also catches the OAuth full-page-redirect return). The embedded Solana wallet is **provisioned on demand** in `src/lib/wallet/useWebSigner.ts` (`createWallet()` once `ready && authenticated && !embedded`) — `embeddedWallets.solana.createOnLogin` misses users who authenticated before that config, and without the fallback `address` stays `undefined` and the hero is stuck on "provisioning…".
- **`web-wallet/` Privy v2.25.0 account hooks (Settings = 5th tab, `src/app/(tabs)/settings`).** Link/unlink/recovery/MFA use `useLinkAccount` / `useLinkWithPasskey` / `useSetWalletRecovery` / `useMfaEnrollment` + `usePrivy().unlink*` from the **main** entry, but **`useExportWallet` is imported from `@privy-io/react-auth/solana`** (the same subpath as `useSolanaWallets` / `useSignTransaction`), not the root — a real drift trap. Most of these open Privy-hosted modals, so the flows only complete when the feature is enabled in the Privy dashboard. Linked-account → display-row mapping is in the tested plain-TS `src/lib/account/linkedAccounts.ts`.
- **`web-wallet/` UI language.** New screens follow the restrained list style of `history`/`receive`: monochrome `colors.textDim` icon badges (via `IconBadge`), small `caption`+`dim` section eyebrows, `Card glass compact` lists, and colour reserved for interactive/semantic states (active tab, `danger` actions) — not decoration. Shared identity helpers (`short`, `avatarColors`) live in `src/lib/wallet/identicon.ts`.
- **Toolchain:** Anchor 0.32 + current Solana crates require **Rust 1.85+** (platform-tools v1.53 via `agave-install update`; the active Solana CLI is 4.0.1).
- **Keep non-UI logic in plain-TS modules** (no Next / framework imports) so it's unit-testable; screens/handlers stay thin and are typecheck-verified. This pattern is used throughout `fe/src/lib`, `web-wallet/src/lib`, `be/src/**`.
- **pnpm 10 blocks native postinstall scripts.** When adding a dep with a native build (argon2, bufferutil, blake-hash, tiny-secp256k1, prisma, `@solana/*`), add it to `pnpm.onlyBuiltDependencies` in that app's `package.json` and reinstall — otherwise it installs unbuilt and breaks at runtime/build. (Already configured in all four apps.)
- **Money is `BigInt` in Prisma; serialize to string before returning it from Nest.** Controllers/services must map `amount`/`*Lamports` → `.toString()` (JSON can't encode BigInt). Returning a raw Prisma row with a BigInt column throws at response time.
- **Stale Prisma client:** if `pnpm build` errors on a model/field that IS in `schema.prisma`, run `pnpm prisma generate` (migrate usually does this, but the client can lag after manual edits). A clean `rm -rf node_modules && CI=true pnpm install` also resets the generated client — re-run `prisma generate` after.
- **Prisma 7 CLI needs `DATABASE_URL` in the shell env.** `be/prisma.config.ts` resolves `env('DATABASE_URL')` but loads **no** dotenv, so `pnpm prisma migrate/generate` fails with `Cannot resolve environment variable: DATABASE_URL`. Prefix it: `DATABASE_URL=... pnpm prisma migrate deploy`. (`pnpm start` is unaffected — the app loads `.env` via `dotenv/config`.)
- **`@solana/web3.js` is pinned to one version via `be/package.json` `pnpm.overrides` (`1.98.4`) — do not remove it.** The Save/Solend SDK → `jito-ts` pulls an ancient web3.js@1.77.4 (wants `rpc-websockets` v7's `dist/lib/client`) that collides with v9 and crashes boot (`ERR_PACKAGE_PATH_NOT_EXPORTED` / `Cannot find module 'rpc-websockets/dist/lib/client'`). After changing it, `rm -rf node_modules && CI=true pnpm install` to prune stale peer variants.
- **The Anchor IDL is a runtime asset.** `be/nest-cli.json` `compilerOptions.assets` copies `src/onchain/*.json` into `dist/src`; without it `node dist`/`nest start` crashes on `Cannot find module './navy_payments.json'`. After `anchor build`, re-copy the IDL from `onchain/target/idl` into `be/src/onchain/` if it drifted.
- The `bigint-buffer` native-binding `console.warn` in be/web-wallet test runs is harmless noise from `@solana/spl-token` (it falls back to pure JS) — ignore it.
- **Git:** the feature stack (`feat/identity-wallet-*` → … → `feat/farming-agent`) plus a **production-hardening pass are now merged to `master`** (2026-07-04). The `navy_payments` program was **upgraded in place on devnet** and smoke-verified. New work: branch off `master`. Runbook: `be/scripts/gateway-bringup.md`; production gates + accepted risks: `docs/PRODUCTION.md`.
- **Env:** each app needs its `.env`/`.env.local`/`app.json extra` populated (Privy app/client IDs, `NAVY_*` secrets incl. relayer + subwallet master key + farming bounds, Solana RPC). `be` loads `.env` via `dotenv/config`.
- **Pay links are HTTPS web URLs** (`https://<web-wallet-origin>/pay/<id>`), set via `NAVY_PAY_BASE_URL`. The old `navy://` native deep-link scheme was removed when the wallet moved to web — scanning a QR opens the browser wallet.
- **On-chain upgrade-in-place:** `anchor build` → if the `.so` grew, `solana program extend <id> <bytes>` **first** (else deploy fails `ExtendProgram requires a minimum of 10240 additional bytes`) → `solana program deploy --program-id <id> … --url devnet` → re-copy IDL to `be/src/onchain/` → rewire backend PDA seeds if the account layout changed. Keep the prior `.so` (`solana program dump`) for rollback.
- **Merchant onboarding order is enforced:** signup → **request payout challenge** (`POST /merchant/payout/challenge`) → set payout (`POST /merchant/payout`, wallet-signs the single-use challenge) → admin approve (`POST /admin/merchants/:id/approve`, registers the merchant on-chain; the on-chain **Merchant PDA is seeded by a stable `merchant_id` derived from the DB uuid**, not the payout wallet) → create API key. Payout must exist *before* approval; API keys require approval.
