import { Injectable } from '@nestjs/common';
import type { TxSummary } from './tx-summary';
import type { PolicyResult } from './policy.validator';

/**
 * Bounds for the ONE delegated operation Navy performs on a user's main wallet:
 * auto-funding the user's own subwallet. Field names preserved across the
 * Solana→EVM migration; `*Lamports` now hold EVM base units (wei for a native
 * ETH gas top-up, or USDC base units for an ERC-20 top-up).
 */
export interface DelegatedFundingContext {
  subwallet: string;
  minLamports: bigint;
  maxLamports: bigint;
}

const lower = (s: string) => s.toLowerCase();

/**
 * Authoritative guard for delegated auto-funding. Permits exactly ONE call, and
 * only either:
 *   - a native value transfer to the subwallet, or
 *   - an ERC-20 `transfer(subwallet, amount)`,
 * with the amount within [minLamports, maxLamports]. Anything else is denied.
 * Reuses deriveTxSummary — never trusts a caller-supplied summary (the funding
 * service derives it from the built tx).
 */
@Injectable()
export class DelegatedPolicyValidator {
  check(tx: TxSummary, ctx: DelegatedFundingContext): PolicyResult {
    if (tx.instructions.length !== 1) {
      return { ok: false, reason: `expected exactly 1 instruction, got ${tx.instructions.length}` };
    }
    const ix = tx.instructions[0];

    if (ix.kind !== 'native-transfer' && ix.kind !== 'erc20-transfer') {
      return { ok: false, reason: `only a transfer to the subwallet is permitted, got ${ix.kind}` };
    }
    if (ix.recipient === undefined || lower(ix.recipient) !== lower(ctx.subwallet)) {
      return { ok: false, reason: `transfer destination not the subwallet: ${ix.recipient}` };
    }
    if (ix.amount === undefined) {
      return { ok: false, reason: 'transfer amount could not be decoded' };
    }
    if (ix.amount < ctx.minLamports || ix.amount > ctx.maxLamports) {
      return {
        ok: false,
        reason: `amount ${ix.amount} out of bounds [${ctx.minLamports}, ${ctx.maxLamports}]`,
      };
    }
    return { ok: true };
  }
}
