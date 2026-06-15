# Navy Payments Program (`navy_payments`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `navy_payments` Anchor program (Solana devnet) that pays USDC invoices once, splits a configurable fee to an admin treasury, pays admin-registered merchants, and supports gasless relayed payment — plus the TS client glue and admin CLI.

**Architecture:** A single Anchor program with `Config`, `Merchant`, and lazily-created `Invoice` PDAs. `pay_invoice` does an SPL `transfer_checked` CPI splitting `amount−fee` to the merchant payout and `fee` to the treasury, initializing the Invoice PDA as a one-time replay nonce. A relayer keypair is the fee/rent payer (gasless for the user, who only signs as token authority). Tests are TS/Mocha on localnet using a test-minted fake USDC.

**Tech Stack:** Anchor 0.32.0 · Rust 1.93 · Solana CLI 3.0 (Agave) · `anchor-spl` (SPL token CPI) · TypeScript + Mocha/Chai + `@solana/spl-token` for tests + client.

**Scope:** Sub-project 2 of Navy. Implements `docs/superpowers/specs/2026-06-13-navy-payments-program-design.md`. Delivers the program + IDL/client + admin CLI; the payment-gateway orchestration is sub-project 3.

> **Anchor 0.32 note (read first):** Anchor 0.32 is newer than some examples here. Where this plan shows Anchor/`anchor-spl` APIs (account macros, `InitSpace`, `transfer_checked`, `Token`/`TokenAccount` types, `associated_token`), **verify against the installed version** (`~/.cargo` crates / `anchor_spl` 0.32 docs) and adjust syntax while preserving behavior. `anchor build` and `anchor test` are the gates that prove the syntax is correct. Document any adjustment.

---

## File Structure

New Anchor workspace at `/home/khoa/Desktop/uni/onchain/`.

```
onchain/
├── Anchor.toml
├── Cargo.toml                       # workspace
├── package.json                     # TS test + client deps
├── tsconfig.json
├── programs/navy-payments/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                   # program module: instruction entrypoints + declare_id
│       ├── state.rs                 # Config, Merchant, Invoice account structs (+ InitSpace)
│       ├── errors.rs                # NavyError enum
│       ├── events.rs                # InvoicePaid event
│       └── instructions/
│           ├── mod.rs
│           ├── config.rs            # initialize_config, update_config (+ Accounts)
│           ├── merchant.rs          # register_merchant, set_merchant_active (+ Accounts)
│           └── pay_invoice.rs       # pay_invoice (+ Accounts)
├── client/
│   ├── index.ts                     # buildPayInvoiceTx + submitPayInvoice (relayer helper)
│   └── pdas.ts                      # PDA derivation helpers (config/merchant/invoice)
├── scripts/
│   └── admin.ts                     # init-config / update-config / register-merchant / set-active from env
└── tests/
    ├── navy-payments.config.ts      # config + merchant admin tests
    └── navy-payments.pay.ts         # pay_invoice tests (happy/replay/reject)
```

Splitting instructions into `instructions/*.rs` keeps each handler + its `Accounts` struct in one focused file. `state.rs`/`errors.rs`/`events.rs` are shared.

---

## Conventions for every task

- Run from `/home/khoa/Desktop/uni/onchain`.
- Build: `anchor build`. Test: `anchor test` (boots a local validator, runs the TS suite). A single test file: `anchor test --skip-build` after a build, or rely on `anchor test`.
- Commit after each task with the message in its final step. Git identity fallback: `git -c user.name=Navy -c user.email=capydata.xyz@gmail.com commit ...`.
- TDD cadence for Anchor: add the TS test for an instruction (red — instruction missing → test fails), implement the handler, `anchor test` (green), commit.

---

### Task 1: Scaffold Anchor workspace

**Files:** Create `onchain/` via `anchor init`, then adjust configs.

- [ ] **Step 1: Initialize the workspace**

```bash
cd /home/khoa/Desktop/uni
anchor init onchain --name navy-payments
cd onchain
```

- [ ] **Step 2: Pin Solana/Anchor in `Anchor.toml`**

Ensure `Anchor.toml` has:
```toml
[toolchain]
anchor_version = "0.32.0"

[features]
resolution = true
skip-lint = false

[programs.localnet]
navy_payments = "Navy11111111111111111111111111111111111111"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
```
(The program id placeholder is replaced in Step 4 by the real keypair-derived id.)

- [ ] **Step 3: Add `anchor-spl` to the program crate**

In `onchain/programs/navy-payments/Cargo.toml`, under `[dependencies]` add (verify versions resolve with Anchor 0.32):
```toml
anchor-lang = { version = "0.32.0", features = ["init-if-needed"] }
anchor-spl = "0.32.0"
```

- [ ] **Step 4: Sync the program id**

```bash
anchor keys sync
```
This writes the real program id into `declare_id!` and `Anchor.toml`. (If `anchor keys sync` is unavailable in 0.32, run `anchor keys list`, copy the id into `declare_id!` in `programs/navy-payments/src/lib.rs` and `Anchor.toml`.)

- [ ] **Step 5: Install TS test/client deps with pnpm**

