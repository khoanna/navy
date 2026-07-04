import { Transaction, Keypair, SystemProgram, PublicKey } from '@solana/web3.js';
import { payInvoice } from './payFlow';

function sampleTx(): { b64: string; signer: string } {
  const kp = Keypair.generate();
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: PublicKey.default, lamports: 1 }));
  tx.feePayer = kp.publicKey; tx.recentBlockhash = '11111111111111111111111111111111';
  return { b64: tx.serialize({ requireAllSignatures: false }).toString('base64'), signer: kp.publicKey.toBase58() };
}

function sampleTxBase64(): string { return sampleTx().b64; }

describe('payInvoice', () => {
  it('fetches the tx, signs it, and submits the signed tx', async () => {
    const client = {
      getPaymentTx: jest.fn().mockResolvedValue({ tx: sampleTxBase64(), invoice: {} }),
      submitSignedTx: jest.fn().mockResolvedValue({ txSignature: 'sig', status: 'confirming' }),
    } as any;
    const signTransaction = jest.fn().mockImplementation(async (tx: Transaction) => tx);
    const out = await payInvoice({ orderId: 'o1', navyAccessToken: 'navy-jwt', client, signTransaction });
    expect(client.getPaymentTx).toHaveBeenCalledWith('o1', 'navy-jwt');
    expect(signTransaction).toHaveBeenCalled();
    expect(client.submitSignedTx).toHaveBeenCalledWith('o1', expect.any(String), 'navy-jwt');
    expect(out.txSignature).toBe('sig');
  });

  it('signs when expectedSigner is a required signer of the tx', async () => {
    const { b64, signer } = sampleTx();
    const client = {
      getPaymentTx: jest.fn().mockResolvedValue({ tx: b64, invoice: {} }),
      submitSignedTx: jest.fn().mockResolvedValue({ txSignature: 'sig', status: 'confirming' }),
    } as any;
    const signTransaction = jest.fn().mockImplementation(async (tx: Transaction) => tx);
    const out = await payInvoice({ orderId: 'o1', navyAccessToken: 'jwt', client, signTransaction, expectedSigner: signer });
    expect(out.txSignature).toBe('sig');
  });

  it('rejects a tx built for a different payer than expectedSigner', async () => {
    const { b64 } = sampleTx();
    const client = {
      getPaymentTx: jest.fn().mockResolvedValue({ tx: b64, invoice: {} }),
      submitSignedTx: jest.fn(),
    } as any;
    const signTransaction = jest.fn();
    await expect(
      payInvoice({ orderId: 'o1', navyAccessToken: 'jwt', client, signTransaction, expectedSigner: 'SomeOtherWallet111111111111111111111111111' }),
    ).rejects.toThrow(/different wallet/);
    expect(signTransaction).not.toHaveBeenCalled();
  });
});
