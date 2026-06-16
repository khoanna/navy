import { Injectable } from '@nestjs/common';

export interface SubwalletPolicy {
  allowedProgramIds: string[];
  allowedDestinations: string[];
}
export interface TxSummary { programIds: string[]; transferDestinations: string[]; }
export type PolicyResult = { ok: true } | { ok: false; reason: string };

@Injectable()
export class PolicyValidator {
  check(policy: SubwalletPolicy, tx: TxSummary): PolicyResult {
    for (const pid of tx.programIds) {
      if (!policy.allowedProgramIds.includes(pid)) return { ok: false, reason: `program not allowlisted: ${pid}` };
    }
    for (const dest of tx.transferDestinations) {
      if (!policy.allowedDestinations.includes(dest)) return { ok: false, reason: `transfer destination not allowed: ${dest}` };
    }
    return { ok: true };
  }
}
