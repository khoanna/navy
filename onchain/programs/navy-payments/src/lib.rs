use anchor_lang::prelude::*;

declare_id!("5Y8xeLpLx2BWHHAZkYMfFQjsRPF2H7sUwmrVP9zjc7az");

#[program]
pub mod navy_payments {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
