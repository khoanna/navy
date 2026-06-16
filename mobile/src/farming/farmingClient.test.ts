import { FarmingClient, formatSol } from './farmingClient';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as typeof fetch;
}

describe('FarmingClient', () => {
  it('createSubwallet posts with the bearer token', async () => {
    const f = mockFetch(201, { subwalletId: 's1', address: 'PK' });
    const c = new FarmingClient('http://api', f);
    const out = await c.createSubwallet('jwt');
    expect(f).toHaveBeenCalledWith('http://api/farming/subwallet', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer jwt' }) }));
    expect(out.address).toBe('PK');
  });
  it('getPosition fetches with the bearer', async () => {
    const f = mockFetch(200, { address: 'PK', principalLamports: '100', currentValueLamports: '105', cTokenAmount: '100' });
    const c = new FarmingClient('http://api', f);
    expect((await c.getPosition('jwt')).currentValueLamports).toBe('105');
  });
  it('withdraw posts the amount', async () => {
    const f = mockFetch(200, { txSignature: 'sig' });
    const c = new FarmingClient('http://api', f);
    await c.withdraw('jwt', 'all');
    expect(f).toHaveBeenCalledWith('http://api/farming/withdraw', expect.objectContaining({ method: 'POST', body: JSON.stringify({ amount: 'all' }) }));
  });
});

describe('formatSol', () => {
  it('formats lamports to SOL', () => { expect(formatSol('1500000000')).toBe('1.5'); });
});
