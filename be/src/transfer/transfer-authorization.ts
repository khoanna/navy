import { ethers } from 'ethers';
import type { UsdcDomain, Eip712Types } from '../evm/payment-authorization';

export const TRANSFER_WITH_AUTHORIZATION_TYPES: Eip712Types = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export interface TransferTypedData {
  domain: UsdcDomain;
  types: Eip712Types;
  primaryType: 'TransferWithAuthorization';
  message: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string };
}

/** Fresh random 32-byte EIP-3009 nonce (p2p transfers have no deterministic invoice key). */
export function randomNonce(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

export function buildTransferTypedData(p: {
  domain: UsdcDomain; from: string; to: string; amount: bigint;
  validAfter: number; validBefore: number; nonce: string;
}): TransferTypedData {
  return {
    domain: p.domain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: p.from, to: p.to, value: p.amount.toString(),
      validAfter: p.validAfter.toString(), validBefore: p.validBefore.toString(), nonce: p.nonce,
    },
  };
}

export function transferDigest(td: TransferTypedData): string {
  return ethers.TypedDataEncoder.hash(td.domain, td.types as any, td.message);
}

export function recoverTransferSigner(td: TransferTypedData, signature: string): string {
  return ethers.verifyTypedData(td.domain, td.types as any, td.message, signature);
}
