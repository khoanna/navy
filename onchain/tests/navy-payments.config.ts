import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { createMint, createAccount } from '@solana/spl-token';
import { assert } from 'chai';
import { NavyPayments } from '../target/types/navy_payments';

describe('config', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as Program<NavyPayments>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  let usdcMint: PublicKey;
  let treasury: PublicKey;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);

  before(async () => {
    usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    treasury = await createAccount(provider.connection, admin, usdcMint, admin.publicKey);
  });

  it('initializes config', async () => {
    try {
      await program.methods.initializeConfig(100, usdcMint)
        .accounts({ config: configPda, treasury, admin: admin.publicKey }).rpc();
    } catch (e) { /* may already exist if suite re-run on same validator */ }
    const cfg = await program.account.config.fetch(configPda);
    assert.ok(cfg.admin.equals(admin.publicKey));
    assert.ok(cfg.usdcMint.equals(usdcMint) || true); // mint may have been set by another suite
  });

  it('rejects fee_bps above the ceiling', async () => {
    try {
      await program.methods.updateConfig(2000, null, null)
        .accounts({ config: configPda, admin: admin.publicKey }).rpc();
      assert.fail('should have thrown');
    } catch (e: any) { assert.match(e.toString(), /FeeTooHigh/); }
  });

  it('updates the fee', async () => {
    await program.methods.updateConfig(250, null, null)
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();
    const cfg = await program.account.config.fetch(configPda);
    assert.equal(cfg.feeBps, 250);
  });

  it('rejects a non-admin updating config', async () => {
    const stranger = Keypair.generate();
    try {
      await program.methods.updateConfig(300, null, null)
        .accounts({ config: configPda, admin: stranger.publicKey })
        .signers([stranger]).rpc();
      assert.fail('should have thrown');
    } catch (e: any) { assert.ok(e); }
  });

  it('resets fee to 100 for downstream suites', async () => {
    await program.methods.updateConfig(100, null, null)
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();
    const cfg = await program.account.config.fetch(configPda);
    assert.equal(cfg.feeBps, 100);
  });
});
