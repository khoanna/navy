import { weiToEth, usdcBaseToDisplay, fetchBalances } from './balances';

const owner = '0x0000000000000000000000000000000000000000';

describe('balance formatters', () => {
  it('formats wei to ETH', () => { expect(weiToEth('1500000000000000000')).toBe('1.5'); });
  it('renders a whole-ETH amount without a fraction', () => { expect(weiToEth('2000000000000000000')).toBe('2'); });
  it('formats USDC base units', () => { expect(usdcBaseToDisplay('990000')).toBe('0.99'); });
});

describe('fetchBalances', () => {
  it('returns ETH wei and USDC base units', async () => {
    const provider = { getBalance: jest.fn().mockResolvedValue(2_000_000_000_000_000_000n) } as any;
    const usdc = { balanceOf: jest.fn().mockResolvedValue(1_500_000n) } as any;
    expect(await fetchBalances(provider, owner, usdc)).toEqual({ ethWei: '2000000000000000000', usdcBase: '1500000' });
  });
  it('treats a failing USDC read as 0', async () => {
    const provider = { getBalance: jest.fn().mockResolvedValue(0n) } as any;
    const usdc = { balanceOf: jest.fn().mockRejectedValue(new Error('no code at address')) } as any;
    expect(await fetchBalances(provider, owner, usdc)).toEqual({ ethWei: '0', usdcBase: '0' });
  });
});
