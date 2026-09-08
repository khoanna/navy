/**
 * Gas preconditions for the user-signed farming flow.
 *
 * SRCLA paper §2.1 removed the backend relayer from farming: the user now
 * broadcasts and *pays for* the vault `approve` + `deposit` (or `redeem`)
 * transactions themselves. A wallet with no ETH on Base therefore fails — and
 * without a precheck it fails as an opaque wallet/RPC error after the user has
 * already committed to the flow. These helpers make that failure legible
 * *before* anything is signed.
 *
 * This module is deliberately plain TypeScript: no React, no Expo, no Privy,
 * no ethers. The screen supplies the numbers it read from the chain; the
 * decision lives here where it can be unit-tested.
 *
 * UNITS — every quantity in this file is an integer, never a decimal:
 *   - ETH / gas price / gas cost : wei          (1 ETH = 1e18 wei)
 *   - gas limits                 : gas units    (dimensionless)
 *   - buffers                    : basis points (10000 bps = 100%)
 * USDC (6 dp) and navUSDC shares (12 dp) do NOT appear here.
 */
import { formatBaseCeil } from './amounts';

/**
 * Head-room applied on top of the raw gas estimate, in basis points.
 *
 * 2500 bps = 25%. Base's fee is dominated by a volatile L1 data component, so
 * an estimate taken a few seconds before broadcast can be materially low; a
 * user who is told "you have enough" and then fails is worse off than one told
 * to top up.
 */
export const GAS_BUFFER_BPS = 2500;

/**
 * Conservative gas limits, in gas units, for the two legs of a farming action.
 * Deliberately above the typical observed cost — this budget only decides
 * whether to *warn*, so overstating it is the safe direction.
 */
export const APPROVE_GAS_UNITS = 70_000n;
export const VAULT_CALL_GAS_UNITS = 450_000n;

/**
 * Is there enough native ETH to pay for `estimatedGasWei` plus `bufferBps` of
 * head-room?
 *
 * @param ethBalanceWei  the wallet's native balance, in wei
 * @param estimatedGasWei the raw estimated cost of the transaction(s), in wei
 * @param bufferBps      head-room in basis points; 2500 = require 125% of the estimate
 * @returns `ok` plus `shortfallWei` — how much more ETH is needed, in wei,
 *          and exactly `0n` whenever `ok` is true.
 *
 * The required amount is rounded **up**, so the buffer can never be silently
 * eroded by integer division. A negative, fractional or non-finite `bufferBps`
 * is coerced to a safe floor of 0 rather than being allowed to reduce the
 * requirement below the raw estimate.
 */
export function hasSufficientGas(
  ethBalanceWei: bigint,
  estimatedGasWei: bigint,
  bufferBps: number,
): { ok: boolean; shortfallWei: bigint } {
  const safeBps =
    Number.isFinite(bufferBps) && bufferBps > 0 ? BigInt(Math.floor(bufferBps)) : 0n;

  // Nothing to pay for → nothing to require.
  const estimate = estimatedGasWei > 0n ? estimatedGasWei : 0n;

  // Ceiling division: required = ceil(estimate * (10000 + bps) / 10000).
  const scaled = estimate * (10_000n + safeBps);
  const requiredWei = (scaled + 9_999n) / 10_000n;

  if (ethBalanceWei >= requiredWei) return { ok: true, shortfallWei: 0n };
  return { ok: false, shortfallWei: requiredWei - ethBalanceWei };
}

/**
 * Budget the gas cost, in wei, of a proposal sequence returned by
 * `POST /vault/transactions/*`.
 *
 * The legs cannot be estimated individually against the chain: `deposit`
 * reverts under `eth_estimateGas` until the preceding `approve` is mined. So
 * we price a conservative fixed limit per leg instead — the ERC-20 `approve`
 * leg is the cheap one, everything else is a vault call.
 *
 * @param gasPriceWei price per gas unit, in wei
 * @param legs        one entry per proposed transaction; `isApprove` picks the limit
 * @returns total cost in wei (0 for an empty sequence or a non-positive price)
 */
export function budgetProposalGasWei(
  gasPriceWei: bigint,
  legs: ReadonlyArray<{ isApprove: boolean }>,
): bigint {
  if (gasPriceWei <= 0n) return 0n;
  const units = legs.reduce(
    (sum, leg) => sum + (leg.isApprove ? APPROVE_GAS_UNITS : VAULT_CALL_GAS_UNITS),
    0n,
  );
  return units * gasPriceWei;
}

/** Format a wei amount as an ETH string with `dp` decimals, rounding **up**
 *  so a "top up by X" instruction is never short of what is actually needed. */
export function weiToEthCeil(wei: bigint, dp = 6): string {
  return formatBaseCeil(wei, 18, dp);
}

/**
 * Thrown by a farming action when the wallet cannot cover its own gas.
 *
 * Carries the shortfall so the UI can say "top up by X" rather than "insufficient
 * funds". `name` is set explicitly so consumers can recognise it structurally,
 * without depending on a single module instance for `instanceof`.
 */
export class GasShortfallError extends Error {
  readonly shortfallWei: bigint;

  constructor(shortfallWei: bigint) {
    super(`Insufficient ETH for gas: short by ${shortfallWei} wei`);
    this.name = 'GasShortfallError';
    this.shortfallWei = shortfallWei;
  }
}

/** Structural check for {@link GasShortfallError}. */
export function isGasShortfall(e: unknown): e is GasShortfallError {
  return (
    !!e &&
    typeof e === 'object' &&
    (e as { name?: unknown }).name === 'GasShortfallError' &&
    typeof (e as { shortfallWei?: unknown }).shortfallWei === 'bigint'
  );
}
