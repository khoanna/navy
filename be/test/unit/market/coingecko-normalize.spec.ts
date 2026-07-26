import { normalizePrice, normalizeTokenInfo, normalizeTopCoins } from '../../../src/market/coingecko-normalize';

describe('coingecko-normalize', () => {
  it('normalizePrice reads /simple/price shape', () => {
    const json = { ethereum: { usd: 3200.5, usd_market_cap: 3.8e11, usd_24h_change: 2.34 } };
    expect(normalizePrice('ethereum', json)).toEqual({ id: 'ethereum', priceUsd: 3200.5, change24h: 2.34, marketCapUsd: 3.8e11 });
  });
  it('normalizePrice returns null when the id is missing', () => {
    expect(normalizePrice('ethereum', {})).toBeNull();
  });
  it('normalizeTokenInfo reads /coins/{id} shape', () => {
    const json = {
      id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1,
      description: { en: 'Bitcoin is a decentralized...' },
      links: { homepage: ['https://bitcoin.org', ''] },
      market_data: {
        current_price: { usd: 67240 }, price_change_percentage_24h: 2.3,
        price_change_percentage_7d: 5.1, price_change_percentage_30d: -3.2,
        market_cap: { usd: 1.32e12 }, total_volume: { usd: 3.1e10 },
        ath: { usd: 73000 }, ath_change_percentage: { usd: -7.9 }, atl: { usd: 67 },
        circulating_supply: 19700000, total_supply: 21000000, max_supply: 21000000,
        sparkline_7d: { price: [66000, 66500, 67000, 67240] },
      },
    };
    const dto = normalizeTokenInfo(json);
    expect(dto.id).toBe('bitcoin');
    expect(dto.symbol).toBe('BTC');
    expect(dto.priceUsd).toBe(67240);
    expect(dto.rank).toBe(1);
    expect(dto.change7d).toBe(5.1);
    expect(dto.marketCapUsd).toBe(1.32e12);
    expect(dto.homepage).toBe('https://bitcoin.org');
    expect(dto.sparkline7d).toEqual([66000, 66500, 67000, 67240]);
    expect(dto.description.startsWith('Bitcoin is')).toBe(true);
  });
  it('normalizeTopCoins maps the /coins/markets array', () => {
    const arr = [{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 67240, market_cap: 1.3e12, market_cap_rank: 1, price_change_percentage_24h: 2.3 }];
    expect(normalizeTopCoins(arr)).toEqual([{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', priceUsd: 67240, marketCapUsd: 1.3e12, rank: 1, change24h: 2.3 }]);
  });
});
