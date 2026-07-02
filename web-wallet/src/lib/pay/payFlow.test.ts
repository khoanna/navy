import { Transaction, Keypair, SystemProgram, PublicKey } from '@solana/web3.js';
import { payInvoice } from './payFlow';

function sampleTxBase64(): string {
  const kp = Keypair.generate();
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: PublicKey.default, lamports: 1 }));
  tx.feePayer = kp.publicKey; tx.recentBlockhash = '11111111111111111111111111111111';
  return tx.serialize({ requireAllSignatures: false }).toString('base64');
}

describe('payInvoice', () => {
  it('fetches the tx, signs it, and submits the signed tx', async () => {
    const client = {
      getPaymentTx: jest.fn().mockResolvedValue({ tx: sampleTxBase64(), invoice: {} }),
      submitSignedTx: jest.fn().mockResolvedValue({ txSignature: 'sig', status: 'confirming' }),
    } as any;
    const signTransaction = jest.fn().mockImplementation(async (tx: Transaction) => tx);
    const out = await payInvoice({ orderId: 'o1', payer: 'PK', client, signTransaction });
    expect(client.getPaymentTx).toHaveBeenCalledWith('o1', 'PK');
    expect(signTransaction).toHaveBeenCalled();
    expect(client.submitSignedTx).toHaveBeenCalledWith('o1', expect.any(String));
    expect(out.txSignature).toBe('sig');
  });
});
