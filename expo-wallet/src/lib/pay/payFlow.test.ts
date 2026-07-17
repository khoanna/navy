import { Wallet, verifyTypedData } from 'ethers';
import { payInvoice } from './payFlow';
import type { Eip712TypedData } from './navyPayClient';

// A deterministic test wallet (well-known Hardhat account #0 key).
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const wallet = new Wallet(KEY);

const TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

function sampleTypedData(from: string): Eip712TypedData {
  return {
    domain: { name: 'USD Coin', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
    types: TYPES,
    primaryType: 'ReceiveWithAuthorization',
    message: {
      from,
      to: '0x000000000000000000000000000000000000dEaD',
      value: '1000000',
      validAfter: '0',
      validBefore: '9999999999',
      nonce: '0x' + '11'.repeat(32),
    },
  };
}

// Real eth_signTypedData_v4 ≈ wallet.signTypedData(domain, types-without-EIP712Domain, message).
const realSigner = async (td: Eip712TypedData) => wallet.signTypedData(td.domain as any, td.types as any, td.message as any);

describe('payInvoice', () => {
  it('fetches the typed data, signs it, and submits the signature', async () => {
    const td = sampleTypedData(wallet.address);
    const client = {
      getPaymentAuthorization: jest.fn().mockResolvedValue({ typedData: td, invoice: {} }),
      submitSignature: jest.fn().mockResolvedValue({ txHash: '0xabc', status: 'confirming' }),
    } as any;
    const out = await payInvoice({ orderId: 'o1', navyAccessToken: 'navy-jwt', client, signTypedData: realSigner });
    expect(client.getPaymentAuthorization).toHaveBeenCalledWith('o1', 'navy-jwt');
    const [, sig] = client.submitSignature.mock.calls[0];
    // The submitted signature recovers to the payer wallet.
    expect(verifyTypedData(td.domain as any, td.types as any, td.message as any, sig).toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(client.submitSignature).toHaveBeenCalledWith('o1', expect.any(String), 'navy-jwt');
    expect(out.txHash).toBe('0xabc');
  });

  it('signs when expectedSigner matches the typed-data `from`', async () => {
    const td = sampleTypedData(wallet.address);
    const client = {
      getPaymentAuthorization: jest.fn().mockResolvedValue({ typedData: td, invoice: {} }),
      submitSignature: jest.fn().mockResolvedValue({ txHash: '0xabc', status: 'confirming' }),
    } as any;
    const out = await payInvoice({ orderId: 'o1', navyAccessToken: 'jwt', client, signTypedData: realSigner, expectedSigner: wallet.address });
    expect(out.txHash).toBe('0xabc');
  });

  it('rejects a typed data built for a different payer than expectedSigner', async () => {
    const td = sampleTypedData('0x000000000000000000000000000000000000BEEF');
    const signTypedData = jest.fn();
    const client = {
      getPaymentAuthorization: jest.fn().mockResolvedValue({ typedData: td, invoice: {} }),
      submitSignature: jest.fn(),
    } as any;
    await expect(
      payInvoice({ orderId: 'o1', navyAccessToken: 'jwt', client, signTypedData, expectedSigner: wallet.address }),
    ).rejects.toThrow(/different wallet/);
    expect(signTypedData).not.toHaveBeenCalled();
  });
});