```bash
corepack pnpm init 2>/dev/null || true
pnpm add -D ts-mocha mocha chai @types/mocha @types/chai typescript ts-node
pnpm add @coral-xyz/anchor @solana/web3.js @solana/spl-token
```
Ensure `onchain/tsconfig.json` exists with `"module": "commonjs"`, `"target": "es2020"`, `"esModuleInterop": true`. If `anchor init` created a `tsconfig.json`, keep it.

- [ ] **Step 6: Build the empty program**

Run: `anchor build`
Expected: builds successfully; generates `target/idl/navy_payments.json` and `target/types/navy_payments.ts`.

- [ ] **Step 7: Commit**

```bash
cd /home/khoa/Desktop/uni
git add onchain
git commit -m "chore(onchain): scaffold Anchor workspace for navy_payments"
```

> Note: `onchain/.gitignore` from `anchor init` ignores `target/` and `node_modules/`. Keep `Anchor.toml`, `programs/`, `tests/`, `package.json`, `pnpm-lock.yaml` tracked.

---

### Task 2: Program state, errors, events

**Files:** Create `programs/navy-payments/src/state.rs`, `errors.rs`, `events.rs`; modify `lib.rs`.

- [ ] **Step 1: Implement `state.rs`**

```rust
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,   // USDC token account receiving fees
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,       // 100 = 1%
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub merchant_authority: Pubkey,
    pub payout: Pubkey,     // USDC token account receiving payments
    pub active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Invoice {
    pub payer: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub paid_at: i64,
    pub bump: u8,
}

pub const MAX_FEE_BPS: u16 = 1000; // 10% ceiling
```

- [ ] **Step 2: Implement `errors.rs`**

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum NavyError {
    #[msg("fee_bps exceeds the maximum allowed")]
    FeeTooHigh,
    #[msg("merchant is not active")]
    MerchantInactive,
    #[msg("invoice has expired")]
    InvoiceExpired,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("token mint does not match the configured USDC mint")]
    WrongMint,
    #[msg("arithmetic overflow")]
    MathOverflow,
    #[msg("only the configured admin may perform this action")]
    NotAdmin,
}
```

- [ ] **Step 3: Implement `events.rs`**

```rust
use anchor_lang::prelude::*;

#[event]
pub struct InvoicePaid {
    pub merchant_authority: Pubkey,
    pub invoice_id: [u8; 16],
    pub payer: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub paid_at: i64,
}
```

- [ ] **Step 4: Wire modules in `lib.rs`** (keep the generated `declare_id!`)

```rust
use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod events;
pub mod instructions;

use instructions::*;

declare_id!("REPLACE_WITH_SYNCED_ID"); // keep whatever `anchor keys sync` wrote

#[program]
pub mod navy_payments {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, fee_bps: u16, usdc_mint: Pubkey) -> Result<()> {
        instructions::initialize_config(ctx, fee_bps, usdc_mint)
    }
    pub fn update_config(ctx: Context<UpdateConfig>, fee_bps: Option<u16>, treasury: Option<Pubkey>) -> Result<()> {
        instructions::update_config(ctx, fee_bps, treasury)
    }
    pub fn register_merchant(ctx: Context<RegisterMerchant>, payout: Pubkey) -> Result<()> {
        instructions::register_merchant(ctx, payout)
    }
    pub fn set_merchant_active(ctx: Context<SetMerchantActive>, active: bool) -> Result<()> {
        instructions::set_merchant_active(ctx, active)
    }
    pub fn pay_invoice(ctx: Context<PayInvoice>, invoice_id: [u8; 16], amount: u64, expiry: i64) -> Result<()> {
        instructions::pay_invoice(ctx, invoice_id, amount, expiry)
    }
}
```

- [ ] **Step 5: Create `instructions/mod.rs`** (stubs wired in subsequent tasks)

```rust
pub mod config;
pub mod merchant;
pub mod pay_invoice;

pub use config::*;
pub use merchant::*;
pub use pay_invoice::*;
```

- [ ] **Step 6: Create empty instruction files so it compiles**

Create `instructions/config.rs`, `instructions/merchant.rs`, `instructions/pay_invoice.rs` each with `use anchor_lang::prelude::*;` and the handler + `Accounts` struct stubs implemented in Tasks 3–5. To keep Step 7 building, implement the full Task 3–5 code now is NOT required; instead, this task ends at module wiring. **Move the build verification to the end of Task 3** (the first task that provides a complete instruction). For now, leave the three instruction files containing only `use anchor_lang::prelude::*;` plus a `// implemented in Task N` comment — the crate will not fully build until Task 3 adds the first real handler, which is expected.

- [ ] **Step 7: Commit (compile deferred to Task 3)**

```bash
git add onchain/programs/navy-payments/src
git commit -m "feat(onchain): program state, errors, events, module wiring"
```

---

### Task 3: `initialize_config` + `update_config`

**Files:** Implement `instructions/config.rs`; add `tests/navy-payments.config.ts`.

- [ ] **Step 1: Write the failing test** — `tests/navy-payments.config.ts`

