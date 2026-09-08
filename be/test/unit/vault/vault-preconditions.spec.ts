/**
 * Unit tests for the restored vault proposal preconditions.
 *
 * Context: paper §2.1 removed the relayer, so the user signs and *pays for*
 * the deposit/redeem transaction. The two guards the deleted relayed service
 * held (USDC balance, `maxRedeem`) therefore matter more than they did before —
 * without them the user buys an opaque revert.
 *
 * These tests exercise the boundary in both directions. A guard written with
 * the comparison flipped (`>` for `>=`, `>=` for `>`) passes an "obvious pass /
 * obvious fail" pair and is caught only at equality, so equality is asserted
 * explicitly for both guards.
 */
import { BadRequestException } from '@nestjs/common';
import {
  checkDepositBalance,
  checkRedeemLiquidity,
  checkWithdrawLiquidity,
  parseBaseAmount,
  preconditionBody,
  type VaultPreconditionBody,
} from '../../../src/vault/vault-preconditions';
import { VaultService } from '../../../src/vault/vault.service';
import { NavyConfigService } from '../../../src/config/config.service';
import { SrclaClient } from '../../../src/vault/srcla-client';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const VAULT = '0x55E728b08FdB9432520FB3Fd1b9D7777320f8ED3';
const WALLET = '0x1111111111111111111111111111111111111111';

describe('checkDepositBalance (USDC, 6 dp base units)', () => {
  it('passes when the balance exactly equals the amount (boundary)', () => {
    expect(checkDepositBalance(2_500_000n, 2_500_000n)).toBeNull();
  });

  it('passes when the balance exceeds the amount by one base unit', () => {
    expect(checkDepositBalance(2_500_001n, 2_500_000n)).toBeNull();
  });

  it('fails by exactly one base unit and reports a shortfall of 1', () => {
    const f = checkDepositBalance(2_499_999n, 2_500_000n);
    expect(f).not.toBeNull();
    expect(f!.code).toBe('INSUFFICIENT_USDC_BALANCE');
    expect(f!.shortfallBase).toBe('1');
    expect(f!.requiredBase).toBe('2500000');
    expect(f!.availableBase).toBe('2499999');
    expect(f!.unit).toBe('usdc-6dp');
  });

  it('reports the full amount as the shortfall on a zero balance', () => {
    const f = checkDepositBalance(0n, 1_000_000n)!;
    expect(f.shortfallBase).toBe('1000000');
    expect(f.availableBase).toBe('0');
  });

  it('keeps full precision on amounts beyond Number.MAX_SAFE_INTEGER', () => {
    // 2^70 vs 2^70 - 1: identical when coerced through Number, distinct as BigInt.
    const required = 2n ** 70n;
    const available = required - 1n;
    const f = checkDepositBalance(available, required)!;
    expect(f.shortfallBase).toBe('1');
    expect(f.requiredBase).toBe(required.toString());
  });
});

describe('checkWithdrawLiquidity (USDC assets, 6 dp)', () => {
  it('passes a withdraw of exactly maxWithdraw (boundary, exact equality)', () => {
    expect(checkWithdrawLiquidity(1_000_000n, 1_000_000n)).toBeNull();
  });

  it('passes one base unit below maxWithdraw', () => {
    expect(checkWithdrawLiquidity(1_000_000n, 999_999n)).toBeNull();
  });

  it('fails one base unit above maxWithdraw and reports the shortfall', () => {
    const f = checkWithdrawLiquidity(1_000_000n, 1_000_001n);
    expect(f).not.toBeNull();
    expect(f!.code).toBe('EXCEEDS_MAX_WITHDRAW');
    expect(f!.shortfallBase).toBe('1');
  });

  it('reports the ASSET unit, not the share unit — conflating them is off by 10^6', () => {
    const f = checkWithdrawLiquidity(0n, 5n)!;
    expect(f.unit).toBe('usdc-6dp');
    // Distinct code from redeem, precisely so a client cannot render an
    // asset shortfall against a share scale.
    expect(f.code).not.toBe('EXCEEDS_MAX_REDEEM');
  });

  it('reports a fully illiquid vault as the whole request being short', () => {
    const f = checkWithdrawLiquidity(0n, 250_000n)!;
    expect(f.availableBase).toBe('0');
    expect(f.shortfallBase).toBe('250000');
    expect(f.requiredBase).toBe('250000');
  });
});

