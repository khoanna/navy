import { ethers } from 'ethers';
import { SigningService } from './signing.service';
import { PolicyValidator } from './policy.validator';
import { EnvelopeCipherService } from '../crypto/cipher.service';
import type { EvmCall } from './tx-summary';

const POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951';
const USDC = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';
const ATOKEN = '0x16dA4541aD1807f4443d92D26044C1147406EB80';

const erc20 = new ethers.Interface([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const pool = new ethers.Interface([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
]);

// A minimal EVM stub — signAndSend only needs `provider` to construct the Wallet.
const evm = { provider: {} as any } as any;

describe('SigningService.signAndSend', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects a call to a non-allowlisted contract (derived from the call, not a caller summary)', async () => {
    const evil = ethers.Wallet.createRandom().address;
    const call: EvmCall = { to: evil, data: erc20.encodeFunctionData('approve', [POOL, 1n]) };
    const row = {
      pubkey: ethers.Wallet.createRandom().address, status: 'active', encryptedPrivkey: 'x', dataKeyWrapped: 'y',
      policyJson: { allowedProgramIds: [USDC, POOL, ATOKEN], allowedDestinations: [POOL] },
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
      policyJson: { allowedProgramIds: [USDC, POOL, ATOKEN], allowedDestinations: [POOL] },
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
      policyJson: { allowedProgramIds: [USDC], allowedDestinations: [POOL] },
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

  it('signs + sends a valid aave-supply call: decrypts the key, broadcasts, wipes, records subwallet.sign', async () => {
    const subKey = ethers.Wallet.createRandom();
    const call: EvmCall = { to: POOL, data: pool.encodeFunctionData('supply', [USDC, 100n, subKey.address, 0]) };
    const secret = Buffer.from(subKey.privateKey.slice(2), 'hex');
    const row = {
      pubkey: subKey.address, status: 'active', encryptedPrivkey: 'x', dataKeyWrapped: 'y',
      policyJson: { allowedProgramIds: [USDC, POOL, ATOKEN], allowedDestinations: [POOL] },
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
