/**
 * VaultDepositService — unit tests.
 * Tests the EIP-3009 deposit and EIP-2612 redeem flows without any live chain calls.
 */
import { BadRequestException } from '@nestjs/common';
import { ethers } from 'ethers';
import { VaultDepositService } from './vault-deposit.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { type Eip3009TypedData, type Eip2612TypedData } from './vault-deposit.service';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VAULT = '0x' + '55'.repeat(20);
const USDC = '0x' + '33'.repeat(20);
const RELAYER = ethers.Wallet.createRandom().address;
const USER = ethers.Wallet.createRandom().address;
const USER_ID = '11111111-2222-3333-4444-555555555555';

const USDC_DOMAIN = { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC };
const VAULT_DOMAIN = { name: 'Navy Vault USDC', version: '1', chainId: 8453, verifyingContract: VAULT };

function makeEvm(overrides?: Partial<NavyEvm>): NavyEvm {
  return {
    provider: { getBalance: jest.fn().mockResolvedValue(10n ** 18n) } as any,
    usdc: { balanceOf: jest.fn(), receiveWithAuthorization: jest.fn() } as any,
    vault: {
      target: VAULT,
      balanceOf: jest.fn(),
      maxRedeem: jest.fn(),
      deposit: jest.fn(),
      redeem: jest.fn(),
      nonces: jest.fn(),
    } as any,
    relayer: { address: RELAYER } as any,
    usdcDomain: USDC_DOMAIN,
    vaultShareDomain: VAULT_DOMAIN,
    ...overrides,
  } as unknown as NavyEvm;
}

