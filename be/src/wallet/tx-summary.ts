import { Interface, getAddress } from 'ethers';

/**
 * EVM calldata policy decoder (Solana→EVM migration).
 *
 * `deriveTxSummary` is the AUTHORITATIVE source of what a subwallet tx actually
 * does: it decodes the raw calldata of each call (never trusts a caller-supplied
 * summary) into a small, deny-by-default shape the PolicyValidator can reason
 * about. Framework-free (no NestJS / @solana imports) so it stays unit-testable.
 *
 * Decoded surface (only what the Aave-v3 farming flow needs):
 *   - ERC-20  approve(spender, amount)   → 'erc20-approve'  (spender)
 *   - ERC-20  transfer(to, amount)       → 'erc20-transfer' (recipient)
 *   - Aave    supply(asset, amount, onBehalfOf, referralCode) → 'aave-supply'
 *   - Aave    withdraw(asset, amount, to)                     → 'aave-withdraw' (recipient)
 *   - a call with a non-zero `value` and empty calldata       → 'native-transfer' (recipient)
 * Everything else → 'unknown' (rejected by the policy).
 */

export type IxKind =
  | 'erc20-approve'
  | 'erc20-transfer'
  | 'aave-supply'
  | 'aave-withdraw'
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
  /** erc20-transfer / aave-withdraw / native-transfer: where value/tokens go. */
  recipient?: string;
  /** aave-supply: the account credited with the aToken position. */
  onBehalfOf?: string;
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

const aavePool = new Interface([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to)',
]);

const SELECTORS = {
  approve: erc20.getFunction('approve')!.selector,
  transfer: erc20.getFunction('transfer')!.selector,
  supply: aavePool.getFunction('supply')!.selector,
  withdraw: aavePool.getFunction('withdraw')!.selector,
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
        const [, amount, onBehalfOf] = aavePool.decodeFunctionData('supply', data);
        return { to, selector, kind: 'aave-supply', onBehalfOf: addr(onBehalfOf), amount: BigInt(amount) };
      }
      case SELECTORS.withdraw: {
        const [, amount, recipient] = aavePool.decodeFunctionData('withdraw', data);
        return { to, selector, kind: 'aave-withdraw', recipient: addr(recipient), amount: BigInt(amount) };
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
