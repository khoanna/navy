/**
 * Unit tests for VaultService proxy methods
 * Tests that VaultService correctly proxies SRCLA data endpoints
 */
import { Test } from '@nestjs/testing';
import { VaultService } from '../../../src/vault/vault.service';
import { SrclaClient } from '../../../src/vault/srcla-client';
import { NavyConfigService } from '../../../src/config/config.service';

describe('VaultService proxy', () => {
  let vaultService: VaultService;
  let srclaClient: jest.Mocked<SrclaClient>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VaultService,
        {
          provide: NavyConfigService,
          useValue: {
            evmRpcUrl: 'https://mainnet.base.org',
            evmChainId: 8453,
            usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            vaultAddress: '0x55E728b08FdB9432520FB3fd1b9D7777320f8ED3',
          },
        },
        {
          provide: SrclaClient,
          useValue: {
            getDecisions: jest.fn(),
            getHarvests: jest.fn(),
            getCurrentAllocation: jest.fn(),
          },
        },
      ],
    }).compile();

    vaultService = module.get(VaultService);
    srclaClient = module.get(SrclaClient);
  });

  describe('getDecisions', () => {
    it('should proxy getDecisions from srclaClient', async () => {
      const mockResponse = {
        data: [{ decisionHash: '0x123', timestamp: '2026-09-01T00:00:00Z' }],
        meta: { count: 1 },
      };
      // Partial fixture: the proxy is pass-through, so only the fields asserted below matter.
      srclaClient.getDecisions.mockResolvedValue(mockResponse as never);

      const result = await vaultService.getDecisions();

      expect(srclaClient.getDecisions).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].decisionHash).toBe('0x123');
    });

    it('should pass cursor and limit params to srclaClient', async () => {
      srclaClient.getDecisions.mockResolvedValue({ data: [], meta: { count: 0 } });

      await vaultService.getDecisions({ cursor: 'cursor-123', limit: '10' });

      expect(srclaClient.getDecisions).toHaveBeenCalledWith({
        cursor: 'cursor-123',
        limit: '10',
      });
    });
  });

  describe('getHarvests', () => {
    it('should proxy getHarvests from srclaClient and transform response', async () => {
      const mockResponse = {
        data: [
          {
            id: 'harvest-1',
            adapter: '0x5b53a25ff5ec56a852cb4c0d193754308c6e99a0', // lowercase to match ADAPTER_NAMES
            timestamp: '2026-09-01T00:00:00Z',
            rewardToken: '0x123',
            amountIn: '1000',
            amountOutBase: '1050',
          },
        ],
        meta: { count: 1 },
      };
      srclaClient.getHarvests.mockResolvedValue(mockResponse);

      const result = await vaultService.getHarvests();

      expect(srclaClient.getHarvests).toHaveBeenCalled();
      expect(result.harvests).toHaveLength(1);
      expect(result.harvests[0].id).toBe('harvest-1');
      expect(result.harvests[0].protocol).toBe('Compound III');
    });

    it('should use raw adapter address when not in ADAPTER_NAMES', async () => {
      const mockResponse = {
        data: [
          {
            id: 'harvest-2',
            adapter: '0x0000000000000000000000000000000000001234',
            timestamp: '2026-09-01T00:00:00Z',
            rewardToken: '0x123',
            amountIn: '1000',
            amountOutBase: '1050',
          },
        ],
        meta: { count: 1 },
      };
      srclaClient.getHarvests.mockResolvedValue(mockResponse);

      const result = await vaultService.getHarvests();

      expect(result.harvests[0].protocol).toBe('0x0000000000000000000000000000000000001234');
    });

    it('should pass adapter filter to srclaClient', async () => {
      srclaClient.getHarvests.mockResolvedValue({ data: [], meta: { count: 0 } });

      await vaultService.getHarvests({ adapter: '0x5b53a25ff5ec56a852cb4c0d193754308c6e99a0' });

      expect(srclaClient.getHarvests).toHaveBeenCalledWith({
        adapter: '0x5b53a25ff5ec56a852cb4c0d193754308c6e99a0',
      });
    });
  });

  describe('getStrategy', () => {
    it('should proxy getCurrentAllocation from srclaClient', async () => {
      const mockAllocation = {
        totalAssets: '1000000',
        allocations: [
          { adapter: '0x5b53a25fF5Ec56a852CB4c0D193754308C6e99A0', name: 'Compound III', assets: '900000', percentage: 90 },
        ],
      };
      srclaClient.getCurrentAllocation.mockResolvedValue(mockAllocation);

      const result = await vaultService.getStrategy();

      expect(srclaClient.getCurrentAllocation).toHaveBeenCalled();
      expect(result.totalAssets).toBe('1000000');
    });
  });
});
