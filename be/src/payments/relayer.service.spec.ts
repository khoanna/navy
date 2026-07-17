import { ethers } from 'ethers';
import { ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { RelayerService } from './relayer.service';
import { buildAuthorizationTypedData, invoiceKey, merchantIdHex, invoiceIdHexFromOrderId, authorizationDigest, type UsdcDomain } from '../evm/payment-authorization';

const DOMAIN: UsdcDomain = { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };
const PAYMENTS = '0x1111111111111111111111111111111111111111';
const MERCHANT_UUID = '11111111-2222-3333-4444-555555555555';
const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeChain(balance = 10n ** 18n, payInvoice = jest.fn()) {
  return {
    provider: { getBalance: jest.fn().mockResolvedValue(balance) },
    payments: { payInvoice },
    relayer: { address: '0x9999999999999999999999999999999999999999' },
    paymentsAddress: PAYMENTS,
    usdcDomain: DOMAIN,
    treasury: '0x2222222222222222222222222222222222222222',
  } as any;
}
function makePrisma(order: any, consumeCount = 1) {
  return { order: {
    findUnique: jest.fn().mockResolvedValue(order),
    update: jest.fn().mockResolvedValue(order),
    updateMany: jest.fn().mockResolvedValue({ count: consumeCount }),
  } } as any;
}
function makeCfg(minWei = 20000000000000000n) { return { relayerMinBalanceWei: minWei } as any; }

async function signFor(wallet: ethers.HDNodeWallet, amount: bigint, expiresAt: Date) {
  const nonce = invoiceKey(merchantIdHex(MERCHANT_UUID), invoiceIdHexFromOrderId(ORDER_ID));
  const td = buildAuthorizationTypedData({ domain: DOMAIN, payer: wallet.address, to: PAYMENTS, amount, validAfter: 0, validBefore: Math.floor(expiresAt.getTime() / 1000), nonce });
  return { sig: await wallet.signTypedData(td.domain, td.types, td.message), digest: authorizationDigest(td) };
}

describe('RelayerService (EVM)', () => {
  it('buildAuthorization persists the digest as the single-use nonce + returns typed data', async () => {
    const chain = makeChain();
    const prisma = makePrisma({ id: ORDER_ID });
    const svc = new RelayerService(chain, prisma, makeCfg());
    const expiresAt = new Date(Date.now() + 600_000);
    const payer = ethers.Wallet.createRandom().address;

    const out = await svc.buildAuthorization({ id: ORDER_ID, amount: 1_000_000n, expiresAt }, merchantIdHex(MERCHANT_UUID), payer);

    expect(out.typedData.message.from).toBe(payer);
    expect(out.typedData.message.value).toBe('1000000');
    const expectedDigest = authorizationDigest(out.typedData);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { issuedTxHash: expectedDigest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null },
    });
  });

  it('buildAuthorization throws 503 when relayer ETH is below min, and does NOT persist', async () => {
    const chain = makeChain(19999999999999999n); // just under 0.02 ETH
    const prisma = makePrisma({ id: ORDER_ID });
    const svc = new RelayerService(chain, prisma, makeCfg(20000000000000000n));
    await expect(svc.buildAuthorization({ id: ORDER_ID, amount: 1_000_000n, expiresAt: new Date(Date.now() + 600_000) }, merchantIdHex(MERCHANT_UUID), '0x1234567890123456789012345678901234567890'))
      .rejects.toThrow(ServiceUnavailableException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('verifyAndSubmit happy path: recovers payer, consumes atomically before submit, returns {txHash,payer,err:null}', async () => {
    const wallet = ethers.Wallet.createRandom();
    const expiresAt = new Date(Date.now() + 600_000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, expiresAt);
    const wait = jest.fn().mockResolvedValue({ status: 1 });
    const payInvoice = jest.fn().mockResolvedValue({ hash: '0xtxhash', wait });
    const chain = makeChain(10n ** 18n, payInvoice);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null };
    const prisma = makePrisma(order);
    const svc = new RelayerService(chain, prisma, makeCfg());

    const res = await svc.verifyAndSubmit(ORDER_ID, sig, wallet.address);

    expect(res).toEqual({ txHash: '0xtxhash', payer: wallet.address, err: null });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: ORDER_ID, issuedTxConsumedAt: null }, data: { issuedTxConsumedAt: expect.any(Date) } });
    const consumeOrder = prisma.order.updateMany.mock.invocationCallOrder[0];
    const submitOrder = payInvoice.mock.invocationCallOrder[0];
    expect(consumeOrder).toBeLessThan(submitOrder);
    // payInvoice called with (merchantIdHex, invoiceIdHex, amount, validAfter, validBefore, payer, v, r, s)
    const args = payInvoice.mock.calls[0];
    expect(args[0]).toBe(merchantIdHex(MERCHANT_UUID));
    expect(args[1]).toBe(invoiceIdHexFromOrderId(ORDER_ID));
    expect(args[2]).toBe(1_000_000n);
    expect(args[5]).toBe(wallet.address);
  });

  it('verifyAndSubmit rejects when the recovered signer != expected payer', async () => {
    const wallet = ethers.Wallet.createRandom();
    const expiresAt = new Date(Date.now() + 600_000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, expiresAt);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null };
    const svc = new RelayerService(makeChain(), makePrisma(order), makeCfg());
    await expect(svc.verifyAndSubmit(ORDER_ID, sig, '0x0000000000000000000000000000000000000001')).rejects.toThrow(/signature/i);
  });

  it('verifyAndSubmit rejects a concurrent second submit (atomic consume count 0) without submitting', async () => {
    const wallet = ethers.Wallet.createRandom();
    const expiresAt = new Date(Date.now() + 600_000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, expiresAt);
    const payInvoice = jest.fn();
    const chain = makeChain(10n ** 18n, payInvoice);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null };
    const prisma = makePrisma(order, 0);
    const svc = new RelayerService(chain, prisma, makeCfg());
    await expect(svc.verifyAndSubmit(ORDER_ID, sig, wallet.address)).rejects.toThrow(/already submitted/i);
    expect(payInvoice).not.toHaveBeenCalled();
  });

  it('verifyAndSubmit rejects an expired issued authorization', async () => {
    const wallet = ethers.Wallet.createRandom();
    const past = new Date(Date.now() - 1000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, past);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: past, issuedTxConsumedAt: null };
    const svc = new RelayerService(makeChain(), makePrisma(order), makeCfg());
    await expect(svc.verifyAndSubmit(ORDER_ID, sig, wallet.address)).rejects.toThrow(/expired/i);
  });

  it('verifyAndSubmit maps a reverted receipt to err', async () => {
    const wallet = ethers.Wallet.createRandom();
    const expiresAt = new Date(Date.now() + 600_000);
    const { sig, digest } = await signFor(wallet, 1_000_000n, expiresAt);
    const payInvoice = jest.fn().mockResolvedValue({ hash: '0xrevert', wait: jest.fn().mockResolvedValue({ status: 0 }) });
    const chain = makeChain(10n ** 18n, payInvoice);
    const order = { id: ORDER_ID, merchantId: MERCHANT_UUID, amount: 1_000_000n, issuedTxHash: digest, issuedTxExpiresAt: expiresAt, issuedTxConsumedAt: null };
    const svc = new RelayerService(chain, makePrisma(order), makeCfg());
    const res = await svc.verifyAndSubmit(ORDER_ID, sig, wallet.address);
    expect(res.txHash).toBe('0xrevert');
    expect(res.err).toBeTruthy();
  });
});
