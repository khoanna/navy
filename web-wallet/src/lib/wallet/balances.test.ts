import { PublicKey } from '@solana/web3.js';
import { lamportsToSol, usdcBaseToDisplay, fetchBalances } from './balances';

const owner = PublicKey.default;
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

describe('balance formatters', () => {
  it('formats lamports to SOL', () => { expect(lamportsToSol(1_500_000_000)).toBe('1.5'); });
  it('formats USDC base units', () => { expect(usdcBaseToDisplay('990000')).toBe('0.99'); });
});

describe('fetchBalances', () => {
  it('returns SOL lamports and USDC base units', async () => {
    const connection = {
      getBalance: jest.fn().mockResolvedValue(2_000_000_000),
      getTokenAccountBalance: jest.fn().mockResolvedValue({ value: { amount: '1500000' } }),
    } as any;
    expect(await fetchBalances(connection, owner, mint)).toEqual({ solLamports: 2_000_000_000, usdcBase: '1500000' });
  });
  it('treats a missing USDC ATA as 0', async () => {
    const connection = {
      getBalance: jest.fn().mockResolvedValue(0),
      getTokenAccountBalance: jest.fn().mockRejectedValue(new Error('could not find account')),
    } as any;
    expect(await fetchBalances(connection, owner, mint)).toEqual({ solLamports: 0, usdcBase: '0' });
  });
});
