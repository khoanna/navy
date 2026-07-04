import { createHash } from 'crypto';
import { RelayerService } from './relayer.service';
import { Transaction, Keypair, SystemProgram, PublicKey } from '@solana/web3.js';

function sampleTx(feePayer: PublicKey): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: PublicKey.default, lamports: 1 }));
  tx.feePayer = feePayer;
  tx.recentBlockhash = '11111111111111111111111111111111';
  return tx;
}

/** A signed tx from the payer, fee-paid + partially signed by the relayer (gasless two-signer). */
function issuedSignedTx(relayer: Keypair, payer: Keypair): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: PublicKey.default, lamports: 1 }));
  tx.feePayer = relayer.publicKey;
  tx.recentBlockhash = '11111111111111111111111111111111';
  tx.partialSign(relayer);
  tx.partialSign(payer);
  return tx;
}

describe('RelayerService.messagesMatch', () => {
  const svc = new RelayerService({} as any, {} as any);
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

describe('RelayerService issued-tx store (durable, single-use)', () => {
  const relayer = Keypair.generate();
  const payer = Keypair.generate();

  function makeChain() {
    return {
      relayer,
      connection: {
        getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: '11111111111111111111111111111111' }),
        sendRawTransaction: jest.fn().mockResolvedValue('sig-123'),
        confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
      },
    } as any;
  }

  function makePrisma(order: any) {
    return {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue(order),
      },
    } as any;
  }

  it('buildPaymentTx persists issuedTxHash (sha256 of the serialized message) + expiresAt', async () => {
    const chain = makeChain();
    const prisma = makePrisma({ id: 'o1' });
    const svc = new RelayerService(chain, prisma);
    // Stub the tx builder so we control the serialized message deterministically.
    const tx = issuedSignedTx(relayer, payer);
    jest.spyOn(svc as any, 'buildTx').mockResolvedValue(tx);

    const expiresAt = new Date(Date.now() + 600_000);
    await svc.buildPaymentTx({ id: 'o1', amount: 1_000_000n, expiresAt }, relayer.publicKey, payer.publicKey);

    const expectedHash = createHash('sha256').update(tx.serializeMessage()).digest('hex');
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { issuedTxHash: expectedHash, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null },
    });
  });

  it('verifyAndSubmit rejects an order with no issued tx', async () => {
    const svc = new RelayerService(makeChain(), makePrisma({ id: 'o1', issuedTxHash: null }));
    const tx = issuedSignedTx(relayer, payer);
    await expect(svc.verifyAndSubmit('o1', tx.serialize().toString('base64'))).rejects.toThrow(/no issued transaction/i);
  });

  it('verifyAndSubmit rejects an already-consumed order', async () => {
    const tx = issuedSignedTx(relayer, payer);
    const hash = createHash('sha256').update(tx.serializeMessage()).digest('hex');
    const svc = new RelayerService(
      makeChain(),
      makePrisma({ id: 'o1', issuedTxHash: hash, issuedTxExpiresAt: new Date(Date.now() + 600_000), issuedTxConsumedAt: new Date() }),
    );
    await expect(svc.verifyAndSubmit('o1', tx.serialize().toString('base64'))).rejects.toThrow(/already submitted/i);
  });

  it('verifyAndSubmit rejects an expired issued tx', async () => {
    const tx = issuedSignedTx(relayer, payer);
    const hash = createHash('sha256').update(tx.serializeMessage()).digest('hex');
    const svc = new RelayerService(
      makeChain(),
      makePrisma({ id: 'o1', issuedTxHash: hash, issuedTxExpiresAt: new Date(Date.now() - 1_000), issuedTxConsumedAt: null }),
    );
    await expect(svc.verifyAndSubmit('o1', tx.serialize().toString('base64'))).rejects.toThrow(/expired/i);
  });

  it('verifyAndSubmit rejects a tx whose message hash does not match the stored hash', async () => {
    const svc = new RelayerService(
      makeChain(),
      makePrisma({ id: 'o1', issuedTxHash: 'deadbeef', issuedTxExpiresAt: new Date(Date.now() + 600_000), issuedTxConsumedAt: null }),
    );
    const tx = issuedSignedTx(relayer, payer);
    await expect(svc.verifyAndSubmit('o1', tx.serialize().toString('base64'))).rejects.toThrow(/does not match/i);
  });

  it('verifyAndSubmit happy path: submits, marks consumed, returns {signature,payer,err}', async () => {
    const tx = issuedSignedTx(relayer, payer);
    const hash = createHash('sha256').update(tx.serializeMessage()).digest('hex');
    const chain = makeChain();
    const prisma = makePrisma({ id: 'o1', issuedTxHash: hash, issuedTxExpiresAt: new Date(Date.now() + 600_000), issuedTxConsumedAt: null });
    const svc = new RelayerService(chain, prisma);

    const res = await svc.verifyAndSubmit('o1', tx.serialize().toString('base64'));

    expect(chain.connection.sendRawTransaction).toHaveBeenCalled();
    expect(res.signature).toBe('sig-123');
    expect(res.payer).toBe(payer.publicKey.toBase58());
    expect(res.err).toBeNull();
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { issuedTxConsumedAt: expect.any(Date) },
    });
  });
});