```ts
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { createMint, createAccount } from '@solana/spl-token';
import { assert } from 'chai';
import { NavyPayments } from '../target/types/navy_payments';

describe('config', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as Program<NavyPayments>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  let usdcMint: PublicKey;
  let treasury: PublicKey;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);

  before(async () => {
    usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    treasury = await createAccount(provider.connection, admin, usdcMint, admin.publicKey);
  });

  it('initializes config with fee_bps and treasury', async () => {
    await program.methods.initializeConfig(100, usdcMint)
      .accounts({ config: configPda, treasury, admin: admin.publicKey })
      .rpc();
    const cfg = await program.account.config.fetch(configPda);
    assert.equal(cfg.feeBps, 100);
    assert.ok(cfg.treasury.equals(treasury));
    assert.ok(cfg.usdcMint.equals(usdcMint));
    assert.ok(cfg.admin.equals(admin.publicKey));
  });

  it('rejects fee_bps above the ceiling', async () => {
    try {
      await program.methods.updateConfig(2000, null)
        .accounts({ config: configPda, admin: admin.publicKey }).rpc();
      assert.fail('should have thrown');
    } catch (e: any) {
      assert.match(e.toString(), /FeeTooHigh/);
    }
  });

  it('updates the fee', async () => {
    await program.methods.updateConfig(250, null)
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();
    const cfg = await program.account.config.fetch(configPda);
    assert.equal(cfg.feeBps, 250);
  });

  it('rejects a non-admin updating config', async () => {
    const stranger = Keypair.generate();
    try {
      await program.methods.updateConfig(300, null)
        .accounts({ config: configPda, admin: stranger.publicKey })
        .signers([stranger]).rpc();
      assert.fail('should have thrown');
    } catch (e: any) {
      assert.ok(e); // has_one/constraint rejects
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `anchor test`
Expected: FAIL — `initializeConfig` not implemented / build incomplete.

- [ ] **Step 3: Implement `instructions/config.rs`**

```rust
use anchor_lang::prelude::*;
use crate::state::{Config, MAX_FEE_BPS};
use crate::errors::NavyError;

pub fn initialize_config(ctx: Context<InitializeConfig>, fee_bps: u16, usdc_mint: Pubkey) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, NavyError::FeeTooHigh);
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.admin.key();
    c.treasury = ctx.accounts.treasury.key();
    c.usdc_mint = usdc_mint;
    c.fee_bps = fee_bps;
    c.bump = ctx.bumps.config;
    Ok(())
}

pub fn update_config(ctx: Context<UpdateConfig>, fee_bps: Option<u16>, treasury: Option<Pubkey>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    if let Some(f) = fee_bps {
        require!(f <= MAX_FEE_BPS, NavyError::FeeTooHigh);
        c.fee_bps = f;
    }
    if let Some(t) = treasury {
        c.treasury = t;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init, payer = admin, space = 8 + Config::INIT_SPACE,
        seeds = [b"config"], bump
    )]
    pub config: Account<'info, Config>,
    /// CHECK: treasury is a token account validated off-chain at setup; stored as-is.
    pub treasury: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ NavyError::NotAdmin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}
```

> Verify against Anchor 0.32: `ctx.bumps.config` access, `has_one = admin @ Error` syntax, `Account::INIT_SPACE` from `#[derive(InitSpace)]`. Adjust if the macro surface differs.

- [ ] **Step 4: Run to verify it passes**

Run: `anchor test`
Expected: the 4 config tests PASS (build now completes since one real instruction exists; the other two instruction files still have stubs — ensure they at least compile as empty modules; if the crate fails because `register_merchant`/`pay_invoice` are referenced in `lib.rs` but unimplemented, temporarily implement them as `Ok(())` stubs WITH minimal empty `Accounts` structs so the crate builds, to be completed in Tasks 4–5).

> Build-ordering guidance: `lib.rs` references all five handlers, so the crate only builds once all five exist. Provide minimal compiling stubs for `register_merchant`, `set_merchant_active`, and `pay_invoice` in their files now (empty `Accounts` struct + `Ok(())`), then flesh them out in Tasks 4–5. Show the stubs:

`instructions/merchant.rs` (stub):
```rust
use anchor_lang::prelude::*;
pub fn register_merchant(_ctx: Context<RegisterMerchant>, _payout: Pubkey) -> Result<()> { Ok(()) }
pub fn set_merchant_active(_ctx: Context<SetMerchantActive>, _active: bool) -> Result<()> { Ok(()) }
#[derive(Accounts)] pub struct RegisterMerchant<'info> { pub admin: Signer<'info> }
#[derive(Accounts)] pub struct SetMerchantActive<'info> { pub admin: Signer<'info> }
```
`instructions/pay_invoice.rs` (stub):
```rust
use anchor_lang::prelude::*;
pub fn pay_invoice(_ctx: Context<PayInvoice>, _invoice_id: [u8;16], _amount: u64, _expiry: i64) -> Result<()> { Ok(()) }
#[derive(Accounts)] pub struct PayInvoice<'info> { pub payer: Signer<'info> }
```

- [ ] **Step 5: Commit**

```bash
git add onchain/programs/navy-payments/src/instructions onchain/tests/navy-payments.config.ts
git commit -m "feat(onchain): initialize_config and update_config with admin gating"
```

---

### Task 4: `register_merchant` + `set_merchant_active`

**Files:** Implement `instructions/merchant.rs` (replace stubs); extend `tests/navy-payments.config.ts` (or a new `tests/navy-payments.merchant.ts`).

- [ ] **Step 1: Write the failing test** — `tests/navy-payments.merchant.ts`

