import { Test } from '@nestjs/testing';
import { FarmingChainService } from './farming-chain.service';
import { NavyConfigService } from '../config/config.service';

const FIXTURE = {
  farmingBaseRpcUrl: 'https://mainnet.base.org',
  farmingBaseChainId: 8453,
  farmingBaseUsdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  farmingVaultAddress: '0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE',
};

function mockConfig(overrides?: Partial<typeof FIXTURE>) {
  const cfg = { ...FIXTURE, ...overrides };
  return {
    farmingBaseRpcUrl: cfg.farmingBaseRpcUrl,
    farmingBaseChainId: cfg.farmingBaseChainId,
    farmingBaseUsdcAddress: cfg.farmingBaseUsdcAddress,
    farmingVaultAddress: cfg.farmingVaultAddress,
  };
}

describe('FarmingChainService', () => {
  it('should be defined', async () => {
    const module = await Test.createTestingModule({
      providers: [
        FarmingChainService,
        { provide: NavyConfigService, useValue: mockConfig() },
      ],
    }).compile();
    const service = module.get(FarmingChainService);
    expect(service).toBeDefined();
  });

  it('should have read-only provider', async () => {
    const module = await Test.createTestingModule({
      providers: [
        FarmingChainService,
        { provide: NavyConfigService, useValue: mockConfig() },
      ],
    }).compile();
    const service = module.get(FarmingChainService);
    expect(service.provider).toBeDefined();
  });

  it('should have correct chain ID', async () => {
    const module = await Test.createTestingModule({
      providers: [
        FarmingChainService,
        { provide: NavyConfigService, useValue: mockConfig() },
      ],
    }).compile();
    const service = module.get(FarmingChainService);
    expect(service.chainId).toBe(8453);
  });

  it('should have usdc address configured', async () => {
    const module = await Test.createTestingModule({
      providers: [
        FarmingChainService,
        { provide: NavyConfigService, useValue: mockConfig() },
      ],
    }).compile();
    const service = module.get(FarmingChainService);
    expect(service.usdcAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('should have vault address configured', async () => {
    const module = await Test.createTestingModule({
      providers: [
        FarmingChainService,
        { provide: NavyConfigService, useValue: mockConfig() },
      ],
    }).compile();
    const service = module.get(FarmingChainService);
    expect(service.vaultAddress).toBe('0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE');
  });

  it('should return vault contract', async () => {
    const module = await Test.createTestingModule({
      providers: [
        FarmingChainService,
        { provide: NavyConfigService, useValue: mockConfig() },
      ],
    }).compile();
    const service = module.get(FarmingChainService);
    expect(service.vault).toBeDefined();
  });

  it('should return usdc contract', async () => {
    const module = await Test.createTestingModule({
      providers: [
        FarmingChainService,
        { provide: NavyConfigService, useValue: mockConfig() },
      ],
    }).compile();
    const service = module.get(FarmingChainService);
    expect(service.usdc).toBeDefined();
  });

  describe('buildApprovalTransaction', () => {
    it('should build a valid approve transaction', async () => {
      const module = await Test.createTestingModule({
        providers: [
          FarmingChainService,
          { provide: NavyConfigService, useValue: mockConfig() },
        ],
      }).compile();
      const service = module.get(FarmingChainService);
      const tx = service.buildApprovalTransaction(
        '0x1234567890123456789012345678901234567890',
        BigInt(1_000_000_000),
      );
      expect(tx.to).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      expect(tx.value).toBe('0');
      expect(tx.chainId).toBe(8453);
      expect(tx.data).toBeDefined();
      expect(tx.description).toContain('Approve');
    });
  });

  describe('buildDepositTransaction', () => {
    it('should build a valid deposit transaction', async () => {
      const module = await Test.createTestingModule({
        providers: [
          FarmingChainService,
          { provide: NavyConfigService, useValue: mockConfig() },
        ],
      }).compile();
      const service = module.get(FarmingChainService);
      const wallet = '0x1234567890123456789012345678901234567890';
      const tx = service.buildDepositTransaction(wallet, BigInt(1_000_000));
      expect(tx.to).toBe('0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE');
      expect(tx.value).toBe('0');
      expect(tx.chainId).toBe(8453);
      expect(tx.description).toContain('Deposit');
    });
  });

  describe('buildRedeemTransaction', () => {
    it('should build a valid redeem transaction', async () => {
      const module = await Test.createTestingModule({
        providers: [
          FarmingChainService,
          { provide: NavyConfigService, useValue: mockConfig() },
        ],
      }).compile();
      const service = module.get(FarmingChainService);
      const wallet = '0x1234567890123456789012345678901234567890';
      const tx = service.buildRedeemTransaction(wallet, BigInt(500_000));
      expect(tx.to).toBe('0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE');
      expect(tx.value).toBe('0');
      expect(tx.chainId).toBe(8453);
      expect(tx.description).toContain('Redeem');
    });
  });

  describe('buildWithdrawTransaction', () => {
    it('should build a valid withdraw transaction', async () => {
      const module = await Test.createTestingModule({
        providers: [
          FarmingChainService,
          { provide: NavyConfigService, useValue: mockConfig() },
        ],
      }).compile();
      const service = module.get(FarmingChainService);
      const wallet = '0x1234567890123456789012345678901234567890';
      const tx = service.buildWithdrawTransaction(wallet, BigInt(500_000));
      expect(tx.to).toBe('0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE');
      expect(tx.value).toBe('0');
      expect(tx.chainId).toBe(8453);
      expect(tx.description).toContain('Withdraw');
    });
  });

  describe('constructor validation', () => {
    it('should throw if FARMING_BASE_RPC_URL is missing', () => {
      // Instantiate directly to bypass NestJS DI — config must not be empty
      expect(() => new FarmingChainService(mockConfig({ farmingBaseRpcUrl: '' }) as any)).toThrow('FARMING_BASE_RPC_URL');
    });

    it('should throw if FARMING_BASE_USDC_ADDRESS is missing', () => {
      expect(() => new FarmingChainService(mockConfig({ farmingBaseUsdcAddress: '' }) as any)).toThrow('FARMING_BASE_USDC_ADDRESS');
    });
  });
});
