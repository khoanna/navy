/**
 * Unit tests for the user-signed vault transaction proposals.
 *
 * Paper §2.1 removes the backend relayer from farming: the entry path is a
 * user-signed, user-paid "USDC approval followed by `deposit` or `mint`".
 * `POST /vault/transactions/approve` is the approval half, so these tests
 * DECODE the returned calldata rather than merely checking a response came
 * back — a malformed spender or amount must fail here.
 */
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ethers } from 'ethers';
import { VaultController } from '../../../src/vault/vault.controller';
import { JwtGuard } from '../../../src/auth/jwt.guard';
import { VaultService } from '../../../src/vault/vault.service';
import { SrclaClient } from '../../../src/vault/srcla-client';
import { NavyConfigService } from '../../../src/config/config.service';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const VAULT = '0x55E728b08FdB9432520FB3Fd1b9D7777320f8ED3'; // EIP-55 checksummed
const CHAIN_ID = 8453;

/** Independent decoder — deliberately NOT the service's own interface instance. */
const erc20 = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
]);

describe('vault approve proposal', () => {
  let controller: VaultController;
  let service: VaultService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [VaultController],
      providers: [
        VaultService,
        {
          provide: NavyConfigService,
          useValue: {
            evmRpcUrl: 'https://mainnet.base.org',
            evmChainId: CHAIN_ID,
            usdcAddress: USDC,
            vaultAddress: VAULT,
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
    })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(VaultController);
    service = module.get(VaultService);
  });

  it('returns a single approve transaction addressed to USDC', () => {
    const { transactions } = controller.buildApproveTransactions({ amountBase: '2500000' });

    expect(transactions).toHaveLength(1);
    const tx = transactions[0]!;
    expect(tx.to.toLowerCase()).toBe(USDC.toLowerCase());
    expect(tx.value).toBe('0');
    expect(tx.chainId).toBe(CHAIN_ID);
  });

  it('encodes approve(spender=vault, amount) — decoded from the calldata', () => {
    const { transactions } = controller.buildApproveTransactions({ amountBase: '2500000' });
    const tx = transactions[0]!;

    // Selector must be approve(address,uint256), not transfer/permit/etc.
    expect(tx.data.slice(0, 10)).toBe(erc20.getFunction('approve')!.selector);

    const decoded = erc20.decodeFunctionData('approve', tx.data);
    expect((decoded[0] as string).toLowerCase()).toBe(VAULT.toLowerCase());
    expect(decoded[1] as bigint).toBe(2_500_000n);
  });

  it('does not approve the USDC contract or the user as spender', () => {
    const { transactions } = controller.buildApproveTransactions({ amountBase: '1' });
    const spender = (erc20.decodeFunctionData('approve', transactions[0]!.data)[0] as string).toLowerCase();

    expect(spender).not.toBe(USDC.toLowerCase());
    expect(spender).not.toBe(ethers.ZeroAddress.toLowerCase());
  });

  it('round-trips a large amount without precision loss (BigInt, not Number)', () => {
    const huge = (2n ** 96n - 1n).toString();
    const transactions = service.buildApproveTransactions(huge);

    const decoded = erc20.decodeFunctionData('approve', transactions[0]!.data);
    expect((decoded[1] as bigint).toString()).toBe(huge);
  });

  it('encodes a zero-amount approval (allowance reset) rather than rejecting it', () => {
    const transactions = service.buildApproveTransactions('0');
    const decoded = erc20.decodeFunctionData('approve', transactions[0]!.data);

    expect(decoded[1] as bigint).toBe(0n);
  });

  it('rejects a non-integer amountBase', () => {
    expect(() => service.buildApproveTransactions('1.5')).toThrow(BadRequestException);
    expect(() => service.buildApproveTransactions('abc')).toThrow(BadRequestException);
  });

  it('rejects a negative amountBase', () => {
    expect(() => service.buildApproveTransactions('-1')).toThrow(BadRequestException);
  });
});
