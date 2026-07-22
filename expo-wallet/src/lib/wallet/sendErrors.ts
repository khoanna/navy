export interface MappedError { title: string; detail: string }

/** Turn any raw send failure (chain, RPC, Privy, backend 4xx/5xx) into friendly, actionable text. */
export function mapSendError(raw: unknown): MappedError {
  const code = (raw as any)?.code;
  const msg = ((raw as any)?.message ?? String(raw ?? '')).toString();
  const m = msg.toLowerCase();

  if (code === 4001 || m.includes('user rejected') || m.includes('rejected the request') || m.includes('cancelled') || m.includes('denied')) {
    return { title: 'Cancelled', detail: 'You dismissed the signature request.' };
  }
  if (m.includes('insufficient funds') || m.includes('intrinsic transaction cost') || m.includes('out of gas') || m.includes('gas required exceeds')) {
    return { title: 'Not enough ETH for gas', detail: 'Your wallet needs a little more ETH to cover the network fee. Top up ETH and try again.' };
  }
  if (m.includes('insufficient usdc')) {
    return { title: 'Not enough USDC', detail: 'Your USDC balance is lower than the amount you tried to send.' };
  }
  if (m.includes('relayer') || m.includes('503') || m.includes('temporarily unavailable')) {
    return { title: 'Try again shortly', detail: 'The gasless relayer is temporarily unavailable. Please retry in a moment.' };
  }
  if (m.includes('expired')) {
    return { title: 'Request expired', detail: 'This transfer request timed out. Start it again to get a fresh one.' };
  }
  if (m.includes('yourself')) {
    return { title: "Can't send to yourself", detail: 'Pick a different recipient.' };
  }
  if (m.includes('not found') || m.includes('invalid recipient') || m.includes('invalid address')) {
    return { title: 'Recipient not found', detail: 'Check the @username or wallet address and try again.' };
  }
  if (m.includes('execution reverted') || m.includes('revert') || m.includes('call_exception')) {
    return { title: 'Transfer failed on-chain', detail: 'The network rejected the transaction. Nothing was sent — you can try again.' };
  }
  if (m.includes('network') || m.includes('timeout') || m.includes('fetch') || m.includes('econn')) {
    return { title: 'Network problem', detail: 'Could not reach the network. Check your connection and retry.' };
  }
  return { title: "Couldn't send", detail: msg ? msg.slice(0, 140) : 'Something went wrong. Please try again.' };
}
