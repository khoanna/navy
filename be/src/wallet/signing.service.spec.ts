import { Transaction, TransactionInstruction, SystemProgram, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SigningService } from './signing.service';
import { PolicyValidator } from './policy.validator';
import { EnvelopeCipherService } from '../crypto/cipher.service';

describe('SigningService', () => {
  it('rejects a tx whose instruction calls a non-allowlisted program (derived from tx, not caller summary)', async () => {
    const evil = Keypair.generate().publicKey;          // not allowlisted
    const allowed = Keypair.generate().publicKey.toBase58();
    const ix = new TransactionInstruction({ keys: [], programId: evil, data: Buffer.alloc(0) });
    const tx = new Transaction().add(ix);
    const row = {
      pubkey: 'PK', status: 'active', encryptedPrivkey: 'x', dataKeyWrapped: 'y',
      policyJson: { allowedProgramIds: [allowed], allowedDestinations: ['OWNER'] },
    };
    const prisma = { farmingSubwallet: { findUnique: jest.fn().mockResolvedValue(row) } } as any;
    const audit = { record: jest.fn() } as any;
    const cipher = new EnvelopeCipherService(Buffer.alloc(32, 1));
    const svc = new SigningService(prisma, cipher, new PolicyValidator(), audit);
    await expect(svc.signTransaction('s1', tx))
      .rejects.toThrow(/Policy denied/);
  });

  it('rejects a tx that transfers to a non-allowlisted destination (derived from tx)', async () => {
    const attacker = Keypair.generate().publicKey;
    const from = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: from, toPubkey: attacker, lamports: 1 }),
    );
    const row = {
      pubkey: 'PK', status: 'active', encryptedPrivkey: 'x', dataKeyWrapped: 'y',
      policyJson: {
        allowedProgramIds: [SystemProgram.programId.toBase58()],
        allowedDestinations: ['Owner111111111111111111111111111111111111'],
      },
    };
    const prisma = { farmingSubwallet: { findUnique: jest.fn().mockResolvedValue(row) } } as any;
    const audit = { record: jest.fn() } as any;
    const cipher = new EnvelopeCipherService(Buffer.alloc(32, 1));
    const svc = new SigningService(prisma, cipher, new PolicyValidator(), audit);
    await expect(svc.signTransaction('s1', tx))
      .rejects.toThrow(/Policy denied/);
  });

  it('rejects a tx with an SPL Approve (opcode 4): does NOT sign, records subwallet.sign.denied', async () => {
    // Approve is a dangerous token opcode — delegating spend authority is never allowed.
    const ix = new TransactionInstruction({
      keys: [],
      programId: TOKEN_PROGRAM_ID,
      data: Buffer.from([4, 0, 0, 0, 0, 0, 0, 0, 0]),
    });
    const tx = new Transaction().add(ix);
    const spy = jest.spyOn(tx, 'partialSign');

    const owner = Keypair.generate().publicKey.toBase58();
    const secretKey = Keypair.generate().secretKey; // real 64-byte secret
    const row = {
      pubkey: Keypair.generate().publicKey.toBase58(),
      status: 'active',
      encryptedPrivkey: 'x',
      dataKeyWrapped: 'y',
      policyJson: {
        allowedProgramIds: [TOKEN_PROGRAM_ID.toBase58()],
        allowedDestinations: [owner],
      },
    };
    const prisma = { farmingSubwallet: { findUnique: jest.fn().mockResolvedValue(row) } } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const cipher = { open: jest.fn().mockResolvedValue(Buffer.from(secretKey)), seal: jest.fn() } as any;
    const svc = new SigningService(prisma, cipher, new PolicyValidator(), audit);

    await expect(svc.signTransaction('s1', tx)).rejects.toThrow(/Policy denied/);

    // BEHAVIOR: the key was never touched, the tx was never signed.
    expect(cipher.open).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(tx.signatures.length).toBe(0);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subwallet.sign.denied' }),
    );
  });

  it('signs a valid tx (System transfer to allowlisted owner): partialSign called, subwallet.sign recorded', async () => {
    const ownerKp = Keypair.generate();
    const owner = ownerKp.publicKey.toBase58();
    const subKp = Keypair.generate();
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: subKp.publicKey, toPubkey: ownerKp.publicKey, lamports: 1 }),
    );
    // partialSign compiles the message, which requires these to be set.
    tx.recentBlockhash = '11111111111111111111111111111111';
    tx.feePayer = subKp.publicKey;
    const spy = jest.spyOn(tx, 'partialSign');

    const row = {
      pubkey: subKp.publicKey.toBase58(),
      status: 'active',
      encryptedPrivkey: 'x',
      dataKeyWrapped: 'y',
      policyJson: {
        allowedProgramIds: [SystemProgram.programId.toBase58()],
        allowedDestinations: [owner],
      },
    };
    const prisma = { farmingSubwallet: { findUnique: jest.fn().mockResolvedValue(row) } } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    // Real secret key matching the subwallet so partialSign produces a real signature.
    const cipher = { open: jest.fn().mockResolvedValue(Buffer.from(subKp.secretKey)), seal: jest.fn() } as any;
    const svc = new SigningService(prisma, cipher, new PolicyValidator(), audit);

    const result = await svc.signTransaction('s1', tx);

    // BEHAVIOR: the key was decrypted, the tx was signed with a real signature.
    expect(cipher.open).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    const sig = result.signatures.find((s) => s.publicKey.equals(subKp.publicKey));
    expect(sig?.signature).toBeInstanceOf(Buffer);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'subwallet.sign' }),
    );
  });
});
