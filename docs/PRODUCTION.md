# Navy — Production Readiness & Accepted-Risk Register

Status as of 2026-07-04. This document records what the production-hardening pass delivered, the **accepted pre-mainnet risks** (deliberately deferred), and the **hard gates** that must close before Navy handles real funds on mainnet.

See `docs/superpowers/specs/2026-07-04-navy-production-hardening-design.md` (design) and `docs/superpowers/plans/2026-07-04-navy-production-hardening.md` (task-by-task record).

## What the hardening pass delivered (devnet, code-complete + tested)

- **Custody (A):** `PolicyValidator` rewritten to deny-by-default — allowlists exact instruction shapes for the farming flow, rejects `Approve`/`ApproveChecked`/`SetAuthority`/`CloseAccount`-to-attacker/`Burn`/unknown opcodes, and destination-checks every transfer. Keys are decrypted transiently only after policy passes.
- **Payment integrity (B):** settlement now goes through on-chain confirmation — `/submit` only settles on `meta.err == null` AND a matching `InvoicePaid` event (matched by invoice PDA id), reconciling payer + fee from the event. Durable single-use issued-tx store on the order row (atomic consume). Atomic settlement write (no double-webhook). Relayer balance guardrail before co-signing.
- **Auth/API (C):** global `ValidationPipe` + validated DTOs, `@nestjs/throttler` + `helmet`, refresh-token rotation + logout + session-revocation-checking guard, TOTP replay guard + time-boxed admin lockout, single-use payout-address challenge, user-JWT auth on pay endpoints (payer derived from token), secret-stripping response mappers.
- **Frontend (D):** fe origin/CSRF guards + json parse guards + refresh proxy; web-wallet authenticated pay flow, embedded-Privy-wallet pinning + signer assertion, strict QR host validation, BigInt-safe money formatting.
- **On-chain (E):** program upgraded in place on devnet (`5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az`) — `token::mint` constraints on treasury/payout, minimum invoice amount, stable `merchant_id` PDA seed + `set_merchant_payout`. Verified live on devnet.
- **Observability (F):** auth auditing (success + failure, no secrets), webhook timestamp/idempotency/retry/delivery-ledger, unauthenticated `/health` (db + rpc).

