import { FarmingAgentScheduler } from './farming-agent.scheduler';

// Build a scheduler whose USDC balanceOf reads are controlled by `balanceMock`.
function makeAgent(opts: {
  sw?: any;
  balanceMock: jest.Mock;
  bounds?: { rentBuffer: number; minDeposit: number; maxDeposit: number };
  delegation?: any;
}) {
  const sw = opts.sw ?? { id: 's1', pubkey: '0xSub', userId: 'u1', status: 'active' };
  const prisma = { farmingSubwallet: { findMany: jest.fn().mockResolvedValue([sw]) } } as any;
  const farming = { depositSubwallet: jest.fn().mockResolvedValue({ txSignature: '0xh' }), refreshSubwallet: jest.fn().mockResolvedValue({}) } as any;
  const evm = { provider: {} } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const bounds = opts.bounds ?? { rentBuffer: 2_000_000, minDeposit: 1_000_000, maxDeposit: 1_000_000_000 };
  const delegation = opts.delegation ?? { autoFundSubwallet: jest.fn().mockResolvedValue({ skipped: 'not enabled' }) };
  const sched = new FarmingAgentScheduler(prisma, farming, evm, audit, bounds, delegation);
  // Override the USDC contract with a balanceOf-only stub returning bigint.
  (sched as any).usdc = { balanceOf: opts.balanceMock };
  return { sched, farming, delegation };
}

describe('FarmingAgentScheduler.tickOnce', () => {
  it('deposits idle USDC above the buffer + min deposit', async () => {
    const { sched, farming } = makeAgent({ balanceMock: jest.fn().mockResolvedValue(5_000_000n) });
    await sched.tickOnce();
    expect(farming.depositSubwallet).toHaveBeenCalled();
    expect(farming.refreshSubwallet).toHaveBeenCalled();
  });
  it('skips depositing when idle is below the buffer + minimum', async () => {
    const { sched, farming } = makeAgent({ balanceMock: jest.fn().mockResolvedValue(2_500_000n) });
    await sched.tickOnce();
    expect(farming.depositSubwallet).not.toHaveBeenCalled();
  });
  it('caps the deposit at maxDeposit', async () => {
    const { sched, farming } = makeAgent({ balanceMock: jest.fn().mockResolvedValue(10_000_000_000n) });
    await sched.tickOnce();
    expect(farming.depositSubwallet.mock.calls[0][1]).toBe(1_000_000_000n);
  });
});

describe('FarmingAgentScheduler auto-fund', () => {
  const bounds = { rentBuffer: 2_000_000, minDeposit: 10_000_000, maxDeposit: 1_000_000_000 };

  it('auto-funds a low subwallet before depositing', async () => {
    const delegation = { autoFundSubwallet: jest.fn().mockResolvedValue({ txSignature: '0xh' }) };
    const { sched, delegation: del } = makeAgent({ balanceMock: jest.fn().mockResolvedValue(1_000_000n), bounds, delegation });
    await sched.tickOnce();
    expect(del.autoFundSubwallet).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', pubkey: '0xSub', userId: 'u1' }));
  });

  it('deposits in the same tick after a successful auto-fund when re-read balance is high enough', async () => {
    const delegation = { autoFundSubwallet: jest.fn().mockResolvedValue({ txSignature: '0xh' }) };
    const balanceMock = jest.fn().mockResolvedValueOnce(1_000_000n).mockResolvedValueOnce(500_000_000n);
    const { sched, farming, delegation: del } = makeAgent({ balanceMock, bounds, delegation });
    await sched.tickOnce();
    expect(del.autoFundSubwallet).toHaveBeenCalled();
    expect(farming.depositSubwallet).toHaveBeenCalled();
  });

  it('does not deposit in the same tick when auto-fund was skipped', async () => {
    const delegation = { autoFundSubwallet: jest.fn().mockResolvedValue({ skipped: 'not enabled' }) };
    const { sched, farming } = makeAgent({ balanceMock: jest.fn().mockResolvedValue(1_000_000n), bounds, delegation });
    await sched.tickOnce();
    expect(farming.depositSubwallet).not.toHaveBeenCalled();
  });
});
