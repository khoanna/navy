use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod events;
pub mod instructions;

use instructions::*;

declare_id!("5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az");

#[program]
pub mod navy_payments {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, fee_bps: u16, usdc_mint: Pubkey) -> Result<()> {
        instructions::initialize_config(ctx, fee_bps, usdc_mint)
    }
    pub fn update_config(ctx: Context<UpdateConfig>, fee_bps: Option<u16>, treasury: Option<Pubkey>, usdc_mint: Option<Pubkey>) -> Result<()> {
        instructions::update_config(ctx, fee_bps, treasury, usdc_mint)
    }
    pub fn register_merchant(ctx: Context<RegisterMerchant>, merchant_id: [u8; 16], payout: Pubkey) -> Result<()> {
        instructions::register_merchant(ctx, merchant_id, payout)
    }
    pub fn set_merchant_active(ctx: Context<SetMerchantActive>, active: bool) -> Result<()> {
        instructions::set_merchant_active(ctx, active)
    }
    pub fn set_merchant_payout(ctx: Context<SetMerchantPayout>, new_payout: Pubkey) -> Result<()> {
        instructions::set_merchant_payout(ctx, new_payout)
    }
    pub fn pay_invoice(ctx: Context<PayInvoice>, invoice_id: [u8; 16], amount: u64, expiry: i64) -> Result<()> {
        instructions::pay_invoice(ctx, invoice_id, amount, expiry)
    }
}
