/**
 * The property D2 broke: the number the optimiser evaluates and the number the
 * replay measures must be the same number. `replay.ts` used to keep its own
 * `stressedLiquidCoverage`/`STRESS_DEMAND_BPS` copy of this arithmetic; this
 * spec guards against that duplicate coming back.
 */
import { readFileSync } from 'fs';
import { stressedCoverage } from '../../../src/policy/steps/coverage.js';

describe('coverage parity between optimiser and replay', () => {
  it('stressedCoverage is well-behaved across a grid of vault states', () => {
    // A property test of the shared function itself, not a "does X equal X"
    // tautology: worst is a valid ratio in [0, 1], liquidBase never exceeds
    // idle + holdings, and more idle/cash never DECREASES coverage.
    for (const idle of [0n, 1n, 500n, 100_000n]) {
      for (const a of [0n, 250n, 900n]) {
        for (const cashA of [0n, 300n, 5_000n]) {
          const holdings = new Map([['aave-v3-usdc', a]]);
          const cash = new Map([['aave-v3-usdc', cashA]]);
          const total = idle + a;

          const result = stressedCoverage({
            holdings,
            idleBase: idle,
            venueCashByMarket: cash,
            totalAssetsBase: total,
          });

          expect(result.worst).toBeGreaterThanOrEqual(0);
          expect(result.worst).toBeLessThanOrEqual(1);
          expect(result.liquidBase).toBeLessThanOrEqual(idle + a);

          // More external cash at the venue never makes coverage worse.
          const withMoreCash = stressedCoverage({
            holdings,
            idleBase: idle,
            venueCashByMarket: new Map([['aave-v3-usdc', cashA + 10_000n]]),
            totalAssetsBase: total,
          });
          expect(withMoreCash.liquidBase).toBeGreaterThanOrEqual(result.liquidBase);
          expect(withMoreCash.worst).toBeGreaterThanOrEqual(result.worst);
        }
      }
    }
  });

  it('replay.ts no longer defines its own coverage function and calls the shared one correctly', () => {
    // A grep-style guard: the duplicate must be gone, not merely unused, and
    // the re-pointed call site must pass the vault's own holdings/idle rather
    // than silently wiring in the wrong arguments.
    const src = readFileSync('src/evaluation/replay/replay.ts', 'utf8');
    expect(src).not.toMatch(/function stressedLiquidCoverage/);
    expect(src).not.toMatch(/const STRESS_DEMAND_BPS/);
    expect(src).toMatch(/from '\.\.\/\.\.\/policy\/steps\/coverage\.js'/);

    // The call site must feed stressedCoverage the vault's OWN holdings and
    // idle balance, not some other source — a re-point that silently passed
    // the wrong arguments would still satisfy the two checks above.
    const callSiteMatch = src.match(/stressedCoverage\(\{[\s\S]*?\}\)\.worst/);
    expect(callSiteMatch).not.toBeNull();
    const callSite = callSiteMatch![0];
    expect(callSite).toMatch(/holdings:\s*vault\.getState\(\)\.strategyBalances/);
    expect(callSite).toMatch(/idleBase:\s*vault\.getState\(\)\.idleBase/);
    expect(callSite).toMatch(/totalAssetsBase:\s*vault\.getState\(\)\.totalAssets/);
  });
});