```ts
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { createMint, createAccount } from '@solana/spl-token';
import { assert } from 'chai';
import { NavyPayments } from '../target/types/navy_payments';

describe('merchant registry', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as Program<NavyPayments>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const merchantAuthority = Keypair.generate();
  let usdcMint: PublicKey;
  let payout: PublicKey;
  const [merchantPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('merchant'), merchantAuthority.publicKey.toBuffer()], program.programId);

  before(async () => {
    usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    payout = await createAccount(provider.connection, admin, usdcMint, merchantAuthority.publicKey);
  });

  it('admin registers a merchant', async () => {
    await program.methods.registerMerchant(payout)
      .accounts({ merchant: merchantPda, merchantAuthority: merchantAuthority.publicKey, admin: admin.publicKey,
        config: PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)[0] })
      .rpc();
    const m = await program.account.merchant.fetch(merchantPda);
    assert.ok(m.payout.equals(payout));
    assert.equal(m.active, true);
  });

  it('admin deactivates the merchant', async () => {
    await program.methods.setMerchantActive(false)
      .accounts({ merchant: merchantPda, admin: admin.publicKey,
        config: PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)[0] })
      .rpc();
    const m = await program.account.merchant.fetch(merchantPda);
    assert.equal(m.active, false);
  });

  it('rejects a non-admin registering a merchant', async () => {
    const stranger = Keypair.generate();
    const other = Keypair.generate();
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('merchant'), other.publicKey.toBuffer()], program.programId);
    try {
      await program.methods.registerMerchant(payout)
        .accounts({ merchant: pda, merchantAuthority: other.publicKey, admin: stranger.publicKey,
          config: PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)[0] })
        .signers([stranger]).rpc();
      assert.fail('should have thrown');
    } catch (e: any) { assert.ok(e); }
  });
});
```

> This suite assumes config was initialized. Since `anchor test` runs all files against one validator and ordering isn't guaranteed, initialize config inside this file's `before` too (idempotent: catch "already in use" if the config PDA already exists, or use a try/catch around `initializeConfig`). Add that to `before`.

- [ ] **Step 2: Run to verify it fails**

Run: `anchor test`
Expected: FAIL — `register_merchant` is a no-op stub, so `merchant.fetch` fails / assertions fail.

- [ ] **Step 3: Implement `instructions/merchant.rs`**

```rust
use anchor_lang::prelude::*;
use crate::state::{Config, Merchant};
use crate::errors::NavyError;

pub fn register_merchant(ctx: Context<RegisterMerchant>, payout: Pubkey) -> Result<()> {
    let m = &mut ctx.accounts.merchant;
    m.merchant_authority = ctx.accounts.merchant_authority.key();
    m.payout = payout;
    m.active = true;
    m.bump = ctx.bumps.merchant;
    Ok(())
}

pub fn set_merchant_active(ctx: Context<SetMerchantActive>, active: bool) -> Result<()> {
    ctx.accounts.merchant.active = active;
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ NavyError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(
        init, payer = admin, space = 8 + Merchant::INIT_SPACE,
        seeds = [b"merchant", merchant_authority.key().as_ref()], bump
    )]
    pub merchant: Account<'info, Merchant>,
    /// CHECK: identity key only; merchant authority does not sign registration (admin does).
    pub merchant_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetMerchantActive<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ NavyError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub merchant: Account<'info, Merchant>,
    pub admin: Signer<'info>,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `anchor test`
Expected: merchant tests PASS (and config tests still PASS).

- [ ] **Step 5: Commit**

```bash
git add onchain/programs/navy-payments/src/instructions/merchant.rs onchain/tests/navy-payments.merchant.ts
git commit -m "feat(onchain): admin-gated merchant registry"
```

---

### Task 5: `pay_invoice` (USDC split + replay + gasless)

**Files:** Implement `instructions/pay_invoice.rs` (replace stub) + `events.rs` already exists; add `tests/navy-payments.pay.ts`.

- [ ] **Step 1: Write the failing test** — `tests/navy-payments.pay.ts`

```ts
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { createMint, createAccount, mintTo, getAccount } from '@solana/spl-token';
import { assert } from 'chai';
import { NavyPayments } from '../target/types/navy_payments';

