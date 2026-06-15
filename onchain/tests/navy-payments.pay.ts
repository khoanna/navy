import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { createMint, createAccount, mintTo, getAccount } from '@solana/spl-token';
import { assert } from 'chai';
import { NavyPayments } from '../target/types/navy_payments';

describe('pay_invoice', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as Program<NavyPayments>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const merchantAuthority = Keypair.generate();
  const user = Keypair.generate();
  let usdcMint: PublicKey, treasury: PublicKey, payout: PublicKey, userAta: PublicKey;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const [merchantPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('merchant'), merchantAuthority.publicKey.toBuffer()], program.programId);

  const invoiceId = Buffer.alloc(16); invoiceId.write('inv-0001');
  const amount = new anchor.BN(1_000_000);
  const future = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
  const [invoicePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), merchantAuthority.publicKey.toBuffer(), invoiceId], program.programId);

  before(async () => {
    usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    treasury = await createAccount(provider.connection, admin, usdcMint, admin.publicKey);
    payout = await createAccount(provider.connection, admin, usdcMint, merchantAuthority.publicKey);
    userAta = await createAccount(provider.connection, admin, usdcMint, user.publicKey);
    await mintTo(provider.connection, admin, usdcMint, userAta, admin, 5_000_000);

    try {
      await program.methods.initializeConfig(100, usdcMint)
        .accounts({ config: configPda, treasury, admin: admin.publicKey }).rpc();
    } catch { /* exists */ }
    // Force config to THIS suite's mint + treasury + fee 100 (1%).
    await program.methods.updateConfig(100, treasury, usdcMint)
      .accounts({ config: configPda, admin: admin.publicKey }).rpc();

    await program.methods.registerMerchant(payout)
      .accounts({ config: configPda, merchant: merchantPda, merchantAuthority: merchantAuthority.publicKey, admin: admin.publicKey }).rpc();
  });

  it('pays an invoice: 99% to merchant, 1% to treasury, marks paid', async () => {
    await program.methods.payInvoice([...invoiceId], amount, future)
      .accounts({ config: configPda, merchant: merchantPda, invoice: invoicePda,
        payerToken: userAta, merchantPayout: payout, treasury, usdcMint,
        payer: user.publicKey, relayer: admin.publicKey })
      .signers([user]).rpc();
    const payoutAcc = await getAccount(provider.connection, payout);
    const treasuryAcc = await getAccount(provider.connection, treasury);
    assert.equal(payoutAcc.amount.toString(), '990000');
    assert.equal(treasuryAcc.amount.toString(), '10000');
    const inv = await program.account.invoice.fetch(invoicePda);
    assert.equal(inv.amount.toString(), '1000000');
    assert.equal(inv.fee.toString(), '10000');
  });

  it('rejects paying the same invoice twice (replay)', async () => {
    try {
      await program.methods.payInvoice([...invoiceId], amount, future)
        .accounts({ config: configPda, merchant: merchantPda, invoice: invoicePda,
          payerToken: userAta, merchantPayout: payout, treasury, usdcMint,
          payer: user.publicKey, relayer: admin.publicKey })
        .signers([user]).rpc();
      assert.fail('replay should fail');
    } catch (e: any) { assert.ok(e); }
  });

  it('rejects an expired invoice', async () => {
    const id2 = Buffer.alloc(16); id2.write('inv-0002');
    const [pda2] = PublicKey.findProgramAddressSync(
      [Buffer.from('invoice'), merchantAuthority.publicKey.toBuffer(), id2], program.programId);
    const past = new anchor.BN(Math.floor(Date.now() / 1000) - 10);
    try {
      await program.methods.payInvoice([...id2], amount, past)
        .accounts({ config: configPda, merchant: merchantPda, invoice: pda2,
          payerToken: userAta, merchantPayout: payout, treasury, usdcMint,
          payer: user.publicKey, relayer: admin.publicKey })
        .signers([user]).rpc();
      assert.fail('expired should fail');
    } catch (e: any) { assert.match(e.toString(), /InvoiceExpired/); }
  });

  it('rejects an inactive merchant', async () => {
    await program.methods.setMerchantActive(false)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
    const id3 = Buffer.alloc(16); id3.write('inv-0003');
    const [pda3] = PublicKey.findProgramAddressSync(
      [Buffer.from('invoice'), merchantAuthority.publicKey.toBuffer(), id3], program.programId);
    try {
      await program.methods.payInvoice([...id3], amount, future)
        .accounts({ config: configPda, merchant: merchantPda, invoice: pda3,
          payerToken: userAta, merchantPayout: payout, treasury, usdcMint,
          payer: user.publicKey, relayer: admin.publicKey })
        .signers([user]).rpc();
      assert.fail('inactive merchant should fail');
    } catch (e: any) { assert.match(e.toString(), /MerchantInactive/); }
    await program.methods.setMerchantActive(true)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
  });
});
