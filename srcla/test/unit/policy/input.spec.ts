import { filterUsableLabels } from '../../../src/policy/input.js';
import type { CompletedLabel, PolicyArtifact } from '../../../src/policy/types.js';

const ORIGIN = 1_000_000;

const artifact = {
  availabilityLagSeconds: 600,
  minObservations: 1,
} as unknown as PolicyArtifact;

function label(over: Partial<CompletedLabel>): CompletedLabel {
  return {
    marketId: 'aave',
    regimeId: 'r1',
    originSeconds: ORIGIN - 100_000,
    horizonSeconds: 86_400,
    horizonEndSeconds: ORIGIN - 10_000,
    availableAtSeconds: ORIGIN - 5_000,
    realizedReturnWad: 1n,
    realizedMinCashBase: 1n,
    ...over,
  };
}

describe('filterUsableLabels — no-look-ahead barrier', () => {
  const regimes = { aave: 'r1' };

  it('keeps a label whose horizon ended and lag elapsed', () => {
    const kept = filterUsableLabels([label({})], ORIGIN, artifact, regimes);
    expect(kept).toHaveLength(1);
  });

  it('drops a label whose horizon has not ended', () => {
    const future = label({ horizonEndSeconds: ORIGIN + 1 });
    expect(filterUsableLabels([future], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('drops a label whose horizon ended exactly at origin but is not yet available', () => {
    const notYet = label({ horizonEndSeconds: ORIGIN, availableAtSeconds: ORIGIN + 1 });
    expect(filterUsableLabels([notYet], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('drops a label whose availability lag has not elapsed', () => {
    const lagged = label({ horizonEndSeconds: ORIGIN - 100, availableAtSeconds: ORIGIN - 100 });
    expect(filterUsableLabels([lagged], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('drops a label from a superseded configuration regime', () => {
    const stale = label({ regimeId: 'r0' });
    expect(filterUsableLabels([stale], ORIGIN, artifact, regimes)).toHaveLength(0);
  });

  it('never admits a label from the future under randomised input', () => {
    const labels = Array.from({ length: 200 }, (_, i) =>
      label({ horizonEndSeconds: ORIGIN - 100 + i, availableAtSeconds: ORIGIN - 100 + i })
    );
    for (const kept of filterUsableLabels(labels, ORIGIN, artifact, regimes)) {
      expect(kept.horizonEndSeconds).toBeLessThanOrEqual(ORIGIN);
      expect(kept.availableAtSeconds + artifact.availabilityLagSeconds).toBeLessThanOrEqual(ORIGIN);
    }
  });
});
