import { MarketClient } from './marketClient';

function fakeFetch(handler: (url: string) => any) {
  return async (url: string) => ({ ok: true, status: 200, json: async () => handler(url) }) as Response;
}

describe('MarketClient', () => {
  it('getPrices GETs /market/prices and returns the price map', async () => {
    let seen = '';
    const c = new MarketClient('http://x', fakeFetch((u) => { seen = u; return { ethereum: { id: 'ethereum', priceUsd: 3200, change24h: 1.2, marketCapUsd: 1 } }; }) as any);
    const p = await c.getPrices(['ethereum']);
    expect(p.ethereum.priceUsd).toBe(3200);
    expect(seen).toContain('/market/prices?ids=ethereum');
  });
});
