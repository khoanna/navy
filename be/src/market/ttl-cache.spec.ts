import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('caches within ttl and reloads after expiry (injected clock)', async () => {
    let t = 1000, calls = 0;
    const cache = new TtlCache({ now: () => t });
    const loader = async () => { calls++; return calls; };
    expect(await cache.getOrLoad('k', 100, loader)).toBe(1);
    t = 1050; expect(await cache.getOrLoad('k', 100, loader)).toBe(1);
    t = 1200; expect(await cache.getOrLoad('k', 100, loader)).toBe(2);
  });
  it('coalesces concurrent loads into a single loader call', async () => {
    let calls = 0;
    const cache = new TtlCache();
    const loader = () => new Promise<number>((res) => { calls++; setTimeout(() => res(42), 5); });
    const out = await Promise.all([cache.getOrLoad('k', 1000, loader), cache.getOrLoad('k', 1000, loader), cache.getOrLoad('k', 1000, loader)]);
    expect(out).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });
  it('serves the stale value when the loader throws after a prior success', async () => {
    let t = 1000, mode = 'ok';
    const cache = new TtlCache({ now: () => t });
    const loader = async () => { if (mode === 'fail') throw new Error('boom'); return 'v1'; };
    expect(await cache.getOrLoad('k', 100, loader)).toBe('v1');
    t = 1200; mode = 'fail';
    expect(await cache.getOrLoad('k', 100, loader)).toBe('v1');
  });
  it('throws when the loader fails and there is no prior value', async () => {
    const cache = new TtlCache();
    await expect(cache.getOrLoad('k', 100, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
