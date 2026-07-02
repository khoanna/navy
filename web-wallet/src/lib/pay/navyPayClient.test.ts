import { NavyPayClient } from './navyPayClient';

function mockFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as typeof fetch;
}

describe('NavyPayClient', () => {
  it('getOrder fetches the order', async () => {
    const f = mockFetch(200, { orderId: 'o1', status: 'awaiting_payment', amount: '1000000', reference: 'R' });
    const c = new NavyPayClient('http://api', f);
    expect(await c.getOrder('o1')).toEqual(expect.objectContaining({ orderId: 'o1' }));
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/o1', expect.anything());
  });
  it('getPaymentTx requests the relayer-signed tx for a payer', async () => {
    const f = mockFetch(200, { tx: 'BASE64', invoice: {} });
    const c = new NavyPayClient('http://api', f);
    const out = await c.getPaymentTx('o1', 'PK');
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/o1/payment-tx?payer=PK', expect.anything());
    expect(out.tx).toBe('BASE64');
  });
  it('submitSignedTx posts the signed tx', async () => {
    const f = mockFetch(200, { txSignature: 'sig', status: 'confirming' });
    const c = new NavyPayClient('http://api', f);
    const out = await c.submitSignedTx('o1', 'SIGNED');
    expect(f).toHaveBeenCalledWith('http://api/v1/orders/o1/submit', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ signedTx: 'SIGNED' }),
    }));
    expect(out.txSignature).toBe('sig');
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
});
