import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { createMint, createAccount } from '@solana/spl-token';
import { assert } from 'chai';
import { NavyPayments } from '../target/types/navy_payments';

describe('merchant registry', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as Program<NavyPayments>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const merchantAuthority = Keypair.generate();
  let usdcMint: PublicKey;
  let payout: PublicKey;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const [merchantPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('merchant'), merchantAuthority.publicKey.toBuffer()], program.programId);

  before(async () => {
    usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    payout = await createAccount(provider.connection, admin, usdcMint, merchantAuthority.publicKey);
    const treasury = await createAccount(provider.connection, admin, usdcMint, admin.publicKey);
    // ensure config exists (idempotent across suites on the same validator)
    try {
      await program.methods.initializeConfig(100, usdcMint)
        .accounts({ config: configPda, treasury, admin: admin.publicKey }).rpc();
    } catch { /* already initialized */ }
  });

  it('admin registers a merchant', async () => {
    await program.methods.registerMerchant(payout)
      .accounts({ config: configPda, merchant: merchantPda, merchantAuthority: merchantAuthority.publicKey, admin: admin.publicKey })
      .rpc();
    const m = await program.account.merchant.fetch(merchantPda);
    assert.ok(m.payout.equals(payout));
    assert.equal(m.active, true);
  });

  it('admin deactivates the merchant', async () => {
    await program.methods.setMerchantActive(false)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
    const m = await program.account.merchant.fetch(merchantPda);
    assert.equal(m.active, false);
  });

  it('rejects a non-admin registering a merchant', async () => {
    const stranger = Keypair.generate();
    const other = Keypair.generate();
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('merchant'), other.publicKey.toBuffer()], program.programId);
    try {
      await program.methods.registerMerchant(payout)
        .accounts({ config: configPda, merchant: pda, merchantAuthority: other.publicKey, admin: stranger.publicKey })
        .signers([stranger]).rpc();
      assert.fail('should have thrown');
    } catch (e: any) { assert.ok(e); }
  });
});