### Added 2026-07-11 — Delegated farming auto-funding (Privy session keys, devnet)
- Opt-in "auto-farm": the user delegates their Privy embedded wallet; the backend then auto-tops-up their farming subwallet from that wallet. Delegated signing (`@privy-io/server-auth` `walletApi.solana.signTransaction`) is used for **exactly one** operation — a relayer-fee-paid `SystemProgram.transfer` from the user's embedded wallet to **their own** subwallet, guarded by `DelegatedPolicyValidator` (only 1 system-transfer, destination = the caller's DB-owned subwallet, amount in `[NAVY_FARM_FUND_MIN, NAVY_FARM_FUND_MAX]`, leaving `NAVY_FARM_USER_RESERVE`). The audited subwallet `SigningService`/`PolicyValidator`/envelope-encryption is untouched.
- **Off by default:** disabled entirely unless `PRIVY_AUTHORIZATION_KEY` is set (endpoints 503, agent skips, signing throws). `enable` verifies the wallet is truly delegated via Privy before persisting; endpoints are per-route throttled (`fund-now` 3/min, `enable` 5/min); denials + unsigned-tx + revocation are audited; a post-sign assertion rejects any tx Privy returns without the user signature; stale delegation (revoked in Privy) is detected and cleared.
- Security-reviewed (adversarial) on devnet: no IDOR, no auth-key-gate bypass, no secret leakage. Residual **accepted devnet risks** below (#5, #6).

## Accepted pre-mainnet risks (documented, NOT fixed in this pass)

1. **Single master key.** `SUBWALLET_MASTER_KEY` (AES-256-GCM envelope) protects BOTH merchant API secrets AND every farming subwallet private key. Leaking that one env var compromises all subwallet funds + merchant webhook secrets simultaneously. The `Cipher` interface (`be/src/crypto/cipher.interface.ts`) is the seam. **Owner accepted this for devnet.**
2. **PolicyValidator Save-CPI residual.** Instructions to the allowlisted Save/Solend program are trusted opaquely (their internal CPIs aren't introspected). Bounded today because the adapter only ever builds deposit/withdraw against the single SOL reserve. A crafted Save instruction to that reserve is trusted.
3. **In-memory relayer rate cap.** The per-window issue cap / throttle token bucket is process-local — correct for a single instance only.
4. **`policyJson` not runtime-validated.** The subwallet policy JSON column is cast, not schema-parsed; malformed policy would throw rather than deny cleanly (rows are Navy-generated, so low risk).
5. **`PRIVY_AUTHORIZATION_KEY` is a raw env key that signs on user-owned embedded wallets.** Its blast radius is broader than `SUBWALLET_MASTER_KEY` (it authorizes signing on delegating users' *primary* Privy wallets, bounded to the funding transfer only by `DelegatedPolicyValidator`). Accepted for devnet; **must** move to KMS + rotation before mainnet (see hard gate below).
6. **Per-IP (not per-user) throttle + soft reserve.** The new endpoints add per-route IP throttling, but the cap is per-IP and process-local (see risk #3), and `NAVY_FARM_USER_RESERVE` is a soft ceiling enforced only in `computeFundAmount` (a TOCTOU between balance read and submit can undercut it; Solana runtime still enforces rent/fee validity). `NAVY_FARM_FUND_MAX` defaults to 1 SOL — set it explicitly for mainnet.

## Hard mainnet gates (MUST close before real funds)

### Key custody / signing
- [ ] Move the subwallet-signing key path and the relayer key to a real **KMS/HSM** (implement a `KmsCipher` behind the `Cipher` interface). No raw private keys in env/DB.
- [ ] Move **`PRIVY_AUTHORIZATION_KEY`** (server-side delegated-signing key for user embedded wallets) to the same KMS/HSM + a rotation path (re-register the Privy dashboard authorization keypair). Broadest blast radius of all keys — treat as top priority.
- [ ] **Separate keys per domain**: subwallet keys ≠ merchant API secrets ≠ relayer key ≠ Privy authorization key. Add a key-id/version to `SealedSecret` to enable rotation.
- [ ] **Per-user, distributed rate limits + relayer spend cap** for the delegated funding endpoints (current per-route throttle is per-IP + process-local; folds into the Redis rate-limiting gate under Infra/HA).

### On-chain
- [ ] **Third-party audit** of the `navy_payments` program before mainnet deploy.
- [ ] Transfer the program **upgrade authority to a multisig/governance** account (currently a single CLI keypair `4RQ8yjeGKNTfUTBZt3vHUPFiqzSygq6rXFNkFoGmuDrQ`).
- [ ] Consider constraining `Config.treasury` mint at config init (currently enforced at `pay_invoice` time).
- [ ] Real **Kamino mainnet yield adapter** behind `YieldAdapter` (devnet uses native SOL + Save; neither exists on mainnet with Circle USDC).
- [ ] Switch `NAVY_USDC_MINT` to Circle mainnet USDC; re-verify decimals + fee math.

### Infra / HA
- [ ] Distributed rate-limiting + relayer spend cap (Redis) — remove single-instance assumptions.
- [ ] Managed Postgres with backups + migrations in CI; secrets manager instead of `.env`.
- [ ] Webhook re-delivery: schedule retries of `WebhookDelivery` rows left `failed` (currently retried in-request only; the ledger exists for a background re-attempt worker).
- [ ] Metrics export + alerting on `/health`, relayer balance, webhook-failure rate, farming-deposit reverts.

### Compliance
- [ ] KYC/AML posture, ToS, custody licensing review — Navy holds user farming funds and processes payments.

## Runbooks
- Gateway bring-up: `be/scripts/gateway-bringup.md`.
- Devnet deploy config + keypairs: see `.env` (`NAVY_ADMIN_SECRET`, `NAVY_RELAYER_SECRET`, `SUBWALLET_MASTER_KEY`).
- On-chain upgrade (in place): `anchor build` → `solana program extend <id> <bytes>` (if the binary grew) → `solana program deploy <so> --program-id <id> --url devnet` → re-copy IDL to `be/src/onchain/navy_payments.json` → rewire backend seeds if the account layout changed. Keep the previous `.so` (`solana program dump`) for rollback.
