import { NavyPayClient } from './navyPayClient';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as unknown as typeof fetch;
}

describe('NavyPayClient', () => {
  it('getOrder fetches the order', async () => {
    const f = mockFetch(200, { orderId: 'o1', status: 'awaiting_payment', amount: '1000000', reference: 'R' });
    const c = new NavyPayClient('http://api', f);
    expect(await c.getOrder('o1')).toEqual(expect.objectContaining({ orderId: 'o1' }));
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/o1', expect.anything());
  });
  it('getPaymentAuthorization sends the Navy bearer token and encodes the id', async () => {
    const f = mockFetch(200, { typedData: { domain: {}, types: {}, primaryType: 'ReceiveWithAuthorization', message: {} }, invoice: {} });
    const c = new NavyPayClient('http://api', f);
    const out = await c.getPaymentAuthorization('o1', 'navy-jwt');
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/o1/payment-authorization', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer navy-jwt' }),
    }));
    expect(out.typedData.primaryType).toBe('ReceiveWithAuthorization');
  });
  it('submitSignature posts the signature with the bearer token', async () => {
    const f = mockFetch(200, { txHash: '0xabc', status: 'confirming' });
    const c = new NavyPayClient('http://api', f);
    const out = await c.submitSignature('o1', '0xsig', 'navy-jwt');
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/o1/submit', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ signature: '0xsig' }),
      headers: expect.objectContaining({ 'Content-Type': 'application/json', Authorization: 'Bearer navy-jwt' }),
    }));
    expect(out.txHash).toBe('0xabc');
  });
  it('getUserPayments sends the Navy bearer token', async () => {
    const f = mockFetch(200, [{ orderId: 'o1' }]);
    const c = new NavyPayClient('http://api', f);
    await c.getUserPayments('navy-jwt');
    expect(f).toHaveBeenCalledWith('http://api/user/payments', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer navy-jwt' }),
    }));
  });
  it('throws on a non-2xx', async () => {
    const c = new NavyPayClient('http://api', mockFetch(404, {}));
    await expect(c.getOrder('missing')).rejects.toThrow();
  });
  it('includes the server error message in the thrown error', async () => {
    const c = new NavyPayClient('http://api', mockFetch(400, { message: 'order expired' }));
    await expect(c.getPaymentAuthorization('o1', 'navy-jwt')).rejects.toThrow(/order expired/);
  });
  it('encodes the id in the path', async () => {
    const f = mockFetch(200, { orderId: 'a/b', status: 's', amount: '1', reference: 'R' });
    const c = new NavyPayClient('http://api', f);
    await c.getOrder('a/b');
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/a%2Fb', expect.anything());
  });
});
