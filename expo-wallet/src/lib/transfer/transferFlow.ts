import type { TransferClient } from './transferClient';
import type { Eip712TypedData } from '@/lib/pay/navyPayClient';

export interface TransferFlowInput { recipient: string; amountBase: string }
export interface TransferFlowResult { txHash: string; status: string; recipient: { address: string; username: string | null }; amount: string }

/** build → sign the EIP-712 typed data → submit. Pure orchestration (signer + client injected). */
export async function runTransferFlow(
  client: Pick<TransferClient, 'build' | 'submit'>,
  signTypedData: (td: Eip712TypedData) => Promise<string>,
  input: TransferFlowInput,
): Promise<TransferFlowResult> {
  const built = await client.build(input.recipient, input.amountBase);
  const signature = await signTypedData(built.typedData);
  const res = await client.submit(built.transferId, signature);
  return { txHash: res.txHash, status: res.status, recipient: built.recipient, amount: built.amount };
}
