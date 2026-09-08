# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Navy** — a **Base (EVM, chainId `8453`)** payment ecosystem: a payment gateway + wallets. **There is no Sepolia/testnet deployment anymore** — local dev runs against an **Anvil fork of Base mainnet** on `:8545` (see *Running the stack*), and `contract/DEPLOYMENTS.md`'s Sepolia section is historical record only. It is built as **five independent apps** in one repo (NOT a pnpm/Nx workspace — each has its own `package.json`, run `pnpm` inside each; `contract/` uses Foundry):

| Dir | Stack | Role |
|---|---|---|
| `be/` | Nest.js 11 + Prisma 7 (Postgres) + ethers v6 | Backend API: auth, payments gateway, transfers, admin, vault BFF, on-chain relayer |
| `fe/` | Next.js 16 (App Router) + React 19 | Web for **admin** + **merchant** (no end-user wallet) |
| `expo-wallet/` | Expo / React Native + `@privy-io/expo` | End-user mobile wallet — the **payer** (balances, scan-to-pay, farming) |
| `contract/` | Foundry (Solidity 0.8.24) | `NavyPayments.sol`, `NavyVaultSRCLA.sol`, and the `IYieldAdapter` venues |
| `srcla/` | TypeScript + Fastify 4 + Prisma **5** | **Long-running service** (`:3100`): yield forecasting, allocation decisions, and the vault keeper. `be` proxies it read-only |

**Development is spec-driven** — but the spec archive was pruned. Features are designed → planned → built via `docs/superpowers/specs/*-design.md` + `docs/superpowers/plans/*.md`; read the relevant one before changing a subsystem, since they hold the *why* and the locked decisions. **Only the still-active specs/plans remain** — commit `7127ce2` deleted the obsolete ones, so historical designs (the Solana→EVM migration, the AI assistant, product images, the original vault) exist **only in git history**: `git log --diff-filter=D --name-only -- docs/superpowers` to find one, `git show <commit>:<path>` to read it. Currently on disk:

| Path | Covers |
|---|---|
| `specs/2026-08-26-client-interaction-gaps-design.md` + `plans/2026-08-26-client-interaction-gaps.md` | client/BFF interaction gaps |
| `specs/2026-09-07-srcla-paper-conformance-design.md` + `plans/2026-09-07-srcla-paper-conformance-phase{1,2}*.md` + `plans/2026-09-08-…-phase3.md` | the paper-conformance work (phases 1–3, complete) |
| `plans/2026-09-07-srcla-phase1-outcome.md` | carried-forward gaps + the operator runbook |
| `plans/2026-09-04-vault-rebalancer-implementation.md` | the be→srcla read-only proxy split |

Other durable design docs live outside that tree: `docs/research/output/srcla-paper.md` (the algorithm), `docs/PRODUCTION.md`, `be/src/vault/SPEC.md`, `srcla/PLAN.md`, `contract/DEPLOYMENTS.md`, `contract/audit/`.

## Commands

Run inside the relevant app dir.

```bash
# be/  (Postgres must be up: docker compose up -d)
pnpm test                         # all unit tests (jest)
pnpm test <pattern>               # e.g. pnpm test vault-deposit.service
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

# contract/  (Foundry; needs BASE_RPC_URL — point it at the local Anvil fork)
forge build                       # compile; writes ABI to out/NavyPayments.sol/NavyPayments.json
forge test                        # unit + fuzz/invariant + Base-fork tests
forge script script/Deploy.s.sol  # deploy/admin (use --slow against 7702-delegated accounts)

# srcla/  (the strategy SERVICE; needs the Anvil fork on :8545 + srcla Postgres on :5433)
pnpm dev                          # tsx watch src/index.ts — serves /v1/* on :3100 AND runs the scheduler
pnpm build && pnpm start          # tsc, then node dist/index.js
pnpm test                         # jest test/unit + test/integration (NOT unit-only)
pnpm test:unit | test:integration | test:eval        # narrower suites
pnpm cli:health                   # health probe (also cli:collect / cli:evaluate / cli:regime)
pnpm collect                      # one-shot market snapshot
pnpm evaluation:full --tiers=100000,1000000,10000000
pnpm prisma:push                  # after schema.prisma changes — Prisma **5** here, not 7
```

**Running the full stack** — order matters, each step depends on the one above:

