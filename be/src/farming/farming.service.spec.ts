import { FarmingService } from './farming.service';
import { PublicKey, Transaction } from '@solana/web3.js';

function deps() {
  const sw = { id: 's1', userId: 'u1', pubkey: PublicKey.default.toBase58(), ownerMainWallet: PublicKey.default.toBase58(), status: 'active', principalLamports: 0n, currentValueLamports: 0n };
  const prisma = {
    farmingSubwallet: { findFirst: jest.fn().mockResolvedValue(sw), update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...sw, ...data })) },
    farmingEvent: { create: jest.fn().mockResolvedValue({ id: 'e1' }), findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  const subwallets = { provision: jest.fn().mockResolvedValue({ id: 's1', pubkey: PublicKey.default.toBase58() }) };
  const adapter = {
    buildDeposit: jest.fn().mockResolvedValue(new Transaction()),
    buildWithdraw: jest.fn().mockResolvedValue(new Transaction()),
    getPosition: jest.fn().mockResolvedValue({ principalLamports: 100n, currentValueLamports: 105n, cTokenAmount: 100n }),
    policyAllowlist: jest.fn().mockResolvedValue({ programIds: ['P'], destinations: ['D'] }),
  };
  const signing = { signTransaction: jest.fn().mockImplementation(async (_id: string, tx: Transaction) => tx) };
  const chain = { connection: { sendRawTransaction: jest.fn().mockResolvedValue('sig'), confirmTransaction: jest.fn().mockResolvedValue({}), getBalance: jest.fn().mockResolvedValue(0) } };
  const audit = { record: jest.fn() };
  return { svc: new FarmingService(prisma, subwallets as any, adapter as any, signing as any, chain as any, audit as any), prisma, subwallets, adapter, signing, sw };
}

describe('FarmingService', () => {
  it('createSubwallet provisions then stores the adapter policy + owner', async () => {
    const { svc, subwallets, adapter, prisma } = deps();
    const out = await svc.createSubwallet('u1', PublicKey.default.toBase58());
    expect(subwallets.provision).toHaveBeenCalled();
    expect(adapter.policyAllowlist).toHaveBeenCalled();
    const upd = prisma.farmingSubwallet.update.mock.calls[0][0].data;
    expect(upd.ownerMainWallet).toBe(PublicKey.default.toBase58());
    expect(upd.policyJson).toEqual({ allowedProgramIds: ['P'], allowedDestinations: ['D'] });
    expect(out.address).toBeDefined();
  });
  it('deposit builds, signs via SigningService, submits, records a deposit event', async () => {
    const { svc, adapter, signing, prisma } = deps();
    await svc.deposit('u1', 100n);
    expect(adapter.buildDeposit).toHaveBeenCalled();
    expect(signing.signTransaction).toHaveBeenCalledWith('s1', expect.any(Transaction));
    expect(prisma.farmingEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'deposit' }) }));
  });
  it('withdraw builds an owner-targeted tx and records a withdraw event', async () => {
    const { svc, adapter, prisma } = deps();
    await svc.withdraw('u1', 'all');
    expect(adapter.buildWithdraw).toHaveBeenCalledWith(expect.any(PublicKey), expect.any(PublicKey), 'all');
    expect(prisma.farmingEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'withdraw' }) }));
  });
  it('getPosition refreshes from the adapter and persists', async () => {
    const { svc, prisma } = deps();
    const pos = await svc.getPosition('u1');
    expect(pos.currentValueLamports).toBe('105');
    expect(prisma.farmingSubwallet.update).toHaveBeenCalled();
  });
  it('depositSubwallet(sw, amount) deposits for a specific row (used by the scheduler)', async () => {
    const { svc, adapter, signing, sw } = deps();
    await svc.depositSubwallet(sw as any, 50n);
    expect(adapter.buildDeposit).toHaveBeenCalledWith(expect.any(PublicKey), 50n);
    expect(signing.signTransaction).toHaveBeenCalledWith('s1', expect.any(Transaction));
  });
});
