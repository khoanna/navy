import { Injectable } from '@nestjs/common';
import { TxSummary } from './tx-summary';

/**
 * Per-subwallet allowlist (deny-by-default). Field names are preserved across the
 * Solana→EVM migration; their meaning is reinterpreted for EVM:
 *   - allowedProgramIds  = allowed CONTRACT addresses ([USDC, AavePool, aToken]).
 *   - allowedDestinations = allowed RECIPIENT addresses ([subwallet, AavePool, ownerMainWallet]).
 * All comparisons are case-insensitive (lowercased hex).
 */
export interface SubwalletPolicy {
  allowedProgramIds: string[];
  allowedDestinations: string[];
}
export type PolicyResult = { ok: true } | { ok: false; reason: string };
export interface PolicyContext {
  subwallet: string;
}

const lower = (s: string) => s.toLowerCase();

@Injectable()
export class PolicyValidator {
  check(policy: SubwalletPolicy, tx: TxSummary, ctx: PolicyContext): PolicyResult {
    const allowedContracts = new Set(policy.allowedProgramIds.map(lower));
    // The subwallet itself is always an implicit allowed destination (defense-in-depth):
    // it funds/receives its own value, same as the Solana model.
    const allowedDestinations = new Set([...policy.allowedDestinations, ctx.subwallet].map(lower));
    const subwallet = lower(ctx.subwallet);

    for (const ix of tx.instructions) {
      // Defense-in-depth: every contract we call must be explicitly allowlisted.
      if (!allowedContracts.has(lower(ix.to))) {
        return { ok: false, reason: `contract not allowlisted: ${ix.to}` };
      }

      switch (ix.kind) {
        case 'erc20-approve': {
          const spender = ix.spender ? lower(ix.spender) : undefined;
          if (spender === undefined || !allowedDestinations.has(spender)) {
            return { ok: false, reason: `approve spender not allowed: ${ix.spender}` };
          }
          break;
        }
        case 'erc20-transfer':
        case 'aave-withdraw':
        case 'native-transfer': {
          const recipient = ix.recipient ? lower(ix.recipient) : undefined;
          if (recipient === undefined || !allowedDestinations.has(recipient)) {
            return { ok: false, reason: `${ix.kind} destination not allowed: ${ix.recipient}` };
          }
          break;
        }
        case 'aave-supply': {
          // Supplied liquidity must credit the subwallet's own aToken position —
          // never a third party.
          if (ix.onBehalfOf === undefined || lower(ix.onBehalfOf) !== subwallet) {
            return { ok: false, reason: `supply onBehalfOf not the subwallet: ${ix.onBehalfOf}` };
          }
          break;
        }
        case 'unknown':
          return { ok: false, reason: `instruction not permitted for contract ${ix.to}` };
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