describe('checkRedeemLiquidity (navUSDC shares, 12 dp)', () => {
  it('passes when the request exactly equals maxRedeem (boundary)', () => {
    expect(checkRedeemLiquidity(1_000_000_000_000n, 1_000_000_000_000n)).toBeNull();
  });

  it('passes below maxRedeem', () => {
    expect(checkRedeemLiquidity(1_000_000_000_000n, 999_999_999_999n)).toBeNull();
  });

  it('fails one share-unit above maxRedeem with a shortfall of 1', () => {
    const f = checkRedeemLiquidity(1_000_000_000_000n, 1_000_000_000_001n);
    expect(f).not.toBeNull();
    expect(f!.code).toBe('EXCEEDS_MAX_REDEEM');
    expect(f!.shortfallBase).toBe('1');
    expect(f!.availableBase).toBe('1000000000000');
    expect(f!.unit).toBe('shares-12dp');
  });

  it('fails everything when the vault has no synchronous liquidity at all', () => {
    const f = checkRedeemLiquidity(0n, 5n)!;
    expect(f.shortfallBase).toBe('5');
    expect(f.availableBase).toBe('0');
  });
});

describe('parseBaseAmount', () => {
  it.each([
    ['1.5', 'a decimal'],
    ['abc', 'junk'],
    ['', 'the empty string'],
    [' 7 ', 'surrounding whitespace'],
    ['-1', 'a negative'],
    ['1e6', 'exponent notation'],
    ['0x10', 'hex'],
  ])('rejects %s (%s)', (raw) => {
    const r = parseBaseAmount(raw, 'assetsBase', 'usdc-6dp');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe('INVALID_AMOUNT');
      expect(r.failure.field).toBe('assetsBase');
      expect(r.failure.received).toBe(raw);
    }
  });

  it('rejects zero (a zero deposit/redeem is never a useful transaction)', () => {
    const r = parseBaseAmount('0', 'sharesBase', 'shares-12dp');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.message).toContain('greater than 0');
  });

  it('accepts 1 — the smallest usable amount', () => {
    const r = parseBaseAmount('1', 'assetsBase', 'usdc-6dp');
    expect(r).toEqual({ ok: true, value: 1n });
  });

  it('parses a large amount as BigInt without precision loss', () => {
    const huge = (2n ** 96n - 1n).toString();
    const r = parseBaseAmount(huge, 'assetsBase', 'usdc-6dp');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(2n ** 96n - 1n);
  });
});

describe('preconditionBody', () => {
  it('nests the machine-readable reason alongside the human message', () => {
    const failure = checkDepositBalance(1n, 2n)!;
    const body = preconditionBody(failure);
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toBe(failure.message);
    expect(body.reason).toBe(failure);
  });

  it('survives JSON serialisation — no BigInt leaks into the response', () => {
    const body = preconditionBody(checkRedeemLiquidity(0n, 2n ** 80n)!);
    const round = JSON.parse(JSON.stringify(body)) as VaultPreconditionBody;
    expect(round.reason.code).toBe('EXCEEDS_MAX_REDEEM');
    if (round.reason.code === 'EXCEEDS_MAX_REDEEM') {
      expect(round.reason.requiredBase).toBe((2n ** 80n).toString());
    }
  });
});

// ---------------------------------------------------------------------------
// Service wiring — the guards must actually be reached by the proposal builders
// ---------------------------------------------------------------------------

