import { Test } from '@nestjs/testing';
import { SrclaClient } from '../../../src/vault/srcla-client';
import { NavyConfigService } from '../../../src/config/config.service';

describe('SrclaClient', () => {
  let client: SrclaClient;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SrclaClient,
        {
          provide: NavyConfigService,
          useValue: {
            srclaApiUrl: 'http://localhost:3100',
          },
        },
      ],
    }).compile();

    client = module.get(SrclaClient);
  });

  it('unwraps the envelope srcla actually sends', async () => {
    // The previous version of this test mocked a FLAT body, which srcla has
    // never returned - routes.ts wraps this route in `{ data: ... }`. The test
    // encoded the wrong contract, which is why the mismatch survived.
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            totalAssets: '1000000',
            allocations: [
              { adapter: '0xaave', name: 'Aave V3', assets: '600000', percentage: 60 },
            ],
          },
        }),
    } as any);

    const result = await client.getCurrentAllocation();
    expect(result.totalAssets).toBe('1000000');
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.name).toBe('Aave V3');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/allocation'),
      expect.any(Object),
    );
    mockFetch.mockRestore();
  });

  it('still accepts a bare body, so an unwrapped route does not break it', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ totalAssets: '42', allocations: [] }),
    } as any);

    const result = await client.getCurrentAllocation();
    expect(result.totalAssets).toBe('42');
    mockFetch.mockRestore();
  });

  it('returns a usable shape rather than undefined fields when the body is empty', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as any);

    const result = await client.getCurrentAllocation();
    expect(result.totalAssets).toBe('0');
    expect(result.allocations).toEqual([]);
    mockFetch.mockRestore();
  });

  it('should get decision by hash', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ decisionHash: '0x123' }),
    } as any);

    const result = await client.getDecision('0x123');
    expect(result.decisionHash).toBe('0x123');
    mockFetch.mockRestore();
  });

  it('should get paginated decisions', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [], meta: { count: 0 } }),
    } as any);

    const result = await client.getDecisions({ limit: '10' });
    expect(result.data).toEqual([]);
    expect(result.meta.count).toBe(0);
    mockFetch.mockRestore();
  });

  it('should throw on service unavailable', async () => {
    // Simulate a real Node.js FetchError where ECONNREFUSED lives in cause.code
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3100'), { code: 'ECONNREFUSED' });
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(
      Object.assign(new Error('fetch failed'), { cause }),
    );

    await expect(client.getHealth()).rejects.toThrow(/unavailable/);
  });
});
