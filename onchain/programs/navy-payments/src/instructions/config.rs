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

pub fn update_config(ctx: Context<UpdateConfig>, fee_bps: Option<u16>, treasury: Option<Pubkey>, usdc_mint: Option<Pubkey>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    if let Some(f) = fee_bps { require!(f <= MAX_FEE_BPS, NavyError::FeeTooHigh); c.fee_bps = f; }
    if let Some(t) = treasury { c.treasury = t; }
    if let Some(m) = usdc_mint { c.usdc_mint = m; }
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: treasury token account validated off-chain at setup; stored as-is.
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
