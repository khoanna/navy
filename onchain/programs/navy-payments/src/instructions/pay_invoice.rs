use anchor_lang::prelude::*;
pub fn pay_invoice(_ctx: Context<PayInvoice>, _invoice_id: [u8;16], _amount: u64, _expiry: i64) -> Result<()> { Ok(()) }
#[derive(Accounts)] pub struct PayInvoice<'info> { pub payer: Signer<'info> }
