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
    #[account(init, payer = admin, space = 8 + Merchant::INIT_SPACE,
        seeds = [b"merchant", merchant_authority.key().as_ref()], bump)]
    pub merchant: Account<'info, Merchant>,
    /// CHECK: identity key only; merchant authority does not sign (admin registers).
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