describe('pay_invoice', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as Program<NavyPayments>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const merchantAuthority = Keypair.generate();
  const user = Keypair.generate();
  let usdcMint: PublicKey, treasury: PublicKey, payout: PublicKey, userAta: PublicKey;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const [merchantPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('merchant'), merchantAuthority.publicKey.toBuffer()], program.programId);

  const invoiceId = Buffer.alloc(16); invoiceId.write('inv-0001');
  const amount = new anchor.BN(1_000_000); // 1.0 USDC (6 decimals)
  const future = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);

  before(async () => {
    usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    treasury = await createAccount(provider.connection, admin, usdcMint, admin.publicKey);
    payout = await createAccount(provider.connection, admin, usdcMint, merchantAuthority.publicKey);
    userAta = await createAccount(provider.connection, admin, usdcMint, user.publicKey);
    await mintTo(provider.connection, admin, usdcMint, userAta, admin, 5_000_000);

    try {
      await program.methods.initializeConfig(100, usdcMint)
        .accounts({ config: configPda, treasury, admin: admin.publicKey }).rpc();
    } catch { /* config may already exist from another suite; update it to this mint/treasury */
      await program.methods.updateConfig(100, treasury).accounts({ config: configPda, admin: admin.publicKey }).rpc();
    }
    await program.methods.registerMerchant(payout)
      .accounts({ config: configPda, merchant: merchantPda, merchantAuthority: merchantAuthority.publicKey, admin: admin.publicKey })
      .rpc();
  });

  const [invoicePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), merchantAuthority.publicKey.toBuffer(), invoiceId], program.programId);

  it('pays an invoice: 99% to merchant, 1% to treasury, marks paid', async () => {
    // NOTE: this test's config.usdcMint must equal the mint created here. If a prior suite set a
    // different mint, run updateConfig in before (done above) — but updateConfig does not change
    // usdc_mint. To keep suites independent, this suite uses its OWN freshly-init config IF none
    // exists; if a conflicting mint exists, see the README note to run `anchor test` on pay alone.
    await program.methods.payInvoice([...invoiceId], amount, future)
      .accounts({
        config: configPda, merchant: merchantPda, invoice: invoicePda,
        payerToken: userAta, merchantPayout: payout, treasury,
        usdcMint, payer: user.publicKey, relayer: admin.publicKey,
      })
      .signers([user])
      .rpc();

    const payoutAcc = await getAccount(provider.connection, payout);
    const treasuryAcc = await getAccount(provider.connection, treasury);
    assert.equal(payoutAcc.amount.toString(), '990000'); // 0.99 USDC
    assert.equal(treasuryAcc.amount.toString(), '10000'); // 0.01 USDC
    const inv = await program.account.invoice.fetch(invoicePda);
    assert.equal(inv.amount.toString(), '1000000');
    assert.equal(inv.fee.toString(), '10000');
  });

  it('rejects paying the same invoice twice (replay)', async () => {
    try {
      await program.methods.payInvoice([...invoiceId], amount, future)
        .accounts({ config: configPda, merchant: merchantPda, invoice: invoicePda,
          payerToken: userAta, merchantPayout: payout, treasury, usdcMint,
          payer: user.publicKey, relayer: admin.publicKey })
        .signers([user]).rpc();
      assert.fail('replay should fail');
    } catch (e: any) { assert.ok(e); /* Invoice PDA already initialized */ }
  });

  it('rejects an expired invoice', async () => {
    const id2 = Buffer.alloc(16); id2.write('inv-0002');
    const [pda2] = PublicKey.findProgramAddressSync(
      [Buffer.from('invoice'), merchantAuthority.publicKey.toBuffer(), id2], program.programId);
    const past = new anchor.BN(Math.floor(Date.now() / 1000) - 10);
    try {
      await program.methods.payInvoice([...id2], amount, past)
        .accounts({ config: configPda, merchant: merchantPda, invoice: pda2,
          payerToken: userAta, merchantPayout: payout, treasury, usdcMint,
          payer: user.publicKey, relayer: admin.publicKey })
        .signers([user]).rpc();
      assert.fail('expired should fail');
    } catch (e: any) { assert.match(e.toString(), /InvoiceExpired/); }
  });

  it('rejects an inactive merchant', async () => {
    await program.methods.setMerchantActive(false)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
    const id3 = Buffer.alloc(16); id3.write('inv-0003');
    const [pda3] = PublicKey.findProgramAddressSync(
      [Buffer.from('invoice'), merchantAuthority.publicKey.toBuffer(), id3], program.programId);
    try {
      await program.methods.payInvoice([...id3], amount, future)
        .accounts({ config: configPda, merchant: merchantPda, invoice: pda3,
          payerToken: userAta, merchantPayout: payout, treasury, usdcMint,
          payer: user.publicKey, relayer: admin.publicKey })
        .signers([user]).rpc();
      assert.fail('inactive merchant should fail');
    } catch (e: any) { assert.match(e.toString(), /MerchantInactive/); }
    await program.methods.setMerchantActive(true)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
  });
});
```

> Cross-suite config note: because all test files share one validator and the `config` PDA is global, ensure only ONE suite calls `initializeConfig` with a given mint, or run pay tests in isolation. The pay suite's `before` tolerates an existing config but cannot change `usdc_mint`; if you hit a mint mismatch, the simplest fix is to make `usdc_mint` updatable too (add it to `update_config`) OR run `anchor test tests/navy-payments.pay.ts` alone. Implementer: add `usdc_mint: Option<Pubkey>` to `update_config` so suites can converge on one mint — update `update_config` signature, `lib.rs`, and the config test accordingly. Document this addition.

- [ ] **Step 2: Run to verify it fails**

Run: `anchor test`
Expected: FAIL — `pay_invoice` stub does nothing; balances unchanged.

- [ ] **Step 3: Implement `instructions/pay_invoice.rs`**

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, TransferChecked};
use crate::state::{Config, Merchant, Invoice};
use crate::errors::NavyError;
use crate::events::InvoicePaid;

pub fn pay_invoice(ctx: Context<PayInvoice>, _invoice_id: [u8; 16], amount: u64, expiry: i64) -> Result<()> {
    require!(amount > 0, NavyError::ZeroAmount);
    require!(ctx.accounts.merchant.active, NavyError::MerchantInactive);
    let now = Clock::get()?.unix_timestamp;
    require!(now <= expiry, NavyError::InvoiceExpired);

    let config = &ctx.accounts.config;
    require_keys_eq!(ctx.accounts.usdc_mint.key(), config.usdc_mint, NavyError::WrongMint);

    let fee: u64 = (amount as u128)
        .checked_mul(config.fee_bps as u128).ok_or(NavyError::MathOverflow)?
        .checked_div(10_000).ok_or(NavyError::MathOverflow)? as u64;
    let to_merchant = amount.checked_sub(fee).ok_or(NavyError::MathOverflow)?;
    let decimals = ctx.accounts.usdc_mint.decimals;

    // amount - fee -> merchant payout
    token::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
            from: ctx.accounts.payer_token.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            to: ctx.accounts.merchant_payout.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        }),
        to_merchant, decimals,
    )?;
    // fee -> treasury
    if fee > 0 {
        token::transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.payer_token.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            }),
            fee, decimals,
        )?;
    }

    let invoice = &mut ctx.accounts.invoice;
    invoice.payer = ctx.accounts.payer.key();
    invoice.amount = amount;
    invoice.fee = fee;
    invoice.paid_at = now;
    invoice.bump = ctx.bumps.invoice;

    emit!(InvoicePaid {
        merchant_authority: ctx.accounts.merchant.merchant_authority,
        invoice_id: _invoice_id,
        payer: ctx.accounts.payer.key(),
        amount, fee, paid_at: now,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(invoice_id: [u8; 16])]
pub struct PayInvoice<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"merchant", merchant.merchant_authority.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    #[account(
        init, payer = relayer, space = 8 + Invoice::INIT_SPACE,
        seeds = [b"invoice", merchant.merchant_authority.as_ref(), &invoice_id], bump
    )]
    pub invoice: Account<'info, Invoice>,
    #[account(mut, token::mint = usdc_mint, token::authority = payer)]
    pub payer_token: Account<'info, TokenAccount>,
    #[account(mut, address = merchant.payout)]
    pub merchant_payout: Account<'info, TokenAccount>,
    #[account(mut, address = config.treasury)]
    pub treasury: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub payer: Signer<'info>,        // token authority (user) — gasless: not the fee payer
    #[account(mut)]
    pub relayer: Signer<'info>,      // fee + rent payer (Navy)
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
```

