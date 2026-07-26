import { orderIdToInvoiceId, invoiceIdToHex } from '../../../src/payments/invoice-id';

describe('invoice-id derivation', () => {
  it('converts a UUID to a 16-byte array', () => {
    const bytes = orderIdToInvoiceId('00112233-4455-6677-8899-aabbccddeeff');
    expect(bytes).toHaveLength(16);
    expect(Buffer.from(bytes).toString('hex')).toBe('00112233445566778899aabbccddeeff');
  });
  it('round-trips to hex', () => {
    const id = 'aabbccdd-eeff-0011-2233-445566778899';
    expect(invoiceIdToHex(orderIdToInvoiceId(id))).toBe('aabbccddeeff00112233445566778899');
  });
  it('rejects a malformed uuid', () => {
    expect(() => orderIdToInvoiceId('not-a-uuid')).toThrow(/uuid/i);
  });
});
