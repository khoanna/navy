# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Navy** — an **Ethereum Sepolia (EVM)** payment ecosystem: a payment gateway + wallets. It is built as **four independent apps** in one repo (NOT a pnpm/Nx workspace — each has its own `package.json`, run `pnpm` inside each; `contract/` uses Foundry):

| Dir | Stack | Role |
|---|---|---|
| `be/` | Nest.js 11 + Prisma 7 (Postgres) + ethers v6 | Backend API: auth, payments gateway, admin, farming agent, on-chain relayer |
| `fe/` | Next.js 16 (App Router) + React 19 | Web for **admin** + **merchant** (no end-user wallet) |
| `expo-wallet/` | Expo / React Native + `@privy-io/expo` | End-user mobile wallet — the **payer** (balances, scan-to-pay, farming) |
| `contract/` | Foundry (Solidity 0.8.24) | `NavyPayments.sol` — deployed to Sepolia |

**Development is spec-driven.** Every feature was designed → planned → built via `docs/superpowers/specs/*-design.md` and `docs/superpowers/plans/*.md`. Read the relevant spec/plan before changing a subsystem — they capture the *why* and the locked decisions. `docs/` is the source of truth for intent. The Solana→EVM migration is `docs/superpowers/specs/2026-07-17-navy-evm-migration-design.md` (+ the three `2026-07-17-navy-evm-*` plans).

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

# expo-wallet/
pnpm test <pattern>               # jest — plain-TS logic in src/lib/**
pnpm exec tsc --noEmit            # typecheck gate for screens/components
pnpm start                        # expo start (also android / ios / web)

