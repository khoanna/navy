import { ethers } from 'ethers';
import { FarmingService } from './farming.service';

const OWNER = ethers.Wallet.createRandom().address;
const SUB = ethers.Wallet.createRandom().address;

function deps() {
  const sw = { id: 's1', userId: 'u1', pubkey: SUB, ownerMainWallet: OWNER, status: 'active', principalLamports: 0n, currentValueLamports: 0n };
  const prisma = {
    farmingSubwallet: { findFirst: jest.fn().mockResolvedValue(sw), update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...sw, ...data })) },
    farmingEvent: { create: jest.fn().mockResolvedValue({ id: 'e1' }), findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  const subwallets = { provision: jest.fn().mockResolvedValue({ id: 's1', pubkey: SUB }) };
  const adapter = {
    buildDeposit: jest.fn().mockResolvedValue([{ to: '0xusdc', data: '0x1' }, { to: '0xpool', data: '0x2' }]),
    buildWithdraw: jest.fn().mockResolvedValue([{ to: '0xpool', data: '0x3' }]),
    getPosition: jest.fn().mockResolvedValue({ principalLamports: 100n, currentValueLamports: 105n, cTokenAmount: 100n }),
    policyAllowlist: jest.fn().mockResolvedValue({ programIds: ['P'], destinations: ['D'] }),
  };
  // signAndSend returns a tx hash per call.
  const signing = { signAndSend: jest.fn().mockResolvedValue('0xhash') };
  const evm = { provider: {} } as any;
  const audit = { record: jest.fn() };
  return { svc: new FarmingService(prisma, subwallets as any, adapter as any, signing as any, evm, audit as any), prisma, subwallets, adapter, signing, sw };
}

describe('FarmingService', () => {
  it('createSubwallet provisions then stores the adapter policy + owner', async () => {
    const { svc, subwallets, adapter, prisma } = deps();
    const out = await svc.createSubwallet('u1', OWNER);
    expect(subwallets.provision).toHaveBeenCalled();
    expect(adapter.policyAllowlist).toHaveBeenCalledWith(SUB, OWNER);
    const upd = prisma.farmingSubwallet.update.mock.calls[0][0].data;
    expect(upd.ownerMainWallet).toBe(OWNER);
    expect(upd.policyJson).toEqual({ allowedProgramIds: ['P'], allowedDestinations: ['D'] });
    expect(out.address).toBeDefined();
  });
  it('deposit builds calls, sends each via SigningService, records a deposit event', async () => {
    const { svc, adapter, signing, prisma } = deps();
    await svc.deposit('u1', 100n);
    expect(adapter.buildDeposit).toHaveBeenCalledWith(SUB, 100n);
    // Two calls (approve + supply) → two signAndSend invocations.
    expect(signing.signAndSend).toHaveBeenCalledTimes(2);
    expect(signing.signAndSend).toHaveBeenCalledWith('s1', { to: '0xusdc', data: '0x1' });
    expect(prisma.farmingEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'deposit' }) }));
  });
  it('withdraw builds an owner-targeted call and records a withdraw event', async () => {
    const { svc, adapter, prisma } = deps();
    await svc.withdraw('u1', 'all');
    expect(adapter.buildWithdraw).toHaveBeenCalledWith(SUB, OWNER, 'all');
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
    expect(adapter.buildDeposit).toHaveBeenCalledWith(SUB, 50n);
    expect(signing.signAndSend).toHaveBeenCalledTimes(2);
  });
});
