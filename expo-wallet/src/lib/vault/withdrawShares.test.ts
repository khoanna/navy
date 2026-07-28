import { sharesToRedeem } from './withdrawShares';

describe('sharesToRedeem', () => {
  const pos = { sharesBase: '1000000', assetsBase: '2000000' }; // 1e6 shares worth 2 USDC

  it('redeems all shares for a withdraw-all', () => {
    expect(sharesToRedeem('all', pos)).toBe('1000000');
  });

  it('redeems all shares when the amount meets or exceeds the position value', () => {
    expect(sharesToRedeem('2000000', pos)).toBe('1000000');
    expect(sharesToRedeem('5000000', pos)).toBe('1000000');
  });

  it('redeems a proportional slice for a partial amount (floored)', () => {
    // want 1 USDC of a 2-USDC position → half the shares
    expect(sharesToRedeem('1000000', pos)).toBe('500000');
  });

  it('floors via BigInt integer division', () => {
    // want 1 of 3 → 1_000_000 * 1_000_000 / 3_000_000 = 333333.33 → 333333
    expect(sharesToRedeem('1000000', { sharesBase: '1000000', assetsBase: '3000000' })).toBe('333333');
  });

  it('returns 0 with no position', () => {
    expect(sharesToRedeem('all', { sharesBase: '0', assetsBase: '0' })).toBe('0');
    expect(sharesToRedeem('1000000', { sharesBase: '0', assetsBase: '0' })).toBe('0');
  });

  it('returns 0 for a non-positive amount', () => {
    expect(sharesToRedeem('0', pos)).toBe('0');
  });

  it('is BigInt-safe for large positions beyond float precision', () => {
    const big = { sharesBase: '10000000000000000000', assetsBase: '20000000000000000000' };
    expect(sharesToRedeem('10000000000000000000', big)).toBe('5000000000000000000');
  });
});
