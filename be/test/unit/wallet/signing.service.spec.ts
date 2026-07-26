import { ethers } from 'ethers';
import { SigningService } from '../../../src/wallet/signing.service';
import { PolicyValidator } from '../../../src/wallet/policy.validator';
import { EnvelopeCipherService } from '../../../src/crypto/cipher.service';
import type { EvmCall } from '../../../src/wallet/tx-summary';

// Compound III (Comet) USDC market + Circle USDC, Sepolia.
const COMET = '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e';
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

const erc20 = new ethers.Interface([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const comet = new ethers.Interface([
  'function supply(address asset, uint256 amount)',
]);

// A minimal EVM stub — signAndSend only needs `provider` to construct the Wallet.
const evm = { provider: {} as any } as any;

describe('SigningService.signAndSend', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a call to a non-allowlisted contract (derived from the call, not a caller summary)', async () => {
    const evil = ethers.Wallet.createRandom().address;
    const call: EvmCall = { to: evil, data: erc20.encodeFunctionData('approve', [COMET, 1n]) };
    const row = {
      pubkey: ethers.Wallet.createRandom().address, status: 'active', encryptedPrivkey: 'x', dataKeyWrapped: 'y',
      policyJson: { allowedProgramIds: [USDC, COMET], allowedDestinations: [COMET] },
    };
    const prisma = { farmingSubwallet: { findUnique: jest.fn().mockResolvedValue(row) } } as any;
    const audit = { record: jest.fn() } as any;
    const cipher = new EnvelopeCipherService(Buffer.alloc(32, 1));
    const svc = new SigningService(prisma, cipher, new PolicyValidator(), audit, evm);
    await expect(svc.signAndSend('s1', call)).rejects.toThrow(/Policy denied/);
  });

  it('rejects an approve to a non-allowlisted spender', async () => {
    const attacker = ethers.Wallet.createRandom().address;
    const call: EvmCall = { to: USDC, data: erc20.encodeFunctionData('approve', [attacker, 1n]) };
    const row = {
      pubkey: ethers.Wallet.createRandom().address, status: 'active', encryptedPrivkey: 'x', dataKeyWrapped: 'y',
      policyJson: { allowedProgramIds: [USDC, COMET], allowedDestinations: [COMET] },
    };
    const prisma = { farmingSubwallet: { findUnique: jest.fn().mockResolvedValue(row) } } as any;
    const audit = { record: jest.fn() } as any;
    const cipher = new EnvelopeCipherService(Buffer.alloc(32, 1));
    const svc = new SigningService(prisma, cipher, new PolicyValidator(), audit, evm);
    await expect(svc.signAndSend('s1', call)).rejects.toThrow(/Policy denied/);
  });

  it('rejects an unknown selector: does NOT touch the key, records subwallet.sign.denied', async () => {
    const call: EvmCall = { to: USDC, data: '0xdeadbeef' };
    const row = {
      pubkey: ethers.Wallet.createRandom().address, status: 'active', encryptedPrivkey: 'x', dataKeyWrapped: 'y',
      policyJson: { allowedProgramIds: [USDC], allowedDestinations: [COMET] },
    };
    const prisma = { farmingSubwallet: { findUnique: jest.fn().mockResolvedValue(row) } } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const cipher = { open: jest.fn(), seal: jest.fn() } as any;
    const sendSpy = jest.spyOn(ethers.Wallet.prototype, 'sendTransaction');
    const svc = new SigningService(prisma, cipher, new PolicyValidator(), audit, evm);

    await expect(svc.signAndSend('s1', call)).rejects.toThrow(/Policy denied/);
    // BEHAVIOR: the key was never decrypted, no tx sent.
    expect(cipher.open).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'subwallet.sign.denied' }));
  });

  it('signs + sends a valid compound-supply call: decrypts the key, broadcasts, wipes, records subwallet.sign', async () => {
    const subKey = ethers.Wallet.createRandom();
    const call: EvmCall = { to: COMET, data: comet.encodeFunctionData('supply', [USDC, 100n]) };
    const secret = Buffer.from(subKey.privateKey.slice(2), 'hex');
    const row = {
      pubkey: subKey.address, status: 'active', encryptedPrivkey: 'x', dataKeyWrapped: 'y',
      policyJson: { allowedProgramIds: [USDC, COMET], allowedDestinations: [COMET] },
    };
    const prisma = { farmingSubwallet: { findUnique: jest.fn().mockResolvedValue(row) } } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const cipher = { open: jest.fn().mockResolvedValue(Buffer.from(secret)), seal: jest.fn() } as any;
    const wait = jest.fn().mockResolvedValue({});
    const sendSpy = jest.spyOn(ethers.Wallet.prototype, 'sendTransaction').mockResolvedValue({ hash: '0xhash', wait } as any);
    const svc = new SigningService(prisma, cipher, new PolicyValidator(), audit, evm);

    const hash = await svc.signAndSend('s1', call);

    expect(hash).toBe('0xhash');
    expect(cipher.open).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'subwallet.sign' }));
  });
});
