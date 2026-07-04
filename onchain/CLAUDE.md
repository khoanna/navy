# CLAUDE.md — onchain (navy_payments Anchor program)

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Anchor 0.32 + Solana CLI 4.0 (Agave) + Rust 1.85+. Devnet. Build is SLOW (Rust + BPF).

- `anchor build` regenerates `target/idl/navy_payments.json` + `target/types/navy_payments.ts`; copy the IDL to `be/src/onchain/` if the backend client drifts.
- `anchor test` boots a local validator and runs `tests/**/*.ts` (ts-mocha); tests mint their own fake USDC, so no real devnet token is needed.
- **Quirks that cost time:** `anchor init` does NOT accept `--name` in 0.32 (rename `programs/<dir>` + `Cargo.toml` name/lib + `declare_id!` manually, then `anchor keys sync`). The TS client uses `new Program(idl, provider)` (2-arg; the IDL embeds the program id). Anchor 0.32 deps need Rust 1.85+ — if the bundled platform-tools is older, `agave-install update` (this bumped Solana CLI to 4.0.1).
- Program id is identical mainnet/devnet for the payment program; the farming agent targets Save (Solend) — see `docs/superpowers/specs/2026-06-16-navy-farming-agent-design.md` for the verified devnet addresses.
- **Hardened program (2026-07-04, deployed devnet):** Merchant PDA seeded by a stable `merchant_id: [u8;16]` (backend derives it from the merchant DB uuid), `set_merchant_payout` admin ix for payout rotation, `token::mint` constraints on treasury/payout, and a `MIN_INVOICE_AMOUNT`. The `InvoicePaid` event carries `merchant_id`.
- **Upgrading in place:** if the rebuilt `.so` is larger, run `solana program extend <program-id> <bytes>` before `solana program deploy --program-id <id>` (else "ExtendProgram requires a minimum of 10240 additional bytes").
