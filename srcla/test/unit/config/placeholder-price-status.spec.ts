/**
 * Task 13, Finding 1: computePlaceholderPriceStatus is the single source of
 * truth for "is this service's GasObservation pricing real" -- it must be
 * derived purely from which SRCLA_REAL_* env vars are actually set,
 * never a separately-maintained flag.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computePlaceholderPriceStatus } from '../../../src/config.js';

const ALL_SET: NodeJS.ProcessEnv = {
  SRCLA_REAL_L1_BASE_FEE_WEI: '1',
  SRCLA_REAL_L1_BLOB_BASE_FEE_WEI: '1',
  SRCLA_REAL_ETH_USD_E8: '1',
  SRCLA_REAL_USDC_USD_E8: '1',
};

describe('computePlaceholderPriceStatus', () => {
  it('reports placeholderPricesInUse=true when none of the env vars are set', () => {
    const status = computePlaceholderPriceStatus({});
    expect(status.placeholderPricesInUse).toBe(true);
    expect(status.placeholderPriceFields.sort()).toEqual(
      ['ethUsdE8', 'l1BaseFeeWei', 'l1BlobBaseFeeWei', 'usdcUsdE8'].sort()
    );
  });

  it('reports placeholderPricesInUse=false only when ALL four env vars are set', () => {
    const status = computePlaceholderPriceStatus(ALL_SET);
    expect(status.placeholderPricesInUse).toBe(false);
    expect(status.placeholderPriceFields).toEqual([]);
  });

  it('reports the specific still-placeholder fields when only some env vars are set', () => {
    const status = computePlaceholderPriceStatus({
      SRCLA_REAL_L1_BASE_FEE_WEI: '8000000000',
      SRCLA_REAL_L1_BLOB_BASE_FEE_WEI: '10000000',
      // ETH/USD and USDC/USD left unset.
    });
    expect(status.placeholderPricesInUse).toBe(true);
    expect(status.placeholderPriceFields.sort()).toEqual(['ethUsdE8', 'usdcUsdE8'].sort());
  });

  it('treats an empty-string env var as unset, not as a supplied real value', () => {
    const status = computePlaceholderPriceStatus({ ...ALL_SET, SRCLA_REAL_ETH_USD_E8: '' });
    expect(status.placeholderPricesInUse).toBe(true);
    expect(status.placeholderPriceFields).toEqual(['ethUsdE8']);
  });
});

/**
 * Whole-branch review, Critical 1: `srcla/.env.example` used to ship all
 * four `SRCLA_PLACEHOLDER_*` vars SET, so the standard `cp .env.example
 * .env` setup path silently disengaged the Task-13 execution guard
 * (placeholderPricesInUse read back false) while the prices were still the
 * fabricated defaults. This test parses the real `.env.example` file
 * shipped in the repo -- exactly the way `cp .env.example .env` would --
 * and asserts the guard reports placeholders in use. It fails if a future
 * edit uncomments/sets any of the four `SRCLA_REAL_*` price vars in
 * `.env.example` (as the pre-fix file did under the old
 * `SRCLA_PLACEHOLDER_*` names), since that is exactly the regression this
 * guards against.
 */
describe('.env.example ships with the execution guard engaged', () => {
  function parseDotEnvExample(): NodeJS.ProcessEnv {
    // ESM + jest --experimental-vm-modules has no __dirname; resolve from
    // the package root instead (tests always run with cwd = srcla/).
    const filePath = path.resolve(process.cwd(), '.env.example');
    const contents = fs.readFileSync(filePath, 'utf8');
    const env: NodeJS.ProcessEnv = {};
    for (const rawLine of contents.split('\n')) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      env[key] = value;
    }
    return env;
  }

  it('reports placeholderPricesInUse=true for a config built from .env.example as shipped', () => {
    const exampleEnv = parseDotEnvExample();
    const status = computePlaceholderPriceStatus(exampleEnv);
    expect(status.placeholderPricesInUse).toBe(true);
    expect(status.placeholderPriceFields.sort()).toEqual(
      ['ethUsdE8', 'l1BaseFeeWei', 'l1BlobBaseFeeWei', 'usdcUsdE8'].sort()
    );
  });

  it('does not set any of the four SRCLA_REAL_* price vars in .env.example', () => {
    const exampleEnv = parseDotEnvExample();
    expect(exampleEnv.SRCLA_REAL_L1_BASE_FEE_WEI).toBeUndefined();
    expect(exampleEnv.SRCLA_REAL_L1_BLOB_BASE_FEE_WEI).toBeUndefined();
    expect(exampleEnv.SRCLA_REAL_ETH_USD_E8).toBeUndefined();
    expect(exampleEnv.SRCLA_REAL_USDC_USD_E8).toBeUndefined();
  });
});
