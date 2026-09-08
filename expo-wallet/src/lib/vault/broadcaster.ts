/**
 * Adapts the Privy embedded wallet + an RPC receipt reader to the
 * `ProposalBroadcaster` that `sendProposals` needs.
 *
 * Kept out of the screens so the "did this actually succeed?" decision is
 * testable: an `eth_sendTransaction` that returns a hash proves only that the
 * transaction was *accepted*, not that it succeeded. A reverted deposit still
 * mines, still costs the user gas, and would otherwise be reported as done.
 */
import type { ProposalBroadcaster } from './proposals';

/** The receipt subset we need — an ethers `JsonRpcProvider` satisfies it. */
export interface ReceiptReader {
  waitForTransaction(hash: string): Promise<{ status?: number | null } | null>;
}

export function makeProposalBroadcaster(
  send: (tx: { to: string; valueWei?: string; data?: string }) => Promise<string>,
  receipts: ReceiptReader,
): ProposalBroadcaster {
  return {
    sendTransaction: (tx) => send({ to: tx.to, valueWei: tx.value, data: tx.data }),
    async waitForTransaction(hash) {
      const receipt = await receipts.waitForTransaction(hash);
      if (!receipt) throw new Error(`Transaction ${hash} was not mined`);
      if (receipt.status !== 1) {
        throw new Error(`Transaction ${hash} reverted on-chain`);
      }
    },
  };
}
