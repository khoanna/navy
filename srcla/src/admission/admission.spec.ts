import { AdmissionEngine } from './engine.js';
import { MarketSnapshot } from '../domain/snapshots.js';

// Helper to create mock snapshots
function createSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    marketId: 'test',
    blockHash: '0x123',
    timestamp: new Date(),
    totalAssetsBase: 10_000_000_000_000n,
    idleBase: 200_000_000_000n,
    supplyRateE18: 50000000000000000n,
    utilizationE18: 700000000000000000n,
    cashBase: 100_000_000_000n,
    borrowsBase: 5_000_000_000_000n,
    reservesBase: 1_000_000_000_000n,
    capBps: 0,
    paused: false,
    configDigest: '0x456',
    ...overrides,
  } as MarketSnapshot;
}

describe('AdmissionEngine', () => {
  let engine: AdmissionEngine;

  beforeEach(() => {
    engine = new AdmissionEngine({
      minReserveBps: 100n,
      maxAdapterCapBps: 5000n,
      maxDependencyGroupCapBps: 8000n,
      maxWithdrawalLossBps: 100n,
      dependencyGroups: [],
    });
  });

  it('should admit market with sufficient reserve', () => {
    const snapshot = createSnapshot({ idleBase: 200_000_000_000n });
    const result = engine.evaluate(snapshot);
    expect(result.admitted).toBe(true);
  });

  it('should reject market below min reserve', () => {
    const snapshot = createSnapshot({ idleBase: 50_000_000_000n });
    const result = engine.evaluate(snapshot);
    expect(result.admitted).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('RESERVE_BELOW_MIN'))).toBe(true);
  });

  it('should reject paused market', () => {
    const snapshot = createSnapshot({ paused: true });
    const result = engine.evaluate(snapshot);
    expect(result.admitted).toBe(false);
    expect(result.reasons.some((r: string) => r.includes('MARKET_PAUSED'))).toBe(true);
  });

  it('should update policy', () => {
    engine.updatePolicy({ minReserveBps: 200n, maxAdapterCapBps: 5000n, maxDependencyGroupCapBps: 8000n, maxWithdrawalLossBps: 100n, dependencyGroups: [] });
    const snapshot = createSnapshot({ idleBase: 150_000_000_000n });
    const result = engine.evaluate(snapshot);
    expect(result.admitted).toBe(false);
  });
});
