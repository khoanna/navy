import { NavyApi, NavyApiError } from './navyApi';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status, json: async () => body,
  }) as unknown as typeof fetch;
}

describe('NavyApi', () => {
  it('adminLogin posts credentials and returns tokens', async () => {
    const f = mockFetch(201, { accessToken: 'a', refreshToken: 'r' });
    const api = new NavyApi('http://api', f);
    const out = await api.adminLogin({ email: 'a@x.com', password: 'pw', totp: '123456' });
    expect(f).toHaveBeenCalledWith('http://api/auth/admin', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@x.com', password: 'pw', totp: '123456' }),
    }));
    expect(out).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });
  it('merchantLogin posts credentials and returns tokens', async () => {
    const f = mockFetch(201, { accessToken: 'a', refreshToken: 'r' });
    const api = new NavyApi('http://api', f);
    const out = await api.merchantLogin({ email: 'm@x.com', password: 'pw' });
    expect(f).toHaveBeenCalledWith('http://api/auth/merchant', expect.objectContaining({ method: 'POST' }));
    expect(out).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });
  it('merchantSignup posts and returns tokens', async () => {
    const f = mockFetch(201, { accessToken: 'a', refreshToken: 'r' });
    const api = new NavyApi('http://api', f);
    await api.merchantSignup({ email: 'm@x.com', password: 'pw', businessName: 'Acme' });
    expect(f).toHaveBeenCalledWith('http://api/auth/merchant/signup', expect.objectContaining({ method: 'POST' }));
  });
  it('createApiKey sends the bearer token', async () => {
    const f = mockFetch(201, { apiKey: 'navy_pk_x', apiSecret: 'navy_sk_y' });
    const api = new NavyApi('http://api', f);
    const out = await api.createApiKey('navy-jwt');
    expect(f).toHaveBeenCalledWith('http://api/merchant/api-keys', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer navy-jwt' }),
    }));
    expect(out).toEqual({ apiKey: 'navy_pk_x', apiSecret: 'navy_sk_y' });
  });
  it('setPayout forwards address/message/signature with bearer', async () => {
    const f = mockFetch(201, { payoutAddress: 'PK' });
    const api = new NavyApi('http://api', f);
    const out = await api.setPayout('navy-jwt', { address: 'PK', message: 'm', signature: 's' });
    expect(f).toHaveBeenCalledWith('http://api/merchant/payout', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer navy-jwt' }),
      body: JSON.stringify({ address: 'PK', message: 'm', signature: 's' }),
    }));
    expect(out).toEqual({ payoutAddress: 'PK' });
  });
  it('throws NavyApiError with status on a non-2xx response', async () => {
    const api = new NavyApi('http://api', mockFetch(401, { message: 'bad' }));
    await expect(api.adminLogin({ email: 'a', password: 'b', totp: 'c' })).rejects.toMatchObject({ status: 401 });
  });
});
