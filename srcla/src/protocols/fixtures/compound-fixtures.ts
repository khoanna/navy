export interface CompoundFixture {
  name: string;
  cash: bigint;
  borrows: bigint;
  supplyRate: bigint;
  horizonSeconds: number;
  expectedMeanReturn: bigint;
}

export const compoundFixtures: CompoundFixture[] = [
  {
    name: '5% APY, 60% util, 1 day',
    cash: 20_000_000_000_000n,
    borrows: 30_000_000_000_000n,
    supplyRate: 50000000000000000n,
    horizonSeconds: 86400,
    expectedMeanReturn: 10000001368360530n,
  },
];
