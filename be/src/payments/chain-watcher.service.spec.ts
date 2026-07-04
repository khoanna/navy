import { ChainWatcherService } from './chain-watcher.service';
import { orderIdToInvoiceId } from './invoice-id';

// A real UUID so orderIdToInvoiceId works for event matching.
const ORDER_ID = '00112233-4455-6677-8899-aabbccddeeff';
const INVOICE_ID = orderIdToInvoiceId(ORDER_ID); // number[16]

// Build a NAVY_ONCHAIN mock whose EventParser (backed by program.coder) is
// stubbed by intercepting connection.getTransaction + a fake parseLogs.
// We stub the EventParser at the module boundary by providing a program.coder
// that the service's EventParser will use; simpler: we mock parseLogs via a
// jest.spyOn on the EventParser prototype is brittle, so instead we let the
// service accept the parsed events through a real coder decode is impractical
// in a unit test. We therefore stub `program.coder.events` decode path by
// making the onchain mock expose a coder that decodes our synthetic log.
//
// The service uses `new EventParser(program.programId, program.coder)`.
// To keep this a pure unit test, we mock @coral-xyz/anchor's EventParser.
jest.mock('@coral-xyz/anchor', () => {
  const actual = jest.requireActual('@coral-xyz/anchor');
  return {
    ...actual,
    EventParser: jest.fn().mockImplementation(() => ({
      // parseLogs reads a JSON-encoded event array we stash in the logs.
      parseLogs: (logs: string[]) => {
        const holder = logs.find((l) => l.startsWith('EVENTS:'));
        if (!holder) return [];
        return JSON.parse(holder.slice('EVENTS:'.length)).map((e: any) => ({
          name: e.name,
          data: {
            ...e.data,
            invoiceId: e.data.invoiceId,
            payer: { toBase58: () => e.data.payer },
            amount: { toString: () => String(e.data.amount) },
            fee: { toString: () => String(e.data.fee) },
          },
        }));
      },
    })),
  };
});

function onchainMock(tx: any) {
  return {
    connection: { getTransaction: jest.fn().mockResolvedValue(tx) },
    program: { programId: {}, coder: {} },
    programId: {},
  } as any;
}

function invoicePaidLog(overrides: Partial<{ invoiceId: number[]; payer: string; amount: string; fee: string }> = {}) {
  const ev = {
    name: 'invoicePaid',
    data: {
      invoiceId: overrides.invoiceId ?? INVOICE_ID,
      payer: overrides.payer ?? 'PAYER_PUBKEY',
      amount: overrides.amount ?? '1000000',
      fee: overrides.fee ?? '5000',
    },
  };
  return 'EVENTS:' + JSON.stringify([ev]);
}

