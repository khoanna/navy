use anchor_lang::prelude::*;
pub fn register_merchant(_ctx: Context<RegisterMerchant>, _payout: Pubkey) -> Result<()> { Ok(()) }
pub fn set_merchant_active(_ctx: Context<SetMerchantActive>, _active: bool) -> Result<()> { Ok(()) }
#[derive(Accounts)] pub struct RegisterMerchant<'info> { pub admin: Signer<'info> }
#[derive(Accounts)] pub struct SetMerchantActive<'info> { pub admin: Signer<'info> }
