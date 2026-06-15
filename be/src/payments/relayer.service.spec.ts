import { RelayerService } from './relayer.service';
import { Transaction, Keypair, SystemProgram, PublicKey } from '@solana/web3.js';

function sampleTx(feePayer: PublicKey): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: PublicKey.default, lamports: 1 }));
  tx.feePayer = feePayer;
  tx.recentBlockhash = '11111111111111111111111111111111';
  return tx;
}

describe('RelayerService.messagesMatch', () => {
  const svc = new RelayerService({} as any);
  it('returns true for identical message bytes', () => {
    const relayer = Keypair.generate();
    expect(svc.messagesMatch(sampleTx(relayer.publicKey), sampleTx(relayer.publicKey))).toBe(true);
  });
  it('returns false when instructions differ', () => {
    const relayer = Keypair.generate();
    const a = sampleTx(relayer.publicKey);
    const b = sampleTx(relayer.publicKey);
    b.add(SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: relayer.publicKey, lamports: 2 }));
    expect(svc.messagesMatch(a, b)).toBe(false);
  });
});
