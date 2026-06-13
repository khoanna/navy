import { SessionManager } from './session';
import { NavyClient } from '../api/navyClient';
import { TokenStore, SecureBackend } from './tokenStore';

function memoryBackend(): SecureBackend {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k) => m.get(k) ?? null,
    setItemAsync: async (k, v) => { m.set(k, v); },
    deleteItemAsync: async (k) => { m.delete(k); },
  };
}

describe('SessionManager', () => {
  it('establishes a session: exchanges the privy token and persists Navy tokens', async () => {
    const client = { exchangePrivyToken: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) } as unknown as NavyClient;
    const store = new TokenStore(memoryBackend());
    const mgr = new SessionManager(client, store);

    const session = await mgr.establish('privy-jwt');

    expect(client.exchangePrivyToken).toHaveBeenCalledWith('privy-jwt');
    expect(session.tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(await store.load()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('restores a session from storage when tokens exist', async () => {
    const store = new TokenStore(memoryBackend());
    await store.save({ accessToken: 'a', refreshToken: 'r' });
    const mgr = new SessionManager({} as NavyClient, store);
    expect(await mgr.restore()).toEqual({ tokens: { accessToken: 'a', refreshToken: 'r' } });
  });

  it('restore returns null when nothing is stored', async () => {
    const mgr = new SessionManager({} as NavyClient, new TokenStore(memoryBackend()));
    expect(await mgr.restore()).toBeNull();
  });

  it('clear wipes the stored session', async () => {
    const store = new TokenStore(memoryBackend());
    await store.save({ accessToken: 'a', refreshToken: 'r' });
    const mgr = new SessionManager({} as NavyClient, store);
    await mgr.clear();
    expect(await mgr.restore()).toBeNull();
  });
});
