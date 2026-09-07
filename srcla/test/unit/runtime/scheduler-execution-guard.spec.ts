/**
 * Task 13, Finding 1: the execution guard.
 *
 * Proves Scheduler.runController() (reached here via the public
 * trigger(force) entry point) refuses to log a produced plan as ready for
 * execution while placeholder price inputs are in use, and permits it once
 * they are not -- without ever touching a real database or chain (the
 * SnapshotCollector/PrismaClient/DecisionDriver dependencies are all plain
 * jest mocks).
 */
import { jest } from '@jest/globals';
import { Scheduler, SchedulerConfig } from '../../../src/runtime/scheduler.js';
import type { SnapshotCollector } from '../../../src/collector/snapshot-collector.js';
import type { PrismaClient } from '@prisma/client';
import type { ChainClient } from '../../../src/chain/client.js';
import type { DecisionDriver } from '../../../src/runtime/decision-driver.js';
import type { DecisionOutput } from '../../../src/policy/types.js';

const mockCollector = {
  collect: jest.fn(),
  client: {} as ChainClient,
} as unknown as SnapshotCollector;

const mockPrisma = {} as unknown as PrismaClient;

const baseConfig: Omit<SchedulerConfig, 'pricingGuard'> = {
  collectorEnabled: false,
  collectorIntervalMs: 900000,
  controllerEnabled: false,
  controllerIntervalMs: 3600000,
  calibrationIntervalMs: 604800000,
  calibrationWindowDays: 30,
  heldOutWindowDays: 7,
  forecastHorizonSeconds: 604800,
  artifactHash: 'test-artifact',
  chainId: 8453,
  executionEnabled: false,
};

/** A DecisionOutput that would rebalance -- only the fields runController reads are populated. */
function rebalanceOutput(): DecisionOutput {
  return {
    decisionHash: '0x' + 'aa'.repeat(32),
    action: 'rebalance',
    reasons: ['REBALANCE'],
    plan: {
      planId: '0x' + 'bb'.repeat(32),
      actions: [{ index: 0 }],
    },
    reserve: { requiredBase: 1_000_000n },
  } as unknown as DecisionOutput;
}

function mockRunCycle(): ReturnType<typeof jest.fn<() => Promise<DecisionOutput>>> {
  return jest.fn(async () => rebalanceOutput());
}

function schedulerWithMockDriver(
  runCycle: ReturnType<typeof mockRunCycle>,
  pricingGuard: SchedulerConfig['pricingGuard']
): Scheduler {
  const scheduler = new Scheduler(
    mockCollector,
    mockPrisma,
    { ...baseConfig, pricingGuard },
    '0x0000000000000000000000000000000000000001'
  );
  scheduler.setDecisionDriver({ runCycle } as unknown as DecisionDriver);
  return scheduler;
}

describe('Scheduler execution guard (Task 13, Finding 1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let logSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let warnSpy: any;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('blocks execution and warns, naming the placeholder fields, when placeholder prices are in use', async () => {
    const runCycle = mockRunCycle();
    const scheduler = schedulerWithMockDriver(runCycle, {
      placeholderPricesInUse: true,
      placeholderPriceFields: ['ethUsdE8', 'usdcUsdE8'],
    });

    const result = await scheduler.trigger(true);

    expect(result.triggered).toBe(true);
    expect(runCycle).toHaveBeenCalledTimes(1);

    // The "ready ... execution wiring pending" log must NOT fire -- that is
    // the log line that would sit right before a real execution call once
    // Task 14 wires one in.
    const allLogs = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allLogs.some((line: string) => line.includes('ready with'))).toBe(false);

    // A specific, named warning must fire instead.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning = String(warnSpy.mock.calls[0]![0]);
    expect(warning).toContain('Execution blocked');
    expect(warning).toContain('ethUsdE8');
    expect(warning).toContain('usdcUsdE8');
  });

  it('permits execution (logs the plan as ready) when no price input is a placeholder', async () => {
    const runCycle = mockRunCycle();
    const scheduler = schedulerWithMockDriver(runCycle, {
      placeholderPricesInUse: false,
      placeholderPriceFields: [],
    });

    const result = await scheduler.trigger(true);

    expect(result.triggered).toBe(true);
    expect(runCycle).toHaveBeenCalledTimes(1);

    // This test never calls scheduler.start() (it stubs collector/prisma and
    // drives runController() straight via trigger()), so no KeeperExecutor
    // is ever constructed -- baseConfig also sets executionEnabled: false.
    // Task 14 wired an actual executePlanDraft() call past the guard, which
    // now warns distinctly ("no keeper executor configured") rather than
    // silently no-op-logging "wiring pending Task 14" the way the pre-Task-14
    // stub did. That warning is orthogonal to the guard this test targets --
    // it must not be the guard's "Execution blocked" warning, and the guard
    // must still have let the plan reach the "ready with" log.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning = String(warnSpy.mock.calls[0]![0]);
    expect(warning).not.toContain('Execution blocked');
    expect(warning).toContain('no keeper executor configured');

    const allLogs = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allLogs.some((line: string) => line.includes('ready with'))).toBe(true);
  });

  it('never blocks deciding/persisting/logging itself -- runCycle always runs regardless of the guard', async () => {
    const blockedRun = mockRunCycle();
    const blocked = schedulerWithMockDriver(blockedRun, {
      placeholderPricesInUse: true,
      placeholderPriceFields: ['ethUsdE8'],
    });
    await blocked.trigger(true);
    expect(blockedRun).toHaveBeenCalledTimes(1);

    const allowedRun = mockRunCycle();
    const allowed = schedulerWithMockDriver(allowedRun, {
      placeholderPricesInUse: false,
      placeholderPriceFields: [],
    });
    await allowed.trigger(true);
    expect(allowedRun).toHaveBeenCalledTimes(1);
  });
});
