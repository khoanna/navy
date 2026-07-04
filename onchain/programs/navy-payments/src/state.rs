use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub merchant_id: [u8; 16],
    pub payout: Pubkey,
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

pub const MAX_FEE_BPS: u16 = 1000;

/// Minimum invoice amount (0.01 USDC at 6 decimals).
pub const MIN_INVOICE_AMOUNT: u64 = 10_000;
