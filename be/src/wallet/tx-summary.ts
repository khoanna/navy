import { Interface, getAddress } from 'ethers';

/**
 * EVM calldata policy decoder (Solana→EVM migration).
 *
 * `deriveTxSummary` is the AUTHORITATIVE source of what a subwallet tx actually
 * does: it decodes the raw calldata of each call (never trusts a caller-supplied
 * summary) into a small, deny-by-default shape the PolicyValidator can reason
 * about. Framework-free (no NestJS / chain-SDK imports) so it stays unit-testable.
 *
 * Decoded surface (only what the Compound-v3 (Comet) farming flow needs):
 *   - ERC-20   approve(spender, amount)   → 'erc20-approve'  (spender)
 *   - ERC-20   transfer(to, amount)       → 'erc20-transfer' (recipient)
 *   - Comet    supply(asset, amount)                → 'compound-supply' (credits msg.sender)
 *   - Comet    withdraw(asset, amount)              → 'compound-withdraw' (to msg.sender)
 *   - Comet    withdrawTo(to, asset, amount)        → 'compound-withdraw' (recipient)
 *   - a call with a non-zero `value` and empty calldata → 'native-transfer' (recipient)
 * Everything else → 'unknown' (rejected by the policy).
 */

export type IxKind =
  | 'erc20-approve'
  | 'erc20-transfer'
  | 'compound-supply'
  | 'compound-withdraw'
  | 'native-transfer'
  | 'unknown';

export interface DecodedIx {
  /** The contract (or recipient, for a native transfer) this call targets. */
  to: string;
  /** 4-byte function selector (lowercase hex, '0x' for a bare native transfer). */
  selector: string;
  kind: IxKind;
  /** erc20-approve: the approved spender. */
  spender?: string;
  /** erc20-transfer / compound-withdraw (withdrawTo) / native-transfer: where value/tokens go. */
  recipient?: string;
  /** compound-supply / compound-withdraw: the Comet market asset being supplied/withdrawn. */
  asset?: string;
  /** transferred / approved / supplied / withdrawn amount (base units). */
  amount?: bigint;
}

export interface TxSummary {
  instructions: DecodedIx[];
}

/** An EVM call as produced by the adapters (ethers TransactionRequest-ish). */
export interface EvmCall {
  to: string;
  data?: string;
  value?: bigint | string | number;
}

const erc20 = new Interface([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);

const comet = new Interface([
  'function supply(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  'function withdrawTo(address to, address asset, uint256 amount)',
]);

const SELECTORS = {
  approve: erc20.getFunction('approve')!.selector,
  transfer: erc20.getFunction('transfer')!.selector,
  supply: comet.getFunction('supply')!.selector,
  withdraw: comet.getFunction('withdraw')!.selector,
  withdrawTo: comet.getFunction('withdrawTo')!.selector,
};

/** Normalize to a checksummed address; falls back to the raw string if invalid. */
function addr(value: unknown): string {
  try {
    return getAddress(String(value));
  } catch {
    return String(value);
  }
}

function selectorOf(data: string): string {
  return data.length >= 10 ? data.slice(0, 10).toLowerCase() : '0x';
}

function toBigInt(value: EvmCall['value']): bigint {
  if (value === undefined || value === null) return 0n;
  return BigInt(value);
}

function decodeCall(call: EvmCall): DecodedIx {
  const to = addr(call.to);
  const data = call.data ?? '0x';
  const selector = selectorOf(data);

  // Bare value transfer (no calldata) — native ETH move.
  if ((data === '0x' || data === '') && toBigInt(call.value) > 0n) {
    return { to, selector: '0x', kind: 'native-transfer', recipient: to, amount: toBigInt(call.value) };
  }

  try {
    switch (selector) {
      case SELECTORS.approve: {
        const [spender, value] = erc20.decodeFunctionData('approve', data);
        return { to, selector, kind: 'erc20-approve', spender: addr(spender), amount: BigInt(value) };
      }
      case SELECTORS.transfer: {
        const [recipient, value] = erc20.decodeFunctionData('transfer', data);
        return { to, selector, kind: 'erc20-transfer', recipient: addr(recipient), amount: BigInt(value) };
      }
      case SELECTORS.supply: {
        // Comet supply(asset, amount) credits the implicit msg.sender (the subwallet); the `asset`
        // is decoded so the policy can pin it to USDC (a non-USDC asset is a wrong-collateral path).
        const [asset, amount] = comet.decodeFunctionData('supply', data);
        return { to, selector, kind: 'compound-supply', asset: addr(asset), amount: BigInt(amount) };
      }
      case SELECTORS.withdraw: {
        // Comet withdraw(asset, amount) sends the base to the implicit msg.sender.
        const [asset, amount] = comet.decodeFunctionData('withdraw', data);
        return { to, selector, kind: 'compound-withdraw', asset: addr(asset), amount: BigInt(amount) };
      }
      case SELECTORS.withdrawTo: {
        const [recipient, asset, amount] = comet.decodeFunctionData('withdrawTo', data);
        return { to, selector, kind: 'compound-withdraw', recipient: addr(recipient), asset: addr(asset), amount: BigInt(amount) };
      }
      default:
        return { to, selector, kind: 'unknown' };
    }
  } catch {
    // Selector matched but arguments failed to decode → treat as unknown (deny).
    return { to, selector, kind: 'unknown' };
  }
}

export function deriveTxSummary(txs: EvmCall[]): TxSummary {
  return { instructions: txs.map(decodeCall) };
}
