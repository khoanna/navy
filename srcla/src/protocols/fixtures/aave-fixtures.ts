export interface AaveFixture {
  name: string;
  cash: bigint;
  borrows: bigint;
  reserves: bigint;
  supplyRate: bigint;
  horizonSeconds: number;
  expectedMeanReturn: bigint;
  tolerance: number;
}

export const aaveFixtures: AaveFixture[] = [
  {
    name: 'Base 5% APY, 70% util, 1 day',
    cash: 10_000_000_000_000n,
    borrows: 23_333_333_333_333n,
    reserves: 1_000_000_000_000n,
    supplyRate: 50000000000000000n, // 5% APY
    horizonSeconds: 86400,
    expectedMeanReturn: 10000001368360530n, // ~1.00001368x
    tolerance: 1e6,
  },
  {
    name: 'High util 90%, 10% APY, 1 hour',
    cash: 5_000_000_000_000n,
    borrows: 45_000_000_000_000n,
    reserves: 2_000_000_000_000n,
    supplyRate: 100000000000000000n, // 10% APY
    horizonSeconds: 3600,
    expectedMeanReturn: 10000000386387512n, // ~1.00000386x
    tolerance: 1e6,
  },
];
