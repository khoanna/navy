import { ethers } from 'ethers';
import { ChainWatcherService } from './chain-watcher.service';
import { merchantIdHex, invoiceIdHexFromOrderId } from '../evm/payment-authorization';

const MERCHANT_UUID = '11111111-2222-3333-4444-555555555555';
const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PAYER = '0x3333333333333333333333333333333333333333';

// Real ethers Interface so parseLog behaves exactly as in production.
const iface = new ethers.Interface([
  'event InvoicePaid(bytes16 indexed merchantId, bytes16 indexed invoiceId, address indexed payer, uint256 amount, uint256 fee, uint256 paidAt)',
]);
function invoicePaidLog(amount: bigint, fee: bigint) {
  return iface.encodeEventLog('InvoicePaid', [
    merchantIdHex(MERCHANT_UUID), invoiceIdHexFromOrderId(ORDER_ID), PAYER, amount, fee, 1_700_000_000n,
  ]);
}

function makeChain(receipt: any) {
  return { provider: { getTransactionReceipt: jest.fn().mockResolvedValue(receipt) }, payments: { interface: iface } } as any;
}
function makePrisma(order: any, claimCount = 1) {
  const updated = { ...order, status: 'paid', paidAt: new Date() };
  // confirmOrder reads once, markPaid reads again (guard), then re-reads the settled row for the
  // webhook payload — so the first TWO reads must be the pre-settlement order, the third the updated row.
  return { order: {
    findUnique: jest.fn().mockResolvedValueOnce(order).mockResolvedValueOnce(order).mockResolvedValue(updated),
    update: jest.fn().mockResolvedValue(order),
    updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
  } } as any;
}
const webhooks = () => ({ deliver: jest.fn().mockResolvedValue(undefined) }) as any;
const secrets = () => ({ secretForMerchant: jest.fn().mockResolvedValue('shh') }) as any;

describe('ChainWatcherService (EVM)', () => {
  const baseOrder = { id: ORDER_ID, merchantId: MERCHANT_UUID, status: 'confirming', txSignature: '0xtx', amount: 1_000_000n, feeBps: 100, reference: 'ORD-1', callbackUrl: 'https://cb', paidAt: null };

  it('confirmOrder settles + fires webhook when the receipt has a matching InvoicePaid log', async () => {
    const log = invoicePaidLog(1_000_000n, 10_000n);
    const chain = makeChain({ status: 1, logs: [{ topics: log.topics, data: log.data }] });
    const prisma = makePrisma(baseOrder);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(prisma.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ORDER_ID, status: 'confirming' } }));
    expect(w.deliver).toHaveBeenCalled();
    const payload = w.deliver.mock.calls[0][3];
    expect(payload.payer).toBe(PAYER);
    expect(payload.fee).toBe('10000');
    expect(payload.status).toBe('paid');
  });

  it('confirmOrder marks failed (no webhook) when the receipt reverted', async () => {
    const chain = makeChain({ status: 0, logs: [] });
    const prisma = makePrisma(baseOrder);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: ORDER_ID }, data: { status: 'failed' } });
    expect(w.deliver).not.toHaveBeenCalled();
  });

  it('confirmOrder is a no-op while the receipt is not yet mined (null)', async () => {
    const chain = makeChain(null);
    const prisma = makePrisma(baseOrder);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(w.deliver).not.toHaveBeenCalled();
  });

  it('confirmOrder does not settle when no matching InvoicePaid log is present', async () => {
    const chain = makeChain({ status: 1, logs: [] });
    const prisma = makePrisma(baseOrder);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(w.deliver).not.toHaveBeenCalled();
  });

  it('confirmOrder refuses to settle when the InvoicePaid amount != the order amount', async () => {
    const log = invoicePaidLog(999_999n, 10_000n); // wrong amount vs order.amount = 1_000_000n
    const chain = makeChain({ status: 1, logs: [{ topics: log.topics, data: log.data }] });
    const prisma = makePrisma(baseOrder);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(w.deliver).not.toHaveBeenCalled();
  });

  it('markPaid loser (claim count 0) does not fire the webhook', async () => {
    const log = invoicePaidLog(1_000_000n, 10_000n);
    const chain = makeChain({ status: 1, logs: [{ topics: log.topics, data: log.data }] });
    const prisma = makePrisma(baseOrder, 0);
    const w = webhooks();
    const svc = new ChainWatcherService(prisma, w, secrets(), chain);
    await svc.confirmOrder(ORDER_ID);
    expect(w.deliver).not.toHaveBeenCalled();
  });
});
