use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::{
    token,
    token_2022::{self, TransferChecked},
};

declare_id!("HQjuoD77heYfGMqArVubqoYd9yWozPk6nrSB2MvugKiB");

// PYUSD mint address
// TODO: current address is for testing, change to PYUSD mint address
pub const MINT_ADDRESS: Pubkey = pubkey!("6c5r5bLXihK2DTKGaPb7Wur9ZhzTD5LbJ1pxHBBbTBMQ");
pub const MAX_RECIPIENTS: usize = 15;

pub fn check_ata_address(wallet: &Pubkey, ata: &AccountInfo, token_program: &Pubkey) -> Result<()> {
    let expected_ata =
        get_associated_token_address_with_program_id(wallet, &MINT_ADDRESS, token_program);
    require!(ata.key() == expected_ata, BazaarError::InvalidTokenAccount);
    Ok(())
}

pub fn get_mint_details(mint_info: &AccountInfo) -> Result<token::Mint> {
    let mint = token::Mint::try_deserialize(&mut &mint_info.data.borrow()[..]).map_err(|e| e)?;
    Ok(mint)
}

#[program]
pub mod bazaar_solana {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }

    pub fn process_payment<'info>(
        ctx: Context<'_, '_, '_, 'info, ProcessPayment<'info>>,
        order_id: u64,
        amounts: Vec<u64>,
        recipients: Vec<Pubkey>,
    ) -> Result<()> {
        require!(
            amounts.len() == recipients.len() && recipients.len() == ctx.remaining_accounts.len(),
            BazaarError::LengthMismatch
        );
        require!(
            recipients.len() <= MAX_RECIPIENTS,
            BazaarError::TooManyRecipients
        );
        require!(!recipients.is_empty(), BazaarError::NoRecipients);

        // Create hash
        let mut data = Vec::new();
        data.extend_from_slice(&order_id.to_le_bytes());
        for amount in amounts.iter() {
            data.extend_from_slice(&amount.to_le_bytes());
        }
        for recipient in recipients.iter() {
            data.extend_from_slice(&recipient.to_bytes());
        }
        let hash_result = anchor_lang::solana_program::hash::hash(&data).to_bytes();

        // Initialize the order account
        ctx.accounts.order.order_id = order_id;
        ctx.accounts.order.hash = hash_result;
        ctx.accounts.order.bump = ctx.bumps.order;

        // Get mint details
        let mint = get_mint_details(&ctx.accounts.mint)?;

        // Process transfers
        for i in 0..amounts.len() {
            let amount = amounts[i];
            let recipient = recipients[i];
            let recipient_ata = &ctx.remaining_accounts[i];

            require!(amount > 0, BazaarError::ZeroAmount);

            // Verify this is the correct ATA for the recipient
            check_ata_address(
                &recipient,
                &recipient_ata,
                &ctx.accounts.token_program.key(),
            )?;

            token_2022::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.payer_token_account.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: recipient_ata.clone(),
                        authority: ctx.accounts.payer.to_account_info(),
                    },
                ),
                amount,
                mint.decimals,
            )?;
        }

        emit!(PaymentProcessedEvent {
            order_id,
            hash: hash_result,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64, amounts: Vec<u64>, recipients: Vec<Pubkey>)]
pub struct ProcessPayment<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: We verify in the instruction
    #[account(mut)]
    pub payer_token_account: AccountInfo<'info>,
    /// CHECK: This is the PYUSD mint
    #[account(address = MINT_ADDRESS)]
    pub mint: AccountInfo<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + 8 + 32 + 1, // discriminator + order_id + hash + bump
        seeds = [b"order", order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,
    /// CHECK: Can be either Token or Token2022 program
    pub token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Order {
    pub order_id: u64,
    pub hash: [u8; 32],
    pub bump: u8,
}

#[event]
pub struct PaymentProcessedEvent {
    pub order_id: u64,
    pub hash: [u8; 32],
}

#[error_code]
pub enum BazaarError {
    #[msg("Amounts, recipients and remaining accounts length mismatch")]
    LengthMismatch,
    #[msg("Order ID already used")]
    OrderIdAlreadyUsed,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Too many recipients")]
    TooManyRecipients,
    #[msg("No recipients provided")]
    NoRecipients,
    #[msg("Amount cannot be zero")]
    ZeroAmount,
}