function makePrisma(overrides?: {
  deposit?: Parameters<VaultDepositService['buildDepositAuthorization']>[0] extends string ? never : any;
  redeem?: any;
}) {
  return {
    vaultDeposit: {
      create: jest.fn().mockResolvedValue({ id: 'uuid' }),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    vaultRedeem: {
      create: jest.fn().mockResolvedValue({ id: 'uuid' }),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function signEip3009(wallet: any, td: Eip3009TypedData) {
  return wallet.signTypedData(td.domain as any, td.types as any, td.message as any);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function signEip2612(wallet: any, td: Eip2612TypedData) {
  return wallet.signTypedData(td.domain as any, td.types as any, td.message as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultDepositService', () => {

  // -------------------------------------------------------------------------
  // buildDepositAuthorization
  // -------------------------------------------------------------------------

  describe('buildDepositAuthorization', () => {
    it('returns typed data with correct EIP-3009 structure and stores a DB record', async () => {
      const evm = makeEvm({ usdc: { ...makeEvm({}).usdc, balanceOf: jest.fn().mockResolvedValue(10_000_000n) } as any });
      const prisma = makePrisma();
      const svc = new VaultDepositService(evm, prisma);

      const out = await svc.buildDepositAuthorization(USER_ID, USER, '1000000');

      expect(out.id).toBeDefined();
      expect(out.amountBase).toBe('1000000');
      expect(out.typedData.primaryType).toBe('ReceiveWithAuthorization');
      expect(out.typedData.domain).toEqual(USDC_DOMAIN);
      expect(out.typedData.message.from).toBe(USER);
      expect(out.typedData.message.to).toBe(VAULT);
      expect(out.typedData.message.value).toBe('1000000');
      expect(out.typedData.message.validAfter).toBeDefined();
      expect(out.typedData.message.validBefore).toBeDefined();
      expect(out.typedData.message.nonce).toMatch(/^0x[0-9a-f]{64}$/);
      expect(prisma.vaultDeposit.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          userAddress: USER.toLowerCase(),
          assetsBase: 1_000_000n,
          status: 'awaiting_signature',
        }),
      }));
    });

    it('throws 400 when amountBase is 0', async () => {
      const svc = new VaultDepositService(makeEvm(), makePrisma());
      await expect(svc.buildDepositAuthorization(USER_ID, USER, '0')).rejects.toThrow(BadRequestException);
      await expect(svc.buildDepositAuthorization(USER_ID, USER, '0')).rejects.toThrow('greater than 0');
    });

    it('throws 400 when amountBase is not a valid integer string', async () => {
      const svc = new VaultDepositService(makeEvm(), makePrisma());
      await expect(svc.buildDepositAuthorization(USER_ID, USER, 'abc')).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when user has insufficient USDC balance', async () => {
      const evm = makeEvm({ usdc: { ...makeEvm({}).usdc, balanceOf: jest.fn().mockResolvedValue(500_000n) } as any });
      const svc = new VaultDepositService(evm, makePrisma());
      await expect(svc.buildDepositAuthorization(USER_ID, USER, '1000000')).rejects.toThrow('Insufficient');
    });

    it('nonce is deterministic: keccak256(vault || user || amount || id)', async () => {
      const evm = makeEvm({ usdc: { ...makeEvm({}).usdc, balanceOf: jest.fn().mockResolvedValue(10_000_000n) } as any });
      const prisma = makePrisma();
      const svc = new VaultDepositService(evm, prisma);

      const out = await svc.buildDepositAuthorization(USER_ID, USER, '1000000');
      const idHex = Buffer.from(out.id.replace(/-/g, ''), 'hex');
      const expectedNonce = ethers.solidityPackedKeccak256(
        ['address', 'address', 'uint256', 'bytes16'],
        [VAULT, USER, 1_000_000n, idHex],
      );
      expect(out.typedData.message.nonce).toBe(expectedNonce);
    });

    it('validBefore is exactly 1 hour after validAfter (3600 seconds)', async () => {
      const evm = makeEvm({ usdc: { ...makeEvm({}).usdc, balanceOf: jest.fn().mockResolvedValue(10_000_000n) } as any });
      const prisma = makePrisma();
      const svc = new VaultDepositService(evm, prisma);

      const before = Math.floor(Date.now() / 1000);
      const out = await svc.buildDepositAuthorization(USER_ID, USER, '1000000');
      const after = Math.floor(Date.now() / 1000);

      const validAfter = parseInt(out.typedData.message.validAfter);
      const validBefore = parseInt(out.typedData.message.validBefore);
      expect(validBefore - validAfter).toBe(3600);
      expect(validAfter).toBeGreaterThanOrEqual(before);
      expect(validAfter).toBeLessThanOrEqual(after);
    });

    it('expired authorization is rejected by submitDeposit', async () => {
      const expiredRecord = {
        id: 'uuid',
        userId: USER_ID,
        userAddress: USER.toLowerCase(),
        assetsBase: 1_000_000n,
        nonce: ethers.keccak256(ethers.toUtf8Bytes('test')),
        digest: '0x' + '00'.repeat(32),
        validBefore: new Date(Date.now() - 1000),
        status: 'awaiting_signature',
        consumedAt: null as Date | null,
        txHash: null as string | null,
        createdAt: new Date(),
      };
      const evm = makeEvm();
      const prisma = makePrisma();
      prisma.vaultDeposit.findUnique = jest.fn().mockResolvedValue(expiredRecord);
      const svc = new VaultDepositService(evm, prisma);

      const wallet = ethers.Wallet.createRandom();
      const typedData: Eip3009TypedData = {
        domain: USDC_DOMAIN,
        types: { ReceiveWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ]},
        primaryType: 'ReceiveWithAuthorization',
        message: {
          from: USER,
          to: VAULT,
          value: '1000000',
          validAfter: '0',
          validBefore: Math.floor(expiredRecord.validBefore.getTime() / 1000).toString(),
          nonce: expiredRecord.nonce,
        },
      };
      const sig = await signEip3009(wallet, typedData);

      await expect(svc.submitDeposit(USER_ID, USER, 'uuid', sig)).rejects.toThrow('expired');
    });
  });

  // -------------------------------------------------------------------------
  // submitDeposit
  // -------------------------------------------------------------------------

  describe('submitDeposit', () => {
    it('throws 400 when no record exists for the given id', async () => {
      const evm = makeEvm();
      const prisma = makePrisma();
      prisma.vaultDeposit.findUnique = jest.fn().mockResolvedValue(null);
      const svc = new VaultDepositService(evm, prisma);

      await expect(svc.submitDeposit(USER_ID, USER, 'nonexistent-uuid', '0x' + '00'.repeat(65)))
        .rejects.toThrow('No deposit authorization found');
    });

    it('throws 400 when record wallet does not match authenticated wallet', async () => {
      const record = {
        id: 'uuid', userId: 'different-user', userAddress: ethers.Wallet.createRandom().address.toLowerCase(),
        assetsBase: 1_000_000n, nonce: '0x' + '00'.repeat(32),
        digest: '0x' + '00'.repeat(32), validBefore: new Date(Date.now() + 3600_000),
        status: 'awaiting_signature', consumedAt: null as Date | null,
        txHash: null as string | null, createdAt: new Date(),
      };
      const evm = makeEvm();
      const prisma = makePrisma();
      prisma.vaultDeposit.findUnique = jest.fn().mockResolvedValue(record);
      const svc = new VaultDepositService(evm, prisma);

      await expect(svc.submitDeposit(USER_ID, USER, 'uuid', '0x' + '00'.repeat(65)))
        .rejects.toThrow('does not belong to this user');
    });

    it('throws 400 on signer mismatch (wrong wallet signed)', async () => {
      const nonce = ethers.keccak256(ethers.toUtf8Bytes('test-nonce'));
      const record = {
        id: 'uuid', userId: USER_ID, userAddress: USER.toLowerCase(),
        assetsBase: 1_000_000n, nonce,
        digest: '0x' + '00'.repeat(32), validBefore: new Date(Date.now() + 3600_000),
        status: 'awaiting_signature', consumedAt: null as Date | null,
        txHash: null as string | null, createdAt: new Date(),
      };
      const evm = makeEvm();
      const prisma = makePrisma();
      prisma.vaultDeposit.findUnique = jest.fn().mockResolvedValue(record);
      const svc = new VaultDepositService(evm, prisma);

      // Sign with a DIFFERENT wallet
      const wrongWallet = ethers.Wallet.createRandom();
      const typedData: Eip3009TypedData = {
        domain: USDC_DOMAIN,
        types: { ReceiveWithAuthorization: [
          { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
        ]},
        primaryType: 'ReceiveWithAuthorization',
        message: { from: USER, to: VAULT, value: '1000000', validAfter: '0',
          validBefore: Math.floor(record.validBefore!.getTime() / 1000).toString(), nonce },
      };
      const sig = await signEip3009(wrongWallet, typedData);

      await expect(svc.submitDeposit(USER_ID, USER, 'uuid', sig)).rejects.toThrow('Signature does not match');
    });

    it('throws 400 when authorization already consumed', async () => {
      const record = {
        id: 'uuid', userId: USER_ID, userAddress: USER.toLowerCase(),
        assetsBase: 1_000_000n, nonce: '0x' + '00'.repeat(32),
        digest: '0x' + '00'.repeat(32), validBefore: new Date(Date.now() + 3600_000),
        status: 'confirming', consumedAt: new Date(),
        txHash: null as string | null, createdAt: new Date(),
      };
      const evm = makeEvm();
      const prisma = makePrisma();
      prisma.vaultDeposit.findUnique = jest.fn().mockResolvedValue(record);
      const svc = new VaultDepositService(evm, prisma);

      await expect(svc.submitDeposit(USER_ID, USER, 'uuid', '0x' + '00'.repeat(65)))
        .rejects.toThrow('Authorization already submitted');
    });
  });

  // -------------------------------------------------------------------------
  // buildRedeemPermit
  // -------------------------------------------------------------------------

  describe('buildRedeemPermit', () => {
    it('returns typed data with correct EIP-2612 structure', async () => {
      const evm = makeEvm({
        vault: { ...makeEvm({}).vault, balanceOf: jest.fn().mockResolvedValue(5_000_000n), maxRedeem: jest.fn().mockResolvedValue(5_000_000n), nonces: jest.fn().mockResolvedValue(3n) } as any,
      });
      const prisma = makePrisma();
      const svc = new VaultDepositService(evm, prisma);

      const out = await svc.buildRedeemPermit(USER_ID, USER, '2000000');

      expect(out.id).toBeDefined();
      expect(out.typedData.primaryType).toBe('Permit');
      expect(out.typedData.domain).toEqual(VAULT_DOMAIN);
      expect(out.typedData.message.owner).toBe(USER);
      expect(out.typedData.message.spender).toBe(RELAYER);
      expect(out.typedData.message.value).toBe('2000000');
      expect(out.typedData.message.nonce).toBe('3');
      expect(prisma.vaultRedeem.create).toHaveBeenCalled();
    });

    it('resolves "all" to current share balance', async () => {
      const evm = makeEvm({
        vault: { ...makeEvm({}).vault, balanceOf: jest.fn().mockResolvedValue(5_000_000n), maxRedeem: jest.fn().mockResolvedValue(5_000_000n), nonces: jest.fn().mockResolvedValue(0n) } as any,
      });
      const prisma = makePrisma();
      const svc = new VaultDepositService(evm, prisma);

      const out = await svc.buildRedeemPermit(USER_ID, USER, 'all');

      expect(out.sharesBase).toBe('5000000');
      expect(out.typedData.message.value).toBe('5000000');
    });

    it('throws 400 when "all" resolves to zero shares', async () => {
      const evm = makeEvm({
        vault: { ...makeEvm({}).vault, balanceOf: jest.fn().mockResolvedValue(0n) } as any,
      });
      const svc = new VaultDepositService(evm, makePrisma());
      await expect(svc.buildRedeemPermit(USER_ID, USER, 'all')).rejects.toThrow('No shares to redeem');
    });

    it('throws 400 when sharesBase is 0', async () => {
      const svc = new VaultDepositService(makeEvm(), makePrisma());
      await expect(svc.buildRedeemPermit(USER_ID, USER, '0')).rejects.toThrow('greater than 0');
    });

    it('throws 400 when shares exceed maxRedeem (synchronous liquidity)', async () => {
      const evm = makeEvm({
        vault: { ...makeEvm({}).vault, balanceOf: jest.fn().mockResolvedValue(10_000_000n), maxRedeem: jest.fn().mockResolvedValue(2_000_000n) } as any,
      });
      const svc = new VaultDepositService(evm, makePrisma());
      await expect(svc.buildRedeemPermit(USER_ID, USER, '5000000')).rejects.toThrow('synchronous liquidity');
    });
  });

  // -------------------------------------------------------------------------
  // submitRedeem
  // -------------------------------------------------------------------------

  describe('submitRedeem', () => {
    it('throws 400 when no record exists for the given id', async () => {
      const evm = makeEvm();
      const prisma = makePrisma();
      prisma.vaultRedeem.findUnique = jest.fn().mockResolvedValue(null);
      const svc = new VaultDepositService(evm, prisma);

      await expect(svc.submitRedeem(USER_ID, USER, 'nonexistent', '0x' + '00'.repeat(65)))
        .rejects.toThrow('No redeem permit found');
    });

    it('throws 400 when record wallet does not match', async () => {
      const record = {
        id: 'uuid', userId: 'other-user', userAddress: ethers.Wallet.createRandom().address.toLowerCase(),
        sharesBase: 1_000_000n, digest: '0x' + '00'.repeat(32),
        deadline: new Date(Date.now() + 3600_000), status: 'awaiting_signature',
        consumedAt: null as Date | null, txHash: null as string | null, createdAt: new Date(),
      };
      const evm = makeEvm({ vault: { ...makeEvm({}).vault, nonces: jest.fn().mockResolvedValue(0n) } as any });
      const prisma = makePrisma();
      prisma.vaultRedeem.findUnique = jest.fn().mockResolvedValue(record);
      const svc = new VaultDepositService(evm, prisma);

      await expect(svc.submitRedeem(USER_ID, USER, 'uuid', '0x' + '00'.repeat(65)))
        .rejects.toThrow('does not belong to this user');
    });

    it('throws 400 on signer mismatch', async () => {
      const nonce = 5n;
      const record = {
        id: 'uuid', userId: USER_ID, userAddress: USER.toLowerCase(),
        sharesBase: 1_000_000n, digest: '0x' + '00'.repeat(32),
        deadline: new Date(Date.now() + 3600_000), status: 'awaiting_signature',
        consumedAt: null as Date | null, txHash: null as string | null, createdAt: new Date(),
      };
      const evm = makeEvm({ vault: { ...makeEvm({}).vault, nonces: jest.fn().mockResolvedValue(nonce) } as any });
      const prisma = makePrisma();
      prisma.vaultRedeem.findUnique = jest.fn().mockResolvedValue(record);
      const svc = new VaultDepositService(evm, prisma);

      // Sign with wrong wallet
      const wrongWallet = ethers.Wallet.createRandom();
      const typedData: Eip2612TypedData = {
        domain: VAULT_DOMAIN,
        types: { Permit: [
          { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ]},
        primaryType: 'Permit',
        message: { owner: USER, spender: RELAYER, value: '1000000',
          nonce: nonce.toString(), deadline: Math.floor(record.deadline!.getTime() / 1000).toString() },
      };
      const sig = await signEip2612(wrongWallet, typedData);

      await expect(svc.submitRedeem(USER_ID, USER, 'uuid', sig)).rejects.toThrow('Signature does not match');
    });

    it('throws 400 when permit already consumed', async () => {
      const record = {
        id: 'uuid', userId: USER_ID, userAddress: USER.toLowerCase(),
        sharesBase: 1_000_000n, digest: '0x' + '00'.repeat(32),
        deadline: new Date(Date.now() + 3600_000), status: 'confirming',
        consumedAt: new Date(), txHash: null as string | null, createdAt: new Date(),
      };
      const evm = makeEvm({ vault: { ...makeEvm({}).vault, nonces: jest.fn().mockResolvedValue(0n) } as any });
      const prisma = makePrisma();
      prisma.vaultRedeem.findUnique = jest.fn().mockResolvedValue(record);
      const svc = new VaultDepositService(evm, prisma);

      await expect(svc.submitRedeem(USER_ID, USER, 'uuid', '0x' + '00'.repeat(65)))
        .rejects.toThrow('Permit already submitted');
    });
  });
});
