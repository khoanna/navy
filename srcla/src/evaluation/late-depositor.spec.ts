import { LateDepositorCalculator, DepositRecord } from './late-depositor';
import { CohortTracker } from './cohort-tracker';

const WAD = 1_000_000_000_000_000_000n;

function createMockCohortTracker(): CohortTracker {
  const cohort = {
    id: 1,
    windowStart: new Date('2024-01-01'),
    windowEnd: new Date('2024-01-08'),
    startSharePrice: WAD,
    endSharePrice: undefined,
    totalDeposits: 0n,
    totalWithdrawals: 0n,
    closed: false,
  };
  return {
    getCurrentCohort: async () => cohort,
    getCohortPerformance: async () => ({
      cohortId: 1,
      grossReturn: 0.05,
      totalDeposits: 0n,
      totalWithdrawals: 0n,
      avgDepositTimestamp: new Date('2024-01-01'),
      depositorCount: 0,
    }),
    calculateCohortReturn: () => 0.05,
    calculateWeightedReturn: (r: number) => r * 0.5, // 50% weight
    getUserCohortPosition: async (userAddress: string, cohortId: number) => {
      if (cohortId === 1) {
        return {
          userAddress,
          cohortId,
          shares: 1000n * WAD,
          depositAmount: 1000n * 1_000_000n,
          depositTimestamp: new Date('2024-01-04'),
          weightedReturn: 0.025,
          unrealizedProfit: 50n * WAD,
        };
      }
      return null;
    },
  } as any as CohortTracker;
}

describe('LateDepositorCalculator', () => {
  let tracker: CohortTracker;
  let calculator: LateDepositorCalculator;

  beforeEach(() => {
    tracker = createMockCohortTracker();
    calculator = new LateDepositorCalculator(tracker);
  });

  it('calculates late return for a single deposit correctly', async () => {
    const deposit: DepositRecord = {
      userAddress: '0x1234567890123456789012345678901234567890',
      amount: 1_000_000_000n,
      shares: 1000n * WAD,
      sharePrice: WAD,
      timestamp: new Date('2024-01-04'),
    };
    const currentPrice = (WAD * 105n) / 100n; // 1.05

    const result = await calculator.calculateLateReturn(deposit, currentPrice);

    expect(result.depositValue).toBe((deposit.shares * deposit.sharePrice) / WAD);
    expect(result.currentValue).toBe((deposit.shares * currentPrice) / WAD);
    expect(result.unrealizedProfit).toBe(result.currentValue - result.depositValue);
    expect(result.weightedReturn).toBeGreaterThan(0);
    expect(result.weightedReturn).toBeLessThan(0.05);
    expect(result.weightedReturn).toBe(0.025);
  });

  it('calculates batch deposits', async () => {
    const deposits: DepositRecord[] = [
      {
        userAddress: '0x1',
        amount: 1_000_000_000n,
        shares: 1000n * WAD,
        sharePrice: WAD,
        timestamp: new Date('2024-01-04'),
      },
      {
        userAddress: '0x2',
        amount: 500_000_000n,
        shares: 500n * WAD,
        sharePrice: WAD,
        timestamp: new Date('2024-01-05'),
      }
    ];
    const currentPrice = (WAD * 105n) / 100n;

    const results = await calculator.calculateBatch(deposits, currentPrice);
    
    expect(results.length).toBe(2);
    expect(results[0]!.depositValue).toBe(1000n * WAD);
    expect(results[1]!.depositValue).toBe(500n * WAD);
  });

  it('calculates total profit across multiple cohorts', async () => {
    const totalProfit = await calculator.calculateTotalProfit('0x123', [1, 2], WAD);
    expect(totalProfit).toBe(50n * WAD);
  });
});
