import { UsernameClient } from './usernameClient';

function fakeFetch(handler: (url: string, init?: RequestInit) => any) {
  return async (url: string, init?: RequestInit) => {
    const body = handler(url, init);
    return { ok: true, status: 200, json: async () => body } as Response;
  };
}

describe('UsernameClient', () => {
  it('checkAvailable hits the availability endpoint', async () => {
    const c = new UsernameClient('http://x', fakeFetch(() => ({ available: true })) as any);
    expect(await c.checkAvailable('linh')).toEqual({ available: true });
  });
  it('setUsername PUTs the handle', async () => {
    let seen: any;
    const c = new UsernameClient('http://x', fakeFetch((_u, init) => { seen = init; return { username: 'linh' }; }) as any);
    expect(await c.setUsername('linh')).toEqual({ username: 'linh' });
    expect(seen.method).toBe('PUT');
  });
});
