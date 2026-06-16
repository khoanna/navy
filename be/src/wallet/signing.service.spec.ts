import { Transaction, TransactionInstruction, SystemProgram, Keypair } from '@solana/web3.js';
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
});
