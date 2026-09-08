/**
 * Tests for the user-pays-gas preconditions.
 *
 * The interesting failures here are the ones an "obvious pass / obvious fail"
 * pair cannot see:
 *   - a dropped buffer (a balance equal to the raw estimate must NOT pass),
 *   - floor instead of ceiling division (erodes the buffer, and reports a
 *     shortfall of 0 for a wallet that is genuinely short),
 *   - a negative bufferBps being honoured and thereby *weakening* the guard,
 *   - the two legs of the proposal sharing one gas limit.
 * Each of those has an assertion that fails if the behaviour regresses.
 */
import {
  APPROVE_GAS_UNITS,
  GAS_BUFFER_BPS,
  VAULT_CALL_GAS_UNITS,
  budgetProposalGasWei,
  hasSufficientGas,
  weiToEthCeil,
} from './gas';

const GWEI = 1_000_000_000n;

describe('hasSufficientGas', () => {
  describe('boundary with no buffer', () => {
    it('passes on an exact match', () => {
      expect(hasSufficientGas(1000n, 1000n, 0)).toEqual({ ok: true, shortfallWei: 0n });
    });

    it('fails one wei short and reports a shortfall of exactly one wei', () => {
      expect(hasSufficientGas(999n, 1000n, 0)).toEqual({ ok: false, shortfallWei: 1n });
    });

    it('passes one wei over', () => {
      expect(hasSufficientGas(1001n, 1000n, 0).ok).toBe(true);
    });
  });

  describe('the buffer is actually required, not decorative', () => {
    it('REFUSES a balance equal to the raw estimate when a buffer is asked for', () => {
      // 25% head-room: 1_000_000 wei of estimate needs 1_250_000 wei of balance.
      const r = hasSufficientGas(1_000_000n, 1_000_000n, 2500);
      expect(r.ok).toBe(false);
      expect(r.shortfallWei).toBe(250_000n);
    });

    it('passes at exactly estimate + buffer', () => {
      expect(hasSufficientGas(1_250_000n, 1_000_000n, 2500)).toEqual({
        ok: true,
        shortfallWei: 0n,
      });
    });

    it('fails one wei below estimate + buffer', () => {
      expect(hasSufficientGas(1_249_999n, 1_000_000n, 2500)).toEqual({
        ok: false,
        shortfallWei: 1n,
      });
    });

    it('scales the buffer with bufferBps rather than using a fixed constant', () => {
      const at2500 = hasSufficientGas(0n, 1_000_000n, 2500).shortfallWei;
      const at5000 = hasSufficientGas(0n, 1_000_000n, 5000).shortfallWei;
      expect(at2500).toBe(1_250_000n);
      expect(at5000).toBe(1_500_000n);
      expect(at5000).toBeGreaterThan(at2500);
    });
  });

  describe('rounding', () => {
    it('rounds the requirement UP — a sub-unit buffer still bites', () => {
      // estimate 1 wei, 1 bp: exact requirement is 1.0001 wei.
      // Ceiling → 2 wei required, so a 1 wei balance is short by 1.
      // Floor would give 1 wei required and wrongly report ok.
      expect(hasSufficientGas(1n, 1n, 1)).toEqual({ ok: false, shortfallWei: 1n });
    });

    it('rounds up on a non-divisible buffer', () => {
      // 3 wei * 1.0001 = 3.0003 → 4 wei required.
      expect(hasSufficientGas(3n, 3n, 1)).toEqual({ ok: false, shortfallWei: 1n });
      expect(hasSufficientGas(4n, 3n, 1).ok).toBe(true);
    });
  });

  describe('bufferBps can only ever tighten the requirement', () => {
    it('ignores a negative bufferBps instead of discounting the estimate', () => {
      // Honouring -5000 would require only 500 wei and wrongly pass a 600 wei wallet.
      expect(hasSufficientGas(600n, 1000n, -5000)).toEqual({ ok: false, shortfallWei: 400n });
    });

    it('ignores NaN', () => {
      expect(hasSufficientGas(600n, 1000n, Number.NaN)).toEqual({ ok: false, shortfallWei: 400n });
    });

    it('ignores Infinity rather than requiring an infinite balance', () => {
      expect(hasSufficientGas(1000n, 1000n, Number.POSITIVE_INFINITY).ok).toBe(true);
    });

    it('floors a fractional bufferBps', () => {
      expect(hasSufficientGas(0n, 10_000n, 2500.9).shortfallWei).toBe(12_500n);
    });
  });

  describe('degenerate inputs', () => {
    it('requires nothing when there is nothing to pay for', () => {
      expect(hasSufficientGas(0n, 0n, GAS_BUFFER_BPS)).toEqual({ ok: true, shortfallWei: 0n });
    });

    it('treats a negative estimate as zero', () => {
      expect(hasSufficientGas(0n, -5n, GAS_BUFFER_BPS)).toEqual({ ok: true, shortfallWei: 0n });
    });

    it('reports the whole requirement when the wallet is empty', () => {
      expect(hasSufficientGas(0n, 2_000_000n, 0).shortfallWei).toBe(2_000_000n);
    });

    it('keeps full precision at realistic wei magnitudes', () => {
      // ~0.0005 ETH of gas against a wallet holding one wei less than required.
      const estimate = 500_000_000_000_000n;
      const required = (estimate * 12_500n) / 10_000n;
      expect(hasSufficientGas(required - 1n, estimate, 2500)).toEqual({
        ok: false,
        shortfallWei: 1n,
      });
      expect(hasSufficientGas(required, estimate, 2500).ok).toBe(true);
    });
  });
});

