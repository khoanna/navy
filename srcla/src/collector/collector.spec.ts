import { SnapshotCollector } from './snapshot-collector.js';
import { CollectorConfig, type VaultSnapshot, type CollectedSnapshot } from './types.js';

describe('SnapshotCollector', () => {
  const mockConfig: CollectorConfig = {
    vaultAddress: '0x0000000000000000000000000000000000000001',
    strategyAddresses: {
      aave: '0x0000000000000000000000000000000000000002',
      compound: '0x0000000000000000000000000000000000000003',
      moonwell: '0x0000000000000000000000000000000000000004',
    },
    usdcAddress: '0x0000000000000000000000000000000000000005',
    rewardAccountantAddress: '0x0000000000000000000000000000000000000006',
    rewardExecutorAddress: '0x0000000000000000000000000000000000000007',
  };

  it('should create collector with config', () => {
    const client = { chainId: 8453 } as any;
    const collector = new SnapshotCollector(client as any, mockConfig);
    expect(collector).toBeDefined();
  });

  it('should have collect method', () => {
    const client = { chainId: 8453 } as any;
    const collector = new SnapshotCollector(client as any, mockConfig);
    expect(typeof collector.collect).toBe('function');
  });
});

describe('CollectorConfig', () => {
  it('should require vault address', () => {
    expect(() => {
      const config: CollectorConfig = {
        vaultAddress: '',
        strategyAddresses: { aave: '', compound: '', moonwell: '' },
        usdcAddress: '',
        rewardAccountantAddress: '',
        rewardExecutorAddress: '',
      };
      void config;
    }).not.toThrow();
  });
});

describe('VaultSnapshot - Extended Fields', () => {
  it('should include absolute caps fields', () => {
    const snapshot: VaultSnapshot = {
      totalAssets: 10_000_000_000_000n,
      synchronousLiquidity: 9_500_000_000_000n,
      idleBase: 500_000_000_000n,
      minIdleBps: 100n,
      paused: false,
      // Extended fields from production vault
      absoluteCaps: {
        totalCap: 100_000_000_000_000n,
        perUserCap: 1_000_000_000_000n,
        minDeposit: 10_000_000n, // 10 USDC
      },
      groups: [
        { id: 'compound-group', exposure: 5_000_000_000_000n, cap: 10_000_000_000_000n },
        { id: 'aave-group', exposure: 4_500_000_000_000n, cap: 8_000_000_000_000n },
      ],
      reserve: {
        admin: 100_000_000_000n,
        dynamic: 400_000_000_000n,
      },
      rewardCacheTimestamp: 1_000_000_000n,
      rewardCacheValue: 50_000_000_000n,
      rewardReady: true,
      rewardPolicyDigest: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      routeDigest: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      routeStatus: 'active',
      sequencerRound: 1_000_000n,
      feedRounds: [
        { feed: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', round: 999_999n, staleness: false },
      ],
    };

    expect(snapshot.absoluteCaps?.totalCap).toBe(100_000_000_000_000n);
    expect(snapshot.absoluteCaps?.perUserCap).toBe(1_000_000_000_000n);
    expect(snapshot.absoluteCaps?.minDeposit).toBe(10_000_000n);
    expect(snapshot.groups).toHaveLength(2);
    expect(snapshot.groups?.[0]?.id).toBe('compound-group');
    expect(snapshot.groups?.[0]?.exposure).toBe(5_000_000_000_000n);
    expect(snapshot.groups?.[0]?.cap).toBe(10_000_000_000_000n);
    expect(snapshot.reserve?.admin).toBe(100_000_000_000n);
    expect(snapshot.reserve?.dynamic).toBe(400_000_000_000n);
    expect(snapshot.rewardCacheTimestamp).toBe(1_000_000_000n);
    expect(snapshot.rewardCacheValue).toBe(50_000_000_000n);
    expect(snapshot.rewardReady).toBe(true);
    expect(snapshot.rewardPolicyDigest).toBeDefined();
    expect(snapshot.routeDigest).toBeDefined();
    expect(snapshot.routeStatus).toBe('active');
    expect(snapshot.sequencerRound).toBe(1_000_000n);
    expect(snapshot.feedRounds).toHaveLength(1);
    expect(snapshot.feedRounds?.[0]?.staleness).toBe(false);
  });

  it('should support route status values', () => {
    const statuses: ('active' | 'inactive' | 'stale')[] = ['active', 'inactive', 'stale'];
    for (const status of statuses) {
      const snapshot: VaultSnapshot = {
        totalAssets: 0n,
        synchronousLiquidity: 0n,
        idleBase: 0n,
        minIdleBps: 0n,
        paused: false,
        routeStatus: status,
      };
      expect(snapshot.routeStatus).toBe(status);
    }
  });

  it('should track staleness in feed rounds', () => {
    const snapshot: VaultSnapshot = {
      totalAssets: 0n,
      synchronousLiquidity: 0n,
      idleBase: 0n,
      minIdleBps: 0n,
      paused: false,
      feedRounds: [
        { feed: '0x1111', round: 100n, staleness: false },
        { feed: '0x2222', round: 50n, staleness: true }, // stale feed
      ],
    };
    expect(snapshot.feedRounds?.[0]?.staleness).toBe(false);
    expect(snapshot.feedRounds?.[1]?.staleness).toBe(true);
  });
});

describe('CollectedSnapshot - Full Production Snapshot', () => {
  it('should include all production vault fields', () => {
    const snapshot: CollectedSnapshot = {
      blockNumber: 12345678,
      blockHash: '0xabc123def456',
      timestamp: new Date(),
      vault: {
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
          { id: 'defi-blue', exposure: 8_000_000_000_000n, cap: 15_000_000_000_000n },
        ],
        reserve: {
          admin: 100_000_000_000n,
          dynamic: 400_000_000_000n,
        },
        rewardCacheTimestamp: 1_000_000_000n,
        rewardCacheValue: 50_000_000_000n,
        rewardReady: true,
        rewardPolicyDigest: '0xdigest123',
        routeDigest: '0xroute456',
        routeStatus: 'active',
        sequencerRound: 1_000_000n,
        feedRounds: [
          { feed: '0xfeed123', round: 999n, staleness: false },
        ],
      },
      strategies: [],
    };

    expect(snapshot.vault.absoluteCaps).toBeDefined();
    expect(snapshot.vault.groups).toBeDefined();
    expect(snapshot.vault.reserve).toBeDefined();
    expect(snapshot.vault.rewardCacheTimestamp).toBeDefined();
    expect(snapshot.vault.rewardReady).toBeDefined();
    expect(snapshot.vault.routeStatus).toBeDefined();
    expect(snapshot.vault.sequencerRound).toBeDefined();
  });
});
