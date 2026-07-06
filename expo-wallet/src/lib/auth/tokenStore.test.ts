import { TokenStore, SecureBackend } from './tokenStore';

function memBackend(): SecureBackend {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => { m.set(k, v); },
    deleteItemAsync: async (k) => { m.delete(k); },
  };
}

describe('TokenStore', () => {
  it('saves and loads tokens', async () => {
    const s = new TokenStore(memBackend());
    await s.save({ accessToken: 'a', refreshToken: 'r' });
    expect(await s.load()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });
  it('returns null when empty', async () => {
    expect(await new TokenStore(memBackend()).load()).toBeNull();
  });
  it('returns null on malformed json', async () => {
    const b = memBackend();
    await b.setItemAsync('navy.tokens', '{not json');
    expect(await new TokenStore(b).load()).toBeNull();
  });
  it('clears tokens', async () => {
    const s = new TokenStore(memBackend());
    await s.save({ accessToken: 'a', refreshToken: 'r' });
    await s.clear();
    expect(await s.load()).toBeNull();
  });
});
