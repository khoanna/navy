/**
 * The `reason` contract between `be`'s vault BFF and this client.
 *
 * `be/src/vault/vault-preconditions.ts` refuses a proposal it can already see
 * will revert — an unfundable deposit, or a redeem beyond the vault's
 * synchronous exit liquidity — and returns a structured `reason` alongside the
 * prose `message`:
 *
 *   { statusCode: 400, error: 'Bad Request', message: '…',
 *     reason: { code, unit, requiredBase, availableBase, shortfallBase } }
 *
 * We branch on `code`, never on the prose. Anything we do not recognise parses
 * to `null` so the caller falls back to the generic error mapper rather than
 * rendering a half-understood shape.
 *
 * UNITS: `requiredBase` / `availableBase` / `shortfallBase` are decimal integer
 * strings whose scale is named by `unit` — `usdc-6dp` or `shares-12dp`.
 */
import { formatBaseCeil } from './amounts';

export type VaultFailureUnit = 'usdc-6dp' | 'shares-12dp';

export interface VaultInvalidAmountReason {
  code: 'INVALID_AMOUNT';
  unit: VaultFailureUnit;
  field: 'assetsBase' | 'sharesBase';
  received: string;
  message: string;
}

export interface VaultShortfallReason {
  code: 'INSUFFICIENT_USDC_BALANCE' | 'EXCEEDS_MAX_REDEEM' | 'EXCEEDS_MAX_WITHDRAW';
  unit: VaultFailureUnit;
  requiredBase: string;
  availableBase: string;
  shortfallBase: string;
  message: string;
}

export type VaultFailureReason = VaultInvalidAmountReason | VaultShortfallReason;

const UNITS: readonly string[] = ['usdc-6dp', 'shares-12dp'];
const DECIMALS: Record<VaultFailureUnit, number> = { 'usdc-6dp': 6, 'shares-12dp': 12 };

const isDigits = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);

/**
 * Read a `reason` out of a parsed error body. Returns `null` for any body that
 * is not exactly one of the shapes above — a missing field, an unknown code or
 * a non-numeric amount all disqualify it, because a partially-understood reason
 * would be rendered as a confidently wrong number.
 */
export function readVaultReason(body: unknown): VaultFailureReason | null {
  if (!body || typeof body !== 'object') return null;
  const reason = (body as { reason?: unknown }).reason;
  if (!reason || typeof reason !== 'object') return null;

  const r = reason as Record<string, unknown>;
  if (typeof r.message !== 'string') return null;
  if (typeof r.unit !== 'string' || !UNITS.includes(r.unit)) return null;
  const unit = r.unit as VaultFailureUnit;

  if (r.code === 'INVALID_AMOUNT') {
    if (r.field !== 'assetsBase' && r.field !== 'sharesBase') return null;
    if (typeof r.received !== 'string') return null;
    return { code: 'INVALID_AMOUNT', unit, field: r.field, received: r.received, message: r.message };
  }

  if (
    r.code === 'INSUFFICIENT_USDC_BALANCE' ||
    r.code === 'EXCEEDS_MAX_REDEEM' ||
    r.code === 'EXCEEDS_MAX_WITHDRAW'
  ) {
    if (!isDigits(r.requiredBase) || !isDigits(r.availableBase) || !isDigits(r.shortfallBase)) {
      return null;
    }
    return {
      code: r.code,
      unit,
      requiredBase: r.requiredBase,
      availableBase: r.availableBase,
      shortfallBase: r.shortfallBase,
      message: r.message,
    };
  }

  return null;
}

/**
 * Turn a reason into the two lines the error panel renders. Returns `null` for
 * `null`, so a caller can write `describeVaultReason(r) ?? mapSendError(e)`.
 *
 * The shortfall is rounded UP (see `amounts.ts`) — telling someone they are
 * "short by 0.00 USDC" is worse than saying nothing.
 */
export function describeVaultReason(
  reason: VaultFailureReason | null,
): { title: string; detail: string } | null {
  if (!reason) return null;

  switch (reason.code) {
    case 'INSUFFICIENT_USDC_BALANCE': {
      const short = formatBaseCeil(BigInt(reason.shortfallBase), DECIMALS[reason.unit], 2);
      const have = formatBaseCeil(BigInt(reason.availableBase), DECIMALS[reason.unit], 2);
      return {
        title: 'Not enough USDC',
        detail:
          `Your USDC balance is short by ${short} USDC. ` +
          `You hold about ${have} USDC — top up or deposit less.`,
      };
    }
    case 'EXCEEDS_MAX_REDEEM': {
      const available = formatBaseCeil(BigInt(reason.availableBase), DECIMALS[reason.unit], 4);
      return {
        title: 'Vault liquidity is limited right now',
        detail:
          `The vault can pay out up to ${available} shares immediately. ` +
          `Withdraw that much now, or try the rest again shortly.`,
      };
    }
    case 'EXCEEDS_MAX_WITHDRAW': {
      // Asset-denominated twin of EXCEEDS_MAX_REDEEM. Rendered in USDC rather
      // than shares — the two arrive on different scales (6 dp vs 12 dp), which
      // is exactly why the backend gives them separate codes.
      const available = formatBaseCeil(BigInt(reason.availableBase), DECIMALS[reason.unit], 2);
      return {
        title: 'Vault liquidity is limited right now',
        detail:
          `The vault can pay out up to ${available} USDC immediately. ` +
          `Withdraw that much now, or try the rest again shortly.`,
      };
    }
    case 'INVALID_AMOUNT':
      return {
        title: 'That amount is not valid',
        detail: `Enter a positive amount. (${reason.message})`,
      };
  }
}
