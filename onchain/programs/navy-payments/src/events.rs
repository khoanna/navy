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
