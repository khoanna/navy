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
