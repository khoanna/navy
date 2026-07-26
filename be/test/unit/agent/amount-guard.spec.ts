import { userSpecifiedAmount } from '../../../src/agent/amount-guard';

describe('userSpecifiedAmount', () => {
  it('allows messages with a digit', () => {
    expect(userSpecifiedAmount('send 5 usdc to @bob')).toBe(true);
    expect(userSpecifiedAmount('deposit 0.5 into farming')).toBe(true);
    expect(userSpecifiedAmount('pay alice $20')).toBe(true);
  });

  it('allows explicit relative quantities', () => {
    expect(userSpecifiedAmount('withdraw all from farming')).toBe(true);
    expect(userSpecifiedAmount('take everything out')).toBe(true);
    expect(userSpecifiedAmount('deposit half my balance')).toBe(true);
    expect(userSpecifiedAmount('send max to bob')).toBe(true);
  });

  it('blocks messages with no quantity at all', () => {
    expect(userSpecifiedAmount('send bob some usdc')).toBe(false);
    expect(userSpecifiedAmount('pay alice')).toBe(false);
    expect(userSpecifiedAmount('deposit into farming')).toBe(false);
    expect(userSpecifiedAmount('put some money in farming')).toBe(false);
    expect(userSpecifiedAmount('withdraw from farming')).toBe(false);
  });

  it('is safe on empty/undefined input', () => {
    expect(userSpecifiedAmount('')).toBe(false);
    expect(userSpecifiedAmount(undefined)).toBe(false);
  });
});
