import { Injectable } from '@nestjs/common';
import { TxSummary } from './tx-summary';

export interface SubwalletPolicy {
  allowedProgramIds: string[];
  allowedDestinations: string[];
}
export type PolicyResult = { ok: true } | { ok: false; reason: string };
export interface PolicyContext {
  subwallet: string;
}

@Injectable()
export class PolicyValidator {
  check(policy: SubwalletPolicy, tx: TxSummary, ctx: PolicyContext): PolicyResult {
    // The subwallet itself is always a permitted destination: WSOL unwrap closes
    // the transient ATA back to the subwallet, and the subwallet funds its own accounts.
    const allowedDestinations = new Set([...policy.allowedDestinations, ctx.subwallet]);

    for (const ix of tx.instructions) {
      // Defense-in-depth: every program must be explicitly allowlisted.
      if (!policy.allowedProgramIds.includes(ix.programId)) {
        return { ok: false, reason: `program not allowlisted: ${ix.programId}` };
      }

      switch (ix.kind) {
        case 'system-transfer':
        case 'token-transfer':
        case 'token-close': {
          const dest = ix.destination;
          if (dest === undefined || !allowedDestinations.has(dest)) {
            return { ok: false, reason: `${ix.kind} destination not allowed: ${dest}` };
          }
          break;
        }
        case 'token-dangerous':
          return {
            ok: false,
            reason: `token instruction not permitted (opcode ${ix.rawOpcode})`,
          };
        case 'unknown':
          return { ok: false, reason: `instruction not permitted for program ${ix.programId}` };
        case 'system-create':
        case 'token-init':
        case 'token-sync':
        case 'ata-create':
        case 'save':
          // benign / expected instructions
          break;
        default: {
          // exhaustiveness guard
          const _never: never = ix.kind;
          return { ok: false, reason: `instruction not permitted: ${_never}` };
        }
      }
    }

    return { ok: true };
  }
}
