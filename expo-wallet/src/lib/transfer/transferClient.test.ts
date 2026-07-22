import { TransferClient } from './transferClient';

function fakeFetch(handler: (url: string, init?: RequestInit) => any) {
  return async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => handler(url, init) }) as Response;
}

describe('TransferClient resolve/recordEth', () => {
  it('resolve GETs /transfer/resolve with the recipient', async () => {
    let seenUrl = '';
    const c = new TransferClient('http://x', fakeFetch((u) => { seenUrl = u; return { address: '0xabc', username: 'linh' }; }) as any);
    expect(await c.resolve('@linh')).toEqual({ address: '0xabc', username: 'linh' });
    expect(seenUrl).toContain('/transfer/resolve?recipient=%40linh');
  });
  it('recordEth POSTs the txHash', async () => {
    let seen: any;
    const c = new TransferClient('http://x', fakeFetch((_u, init) => { seen = init; return { id: 'e1', status: 'confirming' }; }) as any);
    expect(await c.recordEth('0xTo', '1000', '0xhash')).toEqual({ id: 'e1', status: 'confirming' });
    expect(seen.method).toBe('POST');
    expect(JSON.parse(seen.body)).toEqual({ to: '0xTo', amountWei: '1000', txHash: '0xhash' });
  });
});
