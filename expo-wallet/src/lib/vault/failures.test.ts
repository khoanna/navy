/**
 * The `reason` contract with be/src/vault/vault-preconditions.ts.
 *
 * These bodies are copied from what that module actually emits — if the two
 * drift, these tests are the tripwire. `readVaultReason` must be strict: a
 * shape it only half-recognises has to come back `null`, because rendering a
 * missing `shortfallBase` as "short by 0" is worse than a generic error.
 */
import { describeVaultReason, readVaultReason } from './failures';

/** Exactly the body `preconditionBody(checkDepositBalance(400000n, 1000000n))` produces. */
const DEPOSIT_BODY = {
  statusCode: 400,
  error: 'Bad Request',
  message: 'Insufficient USDC balance: have 400000, need 1000000 base units',
  reason: {
    code: 'INSUFFICIENT_USDC_BALANCE',
    unit: 'usdc-6dp',
    requiredBase: '1000000',
    availableBase: '400000',
    shortfallBase: '600000',
    message: 'Insufficient USDC balance: have 400000, need 1000000 base units',
  },
};

/** Exactly the body `preconditionBody(checkRedeemLiquidity(...))` produces. */
const REDEEM_BODY = {
  statusCode: 400,
  error: 'Bad Request',
  message: 'Insufficient synchronous liquidity: can redeem up to 750000000000 shares, requested 1000000000000',
  reason: {
    code: 'EXCEEDS_MAX_REDEEM',
    unit: 'shares-12dp',
    requiredBase: '1000000000000',
    availableBase: '750000000000',
    shortfallBase: '250000000000',
    message: 'Insufficient synchronous liquidity: can redeem up to 750000000000 shares, requested 1000000000000',
  },
};

const INVALID_BODY = {
  statusCode: 400,
  error: 'Bad Request',
  message: 'assetsBase must be greater than 0',
  reason: {
    code: 'INVALID_AMOUNT',
    unit: 'usdc-6dp',
    field: 'assetsBase',
    received: '0',
    message: 'assetsBase must be greater than 0',
  },
};

describe('readVaultReason', () => {
  it('reads the deposit shortfall body the backend emits', () => {
    const r = readVaultReason(DEPOSIT_BODY);
    expect(r).toEqual(DEPOSIT_BODY.reason);
  });

  it('reads the redeem-liquidity body the backend emits', () => {
    expect(readVaultReason(REDEEM_BODY)).toEqual(REDEEM_BODY.reason);
  });

  it('reads the invalid-amount body the backend emits', () => {
    expect(readVaultReason(INVALID_BODY)).toEqual(INVALID_BODY.reason);
  });

  describe('rejects anything it does not fully understand', () => {
    it('returns null for a body with no reason at all (a plain Nest 400)', () => {
      expect(readVaultReason({ statusCode: 400, message: 'Bad Request' })).toBeNull();
    });

    it('returns null for an unknown code', () => {
      expect(
        readVaultReason({ reason: { ...DEPOSIT_BODY.reason, code: 'SOMETHING_NEW' } }),
      ).toBeNull();
    });

    it('returns null for an unknown unit — the scale must never be guessed', () => {
      expect(readVaultReason({ reason: { ...DEPOSIT_BODY.reason, unit: 'usdc-18dp' } })).toBeNull();
    });

    it('returns null when shortfallBase is missing', () => {
      const { shortfallBase, ...rest } = DEPOSIT_BODY.reason;
      expect(readVaultReason({ reason: rest })).toBeNull();
    });

    it('returns null when an amount is a number rather than a digit string', () => {
      expect(readVaultReason({ reason: { ...DEPOSIT_BODY.reason, shortfallBase: 600000 } })).toBeNull();
    });

    it('returns null when an amount is negative or non-numeric', () => {
      expect(readVaultReason({ reason: { ...DEPOSIT_BODY.reason, shortfallBase: '-1' } })).toBeNull();
      expect(readVaultReason({ reason: { ...DEPOSIT_BODY.reason, availableBase: '1.5' } })).toBeNull();
    });

    it('returns null for an INVALID_AMOUNT with an unexpected field', () => {
      expect(readVaultReason({ reason: { ...INVALID_BODY.reason, field: 'amountBase' } })).toBeNull();
    });

    it.each([null, undefined, 'a string', 42, []])('returns null for %p', (body) => {
      expect(readVaultReason(body)).toBeNull();
    });
  });
});

describe('describeVaultReason', () => {
  it('states the USDC shortfall as a number, not just "insufficient"', () => {
    const d = describeVaultReason(readVaultReason(DEPOSIT_BODY))!;
    expect(d.title).toBe('Not enough USDC');
    expect(d.detail).toContain('short by 0.6 USDC');
    expect(d.detail).toContain('0.4 USDC');
  });

  it('rounds a sub-cent USDC shortfall up so it never reads as 0', () => {
    const d = describeVaultReason(
      readVaultReason({ reason: { ...DEPOSIT_BODY.reason, shortfallBase: '1' } }),
    )!;
    expect(d.detail).toContain('short by 0.01 USDC');
    expect(d.detail).not.toContain('short by 0 USDC');
  });

  it('scales the redeem shortfall at 12 dp, not 6 — shares are not USDC', () => {
    const d = describeVaultReason(readVaultReason(REDEEM_BODY))!;
    expect(d.title).toBe('Vault liquidity is limited right now');
    // 750000000000 share base units at 12 dp = 0.75 shares. At 6 dp it would read 750000.
    expect(d.detail).toContain('0.75 shares');
    expect(d.detail).not.toContain('750000');
  });

  it('explains an invalid amount', () => {
    const d = describeVaultReason(readVaultReason(INVALID_BODY))!;
    expect(d.title).toBe('That amount is not valid');
    expect(d.detail).toContain('assetsBase must be greater than 0');
  });

  it('returns null for null so callers can fall through to the generic mapper', () => {
    expect(describeVaultReason(null)).toBeNull();
  });
});
