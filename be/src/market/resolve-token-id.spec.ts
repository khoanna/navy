import { resolveKnownTokenId, KNOWN_TOKEN_IDS } from './resolve-token-id';

describe('resolveKnownTokenId', () => {
  it('maps common symbols/names case-insensitively', () => {
    expect(resolveKnownTokenId('ETH')).toBe('ethereum');
    expect(resolveKnownTokenId(' eth ')).toBe('ethereum');
    expect(resolveKnownTokenId('btc')).toBe('bitcoin');
    expect(resolveKnownTokenId('USDC')).toBe('usd-coin');
    expect(resolveKnownTokenId('ethereum')).toBe('ethereum');
  });
  it('returns null for unknown queries (caller falls back to /search)', () => {
    expect(resolveKnownTokenId('somerandomcoin')).toBeNull();
  });
  it('KNOWN_TOKEN_IDS includes the wallet assets', () => {
    expect(KNOWN_TOKEN_IDS.eth).toBe('ethereum');
    expect(KNOWN_TOKEN_IDS.usdc).toBe('usd-coin');
  });
});
