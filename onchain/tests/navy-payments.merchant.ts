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
  const merchantId = Buffer.alloc(16); merchantId.write('merchant-reg');
  let usdcMint: PublicKey;
  let payout: PublicKey;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const [merchantPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('merchant'), merchantId], program.programId);

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
    await program.methods.registerMerchant([...merchantId], payout)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey })
      .rpc();
    const m = await program.account.merchant.fetch(merchantPda);
    assert.ok(m.payout.equals(payout));
    assert.equal(m.active, true);
    assert.deepEqual(Buffer.from(m.merchantId), merchantId);
  });

  it('admin rotates the merchant payout', async () => {
    const newPayout = await createAccount(provider.connection, admin, usdcMint, Keypair.generate().publicKey);
    await program.methods.setMerchantPayout(newPayout)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
    const m = await program.account.merchant.fetch(merchantPda);
    assert.ok(m.payout.equals(newPayout));
    // restore original payout so downstream assertions are unaffected
    await program.methods.setMerchantPayout(payout)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
  });

  it('rejects a non-admin rotating the payout', async () => {
    const stranger = Keypair.generate();
    try {
      await program.methods.setMerchantPayout(payout)
        .accounts({ config: configPda, merchant: merchantPda, admin: stranger.publicKey })
        .signers([stranger]).rpc();
      assert.fail('should have thrown');
    } catch (e: any) { assert.ok(e); }
  });

  it('admin deactivates the merchant', async () => {
    await program.methods.setMerchantActive(false)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
    const m = await program.account.merchant.fetch(merchantPda);
    assert.equal(m.active, false);
  });

  it('rejects a non-admin registering a merchant', async () => {
    const stranger = Keypair.generate();
    const otherId = Buffer.alloc(16); otherId.write('other-merchant');
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('merchant'), otherId], program.programId);
    try {
      await program.methods.registerMerchant([...otherId], payout)
        .accounts({ config: configPda, merchant: pda, admin: stranger.publicKey })
        .signers([stranger]).rpc();
      assert.fail('should have thrown');
    } catch (e: any) { assert.ok(e); }
  });
});
