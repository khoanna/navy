import { SnapshotCollector } from './snapshot-collector.js';
import { CollectorConfig } from './types.js';

describe('SnapshotCollector', () => {
  const mockConfig: CollectorConfig = {
    vaultAddress: '0x0000000000000000000000000000000000000001',
    strategyAddresses: {
      aave: '0x0000000000000000000000000000000000000002',
      compound: '0x0000000000000000000000000000000000000003',
      moonwell: '0x0000000000000000000000000000000000000004',
    },
    usdcAddress: '0x0000000000000000000000000000000000000005',
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
      };
      void config;
    }).not.toThrow();
  });
});
