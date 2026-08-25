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
| `srcla/` | TypeScript + Prisma | SRCLA strategy evaluation framework — farming yield optimization |

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

# contract/  (Foundry; needs BASE_RPC_URL for fork/deploy)
forge build                       # compile; writes ABI to out/NavyPayments.sol/NavyPayments.json
forge test                        # unit + fuzz/invariant + Base-fork tests
forge script script/Deploy.s.sol  # deploy/admin (use --slow against 7702-delegated accounts)

# srcla/  (SRCLA strategy evaluation; needs Anvil fork + srcla Postgres)
pnpm evaluation:full --tiers=100000,1000000,10000000  # Run full evaluation
pnpm collect                                           # Collect market snapshots
pnpm test                                             # Unit tests
pnpm prisma:push                                      # Sync database schema
# Requires: Anvil fork running on port 8545, Postgres on 5433
```

**Single test:** pass a filename fragment to `pnpm test` (Jest) or a `--match-test`/`--match-contract` filter to `forge test`. Most logic is unit-tested; **UI screens and Privy / chain calls are NOT unit-testable** — verify them via `tsc`/`build` + gated integration tests (`NAVY_E2E=1`, `NAVY_VAULT_E2E=1`) that need a deployed contract + live Base relayer. `be/scripts/evm-e2e.mjs` (payment) and `be/scripts/vault-e2e.mjs` (vault deposit→rebalance→redeem) are the standalone live-Base proofs — run them against a deployed contract + funded relayer/keeper (`NAVY_VAULT_E2E=1 NAVY_VAULT_E2E_PAYER_KEY=… node be/scripts/vault-e2e.mjs`).

## Architecture (the parts that span files)

**Auth — one unified Navy JWT, three front doors.** `be/src/auth` issues a single role-bearing JWT (`{sub, role: user|merchant|admin, walletAddress}`). End-user wallet users authenticate via Privy (`/auth/privy`), merchants via email+password, admins via password+TOTP. `JwtGuard + RolesGuard + @Roles(...)` gate everything. The fe proxies the backend using the session cookie as Bearer (`fe/src/lib/session-backend.ts`). Auth adds refresh-rotation + logout + session revocation (the JWT carries `sid`; `JwtGuard` rejects revoked `AuthSession`s).

**Payments are EIP-712 gasless invoices on Sepolia.** `contract/src/NavyPayments.sol` holds `owner`/`treasury`/`feeBps`, a `relayers[]` allowlist, `merchants[bytes16]`, and `invoicePaid[bytes32]`. The user signs USDC's EIP-712 `ReceiveWithAuthorization` (Circle USDC natively implements **EIP-3009**); the backend **relayer** submits `payInvoice(...)` and pays gas. `payInvoice` pulls the amount via `usdc.receiveWithAuthorization`, splits **99% to merchant payout + 1% fee to treasury**, and emits `InvoicePaid`. It is **pay-once**: the key is `keccak256(abi.encodePacked(merchantId, invoiceId))`, used both as the `invoicePaid` guard **and** as the EIP-3009 `nonce` — so a wrong merchant/invoice/amount/payer/expiry makes USDC's own EIP-712 verification revert (full binding despite USDC's minimal struct). The gateway (`be/src/payments`, on-chain layer in `be/src/evm`) is a BFF: `GET /v1/orders/:id/payment-authorization` returns the typed data + persists its EIP-712 digest as the order's **durable single-use nonce**; `POST /v1/orders/:id/submit` `{signature}` recovers the signer, asserts `signer == req.user.walletAddress`, CAS-consumes the nonce, and relays `payInvoice`. Both **require the Navy user JWT** — the payer is derived from the token, not a param. `ChainWatcherService` decodes the on-chain **`InvoicePaid`** receipt log, reconciles amount/fee/payer, settles the order to `paid`, then fires the HMAC webhook. The `NAVY_EVM` provider (`be/src/evm/evm.module.ts`) wires an ethers `JsonRpcProvider` + relayer/owner `ethers.Wallet`s + the `payments` contract; the ABI is `be/src/evm/navy-payments-abi.json`.

**Peer-to-peer transfers reuse the gasless rails.** `be/src/transfer` (`@Roles('user')`, routes under `/transfer`) lets a user send USDC to another user: `POST /transfer/authorization` builds the EIP-3009 typed data, `POST /transfer/submit {signature}` recovers the signer, CAS-consumes the nonce, and relays USDC's `transferWithAuthorization` (gasless — relayer pays gas) — the same single-use-nonce + `signer == req.user.walletAddress` pattern as payments, but no `NavyPayments` hop. Native ETH sends are client-broadcast and merely recorded (`POST /transfer/eth/record`). `TransferWatcherService` confirms on-chain; `GET /transfer/resolve` + `GET /transfer/history` back the UI.

**Merchant product images go through Cloudinary.** `be/src/products` (`/merchant/products` CRUD, `@Roles('merchant')`) accepts multipart uploads via Multer `FileInterceptor('image')`; `be/src/cloudinary` (`CloudinaryService`) does the backend-signed upload/delete and stores `imageUrl`/`imagePublicId` on `Product`. Oversize → 413; a failed create rolls back the orphaned asset. fe forwards the multipart through its proxy. Needs `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` in `be/.env`. Spec/plan: `docs/superpowers/specs/2026-07-26-sku-product-images-design.md` (+ `docs/superpowers/plans/2026-07-26-sku-product-images.md`).

**The farming vault (pooled ERC-4626).** Users farm by depositing USDC into **`NavyVaultSRCLA`** (`contract/src/NavyVaultSRCLA.sol`) — a pooled ERC-4626 over Circle USDC that mints `navUSDC` shares (ERC20Permit). Deposits are gasless via **relayer + EIP-3009** `depositWithAuthorization`; redemptions gasless via **ERC-2612 permit on the share token + relayer** `redeem`. A constrained **ALLOCATOR** keeper (`be/src/vault/rebalancer.service.ts`, hourly cron) rebalances the pool across owner-allowlisted **`IYieldAdapter`** venues (`CompoundAdapter` live) by live APY under **on-chain** `capBps`/`minIdleBps`/`maxLossBps` guards — the contract is the authoritative guardrail: the allocator can only move funds *between allowlisted adapters*, never to an EOA (verified in the audit). The off-chain strategy is a framework-free `decideRebalance` (`be/src/vault/rebalance.logic.ts`; target-weight + drift band + gas-breakeven + idle buffer). `VaultWatcherService` reconciles `Deposit`/`Reallocated` receipts + a crash-recovery sweep. BFF `be/src/vault` (`/vault/deposit/authorization|submit`, `/vault/redeem/permit|submit`, `/vault/position`, `/vault/apys`) uses the same durable-digest nonce + CAS-consume + `signer == req.user.walletAddress` pattern as payments. Audited (`contract/audit/NavyVault-security-audit-2026-07-28.md`); spec/plans under `docs/superpowers/*/2026-07-28-navy-vault-*`. **The old per-user encrypted-subwallet farming** (`be/src/wallet` `SigningService`/`PolicyValidator`, `be/src/farming`, delegated Privy funding) **was removed 2026-07-29** and replaced by this vault. (`be/src/crypto` AES envelope + `PrivyService.verifyAccessToken` were kept — they serve payments/merchant/auth, not farming.)

**The in-wallet AI assistant is read-and-propose-only.** `be/src/agent` (`AgentService`) runs an **OpenRouter**-backed streaming chat behind `POST /agent/chat` (SSE: `token`/`tool_start`/`tool_result`/`done` events; `@Roles('user')`, throttled 20/min). The **server-side tool loop** (`agent-loop.ts`) calls the model, runs any `tool_calls`, appends `role:'tool'` results, and repeats up to `AGENT_MAX_ITERATIONS` (default 8); `context-window.ts` trims history to `AGENT_CONTEXT_TOKENS` (default 6000). Tools (`tool-schemas.ts`, dispatched via `tool-dispatch.ts` with arg validation) split into **read** tools (`get_portfolio`, `get_payment_history`, `get_farming_summary`, `get_spending_analytics`, `get_token_info`, `get_top_coins`, `resolve_recipient`) and **propose** tools (`build_transfer`, `build_farming_deposit`, `build_farming_withdraw` — the latter two now propose **vault** deposit/redeem). **The agent NEVER moves funds** — action tools return a proposal (with a `display` hint) that the user confirms and signs in the app, driving the gasless EIP-3009 (deposit) / EIP-2612-permit (redeem) vault paths. Conversations persist as `AgentConversation`/`AgentMessage` (Prisma). Default model `google/gemini-2.5-flash` (`OPENROUTER_MODEL`). `be/src/market` is a CoinGecko client + `PriceService` (TTL-cached) powering the token tools and the portfolio's USD valuation. On expo, `src/lib/agent` (SSE parser + `chatReducer`, plain-TS/unit-tested) drives `src/features/assistant/*Card.tsx`, which render from each tool result's `display` kind. Spec: `docs/superpowers/specs/2026-07-22-navy-ai-assistant-design.md`.

## Critical conventions & gotchas

- **Base (chainId `8453`).** `NavyPayments` = `0xb135C49Ef6c0505F7fB55932F31A9E93eba6e907` (`NAVY_PAYMENTS_ADDRESS`). `NavyVaultSRCLA` = `0x55E728b08FdB9432520FB3Fd1b9D7777320f8ED3` (`NAVY_VAULT_ADDRESS`). Redeploy → update the env var; the deployed address is the source of truth, `contract/DEPLOYMENTS.md` records it + supersedes. **One unified USDC** — Circle's Base USDC (EIP-3009 + EIP-2612) `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` for payments, transfers, and the farming vault. The vault supplies it to **Compound III (Comet)** `0xb125E6687d4313864e53df431d5425969c15Eb2F` (whose `baseToken()` is this USDC) via `CompoundAdapter`.

- **SRCLA Adapter Addresses (Anvil Fork):** `NavyVaultSRCLA` = `0xc9CF8dB420d2E5438c6C1ca883bf243218075a82`. `CompoundAdapter` = `0x5b53a25fF5Ec56a852CB4c0D193754308C6e99A0`. `AaveV3Adapter` = `0xfDCaC27247ecb3452f88c8ea10CACeabc19348eb`. `MoonwellAdapter` = `0x5bb77832BA9CBe335fCCdF8Ef5520ae041326598`. `RewardExecutor` = `0x7C2f641b9ceFe5197E81FE750Ec59a365a7D9f1F`.
- **USDC EIP-712 domain on Base is `name="USD Coin"`, `version="2"`** (verified on-chain via `name()`/`version()`; overridable via `NAVY_USDC_EIP712_NAME/VERSION`). Circle has shipped both `"USD Coin"` and `"USDC"` across versions — read the domain from chain, don't hard-code from memory.
- **Compound Comet `withdraw` + public RPCs:** some public `eth_estimateGas` endpoints spuriously revert for Comet `withdraw`/`withdrawTo` even though `eth_call` + real execution succeed — pass an explicit `gasLimit` for the vault's adapter-withdraw / redemption txs, or use a real RPC (Alchemy/Infura). Comet also floors ~2 base units on supply, so the vault's loss guard tolerates a fixed `LOSS_DUST` (see `NavyVault`), and the `CompoundAdapterForkTest` reads the credited balance rather than asserting an exact round-trip.
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
- **Env:** each app needs its `.env`/`.env.local`/`app.json extra` populated (Privy app/client IDs; `BASE_RPC_URL`, `NAVY_PAYMENTS_ADDRESS`, `NAVY_USDC_ADDRESS`, `NAVY_TREASURY_ADDRESS`, `NAVY_RELAYER_PRIVATE_KEY`, `NAVY_OWNER_PRIVATE_KEY`, `NAVY_VAULT_ADDRESS`, `NAVY_KEEPER_PRIVATE_KEY` (the vault allocator; falls back to owner) + optional `NAVY_REBALANCE_*` tuning, `SUBWALLET_MASTER_KEY` (32-byte hex — now backs the `be/src/crypto` cipher for payments/merchant, not subwallets); `OPENROUTER_API_KEY` + optional `OPENROUTER_MODEL` for the AI assistant; `COINGECKO_API_KEY` for market data). `be` loads `.env` via `dotenv/config`.
- **Production gates + accepted devnet risks:** `docs/PRODUCTION.md`. Runbook: `be/scripts/gateway-bringup.md`. New work: branch off `main`.

**Anvil Fork for Testing:** Run `anvil --fork-url https://mainnet.base.org --code-size-limit 100000` to fork Base Mainnet. Then deploy contracts via `forge script script/DeployVaultAnvil.s.sol --fork-url http://127.0.0.1:8545 --broadcast`. srcla evaluation uses this fork (see `srcla/.env.anvil`).

**srcla Database:** Uses separate Postgres on port 5433. `DATABASE_URL=postgresql://user:password@localhost:5433/srcla`. Run `docker compose up -d` in srcla dir (if docker-compose.yml exists) or ensure Postgres is running on 5433. Run `pnpm prisma:push` after schema changes.

**SRCLA Paper:** Full specification at `docs/research/output/srcla-paper.md`. Evaluation report at `SRCLA-REPORT.md`. Paper defines baselines B0-B5, ablations H1-H5, and two release gates (forecast calibration + policy outperformance). **Live evaluation results (2026-08):** Sharpe 1.36, 99.80% withdrawal rate, 5.38-5.48% net APY. Run live eval: `cd srcla && source .env.anvil && npx tsx scripts/run-live-evaluation.ts`

**SRCLA Live Market Data (Anvil fork block 0x300fff0):**
- Compound III: 7.98% APY @ 91.5% utilization
- Aave V3: 3.15% APY @ 80.0% utilization
- Moonwell: 3.61% APY @ 85.0% utilization
- Results saved to: `srcla/evaluation-results-live-*.json`
