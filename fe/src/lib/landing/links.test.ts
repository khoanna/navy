import { resolveLinks, DEFAULT_WALLET_ORIGIN } from './links';

describe('resolveLinks', () => {
  it('falls back to the local wallet origin when env is missing', () => {
    const l = resolveLinks({});
    expect(l.wallet).toBe(DEFAULT_WALLET_ORIGIN);
    expect(l.merchant).toBe('/merchant/login');
    expect(l.adminLogin).toBe('/admin/login');
  });
  it('uses the provided wallet origin', () => {
    const l = resolveLinks({ walletOrigin: 'https://wallet.navy' });
    expect(l.wallet).toBe('https://wallet.navy');
  });
  it('trims a trailing slash from the wallet origin', () => {
    const l = resolveLinks({ walletOrigin: 'https://wallet.navy/' });
    expect(l.wallet).toBe('https://wallet.navy');
  });
  it('ignores an empty-string env value', () => {
    const l = resolveLinks({ walletOrigin: '' });
    expect(l.wallet).toBe(DEFAULT_WALLET_ORIGIN);
  });
});
