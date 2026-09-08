/**
 * One place that turns a failed farming action into the two lines the screen
 * renders — so the screen stays thin and this stays testable.
 *
 * Under paper §2.1 the user pays their own Base gas, so there are now two
 * distinct pre-broadcast refusals the user must be able to tell apart:
 *
 *   - not enough **ETH** to pay the network fee  (detected client-side)
 *   - not enough **USDC**, or a redeem beyond the vault's synchronous exit
 *     liquidity                                   (refused by `be`, with a
 *                                                  structured `reason`)
 *
 * Returns `null` for anything else, so the caller falls back to the generic
 * `mapSendError`. Never invent a reason we do not actually have.
 */
import { describeVaultReason, readVaultReason } from './failures';
import { isGasShortfall, weiToEthCeil } from './gas';

export interface FarmingActionError {
  title: string;
  detail: string;
}

export function describeFarmingActionError(e: unknown): FarmingActionError | null {
  if (isGasShortfall(e)) {
    return {
      title: 'You need ETH on Base for gas',
      detail:
        `Farming transactions are signed and paid for by you — Navy does not relay them. ` +
        `Add about ${weiToEthCeil(e.shortfallWei)} ETH on Base and try again.`,
    };
  }

  // A VaultRequestError carries `reason`; `readVaultReason` validates it and
  // returns null for anything it does not fully recognise.
  const reason = (e as { reason?: unknown } | null | undefined)?.reason;
  return describeVaultReason(readVaultReason({ reason }));
}