1. **Anvil fork of Base mainnet:** `anvil --fork-url https://mainnet.base.org --code-size-limit 100000` (`:8545`). This *is* the chain for local dev — there is no testnet.
2. **Deploy + configure:** `cd contract && forge script script/DeployNavyVaultSRCLA.s.sol --fork-url http://127.0.0.1:8545 --broadcast`, or `DeployAndFund.s.sol` for funded multi-tier vaults with the three adapters registered. Other entry points: `DeployBaseSystem.s.sol` (full Base package), `ConfigureAnvil.s.sol` (tops up a vault — reads `VAULT_ADDRESS` from the env), `FundVaultAnvil.s.sol`. Deploy scripts apply the paper's on-chain guardrails via `script/VaultGuardrails.sol`; the required post-deploy step is in `script/POST_DEPLOY.md`. **`NavyVaultSimple` and its four deploy scripts were deleted** — it was a stub the keeper could not drive (incompatible `submitPlan`, no harvest/emergency-exit), its `_divest` moved funds the wrong way, and its shares were 6 dp against the real vault's 12 dp. Then **write the new addresses into `be/.env` and `srcla/.env.anvil`** — they change on every redeploy.
3. **Two separate Postgres instances:** `cd be && docker compose up -d` gives `navy` on **:5432**; `cd srcla && docker compose up -d` gives `srcla` on **:5433**.
4. `cd srcla && pnpm dev` (`:3100`) — must be up before `be`, which reads it.
5. `cd be && pnpm start` (`:3000`; reads srcla at `SRCLA_API_URL`).
6. `cd fe && pnpm dev` (`:3001` — pinned, since `be` owns `:3000`) and/or `cd expo-wallet && pnpm start`.

**Single test:** pass a filename fragment to `pnpm test` (Jest) or a `--match-test`/`--match-contract` filter to `forge test`. Most logic is unit-tested; **UI screens and Privy / chain calls are NOT unit-testable** — verify them via `tsc`/`build` + gated integration tests (`NAVY_E2E=1`, `NAVY_VAULT_E2E=1`) that need a deployed contract + live Base relayer. `be/scripts/evm-e2e.mjs` (payment) and `be/scripts/vault-e2e.mjs` (vault approve→deposit→redeem) are the standalone live-Base proofs. `vault-e2e.mjs` now drives the **user-pays proposal flow**, so it needs a funded EOA rather than a relayer or keeper (`NAVY_VAULT_E2E=1 NAVY_VAULT_E2E_PAYER_KEY=… node be/scripts/vault-e2e.mjs`).

**srcla tests must run via `pnpm test:unit`, not a raw `npx jest`** — the latter misses the ESM preset and fails five policy suites on `import.meta` (TS1343). That is the invocation, not the code.

## Architecture (the parts that span files)

**Auth — one unified Navy JWT, three front doors.** `be/src/auth` issues a single role-bearing JWT (`{sub, role: user|merchant|admin, walletAddress}`). End-user wallet users authenticate via Privy (`/auth/privy`), merchants via email+password, admins via password+TOTP. `JwtGuard + RolesGuard + @Roles(...)` gate everything. The fe proxies the backend using the session cookie as Bearer (`fe/src/lib/session-backend.ts`). Auth adds refresh-rotation + logout + session revocation (the JWT carries `sid`; `JwtGuard` rejects revoked `AuthSession`s).

