const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Parse `navy://pay/<uuid>` or `https://<host>/pay/<uuid>` into the order id. */
export function parsePayUrl(url: string): string {
  if (!url.startsWith('navy://') && !url.includes('/pay/')) throw new Error('Not a Navy invoice');
  const m = url.match(/(?:navy:\/\/pay\/|\/pay\/)([^/?#]+)/);
  if (!m) throw new Error('Not a Navy invoice');
  const id = m[1];
  if (!UUID.test(id)) throw new Error('Invalid invoice id');
  return id;
}
