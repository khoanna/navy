# Navy — Identity & Wallet Foundation (Design Spec)

**Date:** 2026-06-13
**Status:** Approved (design)
**Sub-project:** 1 of N in the Navy ecosystem (foundational)

---

## 0. Context: Navy ecosystem & decomposition

Navy is a Solana-based payment ecosystem with a payment gateway and wallets. It spans
three apps and seven subsystems:

1. **Identity & wallet foundation** ← *this spec*
2. Smart contracts (payment program; later a farming/delegation program)
3. Payment gateway (ZaloPay-style: order → hosted pay page + QR → scan-to-pay → settle)
4. Admin web panel (merchant approval & management)
5. Merchant web panel / dashboard (invoices, orders, settlements, API keys)
6. Mobile wallet (assets, scan-to-pay)
7. Farming agent (Navy-generated subwallet, delegated yield, auto-compound)

These are built as sequential sub-projects, each with its own spec → plan → build cycle,
in dependency order. **This spec covers only sub-project 1.** It delivers the identity,
authentication, and wallet-provisioning layer everything else depends on. It does **not**
build payments, invoices, QR, the merchant-approval workflow, or farming logic — it makes
them possible.

### Tech stack
- **Web (admin + merchant):** Next.js
- **Backend (API):** Nest.js
- **Mobile (user wallet):** Expo React Native
- **Chain:** Solana (devnet now → mainnet-beta later, config-driven)
- **Wallet infra / auth:** Privy (embedded wallets, social/passkey/email, non-custodial key sharding)

---

## 1. Scope & boundaries

**In scope:**
- User authentication + embedded wallet provisioning (Privy, mobile)
- Merchant authentication (dashboard login) + API credential issuance (ZaloPay-style) + payout-address registration
- Admin authentication (password + TOTP)
- Unified Navy session/JWT + role model in Nest.js
- Identity & wallet data model
- Farming-subwallet provisioning plumbing (keypair gen, encryption, signing-service interface) — *plumbing only, not farming logic*
- Network/config scaffolding (devnet → mainnet)
- Audit logging of privileged actions

**Out of scope (later sub-projects):**
- Payment orders, hosted pay page, QR generation, settlement engine
- Merchant approval workflow UI/state machine (only the `approval_status` field exists here)
- Farming/yield logic, pool integrations, compounding
- Asset display, transaction history UI

---

## 2. Architecture & components

```
┌─────────────┐   ┌──────────────┐   ┌──────────────┐
│ Expo Mobile │   │ Next.js Web  │   │ Next.js Web  │
│   (user)    │   │  (merchant)  │   │   (admin)    │
│ Privy RN SDK│   │ dashboard    │   │ pwd + TOTP   │
│             │   │ login + API  │   │              │
└──────┬──────┘   └──────┬───────┘   └──────┬───────┘
       │ Privy token     │ email+pwd        │ creds+TOTP
       ▼                 ▼                  ▼
        ┌───────────────────────────────────────┐
        │         Nest.js Backend (API)          │
        │  AuthModule  → verify each source,     │
        │                issue unified Navy JWT  │
        │  WalletModule→ Privy server SDK,       │
        │                subwallet provisioning  │
        │  SigningService (isolated) → KMS-ready │
        │                encrypt/sign, policy    │
        └───────────────┬───────────────────────┘
                        ▼
         PostgreSQL (users, merchants, admins,
         api_keys, farming_subwallets, sessions,
         audit_log)
                        │
            Privy (key custody/sharding) ·
            Solana RPC (devnet/mainnet via config)
```

**Backend modules (each a focused, independently testable unit):**
- `AuthModule` — verifies the three identity sources, issues/refreshes Navy JWTs, guards.
- `WalletModule` — Privy server SDK integration; farming-subwallet provisioning.
- `SigningService` — isolated component that owns the `Cipher` and produces signatures; the only place a subwallet plaintext key ever exists (transiently, in memory).
- `UserModule`, `MerchantModule`, `AdminModule` — profile/account management per role.
- `ConfigModule` — resolves network → RPC URL, Privy env, program IDs.
- `AuditModule` — append-only log of privileged actions.

---

## 3. Identity & authentication flows

All three sources converge on a single **Navy JWT** (short-lived access + refresh) carrying
`sub`, `role` (`user` | `merchant` | `admin`), and `walletAddress` (where applicable). One
Nest guard authorizes everything downstream.

### 3.1 User (mobile)
- Privy RN SDK handles **Google / Apple social, passkey (Face/Touch ID), email + SMS OTP**, and provisions the **non-custodial embedded Solana wallet** on device.
- Mobile sends the Privy access token to `POST /auth/privy`.
- Backend verifies the token against Privy's JWKS, upserts a `user` keyed by **Privy DID**, links the embedded wallet address, returns a Navy JWT.

### 3.2 Merchant (web) — ZaloPay-style integration model
- Merchant signs up / logs into a **dashboard** with email + password (Argon2 hashing; TOTP 2FA in a later iteration).
- Backend issues **API credentials**: `merchant_id`, `api_key`, and an `api_secret` used for **HMAC signing** of order-creation requests and webhook verification.
- Merchant connects a wallet (Phantom/Solflare) **once**, only to register a **payout address** — never to sign payments.
- Merchants do **not** receive a Navy wallet and do **not** sign transactions. Their server integrates via API keys; the payment/settlement engine is a later sub-project.

### 3.3 Admin (web)
- Email + password (Argon2) + **TOTP 2FA**.
- Returns a Navy JWT with `admin` role. Account lockout after N failed TOTP attempts.

---

## 4. Wallet model

