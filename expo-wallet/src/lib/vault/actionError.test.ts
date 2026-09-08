/**
 * The whole point of Task 5: both foreseeable pre-broadcast failures must be
 * legible, and they must be DIFFERENT messages. A user told "not enough funds"
 * cannot tell whether to top up ETH or USDC.
 */
import { describeFarmingActionError } from './actionError';
import { GasShortfallError } from './gas';
import { VaultRequestError } from './vaultClient';

const usdcShortfall = () =>
  new VaultRequestError('vault /vault/transactions/deposit failed (400)', 400, {
    code: 'INSUFFICIENT_USDC_BALANCE',
    unit: 'usdc-6dp',
    requiredBase: '1000000',
    availableBase: '400000',
    shortfallBase: '600000',
    message: 'Insufficient USDC balance: have 400000, need 1000000 base units',
  });

const liquidityShortfall = () =>
  new VaultRequestError('vault /vault/transactions/redeem failed (400)', 400, {
    code: 'EXCEEDS_MAX_REDEEM',
    unit: 'shares-12dp',
    requiredBase: '1000000000000',
    availableBase: '750000000000',
    shortfallBase: '250000000000',
    message: 'Insufficient synchronous liquidity',
  });

describe('describeFarmingActionError', () => {
  describe('ETH for gas', () => {
    it('names ETH on Base and quantifies the top-up', () => {
      // 0.0004 ETH short.
      const d = describeFarmingActionError(new GasShortfallError(400_000_000_000_000n))!;
      expect(d.title).toBe('You need ETH on Base for gas');
      expect(d.detail).toContain('0.0004 ETH');
      expect(d.detail).toContain('Base');
    });

    it('rounds a tiny shortfall UP so it never reads as "0 ETH"', () => {
      const d = describeFarmingActionError(new GasShortfallError(1n))!;
      expect(d.detail).toContain('0.000001 ETH');
      expect(d.detail).not.toContain('0 ETH');
    });

    it('recognises a structurally-equivalent error from another module instance', () => {
      const lookalike = Object.assign(new Error('x'), {
        name: 'GasShortfallError',
        shortfallWei: 500_000_000_000_000n,
      });
      expect(describeFarmingActionError(lookalike)?.title).toBe('You need ETH on Base for gas');
    });

    it('does not treat a same-named error without a bigint shortfall as a gas shortfall', () => {
      const bogus = Object.assign(new Error('x'), {
        name: 'GasShortfallError',
        shortfallWei: '500000',
      });
      expect(describeFarmingActionError(bogus)).toBeNull();
    });
  });

  describe('the backend refusals from Part A', () => {
    it('reports a USDC shortfall distinctly from a gas shortfall', () => {
      const d = describeFarmingActionError(usdcShortfall())!;
      expect(d.title).toBe('Not enough USDC');
      expect(d.detail).toContain('0.6 USDC');
      expect(d.detail).not.toContain('ETH');
    });

    it('reports limited vault exit liquidity', () => {
      const d = describeFarmingActionError(liquidityShortfall())!;
      expect(d.title).toBe('Vault liquidity is limited right now');
      expect(d.detail).toContain('0.75 shares');
    });

    it('gives the two shortfall kinds different titles', () => {
      const gas = describeFarmingActionError(new GasShortfallError(1n))!;
      const usdc = describeFarmingActionError(usdcShortfall())!;
      expect(gas.title).not.toBe(usdc.title);
    });
  });

  describe('everything else falls through to the generic mapper', () => {
    it('returns null for a plain error', () => {
      expect(describeFarmingActionError(new Error('user rejected the request'))).toBeNull();
    });

    it('returns null for a vault error with no structured reason', () => {
      expect(
        describeFarmingActionError(new VaultRequestError('vault /vault/position failed (503)', 503, null)),
      ).toBeNull();
    });

    it('returns null for a malformed reason rather than rendering a partial one', () => {
      const bad = Object.assign(new Error('x'), {
        reason: { code: 'INSUFFICIENT_USDC_BALANCE', unit: 'usdc-6dp', message: 'm' },
      });
      expect(describeFarmingActionError(bad)).toBeNull();
    });

    it.each([null, undefined, 'a string'])('returns null for %p', (e) => {
      expect(describeFarmingActionError(e)).toBeNull();
    });
  });
});
