# Seed accounts (dev only)

Fixed local accounts created by `be/prisma/seed.mjs`.

**⚠️ Development only — never run this seed against production.** The credentials
and TOTP secret below are public in the repo.

## How to seed

```bash
# from be/ — Postgres must be up (the navy-pg container on :5433/navy_payments)
DATABASE_URL=postgresql://navy:navy@localhost:5433/navy_payments?schema=public pnpm prisma db seed
# or directly (seed.mjs loads be/.env itself):
node prisma/seed.mjs
```

The seed is **idempotent** (`upsert` by email) — safe to re-run. On each run it
prints the admin's current TOTP code.

## Accounts

### Admin  (fe `/admin`, login = password + TOTP)
| Field | Value |
|---|---|
| Email | `admin@navy.test` |
| Password | `adminpassword123` |
| TOTP secret (base32) | `JBSWY3DPEHPK3PXP` |

Add the TOTP secret to any authenticator app (Google Authenticator, 1Password,
`otplib`), or grab the live code from the seed's console output. Login flow:
`POST /auth/admin` `{ email, password, totp }`.

### Merchant  (fe `/merchant`, login = email + password)
| Field | Value |
|---|---|
| Email | `merchant@navy.test` |
| Password | `merchantpw123` |
| Business name | `Navy Seed Bakery` |
| Approval status | `approved` |
| Payout address | `0x0000000000000000000000000000000000000001` (placeholder) |

Login flow: `POST /auth/merchant` `{ email, password }`.

**Caveat — not registered on-chain.** The seed marks the merchant `approved` in
the DB so the dashboard is usable, but it does **not** run the admin approve
endpoint (`POST /admin/merchants/:id/approve` → `EvmRegistrarService.ensureRegisteredActive`),
so `onchainMerchantId` is null and the payout address is a placeholder. To take
real on-chain payments, set a real payout wallet and re-approve through the API
so the merchant is registered in `NavyPayments` on Sepolia.
