/**
 * EIP-3009 Gasless Relay Utilities
 * Reusable cryptography and balance guards for EIP-3009 gasless invoices and transfers.
 */
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ethers } from 'ethers';

/**
 * Recovers signer address from an EIP-712 digest and verifies against expected payer.
 */
export function recoverAndVerifySigner(
  digest: string,
  signature: string,
  expectedPayer: string,
): { signer: string; sig: ethers.Signature } {
  let signer: string;
  try {
    signer = ethers.recoverAddress(digest, signature);
  } catch {
    throw new BadRequestException('Invalid signature');
  }

  if (signer.toLowerCase() !== expectedPayer.toLowerCase()) {
    throw new BadRequestException('Signature does not match the authenticated payer');
  }

  const sig = ethers.Signature.from(signature);
  return { signer, sig };
}

/**
 * Asserts that relayer wallet has sufficient ETH balance to pay gas fees.
 */
export async function assertRelayerBalance(
  provider: ethers.Provider,
  relayerAddress: string,
  minBalanceWei: bigint,
): Promise<void> {
  const balance = await provider.getBalance(relayerAddress);
  if (balance < minBalanceWei) {
    throw new ServiceUnavailableException('Payment relayer is temporarily unavailable');
  }
}
