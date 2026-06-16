import { FarmingAgentScheduler } from './farming-agent.scheduler';

function make(idleLamports: number) {
  const sw = { id: 's1', pubkey: '11111111111111111111111111111111', status: 'active' };
  const prisma = { farmingSubwallet: { findMany: jest.fn().mockResolvedValue([sw]) } } as any;
  const farming = { depositSubwallet: jest.fn().mockResolvedValue({ txSignature: 'sig' }), refreshSubwallet: jest.fn().mockResolvedValue({}) };
  const chain = { connection: { getBalance: jest.fn().mockResolvedValue(idleLamports) } };
  const audit = { record: jest.fn() };
  return { sched: new FarmingAgentScheduler(prisma, farming as any, chain as any, audit as any, { rentBuffer: 2_000_000, minDeposit: 1_000_000, maxDeposit: 1_000_000_000 }), farming };
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
