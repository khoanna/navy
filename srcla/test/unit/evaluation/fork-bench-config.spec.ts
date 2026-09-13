/**
 * §11.1's fork bench must carry the REGISTERED harness values, or the replay
 * asks the chain about a different experiment.
 *
 * Measured (contract/audit/b4-fork-refusal-root-cause.md): `harnessConfig`
 * registers `adminReserveBase: 0n`, while `DeployAndFund.s.sol`'s tier vaults
 * carried VaultGuardrails' $1,000 `adminReserve`. At the 10,000 USDC tier B4
 * was sized against a $500 floor and the vault enforced $1,000, so its third
 * deploy reverted `InsufficientIdle()` and the run recorded a bench mismatch
 * as the chain refusing B4's allocation.
 *
 * `forkBenchMismatches` is the pure half of the guard `runForkReplays` applies
 * before it submits anything to a tier vault.
 */
import {
  forkBenchMismatches,
  registeredForkBench,
  type ForkBenchVaultConfig,
} from '../../../src/evaluation/fork-runner.js';
import type { HarnessConfig } from '../../../src/evaluation/kernel/decision-input.js';

const MARKET = { capBps: 5_000, absoluteCapBase: 10n ** 15n, maxLossBps: 50 };

function bench(overrides: Partial<ForkBenchVaultConfig> = {}): ForkBenchVaultConfig {
  return {
    adminReserveBase: 0n,
    minIdleBps: 500,
    adapters: {
      'aave-v3-usdc': { ...MARKET },
      'compound-v3-usdc': { ...MARKET },
      'moonwell-usdc': { ...MARKET },
    },
    ...overrides,
  };
}

describe('forkBenchMismatches', () => {
  it('is empty when the bench carries the registered values', () => {
    expect(forkBenchMismatches(bench(), bench())).toEqual([]);
  });

  it("names adminReserve and both values — the b4@10k refusal's cause", () => {
    const out = forkBenchMismatches(bench({ adminReserveBase: 1_000_000_000n }), bench());
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('adminReserve');
    expect(out[0]).toContain('1000000000');
    expect(out[0]).toContain('0');
  });

  it('names minIdleBps and both values', () => {
    const out = forkBenchMismatches(bench({ minIdleBps: 50 }), bench());
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('minIdleBps');
    expect(out[0]).toContain('50');
    expect(out[0]).toContain('500');
  });

  it.each([
    ['capBps', { capBps: 4_000 }, '4000', '5000'],
    ['maxLossBps', { maxLossBps: 100 }, '100', '50'],
    [
      'absoluteCap',
      { absoluteCapBase: 2n ** 256n - 1n },
      (2n ** 256n - 1n).toString(),
      (10n ** 15n).toString(),
    ],
  ] as const)(
    "names the marketId and field when one adapter's %s differs",
    (field, change, onChainValue, registeredValue) => {
      const onChain = bench();
      const adapters = { ...onChain.adapters, 'moonwell-usdc': { ...MARKET, ...change } };
      const out = forkBenchMismatches({ ...onChain, adapters }, bench());
      expect(out).toHaveLength(1);
      expect(out[0]).toContain('moonwell-usdc');
      expect(out[0]).toContain(field);
      expect(out[0]).toContain(onChainValue);
      expect(out[0]).toContain(registeredValue);
    },
  );

  it('names an adapter the bench carries but the harness does not register', () => {
    const onChain = bench();
    const adapters = { ...onChain.adapters, 'euler-usdc': { ...MARKET } };
    const out = forkBenchMismatches({ ...onChain, adapters }, bench());
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('euler-usdc');
  });

  it('names an adapter the harness registers but the bench does not carry', () => {
    const { 'aave-v3-usdc': _dropped, ...rest } = bench().adapters;
    const out = forkBenchMismatches(bench({ adapters: rest }), bench());
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('aave-v3-usdc');
  });

  it('reports every mismatching field, one entry each', () => {
    const onChain = bench({ adminReserveBase: 1_000_000_000n, minIdleBps: 50 });
    const adapters = { ...onChain.adapters, 'aave-v3-usdc': { ...MARKET, capBps: 4_000 } };
    expect(forkBenchMismatches({ ...onChain, adapters }, bench())).toHaveLength(3);
  });
});

describe('registeredForkBench', () => {
  const config = {
    vault: { adminReserveBase: 0n, minIdleBps: 500, configurationDigest: '0x' + '00'.repeat(32) },
    markets: {
      'moonwell-usdc': { capBps: 2_500, absoluteCapBase: 7n, maxLossBps: 10, dependencyGroupIds: [] },
    },
    defaultMarket: { capBps: 5_000, absoluteCapBase: 10n ** 15n, maxLossBps: 50, dependencyGroupIds: [] },
  } as unknown as HarnessConfig;

  it("takes the vault values and each market's own entry, else defaultMarket", () => {
    expect(registeredForkBench(config, ['aave-v3-usdc', 'moonwell-usdc'])).toEqual({
      adminReserveBase: 0n,
      minIdleBps: 500,
      adapters: {
        'aave-v3-usdc': { capBps: 5_000, absoluteCapBase: 10n ** 15n, maxLossBps: 50 },
        'moonwell-usdc': { capBps: 2_500, absoluteCapBase: 7n, maxLossBps: 10 },
      },
    });
  });
});