describe('VaultService proposal preconditions', () => {
  let service: VaultService;
  let balanceOf: jest.Mock;
  let allowance: jest.Mock;
  let maxRedeem: jest.Mock;
  let maxWithdraw: jest.Mock;

  beforeEach(() => {
    const config = {
      evmRpcUrl: 'https://mainnet.base.org',
      evmChainId: 8453,
      usdcAddress: USDC,
      vaultAddress: VAULT,
    } as unknown as NavyConfigService;
    service = new VaultService(config, {} as unknown as SrclaClient);

    balanceOf = jest.fn();
    allowance = jest.fn();
    maxRedeem = jest.fn();
    maxWithdraw = jest.fn();

    // Swap the chain reads for fakes while keeping the REAL ethers Interfaces,
    // so the encoded calldata under test is still the production encoding.
    Object.defineProperty(service, 'usdc', {
      value: { interface: service.usdc.interface, balanceOf, allowance },
      configurable: true,
    });
    Object.defineProperty(service, 'vault', {
      value: { interface: service.vault.interface, maxRedeem, maxWithdraw },
      configurable: true,
    });
  });

  afterEach(async () => {
    await service.provider.destroy();
  });

  /** Pull the structured body out of a rejected proposal build. */
  const bodyOf = async (p: Promise<unknown>): Promise<VaultPreconditionBody> => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return (e as BadRequestException).getResponse() as VaultPreconditionBody;
    }
    throw new Error('expected the proposal build to be refused, but it resolved');
  };

  describe('buildDepositTransactions', () => {
    it('refuses a deposit the wallet cannot fund and says by how much', async () => {
      balanceOf.mockResolvedValue(400_000n);
      const body = await bodyOf(service.buildDepositTransactions(WALLET, '1000000'));

      expect(body.reason.code).toBe('INSUFFICIENT_USDC_BALANCE');
      if (body.reason.code === 'INSUFFICIENT_USDC_BALANCE') {
        expect(body.reason.shortfallBase).toBe('600000');
        expect(body.reason.availableBase).toBe('400000');
        expect(body.reason.requiredBase).toBe('1000000');
        expect(body.reason.unit).toBe('usdc-6dp');
      }
    });

    it('refuses before reading the allowance — no wasted round trip', async () => {
      balanceOf.mockResolvedValue(0n);
      await bodyOf(service.buildDepositTransactions(WALLET, '1'));
      expect(allowance).not.toHaveBeenCalled();
    });

    it('allows a deposit of the entire balance (boundary, exact equality)', async () => {
      balanceOf.mockResolvedValue(1_000_000n);
      allowance.mockResolvedValue(1_000_000n);

      const txs = await service.buildDepositTransactions(WALLET, '1000000');
      // Allowance already sufficient → deposit only, no approve leg.
      expect(txs).toHaveLength(1);
      expect(txs[0]!.to.toLowerCase()).toBe(VAULT.toLowerCase());
    });

    it('still emits the approve leg when the allowance is short but the balance is not', async () => {
      balanceOf.mockResolvedValue(1_000_000n);
      allowance.mockResolvedValue(0n);

      const txs = await service.buildDepositTransactions(WALLET, '1000000');
      expect(txs).toHaveLength(2);
      expect(txs[0]!.to.toLowerCase()).toBe(USDC.toLowerCase());
      expect(txs[1]!.to.toLowerCase()).toBe(VAULT.toLowerCase());
    });

    it('rejects a malformed amount without touching the chain', async () => {
      const body = await bodyOf(service.buildDepositTransactions(WALLET, '1.5'));
      expect(body.reason.code).toBe('INVALID_AMOUNT');
      expect(balanceOf).not.toHaveBeenCalled();
    });
  });

  describe('buildRedeemTransactions', () => {
    it('refuses a redeem beyond the vault synchronous exit liquidity', async () => {
      maxRedeem.mockResolvedValue(750_000_000_000n);
      const body = await bodyOf(service.buildRedeemTransactions(WALLET, '1000000000000'));

      expect(body.reason.code).toBe('EXCEEDS_MAX_REDEEM');
      if (body.reason.code === 'EXCEEDS_MAX_REDEEM') {
        expect(body.reason.shortfallBase).toBe('250000000000');
        expect(body.reason.availableBase).toBe('750000000000');
        expect(body.reason.unit).toBe('shares-12dp');
      }
    });

    it('allows a redeem of exactly maxRedeem (boundary, exact equality)', async () => {
      maxRedeem.mockResolvedValue(750_000_000_000n);
      const txs = await service.buildRedeemTransactions(WALLET, '750000000000');
      expect(txs).toHaveLength(1);
      expect(txs[0]!.to.toLowerCase()).toBe(VAULT.toLowerCase());
    });

    it('refuses one share-unit above maxRedeem', async () => {
      maxRedeem.mockResolvedValue(750_000_000_000n);
      const body = await bodyOf(service.buildRedeemTransactions(WALLET, '750000000001'));
      expect(body.reason.code).toBe('EXCEEDS_MAX_REDEEM');
      if (body.reason.code === 'EXCEEDS_MAX_REDEEM') expect(body.reason.shortfallBase).toBe('1');
    });

    it('rejects a zero-share redeem without touching the chain', async () => {
      const body = await bodyOf(service.buildRedeemTransactions(WALLET, '0'));
      expect(body.reason.code).toBe('INVALID_AMOUNT');
      if (body.reason.code === 'INVALID_AMOUNT') expect(body.reason.field).toBe('sharesBase');
      expect(maxRedeem).not.toHaveBeenCalled();
    });
  });
  describe('buildWithdrawTransactions', () => {
    it('refuses a withdraw beyond the vault synchronous exit liquidity', async () => {
      maxWithdraw.mockResolvedValue(750_000n);
      const body = await bodyOf(service.buildWithdrawTransactions(WALLET, '1000000'));

      expect(body.reason.code).toBe('EXCEEDS_MAX_WITHDRAW');
      if (body.reason.code === 'EXCEEDS_MAX_WITHDRAW') {
        expect(body.reason.shortfallBase).toBe('250000');
        expect(body.reason.availableBase).toBe('750000');
        expect(body.reason.unit).toBe('usdc-6dp');
      }
    });

    it('allows a withdraw of exactly maxWithdraw (boundary, exact equality)', async () => {
      maxWithdraw.mockResolvedValue(750_000n);
      const txs = await service.buildWithdrawTransactions(WALLET, '750000');
      expect(txs).toHaveLength(1);
      expect(txs[0]!.to.toLowerCase()).toBe(VAULT.toLowerCase());
    });

    it('refuses one base unit above maxWithdraw', async () => {
      maxWithdraw.mockResolvedValue(750_000n);
      const body = await bodyOf(service.buildWithdrawTransactions(WALLET, '750001'));
      expect(body.reason.code).toBe('EXCEEDS_MAX_WITHDRAW');
      if (body.reason.code === 'EXCEEDS_MAX_WITHDRAW') expect(body.reason.shortfallBase).toBe('1');
    });

    it('rejects a malformed amount without touching the chain', async () => {
      const body = await bodyOf(service.buildWithdrawTransactions(WALLET, '1.5'));
      expect(body.reason.code).toBe('INVALID_AMOUNT');
      if (body.reason.code === 'INVALID_AMOUNT') expect(body.reason.field).toBe('assetsBase');
      expect(maxWithdraw).not.toHaveBeenCalled();
    });

    it('rejects a zero withdraw without touching the chain', async () => {
      const body = await bodyOf(service.buildWithdrawTransactions(WALLET, '0'));
      expect(body.reason.code).toBe('INVALID_AMOUNT');
      expect(maxWithdraw).not.toHaveBeenCalled();
    });

    it('still encodes the production withdraw calldata when the guard passes', async () => {
      maxWithdraw.mockResolvedValue(1_000_000n);
      const txs = await service.buildWithdrawTransactions(WALLET, '1000000');
      const decoded = service.vault.interface.decodeFunctionData('withdraw', txs[0]!.data);
      expect(decoded[0]).toBe(1_000_000n);
      expect((decoded[1] as string).toLowerCase()).toBe(WALLET.toLowerCase());
      expect((decoded[2] as string).toLowerCase()).toBe(WALLET.toLowerCase());
    });
  });
});
