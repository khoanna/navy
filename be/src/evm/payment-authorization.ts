import { ethers } from 'ethers';

export interface UsdcDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface AuthorizationTypedData {
  domain: UsdcDomain;
  types: typeof RECEIVE_WITH_AUTHORIZATION_TYPES;
  primaryType: 'ReceiveWithAuthorization';
  message: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
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

/** keccak256(abi.encodePacked(bytes16 merchantId, bytes16 invoiceId)) — the EIP-3009 nonce + contract invoice key. */
export function invoiceKey(merchantIdHex16: string, invoiceIdHex16: string): string {
  return ethers.keccak256(ethers.concat([merchantIdHex16, invoiceIdHex16]));
}

export function buildAuthorizationTypedData(p: {
  domain: UsdcDomain;
  payer: string;
  to: string;
  amount: bigint;
  validAfter: number;
  validBefore: number;
  nonce: string;
}): AuthorizationTypedData {
  return {
    domain: p.domain,
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from: p.payer,
      to: p.to,
      value: p.amount.toString(),
      validAfter: p.validAfter.toString(),
      validBefore: p.validBefore.toString(),
      nonce: p.nonce,
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
