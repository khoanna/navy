import { TokenStore, SecureBackend } from './tokenStore';

function memoryBackend(): SecureBackend {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => { m.set(k, v); },
    deleteItemAsync: async (k) => { m.delete(k); },
  };
}

describe('TokenStore', () => {
  it('saves and loads Navy tokens', async () => {
    const store = new TokenStore(memoryBackend());
    await store.save({ accessToken: 'a', refreshToken: 'r' });
    expect(await store.load()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('returns null when nothing is stored', async () => {
    const store = new TokenStore(memoryBackend());
    expect(await store.load()).toBeNull();
  });

  it('clears stored tokens', async () => {
    const backend = memoryBackend();
    const store = new TokenStore(backend);
    await store.save({ accessToken: 'a', refreshToken: 'r' });
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('returns null if stored data is corrupt JSON', async () => {
    const backend = memoryBackend();
    await backend.setItemAsync('navy.tokens', '{not json');
    const store = new TokenStore(backend);
    expect(await store.load()).toBeNull();
  });
});