> Verify against anchor-spl 0.32: `token::transfer_checked` + `TransferChecked` struct field names; `token::mint`/`token::authority` account constraints; `Mint`/`TokenAccount`/`Token` import paths (0.32 may prefer `anchor_spl::token_interface` for Token-2022 — for classic SPL the `token` module is correct). The `address = merchant.payout` constraint enforces the registered payout; `address = config.treasury` enforces the fee destination.

- [ ] **Step 4: Run to verify it passes**

Run: `anchor test`
Expected: all `pay_invoice` tests PASS (split math 990000/10000, replay rejected, expired rejected, inactive rejected) plus prior suites still green.

- [ ] **Step 5: Commit**

```bash
git add onchain/programs/navy-payments/src/instructions/pay_invoice.rs onchain/tests/navy-payments.pay.ts onchain/programs/navy-payments/src/lib.rs
git commit -m "feat(onchain): pay_invoice with USDC fee split, replay protection, gasless relay"
```

---

### Task 6: TS client glue (`buildPayInvoiceTx` + relayer submit + PDAs)

**Files:** Create `client/pdas.ts`, `client/index.ts`; add a client test that dogfoods them in `tests/navy-payments.pay.ts` (or a new `tests/client.ts`).

- [ ] **Step 1: Implement `client/pdas.ts`**

```ts
import { PublicKey } from '@solana/web3.js';

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
}
export function merchantPda(programId: PublicKey, merchantAuthority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('merchant'), merchantAuthority.toBuffer()], programId)[0];
}
export function invoicePda(programId: PublicKey, merchantAuthority: PublicKey, invoiceId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), merchantAuthority.toBuffer(), Buffer.from(invoiceId)], programId)[0];
}
```

- [ ] **Step 2: Implement `client/index.ts`**

```ts
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Transaction, Keypair, Connection } from '@solana/web3.js';
import { configPda, merchantPda, invoicePda } from './pdas';

export interface PayInvoiceParams {
  merchantAuthority: PublicKey;
  payout: PublicKey;          // merchant payout token account
  treasury: PublicKey;        // config treasury token account
  usdcMint: PublicKey;
  invoiceId: Uint8Array;      // 16 bytes
  amount: bigint;
  expiry: number;             // unix seconds
  payer: PublicKey;           // user (token authority)
  relayer: PublicKey;         // fee + rent payer
}

/** Build the unsigned pay_invoice transaction with the relayer as fee payer. */
export async function buildPayInvoiceTx(program: Program, p: PayInvoiceParams): Promise<Transaction> {
  const pid = program.programId;
  const ix = await program.methods
    .payInvoice([...p.invoiceId], { toString: () => p.amount.toString() } as any, p.expiry as any)
    .accounts({
      config: configPda(pid), merchant: merchantPda(pid, p.merchantAuthority),
      invoice: invoicePda(pid, p.merchantAuthority, p.invoiceId),
      payerToken: await userUsdcAta(p.payer, p.usdcMint),
      merchantPayout: p.payout, treasury: p.treasury, usdcMint: p.usdcMint,
      payer: p.payer, relayer: p.relayer,
    })
    .instruction();
  const tx = new Transaction().add(ix);
  tx.feePayer = p.relayer;
  return tx;
}

async function userUsdcAta(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const { getAssociatedTokenAddress } = await import('@solana/spl-token');
  return getAssociatedTokenAddress(mint, owner);
}

/** Relayer co-signs (fee payer) a user-partial-signed tx and submits it. */
export async function submitPayInvoice(
  connection: Connection, tx: Transaction, relayer: Keypair,
): Promise<string> {
  tx.partialSign(relayer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
```