# contract/  (Foundry; needs SEPOLIA_RPC_URL for fork/deploy)
forge build                       # compile; writes ABI to out/NavyPayments.sol/NavyPayments.json
forge test                        # unit + fuzz/invariant + Sepolia-fork tests
forge script script/Deploy.s.sol  # deploy/admin (use --slow against 7702-delegated accounts)
```

**Single test:** pass a filename fragment to `pnpm test` (Jest) or a `--match-test`/`--match-contract` filter to `forge test`. Most logic is unit-tested; **UI screens and Privy / chain calls are NOT unit-testable** — verify them via `tsc`/`build` + gated integration tests (`NAVY_E2E=1`, `NAVY_FARM_E2E=1`) that need a deployed contract + live Sepolia relayer. `be/scripts/evm-e2e.mjs` (payment) and `be/scripts/farming-e2e.mjs` (Compound supply→position→withdraw) are the standalone live-Sepolia proofs — run them against a deployed contract + funded relayer/owner.

## Architecture (the parts that span files)

**Auth — one unified Navy JWT, three front doors.** `be/src/auth` issues a single role-bearing JWT (`{sub, role: user|merchant|admin, walletAddress}`). End-user wallet users authenticate via Privy (`/auth/privy`), merchants via email+password, admins via password+TOTP. `JwtGuard + RolesGuard + @Roles(...)` gate everything. The fe proxies the backend using the session cookie as Bearer (`fe/src/lib/session-backend.ts`). Auth adds refresh-rotation + logout + session revocation (the JWT carries `sid`; `JwtGuard` rejects revoked `AuthSession`s).

**Payments are EIP-712 gasless invoices on Sepolia.** `contract/src/NavyPayments.sol` holds `owner`/`treasury`/`feeBps`, a `relayers[]` allowlist, `merchants[bytes16]`, and `invoicePaid[bytes32]`. The user signs USDC's EIP-712 `ReceiveWithAuthorization` (Circle USDC natively implements **EIP-3009**); the backend **relayer** submits `payInvoice(...)` and pays gas. `payInvoice` pulls the amount via `usdc.receiveWithAuthorization`, splits **99% to merchant payout + 1% fee to treasury**, and emits `InvoicePaid`. It is **pay-once**: the key is `keccak256(abi.encodePacked(merchantId, invoiceId))`, used both as the `invoicePaid` guard **and** as the EIP-3009 `nonce` — so a wrong merchant/invoice/amount/payer/expiry makes USDC's own EIP-712 verification revert (full binding despite USDC's minimal struct). The gateway (`be/src/payments`, on-chain layer in `be/src/evm`) is a BFF: `GET /v1/orders/:id/payment-authorization` returns the typed data + persists its EIP-712 digest as the order's **durable single-use nonce**; `POST /v1/orders/:id/submit` `{signature}` recovers the signer, asserts `signer == req.user.walletAddress`, CAS-consumes the nonce, and relays `payInvoice`. Both **require the Navy user JWT** — the payer is derived from the token, not a param. `ChainWatcherService` decodes the on-chain **`InvoicePaid`** receipt log, reconciles amount/fee/payer, settles the order to `paid`, then fires the HMAC webhook. The `NAVY_EVM` provider (`be/src/evm/evm.module.ts`) wires an ethers `JsonRpcProvider` + relayer/owner `ethers.Wallet`s + the `payments` contract; the ABI is `be/src/evm/navy-payments-abi.json`.

**The farming subwallet security model (most sensitive code).** Users farm via a **Navy-generated subwallet** — an `ethers.Wallet` secp256k1 key that is **AES-256-GCM envelope-encrypted** (`be/src/crypto`, `Cipher` interface, master key from env — KMS is the mainnet gate). Keys are *never* held by the agent: every subwallet tx goes through the isolated `SigningService` (`be/src/wallet/signing.service.ts`) which decrypts transiently → runs the `PolicyValidator` → signs+sends → wipes the key in `finally`. The policy is **deny-by-default and authoritative**: `deriveTxSummary` (`be/src/wallet/tx-summary.ts`) decodes the *actual* calldata (ERC-20 `approve`/`transfer`, Compound Comet `supply`/`withdraw`/`withdrawTo`, native transfer; unknown selector → rejected) and checks contract targets + destinations (and that the supplied/withdrawn `asset` is the USDC) against per-subwallet allowlists. The farming agent (`be/src/farming`) supplies to **Compound III (Comet) on Sepolia** behind a `YieldAdapter` (`CompoundYieldAdapter`: `approve`→`supply`, `withdrawTo` straight to the owner wallet). **The subwallet is `msg.sender`** (Comet credits the caller), so it broadcasts its own tx and pays gas from a small **Sepolia-ETH gas float** the backend tops up (a documented devnet accommodation; ERC-4337 paymaster is the mainnet gate). Delegated auto-funding uses the user's Privy EVM embedded wallet (`PRIVY_AUTHORIZATION_KEY`), bounded by `DelegatedPolicyValidator`.

## Critical conventions & gotchas

- **Sepolia (chainId `11155111`) only.** `NavyPayments` = `0x163933e3f23CBcC93C3910cdFDB0B42EFcfA844c` (redeploy → update `NAVY_PAYMENTS_ADDRESS` in `be/.env`; the deployed address is the source of truth, `contract/DEPLOYMENTS.md` records it + supersedes). **One unified USDC** — Circle's Sepolia USDC (EIP-3009 + EIP-2612) `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` is used for BOTH payments and farming. Farming supplies it to **Compound III (Comet)** `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e` (whose `baseToken()` is this USDC). Get test USDC from **faucet.circle.com** (Ethereum Sepolia). Mainnet gates still deferred: professional audit, KMS/HSM for keys, owner→multisig, ERC-4337 paymaster, distributed rate-limits — see `docs/PRODUCTION.md`.
- **USDC EIP-712 domain on Sepolia is `name="USDC"`, `version="2"`** (verified on-chain via `name()`/`version()`; overridable via `NAVY_USDC_EIP712_NAME/VERSION`). Circle has shipped both `"USD Coin"` and `"USDC"` across versions — read the domain from chain, don't hard-code from memory.
- **Compound Comet `withdraw` + public RPCs:** some public `eth_estimateGas` endpoints spuriously revert for Comet `withdraw`/`withdrawTo` even though `eth_call` + real execution succeed — pass an explicit `gasLimit` for subwallet withdraw txs, or use a real RPC (Alchemy/Infura). Withdraw-all = `withdrawTo(owner, USDC, comet.balanceOf(subwallet))`.
- **Settlement is self-healing.** A submit that reverts on-chain resets the order to `awaiting_payment` (re-payable) and returns `status:'failed'`; a crash between nonce-consume and the confirming-write is recovered by `ChainWatcherService.recoverConsumedOrders` (reads on-chain `invoicePaid[key]`, settles or resets). Don't hand-patch order state — let the sweeps reconcile.
- **An EIP-7702 smart account CANNOT be the EIP-3009 payer.** Circle USDC treats a signer that *has code* as a contract and requires an EIP-1271 signature, so a raw-key ECDSA signature from a 7702-delegated EOA is rejected (`FiatTokenV2: invalid signature`). **The payer must be a plain EOA** (empty `getCode`). Owner/relayer may be smart accounts — they only *send* txs. Also: `forge script` against a 7702 account needs `--slow` (some RPCs reject gapped nonces from delegated accounts).
- **SDK drift is real — verify before coding.** Next / ethers v6 / Privy have breaking changes vs training data; consult the installed `node_modules` types / versioned docs (see `fe/AGENTS.md`, `expo-wallet/AGENTS.md`). Known pin: **otplib v12** (v13 dropped `authenticator`). Prisma 7 uses a driver adapter via `be/prisma.config.ts` + `PrismaPg`. Jest `moduleNameMapper` handles ESM-only `uuid`.
- **Keep non-UI logic in plain-TS modules** (no Next / Expo / NestJS-decorator / chain-SDK imports) so it's unit-testable; screens/handlers/adapters stay thin and are typecheck-verified. `deriveTxSummary` (`be/src/wallet/tx-summary.ts`) is deliberately framework-free. This pattern is used throughout `fe/src/lib`, `expo-wallet/src/lib`, `be/src/**`.
- **pnpm 10 blocks native postinstall scripts.** When adding a dep with a native build (argon2, prisma, `@prisma/engines`, `unrs-resolver`), add it to `pnpm.onlyBuiltDependencies` in that app's `package.json` and reinstall — otherwise it installs unbuilt and breaks at runtime/build. (Already configured.)
- **Money is `BigInt` in Prisma; serialize to string before returning it from Nest.** Controllers/services must map `amount`/`*Base` → `.toString()` (JSON can't encode BigInt). Returning a raw Prisma row with a BigInt column throws at response time. USDC amounts are 6-decimal base units.
- **Stale Prisma client:** if `pnpm build` errors on a model/field that IS in `schema.prisma`, run `pnpm prisma generate` (migrate usually does this, but the client can lag after manual edits). A clean `rm -rf node_modules && CI=true pnpm install` also resets the generated client — re-run `prisma generate` after.
- **Prisma 7 CLI needs `DATABASE_URL` in the shell env.** `be/prisma.config.ts` resolves `env('DATABASE_URL')` but loads **no** dotenv, so `pnpm prisma migrate/generate` fails with `Cannot resolve environment variable: DATABASE_URL`. Prefix it: `DATABASE_URL=... pnpm prisma migrate deploy`. (`pnpm start` is unaffected — the app loads `.env` via `dotenv/config`.)
- **The contract ABI is a runtime asset.** `be/src/evm/navy-payments-abi.json` is `require`d by `evm.module.ts` (require avoids nodenext JSON-import assertions). After changing `NavyPayments.sol` and `forge build`, re-copy the ABI from `contract/out/NavyPayments.sol/NavyPayments.json` into `be/src/evm/` if it drifted.
- **Pay links are HTTPS web URLs** (`https://<origin>/pay/<id>`), set via `NAVY_PAY_BASE_URL`. Scanning a QR opens the pay page.
- **Merchant onboarding order is enforced:** signup → **request payout challenge** (`POST /merchant/payout/challenge`) → set payout (`POST /merchant/payout`, wallet-signs the single-use challenge; `be` verifies via `verifyWalletSignature` in `be/src/common/evm-signature.util.ts`, i.e. ethers `verifyMessage` — plain `personal_sign`, not EIP-712) → admin approve (`POST /admin/merchants/:id/approve`, which calls `EvmRegistrarService.ensureRegisteredActive` → the **owner** wallet's `registerMerchant`/`setMerchantActive` on-chain; the on-chain merchant key is a stable **`bytes16` `merchantId` derived from the DB uuid**, not the payout wallet) → create API key. Payout must exist *before* approval; API keys require approval. The merchant configures their **own EVM payout wallet** via the fe injected wallet (`ethers.BrowserProvider`, `fe/src/app/merchant/WalletConnect.tsx`); payout goes directly there.
- **Env:** each app needs its `.env`/`.env.local`/`app.json extra` populated (Privy app/client IDs; `SEPOLIA_RPC_URL`, `NAVY_PAYMENTS_ADDRESS`, `NAVY_USDC_ADDRESS`, `NAVY_TREASURY_ADDRESS`, `NAVY_RELAYER_PRIVATE_KEY`, `NAVY_OWNER_PRIVATE_KEY`, `SUBWALLET_MASTER_KEY` (32-byte hex), farming bounds). `be` loads `.env` via `dotenv/config`.
- **Production gates + accepted devnet risks:** `docs/PRODUCTION.md`. Runbook: `be/scripts/gateway-bringup.md`. New work: branch off `main`.
