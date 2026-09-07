/**
 * Task 13, Finding 1: computePlaceholderPriceStatus is the single source of
 * truth for "is this service's GasObservation pricing real" -- it must be
 * derived purely from which SRCLA_PLACEHOLDER_* env vars are actually set,
 * never a separately-maintained flag.
 */
import { computePlaceholderPriceStatus } from '../../../src/config.js';

const ALL_SET: NodeJS.ProcessEnv = {
  SRCLA_PLACEHOLDER_L1_BASE_FEE_WEI: '1',
  SRCLA_PLACEHOLDER_L1_BLOB_BASE_FEE_WEI: '1',
  SRCLA_PLACEHOLDER_ETH_USD_E8: '1',
  SRCLA_PLACEHOLDER_USDC_USD_E8: '1',
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
      SRCLA_PLACEHOLDER_L1_BASE_FEE_WEI: '8000000000',
      SRCLA_PLACEHOLDER_L1_BLOB_BASE_FEE_WEI: '10000000',
      // ETH/USD and USDC/USD left unset.
    });
    expect(status.placeholderPricesInUse).toBe(true);
    expect(status.placeholderPriceFields.sort()).toEqual(['ethUsdE8', 'usdcUsdE8'].sort());
  });

  it('treats an empty-string env var as unset, not as a supplied real value', () => {
    const status = computePlaceholderPriceStatus({ ...ALL_SET, SRCLA_PLACEHOLDER_ETH_USD_E8: '' });
    expect(status.placeholderPricesInUse).toBe(true);
    expect(status.placeholderPriceFields).toEqual(['ethUsdE8']);
  });
});
