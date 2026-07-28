import { ethers } from 'ethers';

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}
export type Eip712Types = Record<string, { name: string; type: string }[]>;
export interface TypedData {
  domain: Eip712Domain;
  types: Eip712Types;
  primaryType: string;
  message: Record<string, unknown>;
}

export const RECEIVE_WITH_AUTHORIZATION_TYPES: Eip712Types = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export const PERMIT_TYPES: Eip712Types = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export function randomNonce(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

export function buildDepositAuthorizationTypedData(p: {
  domain: Eip712Domain;
  from: string;
  to: string;
  amount: bigint;
  validAfter: number;
  validBefore: number;
  nonce: string;
}): TypedData {
  return {
    domain: p.domain,
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from: p.from,
      to: p.to,
      value: p.amount.toString(),
      validAfter: p.validAfter,
      validBefore: p.validBefore,
      nonce: p.nonce,
    },
  };
}

export function depositAuthorizationDigest(td: TypedData): string {
  return ethers.TypedDataEncoder.hash(td.domain, td.types, td.message);
}

export function recoverDepositSigner(td: TypedData, signature: string): string {
  return ethers.verifyTypedData(td.domain, td.types, td.message, signature);
}

export function buildRedeemPermitTypedData(p: {
  domain: Eip712Domain;
  owner: string;
  spender: string;
  value: bigint;
  nonce: bigint;
  deadline: number;
}): TypedData {
  return {
    domain: p.domain,
    types: PERMIT_TYPES,
    primaryType: 'Permit',
    message: {
      owner: p.owner,
      spender: p.spender,
      value: p.value.toString(),
      nonce: p.nonce.toString(),
      deadline: p.deadline,
    },
  };
}

export function redeemPermitDigest(td: TypedData): string {
  return ethers.TypedDataEncoder.hash(td.domain, td.types, td.message);
}

export function recoverRedeemSigner(td: TypedData, signature: string): string {
  return ethers.verifyTypedData(td.domain, td.types, td.message, signature);
}
