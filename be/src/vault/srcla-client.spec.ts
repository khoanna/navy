import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SrclaClient } from './srcla-client';

describe('SrclaClient', () => {
  let client: SrclaClient;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SrclaClient,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, fallback?: string) => {
              if (key === 'SRCLA_API_URL') return 'http://localhost:3100';
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    client = module.get(SrclaClient);
  });

  it('should get current allocation', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ totalAssets: '1000000' }),
    } as any);

    const result = await client.getCurrentAllocation();
    expect(result.totalAssets).toBe('1000000');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/allocation'),
      expect.any(Object),
    );
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
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(
      Object.assign(new Error('ECONNREFUSED'), { message: 'ECONNREFUSED' }),
    );

    await expect(client.getHealth()).rejects.toThrow(/unavailable/);
  });
});
