use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, TransferChecked};
use crate::state::{Config, Merchant, Invoice, MIN_INVOICE_AMOUNT};
use crate::errors::NavyError;
use crate::events::InvoicePaid;

pub fn pay_invoice(ctx: Context<PayInvoice>, invoice_id: [u8; 16], amount: u64, expiry: i64) -> Result<()> {
    require!(amount > 0, NavyError::ZeroAmount);
    require!(amount >= MIN_INVOICE_AMOUNT, NavyError::AmountTooSmall);
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

    token::transfer_checked(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
            from: ctx.accounts.payer_token.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            to: ctx.accounts.merchant_payout.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        }),
        to_merchant, decimals,
    )?;
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
        merchant_id: ctx.accounts.merchant.merchant_id,
        invoice_id,
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
    #[account(seeds = [b"merchant", merchant.merchant_id.as_ref()], bump = merchant.bump)]
    pub merchant: Account<'info, Merchant>,
    #[account(init, payer = relayer, space = 8 + Invoice::INIT_SPACE,
        seeds = [b"invoice", merchant.merchant_id.as_ref(), &invoice_id], bump)]
    pub invoice: Account<'info, Invoice>,
    #[account(mut, token::mint = usdc_mint, token::authority = payer)]
    pub payer_token: Account<'info, TokenAccount>,
    #[account(mut, address = merchant.payout, token::mint = usdc_mint)]
    pub merchant_payout: Account<'info, TokenAccount>,
    #[account(mut, address = config.treasury, token::mint = usdc_mint)]
    pub treasury: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub payer: Signer<'info>,
    #[account(mut)]
    pub relayer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
