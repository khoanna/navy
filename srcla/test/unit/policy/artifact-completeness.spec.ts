import { parseArtifact } from '../../../src/policy/artifact.js';

/** A minimal REGISTERED artifact body, every field present. */
function registeredRaw(): Record<string, unknown> {
  return {
    policyVersion: 6,
    horizonSeconds: 1209600,
    coverageTarget: 0.99,
    method: 'rolling',
    methodParams: { windowObservations: 24 },
    residualQuantileWadByMarket: { 'a': '-100000000000000' },
    portfolioResidualQuantileWad: '-100000000000000',
    cashResidualQuantileWadByMarket: { 'a': '-100000000000000' },
    cashLowerBoundQuantileWad: '-100000000000000000',
    minObservations: 30,
    availabilityLagSeconds: 3600,
    noTradeBandK: 1,
    paybackSeconds: 2592000,
    adjustmentRate: 1,
    edgeWindowEffective: 24,
    pinnedConfigDigests: { 'a': '0xdeadbeef' },
    configDigest: 'registered-test',
    residualPanel: { marketIds: ['a'], originsSeconds: [1, 2], rows: [['-1'], ['1']] },
  };
}

describe('registered artifact completeness (P23)', () => {
  it('parses a complete registered artifact and preserves the panel', () => {
    const a = parseArtifact(registeredRaw(), { requireProvisional: false });
    expect(a.residualPanel).toBeDefined();
    expect(a.residualPanel!.marketIds).toEqual(['a']);
    expect(a.residualPanel!.rows).toEqual([[-1n], [1n]]);
    expect(a.paybackSeconds).toBe(2592000);
    expect(a.adjustmentRate).toBe(1);
    expect(a.edgeWindowEffective).toBe(24);
  });

  it('REFUSES a registered artifact with no residual panel', () => {
    const raw = registeredRaw();
    delete raw['residualPanel'];
    expect(() => parseArtifact(raw, { requireProvisional: false }))
      .toThrow(/residualPanel/);
  });

  it('REFUSES a registered artifact with no payback period', () => {
    const raw = registeredRaw();
    delete raw['paybackSeconds'];
    expect(() => parseArtifact(raw, { requireProvisional: false }))
      .toThrow(/paybackSeconds/);
  });

  it('the artifact hash covers the panel', () => {
    const a = parseArtifact(registeredRaw(), { requireProvisional: false });
    const raw2 = registeredRaw();
    (raw2['residualPanel'] as { rows: string[][] }).rows = [['-2'], ['1']];
    const b = parseArtifact(raw2, { requireProvisional: false });
    expect(b.artifactHash).not.toEqual(a.artifactHash);
  });

  it('still allows a PROVISIONAL artifact to omit the panel', () => {
    const raw = registeredRaw();
    delete raw['residualPanel'];
    delete raw['paybackSeconds'];
    delete raw['adjustmentRate'];
    delete raw['edgeWindowEffective'];
    raw['_provisional'] = 'bootstrap; results not citable';
    const a = parseArtifact(raw, { requireProvisional: true });
    expect(a.residualPanel).toBeUndefined();
  });

  it('a panel round-trips through string serialization without loss', () => {
    const raw = registeredRaw();
    (raw['residualPanel'] as { rows: string[][] }).rows = [
      ['-106084734766695'], ['51437739289824'],
    ];
    const a = parseArtifact(raw, { requireProvisional: false });
    expect(a.residualPanel!.rows[0]![0]).toBe(-106084734766695n);
    expect(a.residualPanel!.rows[1]![0]).toBe(51437739289824n);
  });
});
