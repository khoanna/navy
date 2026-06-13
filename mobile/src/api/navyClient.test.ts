import { NavyClient, NavyAuthError } from './navyClient';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('NavyClient.exchangePrivyToken', () => {
  it('POSTs the privy token and returns Navy tokens', async () => {
    const fetchImpl = mockFetch(201, { accessToken: 'a', refreshToken: 'r' });
    const client = new NavyClient('http://api', fetchImpl);
    const tokens = await client.exchangePrivyToken('privy-jwt');
    expect(fetchImpl).toHaveBeenCalledWith('http://api/auth/privy', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: 'privy-jwt' }),
    }));
    expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('throws NavyAuthError on a 401 from the backend', async () => {
    const client = new NavyClient('http://api', mockFetch(401, { message: 'Invalid Privy token' }));
    await expect(client.exchangePrivyToken('bad')).rejects.toBeInstanceOf(NavyAuthError);
  });

  it('throws NavyAuthError if the response is missing tokens', async () => {
    const client = new NavyClient('http://api', mockFetch(201, { accessToken: 'a' }));
    await expect(client.exchangePrivyToken('x')).rejects.toThrow(/token/i);
  });
});
