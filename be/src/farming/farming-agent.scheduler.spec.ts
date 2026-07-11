import { FarmingAgentScheduler } from './farming-agent.scheduler';

function make(idleLamports: number) {
  const sw = { id: 's1', pubkey: '11111111111111111111111111111111', status: 'active' };
  const prisma = { farmingSubwallet: { findMany: jest.fn().mockResolvedValue([sw]) } } as any;
  const farming = { depositSubwallet: jest.fn().mockResolvedValue({ txSignature: 'sig' }), refreshSubwallet: jest.fn().mockResolvedValue({}) };
  const chain = { connection: { getBalance: jest.fn().mockResolvedValue(idleLamports) } };
  const audit = { record: jest.fn() };
  const delegation = { autoFundSubwallet: jest.fn().mockResolvedValue({ skipped: 'not enabled' }) } as any;
  return { sched: new FarmingAgentScheduler(prisma, farming as any, chain as any, audit as any, { rentBuffer: 2_000_000, minDeposit: 1_000_000, maxDeposit: 1_000_000_000 }, delegation), farming };
}

describe('FarmingAgentScheduler.tickOnce', () => {
  it('deposits idle SOL above the rent buffer + min deposit', async () => {
    const { sched, farming } = make(5_000_000);
    await sched.tickOnce();
    expect(farming.depositSubwallet).toHaveBeenCalled();
    expect(farming.refreshSubwallet).toHaveBeenCalled();
  });
  it('skips depositing when idle is below the buffer + minimum', async () => {
    const { sched, farming } = make(2_500_000);
    await sched.tickOnce();
    expect(farming.depositSubwallet).not.toHaveBeenCalled();
  });
  it('caps the deposit at maxDeposit', async () => {
    const { sched, farming } = make(10_000_000_000);
    await sched.tickOnce();
    expect(farming.depositSubwallet.mock.calls[0][1]).toBe(1_000_000_000n);
  });
});

describe('FarmingAgentScheduler auto-fund', () => {
  it('auto-funds a low subwallet before depositing', async () => {
    const sw = { id: 's1', pubkey: '11111111111111111111111111111111', userId: 'u1', status: 'active' };
    const prisma = { farmingSubwallet: { findMany: jest.fn().mockResolvedValue([sw]) } } as any;
    const farming = { depositSubwallet: jest.fn().mockResolvedValue({}), refreshSubwallet: jest.fn().mockResolvedValue({}) } as any;
    // getBalance returns low on first call; re-read after fund also returns low (still below threshold — no deposit expected here)
    const chain = { connection: { getBalance: jest.fn().mockResolvedValue(1_000_000) } } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const bounds = { rentBuffer: 2_000_000, minDeposit: 10_000_000, maxDeposit: 1_000_000_000 };
    const delegation = { autoFundSubwallet: jest.fn().mockResolvedValue({ txSignature: 'sig' }) } as any;
    const agent = new FarmingAgentScheduler(prisma, farming, chain, audit, bounds, delegation);
    await agent.tickOnce();
    expect(delegation.autoFundSubwallet).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', pubkey: '11111111111111111111111111111111', userId: 'u1' }));
  });

  it('deposits in the same tick after a successful auto-fund when re-read balance is high enough', async () => {
    const sw = { id: 's1', pubkey: '11111111111111111111111111111111', userId: 'u1', status: 'active' };
    const prisma = { farmingSubwallet: { findMany: jest.fn().mockResolvedValue([sw]) } } as any;
    const farming = { depositSubwallet: jest.fn().mockResolvedValue({}), refreshSubwallet: jest.fn().mockResolvedValue({}) } as any;
    // First call: low (triggers auto-fund); second call: high (re-read after fund)
    const chain = { connection: { getBalance: jest.fn().mockResolvedValueOnce(1_000_000).mockResolvedValueOnce(500_000_000) } } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const bounds = { rentBuffer: 2_000_000, minDeposit: 10_000_000, maxDeposit: 1_000_000_000 };
    const delegation = { autoFundSubwallet: jest.fn().mockResolvedValue({ txSignature: 'sig' }) } as any;
    const agent = new FarmingAgentScheduler(prisma, farming, chain, audit, bounds, delegation);
    await agent.tickOnce();
    expect(delegation.autoFundSubwallet).toHaveBeenCalled();
    expect(farming.depositSubwallet).toHaveBeenCalled();
  });

  it('does not deposit in the same tick when auto-fund was skipped', async () => {
    const sw = { id: 's1', pubkey: '11111111111111111111111111111111', userId: 'u1', status: 'active' };
    const prisma = { farmingSubwallet: { findMany: jest.fn().mockResolvedValue([sw]) } } as any;
    const farming = { depositSubwallet: jest.fn().mockResolvedValue({}), refreshSubwallet: jest.fn().mockResolvedValue({}) } as any;
    const chain = { connection: { getBalance: jest.fn().mockResolvedValue(1_000_000) } } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const bounds = { rentBuffer: 2_000_000, minDeposit: 10_000_000, maxDeposit: 1_000_000_000 };
    const delegation = { autoFundSubwallet: jest.fn().mockResolvedValue({ skipped: 'not enabled' }) } as any;
    const agent = new FarmingAgentScheduler(prisma, farming, chain, audit, bounds, delegation);
    await agent.tickOnce();
    expect(farming.depositSubwallet).not.toHaveBeenCalled();
  });
});