**Payments are EIP-712 gasless invoices on Base.** `contract/src/NavyPayments.sol` holds `owner`/`treasury`/`feeBps`, a `relayers[]` allowlist, `merchants[bytes16]`, and `invoicePaid[bytes32]`. The user signs USDC's EIP-712 `ReceiveWithAuthorization` (Circle USDC natively implements **EIP-3009**); the backend **relayer** submits `payInvoice(...)` and pays gas. `payInvoice` pulls the amount via `usdc.receiveWithAuthorization`, splits **99% to merchant payout + 1% fee to treasury**, and emits `InvoicePaid`. It is **pay-once**: the key is `keccak256(abi.encodePacked(merchantId, invoiceId))`, used both as the `invoicePaid` guard **and** as the EIP-3009 `nonce` — so a wrong merchant/invoice/amount/payer/expiry makes USDC's own EIP-712 verification revert (full binding despite USDC's minimal struct). The gateway (`be/src/payments`, on-chain layer in `be/src/evm`) is a BFF: `GET /v1/orders/:id/payment-authorization` returns the typed data + persists its EIP-712 digest as the order's **durable single-use nonce**; `POST /v1/orders/:id/submit` `{signature}` recovers the signer, asserts `signer == req.user.walletAddress`, CAS-consumes the nonce, and relays `payInvoice`. Both **require the Navy user JWT** — the payer is derived from the token, not a param. `ChainWatcherService` decodes the on-chain **`InvoicePaid`** receipt log, reconciles amount/fee/payer, settles the order to `paid`, then fires the HMAC webhook. The `NAVY_EVM` provider (`be/src/evm/evm.module.ts`) wires an ethers `JsonRpcProvider` + relayer/owner `ethers.Wallet`s + the `payments` contract; the ABI is `be/src/evm/navy-payments-abi.json`.

**Peer-to-peer transfers reuse the gasless rails.** `be/src/transfer` (`@Roles('user')`, routes under `/transfer`) lets a user send USDC to another user: `POST /transfer/authorization` builds the EIP-3009 typed data, `POST /transfer/submit {signature}` recovers the signer, CAS-consumes the nonce, and relays USDC's `transferWithAuthorization` (gasless — relayer pays gas) — the same single-use-nonce + `signer == req.user.walletAddress` pattern as payments, but no `NavyPayments` hop. Native ETH sends are client-broadcast and merely recorded (`POST /transfer/eth/record`). `TransferWatcherService` confirms on-chain; `GET /transfer/resolve` + `GET /transfer/history` back the UI.

**Merchant product images go through Cloudinary.** `be/src/products` (`/merchant/products` CRUD, `@Roles('merchant')`) accepts multipart uploads via Multer `FileInterceptor('image')`; `be/src/cloudinary` (`CloudinaryService`) does the backend-signed upload/delete and stores `imageUrl`/`imagePublicId` on `Product`. Oversize → 413; a failed create rolls back the orphaned asset. fe forwards the multipart through its proxy. Needs `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` in `be/.env`.

**The farming vault (pooled ERC-4626).** Users farm by depositing USDC into **`NavyVaultSRCLA`** (`contract/src/NavyVaultSRCLA.sol`) — a pooled ERC-4626 over Circle USDC that mints `navUSDC` shares (ERC20Permit). **Farming is user-signed and user-paid** (paper §2.1): there is no relayer, no EIP-3009 deposit and no sponsored gas on this path. The user approves USDC then calls `deposit`/`mint`, and redeems via `redeem`/`withdraw`, paying their own Base gas. A constrained **ALLOCATOR** keeper rebalances the pool across owner-allowlisted **`IYieldAdapter`** venues (`CompoundAdapter`, `AaveV3Adapter`, `MoonwellAdapter`) under **on-chain** `capBps`/`minIdleBps`/`maxLossBps` guards — the contract is the authoritative guardrail: the allocator can only move funds *between allowlisted adapters*, never to an EOA (verified in the audit). **That allocator lives in `srcla/`, not `be/`** — see the next paragraph. `VaultEventWatcher` (`be/src/vault/vault-event-watcher.ts`) reconciles `Deposit`/`Reallocated` receipts + a crash-recovery sweep. BFF `be/src/vault` returns **unsigned transaction proposals** the client signs: `POST /vault/transactions/{approve,deposit,redeem,withdraw}`, plus reads `/vault/{position,limits,apys,events/poll}`. Each proposal is prechecked (`be/src/vault/vault-preconditions.ts`) so a doomed transaction is refused with a machine-readable `reason` — `INSUFFICIENT_USDC_BALANCE`, `EXCEEDS_MAX_REDEEM`, `EXCEEDS_MAX_WITHDRAW`, `INVALID_AMOUNT` — rather than reverting after the user has paid gas. The durable-digest nonce + CAS-consume pattern remains on **payments**, not farming. Audit: `contract/audit/AUDIT-REPORT.md` + `contract/audit/2026-08-12-audit/findings-evm-audit-*.md`, release evidence in `contract/audit/RELEASE-EVIDENCE-2026-08-14.md`. **The old per-user encrypted-subwallet farming** (`be/src/wallet` `SigningService`/`PolicyValidator`, `be/src/farming`, delegated Privy funding) **was removed 2026-07-29** — both directories are gone, replaced by this vault. (`be/src/crypto` AES envelope + `PrivyService.verifyAccessToken` were kept — they serve payments/merchant/auth, not farming.)

**`srcla/` is a running service; `be` only reads from it.** `srcla/` is not an offline harness — `srcla/src/index.ts` boots a **Fastify** API (`srcla/src/http/{server,routes}.ts`; `HTTP_HOST`/`HTTP_PORT`, default `:3100`) *and* a **scheduler** (`srcla/src/runtime/scheduler.ts`: snapshot collection every `COLLECTOR_INTERVAL_MS`, decision cycles on the controller interval, weekly walk-forward calibration — 30d window / 7d held-out / 7d horizon), and it owns **on-chain keeper execution** via its `KeeperExecutor`. **Two listeners.** The public one (`HTTP_PORT`, default `:3100`) is **GET-only and enforced so**: an `onRoute` hook records every route and throws on any non-GET/HEAD/OPTIONS, so adding a POST there makes the service fail to boot (paper §10.2). It serves `health`, `markets[/:marketId]`, `decisions[/:hash]`, `plans`, `harvests`, `allocation`, `evaluations`, `regimes[/:marketId]`, `simulations/:marketId`, `manifests[/:id[/verification]]`, `enumeration/:cycleId`, `reserve`, `emergencies`, `policy`, `sync`. The three mutations — `POST /v1/{manifests,proposals/review,internal/trigger}` — live on a **loopback-only operator listener** (`OPERATOR_HTTP_PORT`, default `:3101`, bound to `127.0.0.1` as a code constant, not an env var). **`be` is a read-only proxy:** `SrclaClient` (`be/src/vault/srcla-client.ts`, interface spec in `be/src/vault/SPEC.md`) fetches over `SRCLA_API_URL` (default `http://localhost:3100`), and `be/src/vault/vault-admin.controller.ts` re-serves it under `/vault/admin/{strategy,decisions,harvests,cohorts,rebalance/status,rebalance/proposals}`. **There is no rebalance trigger and no keeper key in `be`** — the surviving vault handle is provider-bound, not signer-bound, so `be` structurally cannot send a vault transaction (paper §10.2). **The backend does no allocation math and holds no keeper cron — do not add one there.** Plan: `docs/superpowers/plans/2026-09-04-vault-rebalancer-implementation.md`. The algorithm itself (forecasting §7, dynamic reserve §8.1, cost gate §9.1, rewards §9.2–§9.4, enumeration §8.2) is specified in `docs/research/output/srcla-paper.md` and mapped to knobs in `srcla/src/config.ts` (every `SRCLA_*` env var).

**The in-wallet AI assistant is read-and-propose-only.** `be/src/agent` (`AgentService`) runs an **OpenRouter**-backed streaming chat behind `POST /agent/chat` (SSE: `token`/`tool_start`/`tool_result`/`done` events; `@Roles('user')`, throttled 20/min). The **server-side tool loop** (`agent-loop.ts`) calls the model, runs any `tool_calls`, appends `role:'tool'` results, and repeats up to `AGENT_MAX_ITERATIONS` (default 8); `context-window.ts` trims history to `AGENT_CONTEXT_TOKENS` (default 6000). Tools (`tool-schemas.ts`, dispatched via `tool-dispatch.ts` with arg validation) split into **read** tools (`get_portfolio`, `get_payment_history`, `get_farming_summary`, `get_spending_analytics`, `get_token_info`, `get_top_coins`, `resolve_recipient`) and **propose** tools (`build_transfer`, `build_farming_deposit`, `build_farming_withdraw` — the latter two now propose **vault** deposit/redeem). **The agent NEVER moves funds** — action tools return a proposal (with a `display` hint) that the user confirms and signs in the app, driving the gasless EIP-3009 (deposit) / EIP-2612-permit (redeem) vault paths. Conversations persist as `AgentConversation`/`AgentMessage` (Prisma). Default model `google/gemini-2.5-flash` (`OPENROUTER_MODEL`). `be/src/market` is a CoinGecko client + `PriceService` (TTL-cached) powering the token tools and the portfolio's USD valuation. On expo, `src/lib/agent` (SSE parser + `chatReducer`, plain-TS/unit-tested) drives `src/features/assistant/*Card.tsx`, which render from each tool result's `display` kind.

## Critical conventions & gotchas

- **Deployed addresses are NOT hardcoded here — read them from the env files.** Every local deploy is a fresh Anvil fork of Base, so vault/payments/adapter addresses change constantly. Sources of truth: **`be/.env`** (`NAVY_PAYMENTS_ADDRESS`, `NAVY_VAULT_ADDRESS`, `NAVY_USDC_ADDRESS`, `NAVY_TREASURY_ADDRESS`), **`srcla/.env.anvil`** (`VAULT_ADDRESS` + `COMPOUND_/AAVE_/MOONWELL_STRATEGY_ADDRESS`, `REWARD_EXECUTOR_ADDRESS`), and **`contract/DEPLOYMENTS.md`** for the historical record. ⚠️ `DEPLOYMENTS.md` still contains an **Ethereum Sepolia** section from the retired testnet phase — those addresses (and its Sepolia USDC/Comet) are **dead**; don't copy them into any `.env`.

- **Constants that *are* safe to hardcode (Base mainnet, and the fork inherits them).** Circle USDC (EIP-3009 + EIP-2612) `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` — **one unified USDC** for payments, transfers, and the vault. Venues: Compound III Comet `0xb125E6687d4313864e53df431d5425969c15Eb2F` (its `baseToken()` is that USDC), Aave V3 Pool `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`, Moonwell mUSDC `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22`. Full table (Uniswap, Chainlink feeds, sequencer uptime) in `contract/DEPLOYMENTS.md`.

- **USDC EIP-712 domain on Base is `name="USD Coin"`, `version="2"`** (verified on-chain via `name()`/`version()`; overridable via `NAVY_USDC_EIP712_NAME/VERSION`). Circle has shipped both `"USD Coin"` and `"USDC"` across versions — read the domain from chain, don't hard-code from memory.
- **Compound Comet `withdraw` + public RPCs:** some public `eth_estimateGas` endpoints spuriously revert for Comet `withdraw`/`withdrawTo` even though `eth_call` + real execution succeed — pass an explicit `gasLimit` for the vault's adapter-withdraw / redemption txs, or use a real RPC (Alchemy/Infura). Comet also floors ~2 base units on supply, so the vault's loss guard tolerates a fixed `LOSS_DUST` (see `NavyVault`), and the `CompoundAdapterForkTest` reads the credited balance rather than asserting an exact round-trip.
- **Settlement is self-healing.** A submit that reverts on-chain resets the order to `awaiting_payment` (re-payable) and returns `status:'failed'`; a crash between nonce-consume and the confirming-write is recovered by `ChainWatcherService.recoverConsumedOrders` (reads on-chain `invoicePaid[key]`, settles or resets). Don't hand-patch order state — let the sweeps reconcile.
- **An EIP-7702 smart account CANNOT be the EIP-3009 payer.** Circle USDC treats a signer that *has code* as a contract and requires an EIP-1271 signature, so a raw-key ECDSA signature from a 7702-delegated EOA is rejected (`FiatTokenV2: invalid signature`). **The payer must be a plain EOA** (empty `getCode`). Owner/relayer may be smart accounts — they only *send* txs. Also: `forge script` against a 7702 account needs `--slow` (some RPCs reject gapped nonces from delegated accounts).
- **SDK drift is real — verify before coding.** Next / ethers v6 / Privy have breaking changes vs training data; consult the installed `node_modules` types / versioned docs (see `fe/AGENTS.md`, `expo-wallet/AGENTS.md`). Known pin: **otplib v12** (v13 dropped `authenticator`). Prisma 7 uses a driver adapter via `be/prisma.config.ts` + `PrismaPg` — **but `srcla/` is on Prisma 5 + Fastify 4**, so the Prisma-7 notes below do not apply there; check which app you're in before trusting a version-specific gotcha. Jest `moduleNameMapper` handles ESM-only `uuid`.
- **Keep non-UI logic in plain-TS modules** (no Next / Expo / NestJS-decorator / chain-SDK imports) so it's unit-testable; screens/handlers/adapters stay thin and are typecheck-verified. Good exemplars: `be/src/evm/payment-authorization.ts`, `be/src/agent/{agent-loop,context-window,tool-dispatch}.ts`, `be/src/common/evm-signature.util.ts` — all decorator-free and unit-tested. This pattern is used throughout `fe/src/lib`, `expo-wallet/src/lib`, `be/src/**`.
- **pnpm 10 blocks native postinstall scripts.** When adding a dep with a native build (argon2, prisma, `@prisma/engines`, `unrs-resolver`), add it to `pnpm.onlyBuiltDependencies` in that app's `package.json` and reinstall — otherwise it installs unbuilt and breaks at runtime/build. (Already configured.)
- **Money is `BigInt` in Prisma; serialize to string before returning it from Nest.** Controllers/services must map `amount`/`*Base` → `.toString()` (JSON can't encode BigInt). Returning a raw Prisma row with a BigInt column throws at response time. USDC amounts are 6-decimal base units.
- **Stale Prisma client:** if `pnpm build` errors on a model/field that IS in `schema.prisma`, run `pnpm prisma generate` (migrate usually does this, but the client can lag after manual edits). A clean `rm -rf node_modules && CI=true pnpm install` also resets the generated client — re-run `prisma generate` after.
- **Prisma 7 CLI needs `DATABASE_URL` in the shell env.** `be/prisma.config.ts` resolves `env('DATABASE_URL')` but loads **no** dotenv, so `pnpm prisma migrate/generate` fails with `Cannot resolve environment variable: DATABASE_URL`. Prefix it: `DATABASE_URL=... pnpm prisma migrate deploy`. (`pnpm start` is unaffected — the app loads `.env` via `dotenv/config`.)
- **The contract ABI is a runtime asset.** `be/src/evm/navy-payments-abi.json` is `require`d by `evm.module.ts` (require avoids nodenext JSON-import assertions). After changing `NavyPayments.sol` and `forge build`, re-copy the ABI from `contract/out/NavyPayments.sol/NavyPayments.json` into `be/src/evm/` if it drifted.
- **Pay links are HTTPS web URLs** (`https://<origin>/pay/<id>`), set via `NAVY_PAY_BASE_URL`. Scanning a QR opens the pay page.
- **Merchant onboarding order is enforced:** signup → **request payout challenge** (`POST /merchant/payout/challenge`) → set payout (`POST /merchant/payout`, wallet-signs the single-use challenge; `be` verifies via `verifyWalletSignature` in `be/src/common/evm-signature.util.ts`, i.e. ethers `verifyMessage` — plain `personal_sign`, not EIP-712) → admin approve (`POST /admin/merchants/:id/approve`, which calls `EvmRegistrarService.ensureRegisteredActive` → the **owner** wallet's `registerMerchant`/`setMerchantActive` on-chain; the on-chain merchant key is a stable **`bytes16` `merchantId` derived from the DB uuid**, not the payout wallet) → create API key. Payout must exist *before* approval; API keys require approval. The merchant configures their **own EVM payout wallet** via the fe injected wallet (`ethers.BrowserProvider`, `fe/src/app/merchant/WalletConnect.tsx`); payout goes directly there.
- **Env:** each app needs its `.env`/`.env.local` populated (expo reads `EXPO_PUBLIC_*` from `.env.local` via `src/lib/config/env.ts` — **not** `app.json` `extra`, which is empty) (Privy app/client IDs; `BASE_RPC_URL`, `NAVY_PAYMENTS_ADDRESS`, `NAVY_USDC_ADDRESS`, `NAVY_TREASURY_ADDRESS`, `NAVY_RELAYER_PRIVATE_KEY`, `NAVY_OWNER_PRIVATE_KEY`, `NAVY_VAULT_ADDRESS`, **`NAVY_VAULT_EIP712_NAME` — must be exactly `Navy Vault SRCLA`**, matching `NavyVaultSRCLA`'s `ERC20Permit` name, or every redeem permit is signed against a domain the vault rejects; `SUBWALLET_MASTER_KEY` (32-byte hex — now backs the `be/src/crypto` cipher for payments/merchant, not subwallets); `OPENROUTER_API_KEY` + optional `OPENROUTER_MODEL` for the AI assistant; `COINGECKO_API_KEY` for market data; `SRCLA_API_URL` pointing `be` at the srcla service). `be` loads `.env` via `dotenv/config`; `srcla` loads its own via `dotenv/config` in `src/config.ts` (validated by a zod schema — a missing/malformed var fails fast at boot). `deploy/` holds gitignored local deploy material (`base-wallets.env`, `README.private.md`) — never commit its contents.
- **`be/.env.example` is now exhaustive and dead-free** — every var in it is read by `be/src`. Removed in the 2026-09-07 cleanup: `NAVY_REBALANCE_*` (configured the deleted `rebalance.logic.ts`), `NAVY_FARM_*` + `PRIVY_AUTHORIZATION_KEY` (the removed farming/delegated-signing paths), and `FARMING_BASE_*` / `FARMING_VAULT_ADDRESS` (duplicates of `BASE_RPC_URL`/`EVM_CHAIN_ID`/`NAVY_USDC_ADDRESS`/`NAVY_VAULT_ADDRESS` that existed only while payments were on Sepolia and farming on Base). Don't wire any of them back up — rebalance tuning lives in srcla's `SRCLA_*` vars (`srcla/src/config.ts`).
- **Outstanding migration:** the relayed-flow nonce models (`VaultDepositAuthorization`, `VaultRedeemPermit`) were dropped from `be/prisma/schema.prisma` but **no migration has been run** — an operator must run `DATABASE_URL=… pnpm prisma migrate dev --name drop_relayed_vault_nonce_models`.
- **Production gates + accepted pre-production risks:** `docs/PRODUCTION.md`. Runbook: `be/scripts/gateway-bringup.md`. New work: branch off `main`.

**Anvil fork:** see *Running the stack* above for the fork + deploy commands. `contract/script/` holds the real set — there is **no** `DeployVaultAnvil.s.sol` and, since the stub was removed, no `DeploySimpleAnvil.s.sol`/`SetupAnvil.s.sol`/`DeployFull.s.sol`/`DeployDirect.s.sol` either. Both `be` and `srcla` point at this fork (`be/.env` `BASE_RPC_URL`, `srcla/.env.anvil`).

**srcla Database:** Separate Postgres on port 5433, via `srcla/docker-compose.yml` (added in Phase 4; `be/docker-compose.yml` only serves `be`'s `navy` DB on 5432). `DATABASE_URL=postgresql://user:password@localhost:5433/srcla`. Run `pnpm prisma:push` after schema changes.

**SRCLA Paper & evaluation.** Algorithm spec: `docs/research/output/srcla-paper.md` — **v0.5**, carrying an Amendment Record (P1–P8) and a burned-window declaration; both are binding spec, not proposals. Defines baselines B0–B5 (incl. B2u), ablations **H1–H7**, and two release gates (forecast calibration + policy outperformance). Evaluation report: `SRCLA-REPORT.md` (+ `SRCLA-REPORT.json`). Run a live eval against the fork: `cd srcla && source .env.anvil && npx tsx scripts/run-live-evaluation.ts` (results land in `srcla/evaluation-results-live-*.json`); `scripts/show-live-apys.ts` prints the venue APYs the fork is currently reporting.

> Point-in-time numbers (Sharpe, per-venue APY, fork block) are **not** kept here — they go stale on every re-fork. Read them from the newest `srcla/evaluation-results-live-*.json` or re-run the eval.

## Paper conformance status (2026-09-08)

Phases 1–4 of the paper-conformance work are **complete**. The code implements the
paper rather than approximating it, and there is now a real dataset to evaluate it
on. Phase 2's contract changes are recorded in
`contract/audit/2026-09-07-phase2-changes.md` (incl. an ABI break:
`RewardAccountant`'s constructor is now `(address admin, address vault_)`).

### The dataset and the eras

**There IS held-out data now.** Phase 4 backfilled **~17,700 hourly origins over
two years** of Base mainnet venue state (Compound III, Aave V3, Moonwell) with
**zero gaps**, reading the protocols directly at archive blocks — `pnpm
backfill:history`, resumable, multi-endpoint. Base archive state for all three
venues reads back to at least 2024-09-03, and this repository had never looked at
any of it, so the "no held-out data" blocker is closed by collecting rather than by
waiting.

`srcla/src/evaluation/eras.ts` is the registered split, and it is enforced in code
(`assertNotSealed` throws; `loadEra` is the only loader that takes an era):

| Era | Window | Days | Role |
|---|---|---|---|
| `calibration` | 2024-09-01 → 2025-08-31 | 365 | the ONLY data anything may be fit on |
| `heldout-a` | 2025-09-01 → 2026-05-25 | 267 | **sealed**, primary — statistical power |
| `burned` | 2026-05-26 → 2026-08-23 | 90 | §4.1 design data; in NEITHER era |
| `heldout-b` | 2026-08-24 → present | 16+ | **sealed**, secondary — temporal purity |

Two deviations are deliberate and must stay disclosed in any report: §4.1's letter
puts the burned window inside calibration, and here it is in neither (including it
would place fitting data *after* held-out A and invert walk-forward order); and
held-out A *precedes* the burned window, so it carries a design-knowledge caveat
that held-out B does not. **Both eras are reported; neither alone is sufficient.**

### Running the experiment

```bash
cd srcla && docker compose up -d                       # Postgres on :5433 (new)
DATABASE_URL=… pnpm prisma:push
DATABASE_URL=… pnpm backfill:history                   # ~45 min, resumable, 0 gaps
DATABASE_URL=… pnpm phase4:freeze                      # -> config/registered-artifact.json
DATABASE_URL=… pnpm phase4:run                         # both held-out eras + SRCLA-REPORT.{md,json}
DATABASE_URL=… pnpm evaluation:verify evaluation-heldout-a.json
```

`pnpm digests:rewrite` repairs persisted `configDigest`s in place if the format
changes; it re-derives from columns already stored and fetches no blocks.

### Things that will bite you

- **The backfill CANNOT reuse `SnapshotCollector`.** That reads venue state through
  the deployed Navy adapters, which exist only on the Anvil fork and have no Base
  mainnet history. `src/collector/archive/calls.ts` reads Comet, the Aave Pool and
  the mToken directly — one multicall3 `aggregate3` per origin, 39 legs.
- **`configDigest` is `identity|parameters`** (`src/domain/config-digest.ts`).
  Identity is protocol + market contract and is what `CONFIG_DIGEST_MISMATCH` pins;
  parameters include the rate-model address and coefficients and are what starts a
  new regime. Conflating them makes every venue permanently inadmissible at its
  first governance rate change — the registered window holds 6 Compound, 14 Aave
  and 11 Moonwell parameter regimes. A pin registers a SET of identities.
- **IRM parameters are read from chain, not from `DEFAULT_*_CONFIG`.** Those
  placeholders assert an 80% kink and a 6.25% low slope; Compound's real values are
  **90%** and **~3.60%**. Compound's rate is computed per-second and annualized
  afterwards, reproducing `Comet.getSupplyRate` exactly.
- **Gas and oracle inputs are MEASURED per origin** (`ChainCostSnapshot` +
  `src/evaluation/gas-series.ts`), not the five constants `harnessConfig` used to
  assert. The series refuses to extrapolate backwards and carries a digest, because
  the manifest's dataset hash covers snapshots and withdrawals only.
- **A registered artifact is FROZEN.** `prepareArtifact` returns it untouched;
  re-fitting it against a held-out era would train the policy on the data the run
  exists to test.
- **`SRCLA-REPORT.{md,json}` is generated by `pnpm phase4:run`** from
  `src/evaluation/report/render-markdown.ts`. The untracked `evaluation-v2/*.mjs`
  harness that produced every earlier version is retired.

### Still open

1. **§11.1's pinned-prestate fork replay is unwired.** `src/evaluation/fork-runner.ts`
   is the scaffold and nothing calls it, so the §11.5 gate reports it `NOT PRODUCED`
   and **blocks**. Expect the registered run to `FAIL` on that check alone. That is
   the designed behaviour — a reproducible `FAIL` is an acceptable outcome and
   §11.5 forbids retuning against held-out data to avoid one.
2. **Withdrawals are a registered schedule, not observed.** The Navy vault has no
   Base mainnet history, so §8.1's `W_H` has no real series. Its cadence is now in
   SECONDS: counted in snapshots it silently meant "every 7 hours" on hourly
   origins and demanded ~240% of the vault per reserve horizon.
3. **P8's `k` did not resolve.** The sweep in `freeze-artifact.ts` is a step
   function against a dispersion proxy, not an informative curve; scoring it needs
   turnover-vs-return through the replay. It is reported UNRESOLVED rather than set
   to a convenient value.
4. **`forecast/calibration.ts` still carries the F2/F3 shape** on the LIVE weekly
   calibration path. `select.ts` was its dead duplicate and is deleted;
   `forecast/grid-sweep.ts` is the registered replacement used by the evaluation.
5. **Reward emissions**: a live probe found no materially harvestable emissions on
   Base, so §9.2–9.4 ships tested and contributes a measured zero.

Open decisions that are the paper owner's, not the code's: the burned-window
placement above, the B0–B5 switch mapping (implemented from a reading of §11.2),
§9.2's material-change refresh trigger (only cache-age exists), the §9.2-vs-§9.3
conflict over an ended emission that still holds an accrued balance, and an
absolute dust allowance for residual pulls — no bps value can cover a base-unit
venue floor.