describe('budgetProposalGasWei', () => {
  it('prices an approve + deposit sequence from both gas limits', () => {
    const wei = budgetProposalGasWei(GWEI, [{ isApprove: true }, { isApprove: false }]);
    expect(wei).toBe((APPROVE_GAS_UNITS + VAULT_CALL_GAS_UNITS) * GWEI);
  });

  it('prices a lone redeem from the vault-call limit only', () => {
    expect(budgetProposalGasWei(GWEI, [{ isApprove: false }])).toBe(VAULT_CALL_GAS_UNITS * GWEI);
  });

  it('charges an approve leg less than a vault leg', () => {
    // Guards against both legs collapsing onto one shared constant.
    expect(budgetProposalGasWei(GWEI, [{ isApprove: true }])).toBeLessThan(
      budgetProposalGasWei(GWEI, [{ isApprove: false }]),
    );
  });

  it('scales linearly with the gas price', () => {
    const legs = [{ isApprove: true }, { isApprove: false }];
    expect(budgetProposalGasWei(2n * GWEI, legs)).toBe(2n * budgetProposalGasWei(GWEI, legs));
  });

  it('is zero for an empty proposal list', () => {
    expect(budgetProposalGasWei(GWEI, [])).toBe(0n);
  });

  it('is zero when the gas price is unknown (0) rather than guessing', () => {
    expect(budgetProposalGasWei(0n, [{ isApprove: false }])).toBe(0n);
  });
});

describe('weiToEthCeil', () => {
  it('renders zero as "0"', () => {
    expect(weiToEthCeil(0n)).toBe('0');
  });

  it('never rounds a real shortfall down to "0"', () => {
    // Flooring here would tell the user to top up by 0 ETH.
    expect(weiToEthCeil(1n)).toBe('0.000001');
  });

  it('renders whole ETH without a fraction', () => {
    expect(weiToEthCeil(10n ** 18n)).toBe('1');
  });

  it('strips trailing zeros from the fraction', () => {
    expect(weiToEthCeil(1_500_000_000_000_000_000n)).toBe('1.5');
  });

  it('rounds a repeating value up at the requested precision', () => {
    // 0.0000105 ETH at 6 dp → 0.000011, not 0.00001.
    expect(weiToEthCeil(10_500_000_000_000n, 6)).toBe('0.000011');
  });

  it('honours a custom precision', () => {
    expect(weiToEthCeil(1_234_500_000_000_000_000n, 2)).toBe('1.24');
  });
});
