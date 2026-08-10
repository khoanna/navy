import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FarmingChainService } from './farming-chain.service';

describe('FarmingChainService', () => {
  let service: FarmingChainService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        FarmingChainService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string | number> = {
                FARMING_BASE_RPC_URL: 'https://mainnet.base.org',
                FARMING_BASE_CHAIN_ID: 8453,
                FARMING_BASE_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                FARMING_VAULT_ADDRESS: '0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(FarmingChainService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should have read-only provider', () => {
    expect(service.provider).toBeDefined();
  });

  it('should have correct chain ID', () => {
    expect(service.chainId).toBe(8453);
  });

  it('should have usdc address configured', () => {
    expect(service.usdcAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('should have vault address configured', () => {
    expect(service.vaultAddress).toBe('0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE');
  });

  it('should return vault contract', () => {
    expect(service.vault).toBeDefined();
  });

  it('should return usdc contract', () => {
    expect(service.usdc).toBeDefined();
  });

  describe('buildApprovalTransaction', () => {
    it('should build a valid approve transaction', () => {
      const tx = service.buildApprovalTransaction(
        '0x1234567890123456789012345678901234567890',
        BigInt(1_000_000_000),
      );
      expect(tx.to).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      expect(tx.value).toBe('0');
      expect(tx.chainId).toBe(8453);
      expect(tx.data).toBeDefined();
      expect(tx.data.length).toBeGreaterThan(0);
      expect(tx.description).toContain('Approve');
    });
  });

  describe('buildDepositTransaction', () => {
    it('should build a valid deposit transaction', () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const tx = service.buildDepositTransaction(wallet, BigInt(1_000_000));
      expect(tx.to).toBe('0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE');
      expect(tx.value).toBe('0');
      expect(tx.chainId).toBe(8453);
      expect(tx.description).toContain('Deposit');
    });
  });

  describe('buildRedeemTransaction', () => {
    it('should build a valid redeem transaction', () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const tx = service.buildRedeemTransaction(wallet, BigInt(500_000));
      expect(tx.to).toBe('0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE');
      expect(tx.value).toBe('0');
      expect(tx.chainId).toBe(8453);
      expect(tx.description).toContain('Redeem');
    });
  });

  describe('buildWithdrawTransaction', () => {
    it('should build a valid withdraw transaction', () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const tx = service.buildWithdrawTransaction(wallet, BigInt(500_000));
      expect(tx.to).toBe('0x28f8Da914C1fc5acfC5FC1bb8273829d0Fd3daDE');
      expect(tx.value).toBe('0');
      expect(tx.chainId).toBe(8453);
      expect(tx.description).toContain('Withdraw');
    });
  });

  describe('constructor validation', () => {
    it('should throw if FARMING_BASE_RPC_URL is missing', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            FarmingChainService,
            {
              provide: ConfigService,
              useValue: { get: jest.fn().mockReturnValue(undefined) },
            },
          ],
        }).compile(),
      ).rejects.toThrow('FARMING_BASE_RPC_URL');
    });

    it('should throw if FARMING_BASE_USDC_ADDRESS is missing', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            FarmingChainService,
            {
              provide: ConfigService,
              useValue: {
                get: jest.fn((key: string) => {
                  if (key === 'FARMING_BASE_RPC_URL') return 'https://mainnet.base.org';
                  return undefined;
                }),
              },
            },
          ],
        }).compile(),
      ).rejects.toThrow('FARMING_BASE_USDC_ADDRESS');
    });
  });
});
