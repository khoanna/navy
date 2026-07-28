import { decideRebalance, RebalanceConfig, AdapterState } from './rebalance.logic';

const cfg: RebalanceConfig = {
  driftBandBps: 500,
  minIdleBps: 1000,
  gasCostBase: 100_000n,
  safetyFactor: 2,
  horizonSeconds: 2_592_000,
};

function st(addr: string, targetBps: number, aprE18: bigint, assetsBase: bigint): AdapterState {
  return { address: addr, targetBps, aprE18, assetsBase };
}

describe('decideRebalance', () => {
  it('deploys idle above the buffer toward the highest-APY under-target adapter', () => {
    const adapters = [st('0xA', 5000, 30n * 10n ** 15n, 0n), st('0xB', 5000, 50n * 10n ** 15n, 0n)];
    const moves = decideRebalance({ adapters, idleBase: 1_000_000_000n, totalBase: 1_000_000_000n, config: cfg });
    expect(moves.length).toBeGreaterThan(0);
    const deployed = moves.filter((m) => m.kind === 'deploy').reduce((a, m) => a + m.amountBase, 0n);
    expect(deployed).toBeLessThanOrEqual(900_000_000n);
    expect(deployed).toBeGreaterThan(0n);
  });

  it('does nothing when allocation is within the drift band', () => {
    const adapters = [st('0xA', 5000, 4n * 10n ** 16n, 480_000_000n), st('0xB', 5000, 4n * 10n ** 16n, 520_000_000n)];
    const moves = decideRebalance({ adapters, idleBase: 0n, totalBase: 1_000_000_000n, config: cfg });
    expect(moves).toEqual([]);
  });

  it('reallocates from an over-target to an under-target adapter when drift exceeds the band', () => {
    const adapters = [st('0xA', 5000, 3n * 10n ** 16n, 800_000_000n), st('0xB', 5000, 5n * 10n ** 16n, 200_000_000n)];
    const moves = decideRebalance({ adapters, idleBase: 0n, totalBase: 1_000_000_000n, config: cfg });
    const re = moves.find((m) => m.kind === 'reallocate');
    expect(re).toBeDefined();
    expect(re!.fromAdapter).toBe('0xA');
    expect(re!.toAdapter).toBe('0xB');
    expect(re!.amountBase).toBeGreaterThan(0n);
  });

  it('skips a move whose expected extra yield does not clear the gas-breakeven check', () => {
    const adapters2 = [st('0xA', 9000, 30n * 10n ** 15n, 1_000_000n), st('0xB', 1000, 30n * 10n ** 15n, 0n)];
    const moves = decideRebalance({ adapters: adapters2, idleBase: 0n, totalBase: 1_000_000n, config: cfg });
    expect(moves).toEqual([]);
  });
});
