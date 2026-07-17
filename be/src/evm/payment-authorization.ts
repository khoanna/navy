import { ethers } from 'ethers';

export interface UsdcDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export type Eip712Types = Record<string, Array<{ name: string; type: string }>>;

export const PERMIT_TYPES: Eip712Types = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export interface AuthorizationTypedData {
  domain: UsdcDomain;
  types: Eip712Types;
  primaryType: 'Permit';
  message: {
    owner: string;
    spender: string;
    value: string;
    nonce: string;
    deadline: string;
  };
}

/** uuid (v4) -> 0x-prefixed 16-byte hex (matches the contract's bytes16 merchantId / invoiceId). */
function uuidToBytes16Hex(uuid: string): string {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`invalid uuid: ${uuid}`);
  return '0x' + hex;
}

export function merchantIdHex(merchantUuid: string): string {
  return uuidToBytes16Hex(merchantUuid);
}

export function invoiceIdHexFromOrderId(orderId: string): string {
  return uuidToBytes16Hex(orderId);
}

/** keccak256(abi.encodePacked(bytes16 merchantId, bytes16 invoiceId)) — the on-chain invoice key. */
export function invoiceKey(merchantIdHex16: string, invoiceIdHex16: string): string {
  return ethers.keccak256(ethers.concat([merchantIdHex16, invoiceIdHex16]));
}

export function buildAuthorizationTypedData(p: {
  domain: UsdcDomain;
  payer: string;
  spender: string;
  amount: bigint;
  nonce: bigint;
  deadline: number;
}): AuthorizationTypedData {
  return {
    domain: p.domain,
    types: PERMIT_TYPES,
    primaryType: 'Permit',
    message: {
      owner: p.payer,
      spender: p.spender,
      value: p.amount.toString(),
      nonce: p.nonce.toString(),
      deadline: p.deadline.toString(),
    },
  };
}

/** The EIP-712 digest the wallet signs; persisted as the order's durable single-use nonce. */
export function authorizationDigest(td: AuthorizationTypedData): string {
  return ethers.TypedDataEncoder.hash(td.domain, td.types as any, td.message);
}

/** Recover the signer address from typed data + a 65-byte signature. */
export function recoverAuthorizationSigner(td: AuthorizationTypedData, signature: string): string {
  return ethers.verifyTypedData(td.domain, td.types as any, td.message, signature);
}