describe('ChainWatcherService', () => {
  describe('markPaid', () => {
    it('marks a confirming order paid and fires the webhook', async () => {
      const order = { id: 'o1', merchantId: 'm1', status: 'confirming', txSignature: 'sig', callbackUrl: 'https://cb', amount: 1000000n, feeBps: 100, reference: 'R1' };
      const update = jest.fn().mockResolvedValue({ ...order, status: 'paid', amount: 1000000n, feeBps: 100, reference: 'R1', paidAt: new Date() });
      const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order), update } } as any;
      const webhooks = { deliver: jest.fn().mockResolvedValue(true) } as any;
      const secrets = { secretForMerchant: jest.fn().mockResolvedValue('sk') } as any;
      const svc = new ChainWatcherService(prisma, webhooks, secrets, onchainMock(null));

      await svc.markPaid('o1', { payer: 'PK', signature: 'sig' });

      expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o1' }, data: expect.objectContaining({ status: 'paid', payer: 'PK' }) }));
      expect(webhooks.deliver).toHaveBeenCalledWith('o1', 'https://cb', 'sk', expect.objectContaining({ status: 'paid', orderId: 'o1' }));
    });

    it('uses the reconciled on-chain fee when provided', async () => {
      const order = { id: 'o1', merchantId: 'm1', status: 'confirming', txSignature: 'sig', callbackUrl: 'https://cb', amount: 1000000n, feeBps: 100, reference: 'R1' };
      const update = jest.fn().mockResolvedValue({ ...order, status: 'paid', paidAt: new Date() });
      const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order), update } } as any;
      const webhooks = { deliver: jest.fn().mockResolvedValue(true) } as any;
      const secrets = { secretForMerchant: jest.fn().mockResolvedValue('sk') } as any;
      const svc = new ChainWatcherService(prisma, webhooks, secrets, onchainMock(null));

      await svc.markPaid('o1', { payer: 'PK', signature: 'sig', fee: 4242n });

      // recomputed guess would be 1000000*100/10000 = 10000; on-chain fee is 4242
      expect(webhooks.deliver).toHaveBeenCalledWith('o1', 'https://cb', 'sk', expect.objectContaining({ fee: '4242' }));
    });

    it('is idempotent: a paid order is not re-processed', async () => {
      const prisma = { order: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', status: 'paid' }), update: jest.fn() } } as any;
      const webhooks = { deliver: jest.fn() } as any;
      const svc = new ChainWatcherService(prisma, webhooks, { secretForMerchant: jest.fn() } as any, onchainMock(null));
      await svc.markPaid('o1', { payer: 'PK', signature: 'sig' });
      expect(webhooks.deliver).not.toHaveBeenCalled();
    });
  });

  describe('confirmOrder', () => {
    it('settles to paid with the on-chain fee when a matching InvoicePaid event is present', async () => {
      const order = { id: ORDER_ID, merchantId: 'm1', status: 'confirming', txSignature: 'sig', callbackUrl: 'https://cb', amount: 1000000n, feeBps: 100, reference: 'R1' };
      const update = jest.fn().mockResolvedValue({ ...order, status: 'paid', paidAt: new Date() });
      const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order), update } } as any;
      const webhooks = { deliver: jest.fn().mockResolvedValue(true) } as any;
      const secrets = { secretForMerchant: jest.fn().mockResolvedValue('sk') } as any;
      const tx = { meta: { err: null, logMessages: ['start', invoicePaidLog({ payer: 'ONCHAIN_PAYER', fee: '5000' }), 'end'] } };
      const svc = new ChainWatcherService(prisma, webhooks, secrets, onchainMock(tx));

      await svc.confirmOrder(ORDER_ID);

      expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'paid', payer: 'ONCHAIN_PAYER' }) }));
      expect(webhooks.deliver).toHaveBeenCalledWith(ORDER_ID, 'https://cb', 'sk', expect.objectContaining({ status: 'paid', fee: '5000', payer: 'ONCHAIN_PAYER' }));
    });

    it('marks the order failed and fires no webhook when the tx reverted', async () => {
      const order = { id: ORDER_ID, merchantId: 'm1', status: 'confirming', txSignature: 'sig', callbackUrl: 'https://cb', amount: 1000000n, feeBps: 100 };
      const update = jest.fn().mockResolvedValue({});
      const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order), update } } as any;
      const webhooks = { deliver: jest.fn() } as any;
      const svc = new ChainWatcherService(prisma, webhooks, { secretForMerchant: jest.fn() } as any, onchainMock({ meta: { err: { InstructionError: [0, 'Custom'] }, logMessages: [] } }));

      await svc.confirmOrder(ORDER_ID);

      expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ORDER_ID }, data: expect.objectContaining({ status: 'failed' }) }));
      expect(webhooks.deliver).not.toHaveBeenCalled();
    });

    it('is a no-op when the tx is not yet confirmed (null)', async () => {
      const order = { id: ORDER_ID, status: 'confirming', txSignature: 'sig' };
      const update = jest.fn();
      const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order), update } } as any;
      const svc = new ChainWatcherService(prisma, { deliver: jest.fn() } as any, { secretForMerchant: jest.fn() } as any, onchainMock(null));
      await svc.confirmOrder(ORDER_ID);
      expect(update).not.toHaveBeenCalled();
    });

    it('is a no-op when the order has no txSignature', async () => {
      const order = { id: ORDER_ID, status: 'confirming', txSignature: null };
      const getTransaction = jest.fn();
      const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order), update: jest.fn() } } as any;
      const onchain = { connection: { getTransaction }, program: { programId: {}, coder: {} }, programId: {} } as any;
      const svc = new ChainWatcherService(prisma, { deliver: jest.fn() } as any, { secretForMerchant: jest.fn() } as any, onchain);
      await svc.confirmOrder(ORDER_ID);
      expect(getTransaction).not.toHaveBeenCalled();
    });

    it('does not settle when no matching InvoicePaid event is present (leaves confirming)', async () => {
      const order = { id: ORDER_ID, merchantId: 'm1', status: 'confirming', txSignature: 'sig', callbackUrl: 'https://cb', amount: 1000000n, feeBps: 100 };
      const update = jest.fn();
      const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order), update } } as any;
      const webhooks = { deliver: jest.fn() } as any;
      // event for a different invoice id
      const otherId = orderIdToInvoiceId('ffffffff-4455-6677-8899-aabbccddeeff');
      const tx = { meta: { err: null, logMessages: [invoicePaidLog({ invoiceId: otherId })] } };
      const svc = new ChainWatcherService(prisma, webhooks, { secretForMerchant: jest.fn() } as any, onchainMock(tx));

      await svc.confirmOrder(ORDER_ID);

      expect(update).not.toHaveBeenCalled();
      expect(webhooks.deliver).not.toHaveBeenCalled();
    });

    it('is idempotent: an already-paid order is not re-processed', async () => {
      const prisma = { order: { findUnique: jest.fn().mockResolvedValue({ id: ORDER_ID, status: 'paid', txSignature: 'sig' }), update: jest.fn() } } as any;
      const getTransaction = jest.fn();
      const onchain = { connection: { getTransaction }, program: { programId: {}, coder: {} }, programId: {} } as any;
      const svc = new ChainWatcherService(prisma, { deliver: jest.fn() } as any, { secretForMerchant: jest.fn() } as any, onchain);
      await svc.confirmOrder(ORDER_ID);
      expect(getTransaction).not.toHaveBeenCalled();
    });
  });

  describe('sweepConfirming', () => {
    it('calls confirmOrder for every confirming order and swallows errors', async () => {
      const orders = [{ id: 'a' }, { id: 'b' }];
      const prisma = { order: { findMany: jest.fn().mockResolvedValue(orders) } } as any;
      const svc = new ChainWatcherService(prisma, {} as any, {} as any, onchainMock(null));
      const spy = jest.spyOn(svc, 'confirmOrder').mockImplementation(async (id) => { if (id === 'a') throw new Error('boom'); });
      await svc.sweepConfirming();
      expect(spy).toHaveBeenCalledWith('a');
      expect(spy).toHaveBeenCalledWith('b');
    });
  });

  describe('expireStale', () => {
    it('expires an awaiting order past its deadline', async () => {
      const past = new Date(Date.now() - 1000);
      const update = jest.fn();
      const prisma = { order: { findMany: jest.fn().mockResolvedValue([{ id: 'o2', status: 'awaiting_payment', expiresAt: past }]), update } } as any;
      const svc = new ChainWatcherService(prisma, { deliver: jest.fn() } as any, { secretForMerchant: jest.fn() } as any, onchainMock(null));
      await svc.expireStale();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o2' }, data: { status: 'expired' } }));
    });
  });
});
