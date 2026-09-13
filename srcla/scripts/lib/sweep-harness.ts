/**
 * Helpers shared by the calibration-era sweeps (`sweep-hurdle-bound.ts`,
 * `sweep-calibration-gap.ts`).
 *
 * `harnessConfig` mirrors `scripts/run-phase4.ts#harnessConfig` exactly — keep
 * the two in step. The registered run keeps its own copy so that nothing a
 * sweep needs can change what the registered run executes.
 */
import type { HarnessConfig } from '../../src/evaluation/kernel/decision-input.js';
import type { PolicyArtifact } from '../../src/policy/types.js';

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function harnessConfig(gas: HarnessConfig['gas'], artifact: PolicyArtifact): HarnessConfig {
  return {
    vault: {
      adminReserveBase: 0n,
      minIdleBps: 500,
      configurationDigest: '0x' + '00'.repeat(32),
    },
    markets: {},
    defaultMarket: {
      capBps: 5_000,
      absoluteCapBase: 10n ** 15n,
      maxLossBps: 50,
      dependencyGroupIds: [],
    },
    // EMPTY, deliberately: the collector emits no dependency-group data, so
    // H5 has nothing to remove and is reported INERT rather than given a
    // number it did not earn.
    dependencyGroups: [],
    gas,
    horizonSeconds: artifact.horizonSeconds,
    availabilityLagSeconds: artifact.availabilityLagSeconds,
  };
}
