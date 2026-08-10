export interface MoonwellFixture {
  name: string;
  cash: bigint;
  borrows: bigint;
  supplyRate: bigint;
  horizonSeconds: number;
  expectedMeanReturn: bigint;
}

export const moonwellFixtures: MoonwellFixture[] = [
  {
    name: '8% APY, 50% util, 1 day',
    cash: 15_000_000_000_000n,
    borrows: 15_000_000_000_000n,
    supplyRate: 80000000000000000n,
    horizonSeconds: 86400,
    expectedMeanReturn: 10000002179546760n,
  },
];
