use anchor_lang::prelude::*;
use crate::state::{Config, Merchant};
use crate::errors::NavyError;

pub fn register_merchant(ctx: Context<RegisterMerchant>, merchant_id: [u8; 16], payout: Pubkey) -> Result<()> {
    let m = &mut ctx.accounts.merchant;
    m.merchant_id = merchant_id;
    m.payout = payout;
    m.active = true;
    m.bump = ctx.bumps.merchant;
    Ok(())
}

pub fn set_merchant_active(ctx: Context<SetMerchantActive>, active: bool) -> Result<()> {
    ctx.accounts.merchant.active = active;
    Ok(())
}

pub fn set_merchant_payout(ctx: Context<SetMerchantPayout>, new_payout: Pubkey) -> Result<()> {
    ctx.accounts.merchant.payout = new_payout;
    Ok(())
}

#[derive(Accounts)]
#[instruction(merchant_id: [u8; 16])]
pub struct RegisterMerchant<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ NavyError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Merchant::INIT_SPACE,
        seeds = [b"merchant", merchant_id.as_ref()], bump)]
    pub merchant: Account<'info, Merchant>,
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

#[derive(Accounts)]
pub struct SetMerchantPayout<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ NavyError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub merchant: Account<'info, Merchant>,
    pub admin: Signer<'info>,
}
