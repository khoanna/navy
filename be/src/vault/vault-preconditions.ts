/**
 * Vault proposal preconditions — the read-only guards that keep a user from
 * paying gas for a transaction that cannot succeed.
 *
 * Paper §2.1 / §10.2 removed the backend relayer from farming, and with it the
 * `VaultDepositService` that used to hold these two checks:
 *
 *   1. refuse to build a deposit the user's USDC balance cannot fund
 *      (was: `buildDepositAuthorization`, "Insufficient USDC balance")
 *   2. refuse to build a redeem beyond the vault's synchronous exit liquidity
 *      (was: `buildRedeemPermit`, "Insufficient synchronous liquidity")
 *
 * Now that the user signs and *pays for* their own transaction, losing these
 * turns a cheap 400 into an on-chain revert the user has already bought. A
 * read-only precheck in a BFF is not relaying: it holds no key, signs nothing
 * and sponsors no gas, so it stays inside the paper's locked scope.
 *
 * This module is deliberately decorator-free and I/O-free — the caller reads
 * the chain, this decides. That keeps the decision unit-testable.
 *
 * UNITS — every quantity here is an integer base unit, never a decimal:
 *   - USDC assets  : 6 dp  (`unit: 'usdc-6dp'`)
 *   - navUSDC shares: 12 dp (`unit: 'shares-12dp'`) — the vault's ERC-4626
 *     `_decimalsOffset()` is 6 on a 6-dp asset, so shares carry 12 decimals,
 *     NOT 18. Do not assume WAD here.
 */

/** Machine-readable discriminator. The expo client branches on this, not on prose. */
export type VaultPreconditionCode =
  | 'INVALID_AMOUNT'
  | 'INSUFFICIENT_USDC_BALANCE'
  | 'EXCEEDS_MAX_REDEEM';

/** Unit tag carried on every failure so a client never has to infer the scale. */
export type VaultAmountUnit = 'usdc-6dp' | 'shares-12dp';

/** The requested amount was not a positive integer base-unit string. */
export interface VaultInvalidAmountFailure {
  code: 'INVALID_AMOUNT';
  unit: VaultAmountUnit;
  /** Which request field was rejected, so the client can highlight it. */
  field: 'assetsBase' | 'sharesBase';
  /** Echo of what was received (already a string — safe to render). */
  received: string;
  message: string;
}

/**
 * The request is well-formed but exceeds an on-chain quantity. All three
 * amounts are decimal integer strings in `unit`, and
 * `shortfallBase = requiredBase - availableBase` (always > 0).
 */
export interface VaultShortfallFailure {
  code: 'INSUFFICIENT_USDC_BALANCE' | 'EXCEEDS_MAX_REDEEM';
  unit: VaultAmountUnit;
  requiredBase: string;
  availableBase: string;
  shortfallBase: string;
  message: string;
}

export type VaultPreconditionFailure = VaultInvalidAmountFailure | VaultShortfallFailure;

/**
 * The HTTP body a failed precheck produces. Nest returns the object given to
 * `BadRequestException` verbatim, so `reason` reaches the client intact while
 * `message` stays where every existing consumer already looks for it.
 */
export interface VaultPreconditionBody {
  statusCode: 400;
  error: 'Bad Request';
  message: string;
  reason: VaultPreconditionFailure;
}

export function preconditionBody(failure: VaultPreconditionFailure): VaultPreconditionBody {
  return {
    statusCode: 400,
    error: 'Bad Request',
    message: failure.message,
    reason: failure,
  };
}

/**
 * Parse a base-unit amount string. Returns the bigint, or a failure describing
 * why it was rejected. Rejects non-integers ("1.5"), junk ("abc"), the empty
 * string, and anything <= 0 — the same set the removed relayed service refused.
 *
 * Note `BigInt('')` is 0n and `BigInt(' 7 ')` is 7n, so the string is screened
 * with a strict pattern before conversion rather than relying on a throw.
 */
export function parseBaseAmount(
  raw: string,
  field: 'assetsBase' | 'sharesBase',
  unit: VaultAmountUnit,
): { ok: true; value: bigint } | { ok: false; failure: VaultInvalidAmountFailure } {
  const received = typeof raw === 'string' ? raw : String(raw);
  const invalid = (message: string) => ({
    ok: false as const,
    failure: { code: 'INVALID_AMOUNT' as const, unit, field, received, message },
  });

  if (!/^\d+$/.test(received)) {
    return invalid(`${field} must be a positive integer string of base units`);
  }
  const value = BigInt(received);
  if (value <= 0n) {
    return invalid(`${field} must be greater than 0`);
  }
  return { ok: true, value };
}

/**
 * Deposit funding guard. `balanceBase` is the wallet's USDC balance and
 * `amountBase` the requested deposit, both 6-dp base units.
 *
 * Carried over verbatim from the deleted relayed service: strict `<`, so
 * depositing exactly the whole balance is allowed.
 */
export function checkDepositBalance(
  balanceBase: bigint,
  amountBase: bigint,
): VaultShortfallFailure | null {
  if (balanceBase >= amountBase) return null;
  return {
    code: 'INSUFFICIENT_USDC_BALANCE',
    unit: 'usdc-6dp',
    requiredBase: amountBase.toString(),
    availableBase: balanceBase.toString(),
    shortfallBase: (amountBase - balanceBase).toString(),
    message: `Insufficient USDC balance: have ${balanceBase}, need ${amountBase} base units`,
  };
}

/**
 * Redeem liquidity guard. `maxRedeemShares` is ERC-4626 `maxRedeem(owner)` —
 * which this vault caps at its *synchronous* exit capacity, not merely at the
 * owner's share balance — and `requestedShares` is what the user asked for,
 * both 12-dp share units.
 *
 * Carried over verbatim: strict `>`, so redeeming exactly `maxRedeem` passes.
 */
export function checkRedeemLiquidity(
  maxRedeemShares: bigint,
  requestedShares: bigint,
): VaultShortfallFailure | null {
  if (requestedShares <= maxRedeemShares) return null;
  return {
    code: 'EXCEEDS_MAX_REDEEM',
    unit: 'shares-12dp',
    requiredBase: requestedShares.toString(),
    availableBase: maxRedeemShares.toString(),
    shortfallBase: (requestedShares - maxRedeemShares).toString(),
    message:
      `Insufficient synchronous liquidity: can redeem up to ${maxRedeemShares} shares, ` +
      `requested ${requestedShares}`,
  };
}
