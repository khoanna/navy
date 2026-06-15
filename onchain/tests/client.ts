import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { createMint, createAccount, mintTo, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { assert } from 'chai';
import { NavyPayments } from '../target/types/navy_payments';
import { buildPayInvoiceTx, submitPayInvoice } from '../client';
import { configPda, merchantPda } from '../client/pdas';

describe('client helpers', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as Program<NavyPayments>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  it('buildPayInvoiceTx + submitPayInvoice pays an invoice end to end', async () => {
    const merchantAuthority = Keypair.generate();
    const user = Keypair.generate();
    const usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    const treasury = await createAccount(provider.connection, admin, usdcMint, admin.publicKey);
    const payout = await createAccount(provider.connection, admin, usdcMint, merchantAuthority.publicKey);
    const userAta = await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, user.publicKey);
    await mintTo(provider.connection, admin, usdcMint, userAta.address, admin, 2_000_000);

    const cfg = configPda(program.programId);
    try { await program.methods.initializeConfig(100, usdcMint).accounts({ config: cfg, treasury, admin: admin.publicKey }).rpc(); } catch {}
    await program.methods.updateConfig(100, treasury, usdcMint).accounts({ config: cfg, admin: admin.publicKey }).rpc();
    await program.methods.registerMerchant(payout)
      .accounts({ config: cfg, merchant: merchantPda(program.programId, merchantAuthority.publicKey), merchantAuthority: merchantAuthority.publicKey, admin: admin.publicKey }).rpc();

    const invoiceId = new Uint8Array(16); invoiceId.set([9, 9, 9]);
    const tx = await buildPayInvoiceTx(program as any, {
      merchantAuthority: merchantAuthority.publicKey, payout, treasury, usdcMint,
      invoiceId, amount: 1_000_000n, expiry: Math.floor(Date.now() / 1000) + 600,
      payer: user.publicKey, relayer: admin.publicKey,
    });
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
    tx.partialSign(user);
    const sig = await submitPayInvoice(provider.connection, tx, admin);
    assert.ok(sig);
  });
});
