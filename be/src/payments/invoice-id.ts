export function orderIdToInvoiceId(orderId: string): number[] {
  const hex = orderId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`invalid uuid: ${orderId}`);
  return Array.from(Buffer.from(hex, 'hex'));
}

export function invoiceIdToHex(invoiceId: number[]): string {
  return Buffer.from(invoiceId).toString('hex');
}
