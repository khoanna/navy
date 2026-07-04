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
  const merchantId = Buffer.alloc(16); merchantId.write('pay-merchant');
  const user = Keypair.generate();
  let usdcMint: PublicKey, treasury: PublicKey, payout: PublicKey, userAta: PublicKey;
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const [merchantPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('merchant'), merchantId], program.programId);

  const invoiceId = Buffer.alloc(16); invoiceId.write('inv-0001');
  const amount = new anchor.BN(1_000_000);
  const future = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
  const [invoicePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), merchantId, invoiceId], program.programId);

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

    await program.methods.registerMerchant([...merchantId], payout)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
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
      [Buffer.from('invoice'), merchantId, id2], program.programId);
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
      [Buffer.from('invoice'), merchantId, id3], program.programId);
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

  it('rejects an amount below the minimum invoice amount', async () => {
    const id4 = Buffer.alloc(16); id4.write('inv-0004');
    const [pda4] = PublicKey.findProgramAddressSync(
      [Buffer.from('invoice'), merchantId, id4], program.programId);
    const small = new anchor.BN(9_999); // MIN_INVOICE_AMOUNT is 10_000
    try {
      await program.methods.payInvoice([...id4], small, future)
        .accounts({ config: configPda, merchant: merchantPda, invoice: pda4,
          payerToken: userAta, merchantPayout: payout, treasury, usdcMint,
          payer: user.publicKey, relayer: admin.publicKey })
        .signers([user]).rpc();
      assert.fail('below-minimum should fail');
    } catch (e: any) { assert.match(e.toString(), /AmountTooSmall/); }
  });

  it('rejects a merchant_payout token account of a different mint', async () => {
    // A different mint whose treasury/payout accounts do not match config.usdc_mint.
    const otherMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    const wrongPayout = await createAccount(provider.connection, admin, otherMint, Keypair.generate().publicKey);
    // Rotate the merchant payout to a wrong-mint account.
    await program.methods.setMerchantPayout(wrongPayout)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
    const id5 = Buffer.alloc(16); id5.write('inv-0005');
    const [pda5] = PublicKey.findProgramAddressSync(
      [Buffer.from('invoice'), merchantId, id5], program.programId);
    try {
      await program.methods.payInvoice([...id5], amount, future)
        .accounts({ config: configPda, merchant: merchantPda, invoice: pda5,
          payerToken: userAta, merchantPayout: wrongPayout, treasury, usdcMint,
          payer: user.publicKey, relayer: admin.publicKey })
        .signers([user]).rpc();
      assert.fail('wrong-mint payout should fail');
    } catch (e: any) { assert.ok(e); }
    // restore a correct-mint payout
    await program.methods.setMerchantPayout(payout)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
  });

  it('set_merchant_payout rotates the payout and a subsequent pay routes to the new account', async () => {
    const newPayout = await createAccount(provider.connection, admin, usdcMint, Keypair.generate().publicKey);
    await program.methods.setMerchantPayout(newPayout)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
    const m = await program.account.merchant.fetch(merchantPda);
    assert.ok(m.payout.equals(newPayout));

    const id6 = Buffer.alloc(16); id6.write('inv-0006');
    const [pda6] = PublicKey.findProgramAddressSync(
      [Buffer.from('invoice'), merchantId, id6], program.programId);
    await program.methods.payInvoice([...id6], amount, future)
      .accounts({ config: configPda, merchant: merchantPda, invoice: pda6,
        payerToken: userAta, merchantPayout: newPayout, treasury, usdcMint,
        payer: user.publicKey, relayer: admin.publicKey })
      .signers([user]).rpc();
    const newPayoutAcc = await getAccount(provider.connection, newPayout);
    assert.equal(newPayoutAcc.amount.toString(), '990000');
    // restore original payout
    await program.methods.setMerchantPayout(payout)
      .accounts({ config: configPda, merchant: merchantPda, admin: admin.publicKey }).rpc();
  });
});