- **User main wallet:** non-custodial, Privy-sharded (TEE + device). Backend never sees a private key. Used to store assets and pay invoices (later).
- **Merchant:** external pubkey registered as payout address only. Navy stores the address, never keys.
- **Farming subwallet (provisioning only in this sub-project):**
  - A **Navy-generated Solana keypair**, separate from the user's main wallet.
  - The user funds it by transferring SOL / USDC from their main wallet (later flow).
  - Private key encrypted at rest (see §6); plaintext key only ever exists transiently inside the isolated `SigningService`.
  - The agent (later sub-project) signs only via `SigningService`, under policy (§6).
  - **Main wallet stays non-custodial; only the farming subwallet is custodial-with-encryption** — the deliberately small, bounded "hot" surface.

---

## 5. Data model (core entities)

```
users(
  id, privy_did UNIQUE, primary_wallet, status, created_at
)

merchants(
  id, email UNIQUE, password_hash, business_name,
  approval_status,         -- enum: pending|approved|rejected (workflow is a later project)
  payout_address,          -- external Phantom/Solflare pubkey
  created_at
)

merchant_api_keys(
  id, merchant_id FK, api_key UNIQUE, secret_hash,
  status,                  -- active|revoked
  created_at
)

admins(
  id, email UNIQUE, password_hash, totp_secret, failed_totp_count
)

farming_subwallets(
  id, user_id FK, pubkey,
  encrypted_privkey,       -- AES-256-GCM ciphertext of the keypair secret
  data_key_wrapped,        -- per-subwallet data key, wrapped by master key (envelope)
  policy_json,             -- allowlisted programs, transfer constraints, caps
  status,                  -- active|disabled
  created_at
)

auth_sessions(
  id, subject_id, role, refresh_token_hash, expires_at, created_at
)

audit_log(
  id, actor, action, target, metadata_json, created_at  -- append-only
)
```

---

## 6. Trust boundaries & security

### 6.1 Key handling
- **No private keys at rest for the main wallet, ever.** Privy holds shards; Navy holds the address only.
- **Farming subwallet keys** are encrypted with **AES-256-GCM** using a **per-subwallet data key** (envelope structure). The data key is wrapped by a **master secret supplied via environment variable** (current decision).
- Encryption is implemented behind a small **`Cipher` interface**, so the master key can later move into a **KMS/HSM** (AWS/GCP KMS or Vault Transit) as a **one-class swap with no re-encryption** of stored ciphertext.

### 6.2 Accepted / documented residual risk
- Because the backend can decrypt subwallet keys to sign, Navy is **custodial over subwallet funds**. With the master secret in an environment variable, a simultaneous leak of **both the database and the env secret** would expose subwallet balances.
- This is an **accepted, documented risk** for the current phase, contained by the mitigations below, with a defined upgrade path (move master key to KMS/HSM before mainnet handles meaningful value).

### 6.3 Blast-radius containment (independent of where the secret lives)
- **Bounded surface:** only user-allocated farming funds sit in the subwallet; the main wallet is never exposed.
- **Isolated SigningService:** plaintext keys exist only transiently, in memory, inside a hardened signing component; the main API never touches raw keys.
- **Pre-sign policy:** the agent may call **only whitelisted DeFi programs** (deposit/harvest/compound) and may send funds **only back to the user's own main wallet** — never to an arbitrary address. Enforced in code before signing.
- **Full audit log** of every signature and every privileged action.

### 6.4 Other controls
- Secrets (Privy app secret, JWT signing key, admin TOTP, encryption master key) live in env/secrets manager, never in DB or client. Rotatable.
- Merchant API `api_secret` stored hashed; HMAC verification for order/webhook requests.
- Passwords hashed with Argon2; admin TOTP 2FA with lockout.
- Refresh tokens stored hashed; short-lived access tokens.

---

## 7. Networks & configuration

- `ConfigModule` resolves `NETWORK` (`devnet` | `mainnet`) → RPC URL, Privy environment, and program IDs. No hardcoded endpoints.
- **Devnet** for all development and testing (free airdrops, full feature parity for SPL/USDC/DeFi). Flip one env var to **mainnet-beta** for production.

---

## 8. Error handling & edge cases

- Access-token expiry → refresh-token rotation; reject reused refresh tokens.
- Privy webhook for account changes (linked methods, wallet rotation) → reconcile `users`.
- Merchant API request with bad HMAC / revoked key → reject + audit.
- Duplicate identity (same person, multiple Privy login methods) → keyed on Privy DID, single `user`.
- Admin lockout after N failed TOTP attempts.
- Solana RPC outage → retry with backoff; surface a clear error; never block auth on RPC.
- Subwallet signing requested while `status = disabled` or policy violation → reject + audit.

---

## 9. Testing strategy

- **Unit tests** per module: Privy token verification, merchant HMAC verify, admin TOTP, `Cipher` encrypt/decrypt round-trip, pre-sign policy validator (incl. bypass attempts). Privy & RPC mocked.
- **Integration tests** for each of the three auth flows end-to-end against **devnet + Privy test env**, issuing and validating Navy JWTs.
- **Security tests:** token replay, expired/forged tokens, refresh-token reuse, policy-bypass attempts on `SigningService`, attempt to sign a transfer to a non-user address (must fail).

---

## 10. Open items deferred to later sub-projects

- Payment order lifecycle, hosted pay page, QR, settlement → **Payment Gateway** project.
- Merchant approval workflow (state transitions, admin review UI) → **Admin Panel** project.
- Farming logic, pool integrations, compounding, subwallet funding UX → **Farming Agent** project.
- Move encryption master key into KMS/HSM → **before mainnet launch** (tracked as the documented upgrade path in §6).