> The `amount`/`expiry` BN coercion above is illustrative — use `new anchor.BN(p.amount.toString())` and a JS number for `expiry`. Verify the Anchor 0.32 `.methods.payInvoice(...)` arg types from the generated `target/types/navy_payments.ts` and pass `BN`s where the IDL expects `u64`/`i64`. Fix the coercion to the real generated types so it compiles.

- [ ] **Step 3: Add a client dogfood test** in `tests/client.ts`

```ts
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { createMint, createAccount, mintTo } from '@solana/spl-token';
import { assert } from 'chai';
import { NavyPayments } from '../target/types/navy_payments';
import { buildPayInvoiceTx, submitPayInvoice } from '../client';

describe('client helpers', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as Program<NavyPayments>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  it('buildPayInvoiceTx + submitPayInvoice pays an invoice end to end', async () => {
    const merchantAuthority = Keypair.generate();
    const user = Keypair.generate();
    const usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    const treasury = await createAccount(provider.connection, admin, usdcMint, admin.publicKey);
    const payout = await createAccount(provider.connection, admin, usdcMint, merchantAuthority.publicKey);
    // user ATA created via @solana/spl-token associated account:
    const { getOrCreateAssociatedTokenAccount } = await import('@solana/spl-token');
    const userAta = await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, user.publicKey);
    await mintTo(provider.connection, admin, usdcMint, userAta.address, admin, 2_000_000);

    const cfg = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)[0];
    try { await program.methods.initializeConfig(100, usdcMint).accounts({ config: cfg, treasury, admin: admin.publicKey }).rpc(); }
    catch { await program.methods.updateConfig(100, treasury, usdcMint).accounts({ config: cfg, admin: admin.publicKey }).rpc(); }
    await program.methods.registerMerchant(payout)
      .accounts({ config: cfg, merchant: PublicKey.findProgramAddressSync([Buffer.from('merchant'), merchantAuthority.publicKey.toBuffer()], program.programId)[0],
        merchantAuthority: merchantAuthority.publicKey, admin: admin.publicKey }).rpc();

    const invoiceId = new Uint8Array(16); invoiceId.set([9, 9, 9]);
    const tx = await buildPayInvoiceTx(program as any, {
      merchantAuthority: merchantAuthority.publicKey, payout, treasury, usdcMint,
      invoiceId, amount: 1_000_000n, expiry: Math.floor(Date.now() / 1000) + 600,
      payer: user.publicKey, relayer: admin.publicKey,
    });
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
    tx.partialSign(user); // user authorizes
    const sig = await submitPayInvoice(provider.connection, tx, admin); // relayer co-signs + submits
    assert.ok(sig);
  });
});
```

