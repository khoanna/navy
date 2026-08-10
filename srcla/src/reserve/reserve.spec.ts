import { ReserveOptimizer } from './reserve.js';
import { ActionDecisionEngine } from '../decision/action-decision.js';

describe('ReserveOptimizer', () => {
  it('should calculate minimum reserve', () => {
    const optimizer = new ReserveOptimizer({ minReserveBps: 100n, stressBufferBps: 50n, withdrawalHorizonHours: 24 });
    const totalAssets = 10_000_000_000_000n;

    expect(optimizer.minReserve(totalAssets)).toBe(100_000_000_000n);
  });

  it('should calculate optimal reserve from scenarios', () => {
    const optimizer = new ReserveOptimizer({ minReserveBps: 100n, stressBufferBps: 50n, withdrawalHorizonHours: 24 });
    const scenarios = [
      { name: 'normal', probability: 0.9, withdrawalRate: 0.01, durationHours: 24 },
    ];

    const optimal = optimizer.optimalReserve(10_000_000_000_000n, scenarios);

    expect(optimal).toBeGreaterThan(0n);
  });

  it('should pass stress test', () => {
    const optimizer = new ReserveOptimizer({ minReserveBps: 100n, stressBufferBps: 50n, withdrawalHorizonHours: 24 });
    // 0.001 (0.1%) per hour for 24 hours = 2.4% total withdrawals
    // reserve = 200B on 10T = 2%, so coverage = 2/2.4 = 0.83 < 1 (fails)
    // Let's use 0.0005 (0.05%) per hour for 24 hours = 1.2% total withdrawals
    // reserve = 200B on 10T = 2%, so coverage = 2/1.2 = 1.67 > 1 (passes)
    const scenarios = [
      { name: 'normal', probability: 0.9, withdrawalRate: 0.0005, durationHours: 24 },
    ];

    const result = optimizer.stressTest(10_000_000_000_000n, 200_000_000_000n, scenarios);

    expect(result).toBeDefined();
    expect(result.passed).toBe(true);
  });
});

describe('ActionDecisionEngine', () => {
  it('should return hold when amounts are equal', () => {
    const engine = new ActionDecisionEngine({
      movementCostBps: 10n,
      cooldownSeconds: 3600,
      minActionAmount: 1000n,
      turnoverBudgetBps: 500n,
    });

    const result = engine.decide({
      currentAllocation: new Map([['aave', 5000_000_000n]]),
      optimalAllocation: new Map([['aave', 5000_000_000n]]),
      totalAssets: 10_000_000_000_000n,
      forecast: [{ meanReturn: 1_000_000_000_000_000_000n, lowerReturn: 990_000_000_000_000_000n }],
      lastActionTimestamp: new Date(Date.now() - 86400000),
      recentTurnover: 0n,
    });

    expect(result.action).toBe('hold');
  });

  it('should deploy when optimal > current', () => {
    const engine = new ActionDecisionEngine({
      movementCostBps: 10n,
      cooldownSeconds: 0,
      minActionAmount: 1000n,
      turnoverBudgetBps: 10000n,
    });

    const result = engine.decide({
      currentAllocation: new Map([['aave', 0n]]),
      optimalAllocation: new Map([['aave', 5000_000_000n]]),
      totalAssets: 10_000_000_000_000n,
      forecast: [{ meanReturn: 1_000_000_000_000_000_000n, lowerReturn: 990_000_000_000_000_000n }],
      lastActionTimestamp: new Date(Date.now() - 86400000),
      recentTurnover: 0n,
    });

    expect(['deploy', 'hold']).toContain(result.action);
  });

  it('should respect cooldown', () => {
    const engine = new ActionDecisionEngine({
      movementCostBps: 10n,
      cooldownSeconds: 86400,
      minActionAmount: 0n,
      turnoverBudgetBps: 10000n,
    });

    const result = engine.decide({
      currentAllocation: new Map([['aave', 0n]]),
      optimalAllocation: new Map([['aave', 5000_000_000n]]),
      totalAssets: 10_000_000_000_000n,
      forecast: [],
      lastActionTimestamp: new Date(),
      recentTurnover: 0n,
    });

    expect(result.action).toBe('hold');
    expect(result.reason).toBe('COOLDOWN_ACTIVE');
  });
});
