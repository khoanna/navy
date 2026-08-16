import { AdmissionEngine } from './engine.js';
import { MarketSnapshot } from '../domain/snapshots.js';
import type { VaultSnapshot } from '../collector/types.js';

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

// Helper to create vault snapshot with production fields
function createVaultSnapshot(overrides: Partial<VaultSnapshot> = {}): VaultSnapshot {
  return {
    totalAssets: 10_000_000_000_000n,
    synchronousLiquidity: 9_500_000_000_000n,
    idleBase: 500_000_000_000n,
    minIdleBps: 100n,
    paused: false,
    absoluteCaps: {
      totalCap: 100_000_000_000_000n,
      perUserCap: 1_000_000_000_000n,
      minDeposit: 10_000_000n,
    },
    groups: [
      { id: 'compound-group', exposure: 5_000_000_000_000n, cap: 10_000_000_000_000n },
    ],
    reserve: {
      admin: 100_000_000_000n,
      dynamic: 400_000_000_000n,
    },
    rewardCacheTimestamp: BigInt(Math.floor(Date.now() / 1000)), // Fresh timestamp
    rewardCacheValue: 50_000_000_000n,
    rewardReady: true,
    rewardPolicyDigest: '0xdigest123',
    routeDigest: '0xroute456',
    routeStatus: 'active',
    sequencerRound: BigInt(Math.floor(Date.now() / 1000)), // Fresh sequencer round
    feedRounds: [
      { feed: '0xfeed123', round: BigInt(Math.floor(Date.now() / 1000)), staleness: false },
    ],
    ...overrides,
  };
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

describe('AdmissionEngine - Production Vault Fields', () => {
  let engine: AdmissionEngine;

  beforeEach(() => {
    engine = new AdmissionEngine({
      minReserveBps: 100n,
      maxAdapterCapBps: 5000n,
      maxDependencyGroupCapBps: 8000n,
      maxWithdrawalLossBps: 100n,
      dependencyGroups: [],
      // Production policy fields
      maxTotalCapBps: 10000n, // 100% of vault
      maxPerUserCapBps: 1000n, // 10% per user
      minRewardCacheAgeSeconds: 3600n, // 1 hour
      maxSequencerStalenessSeconds: 3600n, // 1 hour
      maxFeedStalenessSeconds: 300n, // 5 minutes
    });
  });

  describe('Reward State Validation', () => {
    it('should reject when reward is not ready', () => {
      const vaultSnapshot = createVaultSnapshot({ rewardReady: false });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(false);
      expect(result.errors.some((e) => e.includes('REWARD_NOT_READY'))).toBe(true);
    });

    it('should admit when reward is ready', () => {
      const vaultSnapshot = createVaultSnapshot({ rewardReady: true });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(true);
    });

    it('should reject stale reward cache', () => {
      const now = Math.floor(Date.now() / 1000);
      const staleTimestamp = now - 7200; // 2 hours ago
      const vaultSnapshot = createVaultSnapshot({ rewardCacheTimestamp: BigInt(staleTimestamp) });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(false);
      expect(result.errors.some((e) => e.includes('REWARD_CACHE_STALE'))).toBe(true);
    });

    it('should admit fresh reward cache', () => {
      const now = Math.floor(Date.now() / 1000);
      const freshTimestamp = now - 1800; // 30 minutes ago
      const vaultSnapshot = createVaultSnapshot({ rewardCacheTimestamp: BigInt(freshTimestamp) });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(true);
    });
  });

  describe('Route Status Validation', () => {
    it('should reject inactive route', () => {
      const vaultSnapshot = createVaultSnapshot({ routeStatus: 'inactive' });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(false);
      expect(result.errors.some((e) => e.includes('ROUTE_INACTIVE'))).toBe(true);
    });

    it('should reject stale route', () => {
      const vaultSnapshot = createVaultSnapshot({ routeStatus: 'stale' });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(false);
      expect(result.errors.some((e) => e.includes('ROUTE_STALE'))).toBe(true);
    });

    it('should admit active route', () => {
      const vaultSnapshot = createVaultSnapshot({ routeStatus: 'active' });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(true);
    });
  });

  describe('Sequencer/Feed Staleness', () => {
    it('should reject stale sequencer round', () => {
      const oldRound = 100n; // Very old round
      const vaultSnapshot = createVaultSnapshot({ sequencerRound: oldRound });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(false);
      expect(result.errors.some((e) => e.includes('SEQUENCER_STALE'))).toBe(true);
    });

    it('should admit recent sequencer round', () => {
      const recentRound = BigInt(Math.floor(Date.now() / 1000) - 60); // 1 minute ago
      const vaultSnapshot = createVaultSnapshot({ sequencerRound: recentRound });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(true);
    });

    it('should reject stale feed', () => {
      const vaultSnapshot = createVaultSnapshot({
        feedRounds: [{ feed: '0xfeed', round: 100n, staleness: true }],
      });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(false);
      expect(result.errors.some((e) => e.includes('FEED_STALE'))).toBe(true);
    });

    it('should admit fresh feed', () => {
      const vaultSnapshot = createVaultSnapshot({
        feedRounds: [{ feed: '0xfeed', round: BigInt(Math.floor(Date.now() / 1000)), staleness: false }],
      });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(true);
    });
  });

  describe('Policy Digest Validation', () => {
    it('should reject mismatched reward policy digest', () => {
      const expectedDigest = '0xdigest123';
      const vaultSnapshot = createVaultSnapshot({
        rewardPolicyDigest: '0xwrongdigest456',
      });

      engine.updatePolicy({
        minReserveBps: 100n,
        maxAdapterCapBps: 5000n,
        maxDependencyGroupCapBps: 8000n,
        maxWithdrawalLossBps: 100n,
        dependencyGroups: [],
        expectedRewardPolicyDigest: expectedDigest,
      });

      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(false);
      expect(result.errors.some((e) => e.includes('REWARD_DIGEST_MISMATCH'))).toBe(true);
    });

    it('should admit matching reward policy digest', () => {
      const expectedDigest = '0xdigest123';
      const vaultSnapshot = createVaultSnapshot({
        rewardPolicyDigest: expectedDigest,
      });

      engine.updatePolicy({
        minReserveBps: 100n,
        maxAdapterCapBps: 5000n,
        maxDependencyGroupCapBps: 8000n,
        maxWithdrawalLossBps: 100n,
        dependencyGroups: [],
        expectedRewardPolicyDigest: expectedDigest,
      });

      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(true);
    });
  });

  describe('Cap Validation', () => {
    it('should reject when total assets exceed total cap', () => {
      const vaultSnapshot = createVaultSnapshot({
        totalAssets: 150_000_000_000_000n, // Exceeds 100T cap
        absoluteCaps: {
          totalCap: 100_000_000_000_000n,
          perUserCap: 1_000_000_000_000n,
          minDeposit: 10_000_000n,
        },
      });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(false);
      expect(result.errors.some((e) => e.includes('TOTAL_CAP_EXCEEDED'))).toBe(true);
    });

    it('should reject when group exposure exceeds group cap', () => {
      const vaultSnapshot = createVaultSnapshot({
        groups: [
          { id: 'compound-group', exposure: 12_000_000_000_000n, cap: 10_000_000_000_000n },
        ],
      });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(false);
      expect(result.errors.some((e) => e.includes('GROUP_CAP_EXCEEDED'))).toBe(true);
    });

    it('should admit when within all caps', () => {
      const vaultSnapshot = createVaultSnapshot({
        totalAssets: 50_000_000_000_000n,
        absoluteCaps: {
          totalCap: 100_000_000_000_000n,
          perUserCap: 1_000_000_000_000n,
          minDeposit: 10_000_000n,
        },
        groups: [
          { id: 'compound-group', exposure: 5_000_000_000_000n, cap: 10_000_000_000_000n },
        ],
      });
      const result = engine.evaluateVault(vaultSnapshot);
      expect(result.admitted).toBe(true);
    });
  });
});

describe('AdmissionResult - Extended Fields', () => {
  it('should include reward-specific errors', () => {
    const vaultSnapshot = createVaultSnapshot({ rewardReady: false });
    const engine = new AdmissionEngine({
      minReserveBps: 100n,
      maxAdapterCapBps: 5000n,
      maxDependencyGroupCapBps: 8000n,
      maxWithdrawalLossBps: 100n,
      dependencyGroups: [],
    });

    const result = engine.evaluateVault(vaultSnapshot);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('REWARD_NOT_READY');
  });
});
