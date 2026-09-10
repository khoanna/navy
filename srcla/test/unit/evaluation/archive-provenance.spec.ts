/**
 * Ruling R30: a held-out era's rows must come from the archive backfill.
 *
 * `heldout-b` is registered OPEN_ENDED, so the live collector is writing into
 * its window continuously. Promoting those rows instead of re-running
 * `backfill.ts` would build the project's most valuable sealed era on rows
 * that carry NULL `irm*` -- every venue replayed on `DefaultConfigs`, measured
 * at 7.5689 pp MAE (Compound) and 7.2538 pp (Moonwell) against mean rates near
 * 4.9 pp -- with nothing in the output saying so.
 *
 * These assert the PREDICATE `loadEra` enforces, on hand-built rows, so the
 * rule holds without a database.
 */
import { archiveProvenanceViolations, type ProvenanceRow } from '../../../src/evaluation/dataset.js';

const AT = new Date('2026-08-25T00:00:00Z');

/** A row exactly as `collector/archive/backfill.ts#persistOrigin` writes it. */
const backfilled = (over: Partial<ProvenanceRow> = {}): ProvenanceRow => ({
  marketId: 'moonwell-usdc',
  timestamp: AT,
  blockNumber: 19_300_000n,
  eraTag: 'heldout-b',
  irmAddress: '0x0f36Dda2b47984434051AeCAa5F9587DEA7f95B7',
  irmBaseRateWad: '0',
  irmKinkRay: '900000000000000000000000000',
  irmSlopeLowWad: '61041780821613600',
  irmSlopeHighWad: '9006164383533832800',
  ...over,
});

/**
 * A row exactly as `runtime/scheduler.ts` upserts it: state columns only, the
 * ADAPTER ADDRESS as the market id, and no archive provenance at all.
 */
const liveCollected = (): ProvenanceRow => ({
  marketId: '0x1234567890AbcdEF1234567890aBcdef12345678',
  timestamp: AT,
  blockNumber: null,
  eraTag: null,
  irmAddress: null,
  irmBaseRateWad: null,
  irmKinkRay: null,
  irmSlopeLowWad: null,
  irmSlopeHighWad: null,
});

describe('archiveProvenanceViolations (R30)', () => {
  it('accepts rows the archive backfill wrote', () => {
    expect(archiveProvenanceViolations('heldout-b', [backfilled()])).toEqual([]);
  });

  it('rejects a live-collected row, naming every way it differs', () => {
    const [v] = archiveProvenanceViolations('heldout-b', [liveCollected()]);
    expect(v).toBeDefined();
    expect(v!.reasons.join(' ')).toMatch(/eraTag is NULL/);
    expect(v!.reasons.join(' ')).toMatch(/no archive block height/);
    expect(v!.reasons.join(' ')).toMatch(/not a registered venue id/);
    expect(v!.reasons.join(' ')).toMatch(/PLACEHOLDER model/);
  });

  it('rejects a live row that has been RELABELLED into the era -- the actual R30 vector', () => {
    // The dangerous case is not an obviously foreign row. It is someone
    // stamping eraTag and a venue id onto live rows so they "count", which
    // leaves exactly one tell: no rate model.
    const promoted = liveCollected();
    promoted.eraTag = 'heldout-b';
    promoted.marketId = 'moonwell-usdc';
    promoted.blockNumber = 51_105_787n;
    const [v] = archiveProvenanceViolations('heldout-b', [promoted]);
    expect(v).toBeDefined();
    expect(v!.reasons).toHaveLength(1);
    expect(v!.reasons[0]).toMatch(/PLACEHOLDER model/);
    expect(v!.reasons[0]).toMatch(/irmAddress, irmBaseRateWad, irmKinkRay/);
  });

  it('rejects a row carried in from a DIFFERENT era, not only an untagged one', () => {
    const [v] = archiveProvenanceViolations('heldout-b', [backfilled({ eraTag: 'calibration' })]);
    expect(v!.reasons.join(' ')).toMatch(/eraTag is 'calibration', not 'heldout-b'/);
  });

  it('flags a PARTIAL rate model -- one NULL coefficient is still a placeholder', () => {
    const [v] = archiveProvenanceViolations('heldout-b', [backfilled({ irmKinkRay: null })]);
    expect(v!.reasons).toHaveLength(1);
    expect(v!.reasons[0]).toMatch(/irmKinkRay NULL/);
  });

  it('reports every offending row rather than stopping at the first', () => {
    const rows = [backfilled(), liveCollected(), backfilled({ blockNumber: null }), backfilled()];
    expect(archiveProvenanceViolations('heldout-b', rows)).toHaveLength(2);
  });
});
