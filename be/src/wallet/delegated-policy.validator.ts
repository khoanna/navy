import { Injectable } from '@nestjs/common';
import type { TxSummary } from './tx-summary';
import type { PolicyResult } from './policy.validator';

export interface DelegatedFundingContext {
  subwallet: string;
  minLamports: bigint;
  maxLamports: bigint;
}

/**
 * Authoritative guard for the ONE delegated operation Navy performs on a user's
 * embedded wallet: a single SystemProgram.transfer into the user's own subwallet,
 * amount-bounded. Anything else is denied. Reuses deriveTxSummary — never trusts a
 * caller-supplied summary (the funding service derives it from the built tx).
 */
@Injectable()
export class DelegatedPolicyValidator {
  check(tx: TxSummary, ctx: DelegatedFundingContext): PolicyResult {
    if (tx.instructions.length !== 1) {
      return { ok: false, reason: `expected exactly 1 instruction, got ${tx.instructions.length}` };
    }
    const ix = tx.instructions[0];
    if (ix.kind !== 'system-transfer') {
      return { ok: false, reason: `only system-transfer permitted, got ${ix.kind}` };
    }
    if (ix.destination !== ctx.subwallet) {
      return { ok: false, reason: `transfer destination not the subwallet: ${ix.destination}` };
    }
    if (ix.lamports === undefined) {
      return { ok: false, reason: 'transfer lamports could not be decoded' };
    }
    if (ix.lamports < ctx.minLamports || ix.lamports > ctx.maxLamports) {
      return { ok: false, reason: `amount ${ix.lamports} out of bounds [${ctx.minLamports}, ${ctx.maxLamports}]` };
    }
    return { ok: true };
  }
}
