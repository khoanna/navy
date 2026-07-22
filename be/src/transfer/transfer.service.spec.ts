import { TransferService } from './transfer.service';

const USDC_DOMAIN = { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };
const bigBal = async () => 10n ** 18n;

function deps(over: any = {}) {
  const chain = {
    provider: { getBalance: jest.fn(bigBal) },
    relayer: { address: '0xrelayer' },
    usdc: { balanceOf: jest.fn(async () => 1_000000n) },
    usdcDomain: USDC_DOMAIN,
    ...over.chain,
  };
  const prisma = { transfer: { create: jest.fn(async ({ data }: any) => ({ id: 't1', ...data })) }, ...over.prisma };
  const users = { resolveUsername: jest.fn(async () => ({ username: 'linh', address: '0x000000000000000000000000000000000000dEaD' })), ...over.users };
  const cfg = { relayerMinBalanceWei: 0n, ...over.cfg };
  return { chain, prisma, users, cfg, svc: new TransferService(chain as any, prisma as any, users as any, cfg as any) };
}

describe('TransferService.buildAuthorization', () => {
  it('resolves @username to an address and persists a Transfer with a digest+nonce', async () => {
    const { svc, prisma } = deps();
    const r = await svc.buildAuthorization('u1', '0x1111111111111111111111111111111111111111', '@linh', 500000n);
    expect(r.typedData.message.to.toLowerCase()).toBe('0x000000000000000000000000000000000000dead');
    expect(r.typedData.message.value).toBe('500000');
    expect(prisma.transfer.create).toHaveBeenCalled();
  });
  it('rejects an unknown username', async () => {
    const { svc } = deps({ users: { resolveUsername: jest.fn(async () => null) } });
    await expect(svc.buildAuthorization('u1', '0x1111111111111111111111111111111111111111', '@ghost', 1n)).rejects.toThrow(/not found/i);
  });
  it('rejects self-transfer', async () => {
    const self = '0x000000000000000000000000000000000000dEaD';
    const { svc } = deps({ users: { resolveUsername: jest.fn(async () => ({ username: 'mee', address: self })) } });
    await expect(svc.buildAuthorization('u1', self, '@mee', 1n)).rejects.toThrow(/yourself/i);
  });
  it('rejects insufficient balance', async () => {
    const { svc } = deps({ chain: { provider: { getBalance: jest.fn(bigBal) }, usdc: { balanceOf: jest.fn(async () => 10n) }, relayer: { address: '0xr' }, usdcDomain: USDC_DOMAIN } });
    await expect(svc.buildAuthorization('u1', '0x1111111111111111111111111111111111111111', '@linh', 20n)).rejects.toThrow(/insufficient/i);
  });
});