> This test depends on `update_config` accepting `usdc_mint` (added in Task 5's note). It also uses the ATA address for the user; ensure `buildPayInvoiceTx` derives the same ATA (it uses `getAssociatedTokenAddress`). If the user's ATA must be created, the test pre-creates it via `getOrCreateAssociatedTokenAccount`.

- [ ] **Step 4: Run to verify**

Run: `anchor test`
Expected: client dogfood test PASSES alongside all prior suites.

- [ ] **Step 5: Commit**

```bash
git add onchain/client onchain/tests/client.ts
git commit -m "feat(onchain): TS client — PDA helpers, buildPayInvoiceTx, relayer submit"
```

---

### Task 7: Admin CLI (env-seeded config + merchant registration)

**Files:** Create `scripts/admin.ts`.

- [ ] **Step 1: Implement `scripts/admin.ts`**

```ts
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import fs from 'fs';
import { configPda, merchantPda } from '../client/pdas';

// Usage:
//   NAVY_FEE_BPS=100 NAVY_TREASURY=<ata> NAVY_USDC_MINT=<mint> ANCHOR_WALLET=~/.config/solana/id.json \
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com pnpm exec ts-node scripts/admin.ts init-config
//   ... register-merchant <merchantAuthorityPubkey> <payoutTokenAccount>
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const cmd = process.argv[2];
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as anchor.Program;
  const pid = program.programId;
  const admin = (provider.wallet as anchor.Wallet).payer;

  if (cmd === 'init-config') {
    const feeBps = parseInt(env('NAVY_FEE_BPS'), 10);
    const treasury = new PublicKey(env('NAVY_TREASURY'));
    const usdcMint = new PublicKey(env('NAVY_USDC_MINT'));
    await program.methods.initializeConfig(feeBps, usdcMint)
      .accounts({ config: configPda(pid), treasury, admin: admin.publicKey }).rpc();
    console.log('config initialized', { feeBps, treasury: treasury.toBase58(), usdcMint: usdcMint.toBase58() });
  } else if (cmd === 'update-config') {
    const feeBps = process.env.NAVY_FEE_BPS ? parseInt(process.env.NAVY_FEE_BPS, 10) : null;
    const treasury = process.env.NAVY_TREASURY ? new PublicKey(process.env.NAVY_TREASURY) : null;
    const usdcMint = process.env.NAVY_USDC_MINT ? new PublicKey(process.env.NAVY_USDC_MINT) : null;
    await program.methods.updateConfig(feeBps, treasury, usdcMint)
      .accounts({ config: configPda(pid), admin: admin.publicKey }).rpc();
    console.log('config updated');
  } else if (cmd === 'register-merchant') {
    const merchantAuthority = new PublicKey(process.argv[3]);
    const payout = new PublicKey(process.argv[4]);
    await program.methods.registerMerchant(payout)
      .accounts({ config: configPda(pid), merchant: merchantPda(pid, merchantAuthority),
        merchantAuthority, admin: admin.publicKey }).rpc();
    console.log('merchant registered', merchantAuthority.toBase58());
  } else if (cmd === 'set-active') {
    const merchantAuthority = new PublicKey(process.argv[3]);
    const active = process.argv[4] === 'true';
    await program.methods.setMerchantActive(active)
      .accounts({ config: configPda(pid), merchant: merchantPda(pid, merchantAuthority), admin: admin.publicKey }).rpc();
    console.log('merchant active =', active);
  } else {
    console.error('commands: init-config | update-config | register-merchant <auth> <payout> | set-active <auth> <true|false>');
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify the CLI compiles**

Run: `pnpm exec tsc --noEmit -p tsconfig.json` (or `pnpm exec ts-node --transpile-only scripts/admin.ts` with no command to hit the usage error)
Expected: no type errors / prints the usage line.

> This CLI talks to whatever `ANCHOR_PROVIDER_URL` points at (localnet for a smoke, devnet for real). `update_config` now takes `(feeBps, treasury, usdcMint)` — confirm the signature matches the program after Task 5's `usdc_mint` addition.

- [ ] **Step 3: Commit**

```bash
git add onchain/scripts/admin.ts
git commit -m "feat(onchain): admin CLI for config + merchant registration from env"
```

---

### Task 8: Final verification

**Files:** none

- [ ] **Step 1: Full build**

Run: `anchor build`
Expected: builds; `target/idl/navy_payments.json` + `target/types/navy_payments.ts` regenerated.

- [ ] **Step 2: Full test suite**

Run: `anchor test`
Expected: every suite passes — config (4), merchant (3), pay_invoice (4), client (1) = 12 tests. If a cross-suite config/mint collision surfaces, apply the `update_config(usdc_mint)` convergence (Task 5 note) so all suites agree on one mint, or split runs.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A onchain
git commit -m "test(onchain): full navy_payments suite green" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (spec §→ task):**
- §3 accounts (Config/Merchant/Invoice PDAs) → Task 2.
- §4 instructions: `initialize_config`/`update_config` → Task 3; `register_merchant`/`set_merchant_active` → Task 4; `pay_invoice` (USDC split, replay, expiry, active checks) → Task 5.
- §5 fee from on-chain Config + gasless two-signer (payer authority + relayer fee payer) → Task 5 (`PayInvoice` accounts) + Task 6 (`buildPayInvoiceTx` sets `feePayer = relayer`, user partial-signs).
- §6 off-chain deliverables: IDL/types (Task 1/8), `buildPayInvoiceTx` + relayer submit (Task 6), admin CLI from env (Task 7).
- §7 security: `MAX_FEE_BPS` bound, checked math, mint/payout/treasury identity constraints, init-once invoice, admin-only mutations → Tasks 2,3,4,5.
- §8 testing → Tasks 3,4,5,6,8.

**Placeholder scan:** No TBD/TODO-as-implementation. Every Rust handler and TS test ships complete code. The Anchor-0.32 syntax-verification notes are explicit "verify against installed version and adjust" instructions with `anchor build`/`anchor test` as the gate — not placeholders. The one design addition discovered while writing tests (`update_config` must also accept `usdc_mint` so independent test suites converge on one global `Config`) is called out in Task 5 and threaded through Tasks 6, 7 — implementer must add `usdc_mint: Option<Pubkey>` to `update_config` (signature in `lib.rs` + handler in `config.rs` + the config test).

**Type consistency:** PDA seeds (`"config"`, `["merchant", authority]`, `["invoice", authority, invoice_id]`) are identical across Rust (`state`/instruction accounts) and TS (`client/pdas.ts`, tests). `fee_bps`/`MAX_FEE_BPS`, `Invoice{payer,amount,fee,paid_at,bump}`, `InvoicePaid` event fields match between `state.rs`/`pay_invoice.rs`/`events.rs` and the test assertions. `pay_invoice(invoice_id:[u8;16], amount:u64, expiry:i64)` signature matches `lib.rs`, the handler, the tests, and `buildPayInvoiceTx`.

**Known follow-ups (recorded):** `update_config` gained `usdc_mint` for test-suite convergence (and real re-pointing); the relayer ATA-creation-if-missing path (spec §5) is handled by the gateway when it builds txs (sub-project 3) — the program itself does not create ATAs; Approach B (in-program merchant-signature verification) remains the future trustless option (spec §10); mainnet requires audit.
