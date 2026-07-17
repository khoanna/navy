import { FarmingClient, formatUsdc } from './farmingClient';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as typeof fetch;
}

describe('FarmingClient', () => {
  it('createSubwallet posts with the bearer token', async () => {
    const f = mockFetch(201, { subwalletId: 's1', address: '0xPK' });
    const c = new FarmingClient('http://api', f);
    const out = await c.createSubwallet('jwt');
    expect(f).toHaveBeenCalledWith('http://api/farming/subwallet', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer jwt' }) }));
    expect(out.address).toBe('0xPK');
  });
  it('getPosition fetches with the bearer', async () => {
    const f = mockFetch(200, { address: '0xPK', principalBase: '100', currentValueBase: '105', cTokenAmount: '100' });
    const c = new FarmingClient('http://api', f);
    expect((await c.getPosition('jwt')).currentValueBase).toBe('105');
  });
  it('deposit posts the USDC base-unit amount', async () => {
    const f = mockFetch(200, { txSignature: '0xsig' });
    const c = new FarmingClient('http://api', f);
    await c.deposit('jwt', '1500000');
    expect(f).toHaveBeenCalledWith('http://api/farming/deposit', expect.objectContaining({ method: 'POST', body: JSON.stringify({ amountBase: '1500000' }) }));
  });
  it('withdraw posts the amount', async () => {
    const f = mockFetch(200, { txSignature: '0xsig' });
    const c = new FarmingClient('http://api', f);
    await c.withdraw('jwt', 'all');
    expect(f).toHaveBeenCalledWith('http://api/farming/withdraw', expect.objectContaining({ method: 'POST', body: JSON.stringify({ amount: 'all' }) }));
  });
});

describe('formatUsdc', () => {
  it('formats USDC base units (6 dec) to a decimal string', () => { expect(formatUsdc('1500000')).toBe('1.5'); });
  it('handles whole-dollar amounts without a decimal point', () => { expect(formatUsdc('2000000')).toBe('2'); });
  it('handles zero', () => { expect(formatUsdc('0')).toBe('0'); });
  it('trims trailing fractional zeros', () => { expect(formatUsdc('1100000')).toBe('1.1'); });
  it('preserves all 6 fractional digits when needed', () => { expect(formatUsdc('1000001')).toBe('1.000001'); });
  it('is BigInt-safe for large amounts that would lose float precision', () => {
    // 10_000_000_000_000_000 base units = 10_000_000_000 USDC — well beyond float safe integer
    expect(formatUsdc('10000000000000000')).toBe('10000000000');
  });
  it('accepts a number input', () => { expect(formatUsdc(500000)).toBe('0.5'); });
});
