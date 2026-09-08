/**
 * Driving the unsigned-proposal farming flow.
 *
 * `POST /vault/transactions/{deposit,redeem,withdraw}` returns an ordered list
 * of unsigned transactions. Paper §2.1: the user signs and pays for each one —
 * there is no relayer, so nothing here holds a key. The wallet adapter that
 * actually broadcasts is injected, which keeps this module plain TypeScript and
 * testable (no Privy, no ethers, no React).
 *
 * The legs are strictly ordered and must be mined in order: a `deposit` sent
 * before its `approve` confirms will revert. So `sendProposals` waits for each.
 *
 * UNITS: `value` is wei as a decimal string; `data` is 0x-prefixed calldata.
 */
import { GAS_BUFFER_BPS, budgetProposalGasWei, hasSufficientGas } from './gas';

/** One unsigned transaction, exactly as `be/src/vault/vault.types.ts` returns it. */
export interface TransactionProposal {
  to: string;
  data: string;
  value: string;
  chainId: number;
  description: string;
}

/** `approve(address,uint256)` — keccak("approve(address,uint256)")[0..4]. */
export const APPROVE_SELECTOR = '0x095ea7b3';

/**
 * Is this leg the cheap ERC-20 approval rather than a vault call?
 *
 * Decided from the calldata selector, not from the description or the position
 * in the list, so a re-ordered or re-worded proposal is still priced correctly.
 */
export function isApproveProposal(p: Pick<TransactionProposal, 'data'>): boolean {
  return typeof p.data === 'string' && p.data.slice(0, 10).toLowerCase() === APPROVE_SELECTOR;
}

export interface GasPreflight {
  ok: boolean;
  /** How much more ETH the wallet needs, in wei. Exactly 0n when `ok`. */
  shortfallWei: bigint;
  /** The budgeted cost of the whole sequence before buffer, in wei. */
  estimatedWei: bigint;
  /** True when the gas price could not be read, so no judgement was possible. */
  unknown: boolean;
}

/**
 * Decide whether the wallet can afford to broadcast this proposal sequence.
 *
 * `unknown: true` (an unreadable gas price) is reported as `ok: true` — the
 * flow should not be blocked by our own failure to read the chain, only by a
 * balance we positively know is too low.
 */
export function preflightProposalGas(
  proposals: ReadonlyArray<TransactionProposal>,
  chain: { ethBalanceWei: bigint; gasPriceWei: bigint },
  bufferBps: number = GAS_BUFFER_BPS,
): GasPreflight {
  if (chain.gasPriceWei <= 0n) {
    return { ok: true, shortfallWei: 0n, estimatedWei: 0n, unknown: true };
  }
  const estimatedWei = budgetProposalGasWei(
    chain.gasPriceWei,
    proposals.map((p) => ({ isApprove: isApproveProposal(p) })),
  );
  const { ok, shortfallWei } = hasSufficientGas(chain.ethBalanceWei, estimatedWei, bufferBps);
  return { ok, shortfallWei, estimatedWei, unknown: false };
}

/** The wallet capability `sendProposals` needs. The Privy embedded wallet supplies it. */
export interface ProposalBroadcaster {
  /** Broadcast one transaction, returning its hash. */
  sendTransaction(tx: { to: string; data: string; value: string }): Promise<string>;
  /** Resolve once `hash` is mined. Must reject if the transaction reverted. */
  waitForTransaction(hash: string): Promise<void>;
}

/**
 * Broadcast the legs in order, waiting for each to be mined before sending the
 * next. Returns the hashes of everything that was successfully mined; on
 * failure the error is rethrown with the index annotated so the caller can say
 * *which* leg failed (an approve that succeeded is not undone).
 */
export async function sendProposals(
  wallet: ProposalBroadcaster,
  proposals: ReadonlyArray<TransactionProposal>,
): Promise<string[]> {
  const hashes: string[] = [];
  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i]!;
    try {
      const hash = await wallet.sendTransaction({ to: p.to, data: p.data, value: p.value });
      await wallet.waitForTransaction(hash);
      hashes.push(hash);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      (err as Error & { legIndex?: number; leg?: string }).legIndex = i;
      (err as Error & { legIndex?: number; leg?: string }).leg = p.description;
      throw err;
    }
  }
  return hashes;
}

/**
 * Worst-case gas preflight for a deposit the user has not composed yet:
 * an ERC-20 `approve` plus one vault call.
 *
 * Lets the screen warn "you need ETH on Base for gas" on load, rather than
 * waiting until the user has typed an amount and pressed Deposit.
 */
export function preflightDepositGas(
  chain: { ethBalanceWei: bigint; gasPriceWei: bigint },
  bufferBps?: number,
): GasPreflight {
  const blank = { to: '', value: '0', chainId: 0, description: '' };
  return preflightProposalGas(
    [
      { ...blank, data: APPROVE_SELECTOR },
      { ...blank, data: '0x' }, // any non-approve selector → the vault-call limit
    ],
    chain,
    bufferBps,
  );
}
