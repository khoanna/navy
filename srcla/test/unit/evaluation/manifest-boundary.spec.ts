/**
 * `validateManifest`'s calibration-boundary check (paper §7.3, §11.1).
 *
 * The check was written `heldOutStartDate !== calibrationEndDate` on two
 * `Date` objects, i.e. REFERENCE identity. `createEvaluationManifest`
 * assigns the same `boundaryDate` object to both fields, so it never fired
 * for a freshly built manifest; `thawEvaluationManifest` builds two distinct
 * `Date`s from the JSON, so it ALWAYS fired for a stored one. Either way it
 * said nothing about whether the two instants agree — which is the only
 * thing §7.3's no-look-ahead boundary depends on.
 */
import {
  createEvaluationManifest,
  freezeEvaluationManifest,
  thawEvaluationManifest,
  validateManifest,
} from '../../../src/evaluation/manifest/manifest.js';

const boundaryError = 'Held-out start date must equal calibration end date (boundary)';

function manifest(overrides: { calibrationEndDate?: Date; heldOutStartDate?: Date } = {}) {
  return createEvaluationManifest({
    id: 'eval-boundary-fixture',
    dataset: {
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-08-23T00:00:00.000Z'),
    },
    calibration: {
      calibrationEndDate: new Date('2026-08-01T00:00:00.000Z'),
      heldOutStartDate: new Date('2026-08-01T00:00:00.000Z'),
      ...overrides,
    },
  });
}

describe('validateManifest: calibration boundary', () => {
  it('accepts equal instants supplied as two distinct Date objects', () => {
    // Two separate `new Date(...)` with the same instant. Under `!==` this
    // was an error; the boundary is a fact about the instants, not about
    // object identity.
    const result = validateManifest(manifest());

    expect(result.errors).not.toContain(boundaryError);
  });

  it('accepts a manifest that has been frozen to JSON and thawed back', () => {
    // The stored form is the one a reproduction actually reads. `thaw`
    // constructs two distinct Dates, so under `!==` EVERY stored manifest
    // failed this check.
    const thawed = thawEvaluationManifest(freezeEvaluationManifest(manifest()));

    expect(validateManifest(thawed).errors).not.toContain(boundaryError);
  });

  it('rejects a held-out start one millisecond after the calibration end', () => {
    const result = validateManifest(
      manifest({ heldOutStartDate: new Date('2026-08-01T00:00:00.001Z') }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(boundaryError);
  });

  it('rejects a held-out start one millisecond BEFORE the calibration end', () => {
    // A gap in this direction is a look-ahead leak: held-out data would
    // overlap the calibration window.
    const result = validateManifest(
      manifest({ heldOutStartDate: new Date('2026-07-31T23:59:59.999Z') }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(boundaryError);
  });
});
