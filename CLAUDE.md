# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Navy** — a Solana (devnet) payment ecosystem: a payment gateway + wallets. It is built as **four independent apps** in one repo (NOT a pnpm/Nx workspace — each has its own `package.json`, run `pnpm` inside each):

| Dir | Stack | Role |
|---|---|---|
| `be/` | Nest.js 11 + Prisma 7 (Postgres) | Backend API: auth, payments gateway, admin, farming agent, on-chain relayer |
| `fe/` | Next.js 16 (App Router) + React 19 | Web for **admin** + **merchant** (no end-user wallet) |
| `mobile/` | Expo SDK 56 + `@privy-io/expo` | End-user wallet (balances, scan-to-pay, farming) |
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

# mobile/
pnpm test <pattern>               # jest "unit" project = src/**/*.test.ts (ts-jest/node)
pnpm exec tsc --noEmit            # gate for screens
pnpm exec expo start

# onchain/
anchor build                      # SLOW (Rust + BPF); also regenerates target/idl + target/types
anchor test                       # boots a local validator, runs tests/**/*.ts (ts-mocha)
```

**Single test:** pass a filename fragment to `pnpm test` (Jest) or run one Anchor spec via `anchor test` after a build. Most logic is unit-tested; **UI screens and the Save SDK / chain calls are NOT unit-testable** — they are verified by `tsc`/`build` + gated integration tests (`NAVY_E2E=1`, `NAVY_FARM_E2E=1`) that need a live validator.

## Architecture (the parts that span files)

**Auth — one unified Navy JWT, three front doors.** `be/src/auth` issues a single role-bearing JWT (`{sub, role: user|merchant|admin, walletAddress}`). Mobile users authenticate via Privy (`/auth/privy`), merchants via email+password, admins via password+TOTP. `JwtGuard + RolesGuard + @Roles(...)` gate everything. The fe proxies the backend using the session cookie as Bearer (`fe/src/lib/session-backend.ts`).

**Payments are EIP-712-style invoices on Solana.** The `navy_payments` Anchor program (`onchain/programs/navy-payments`) has `Config`/`Merchant`/lazy-`Invoice` PDAs; `pay_invoice` does an SPL `transfer_checked` split (merchant payout + 1% fee to treasury), the Invoice PDA is a **pay-once replay nonce**, and it's **gasless two-signer** (the user authorizes, a Navy **relayer** is fee payer and submits). The gateway (`be/src/payments`) is a BFF: it **builds the tx server-side**, the wallet adds the user signature, and the relayer only ever co-signs the *identical* tx it issued (security-critical — see `RelayerService`). A `ChainWatcherService` confirms `InvoicePaid` and fires HMAC webhooks.

**The farming subwallet security model (most sensitive code).** Users farm via a **Navy-generated subwallet** whose private key is **AES-256-GCM envelope-encrypted** (`be/src/crypto`, `Cipher` interface, master key from env — KMS is the mainnet gate). Keys are *never* held by the agent: every subwallet tx goes through the isolated `SigningService` (`be/src/wallet/signing.service.ts`) which decrypts transiently → runs the `PolicyValidator` → signs → wipes. The policy is **authoritative**: `deriveTxSummary` decodes program IDs + transfer destinations from the *actual tx* (never trusts the caller) and checks them against per-subwallet allowlists. The farming agent (`be/src/farming`) targets **Save (Solend)'s devnet SOL reserve** behind a `YieldAdapter` (Kamino is the documented mainnet swap). Read `docs/superpowers/specs/2026-06-16-navy-farming-agent-design.md` before touching this.

## Critical conventions & gotchas

- **Devnet only.** USDC = Circle devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Farming uses **native SOL** on devnet (no devnet DeFi pool uses Circle USDC). Mainnet work (audit, KMS, real-protocol adapters) is deferred everywhere it appears in specs.
- **SDK drift is real — verify before coding.** `fe/AGENTS.md` and `mobile/AGENTS.md` warn that Next/Expo have breaking changes vs training data; consult the installed `node_modules` types / versioned docs. Known pins/workarounds already in place: **otplib v12** (v13 dropped `authenticator`), **Prisma 7 driver adapter** via `be/prisma.config.ts` + `PrismaPg`, **jest `moduleNameMapper`** for ESM-only `uuid` (and `rpc-websockets` in `be/`) so `@solana/web3.js`/spl-token load under ts-jest. Privy Expo signing is `provider.signTransaction({transaction: Uint8Array}) → {signedTransaction}` (sign-only — NOT `signAndSend`; the relayer pays gas).
- **Toolchain:** Anchor 0.32 + current Solana crates require **Rust 1.85+** (platform-tools v1.53 via `agave-install update`; the active Solana CLI is 4.0.1).
- **Keep non-UI logic in plain-TS modules** (no React Native / Next imports) so it's unit-testable; screens/handlers stay thin and are typecheck-verified. This pattern is used throughout `fe/src/lib`, `mobile/src`, `be/src/**`.
- **pnpm 10 blocks native postinstall scripts.** When adding a dep with a native build (argon2, bufferutil, blake-hash, tiny-secp256k1, prisma, `@solana/*`), add it to `pnpm.onlyBuiltDependencies` in that app's `package.json` and reinstall — otherwise it installs unbuilt and breaks at runtime/build. (Already configured in all four apps.)
- **Money is `BigInt` in Prisma; serialize to string before returning it from Nest.** Controllers/services must map `amount`/`*Lamports` → `.toString()` (JSON can't encode BigInt). Returning a raw Prisma row with a BigInt column throws at response time.
- **Stale Prisma client:** if `pnpm build` errors on a model/field that IS in `schema.prisma`, run `pnpm prisma generate` (migrate usually does this, but the client can lag after manual edits).
- The `bigint-buffer` native-binding `console.warn` in be/mobile test runs is harmless noise from `@solana/spl-token` (it falls back to pure JS) — ignore it.
- **Git:** work lives on **stacked unmerged feature branches** (`feat/identity-wallet-*` → `feat/payments-program` → `feat/payment-gateway` → `feat/admin-panel` → `feat/merchant-panel` → `feat/mobile-wallet` → `feat/farming-agent`), not yet on `master`. Integration/devnet smokes are deferred to a consolidated pass (per the project owner). Runbook: `be/scripts/gateway-bringup.md`.
- **Env:** each app needs its `.env`/`.env.local`/`app.json extra` populated (Privy app/client IDs, `NAVY_*` secrets incl. relayer + subwallet master key + farming bounds, Solana RPC). `be` loads `.env` via `dotenv/config`.
