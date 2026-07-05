import { earnTip } from './tips';

describe('earnTip', () => {
  it('suggests earning when idle USDC is at/above threshold', () => {
    expect(earnTip(1000, 100)).toEqual({ show: true, amount: '1,000' });
  });
  it('stays hidden below the threshold', () => {
    expect(earnTip(50, 100)).toEqual({ show: false });
  });
  it('handles non-finite balances as hidden', () => {
    expect(earnTip(NaN, 100)).toEqual({ show: false });
  });
});
