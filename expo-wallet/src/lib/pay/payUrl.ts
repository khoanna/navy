export const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** True if `id` is a canonical UUID (used to guard hand-typed /pay/<x> URLs). */
export function isUuid(id: string): boolean {
  return UUID.test(id);
}

/** Hosts we trust for the https invoice fallback. localhost allowed for local dev. */
const ALLOWED_HTTPS_HOSTS = new Set(['pay.navy', 'localhost', '127.0.0.1']);

/**
 * Parse a web invoice URL `https://<host>/pay/<uuid>` into the order id.
 *
 * The web-wallet is a browser app, so invoices are plain https links (scanning
 * the QR from any phone camera opens the wallet in the browser). Uses strict URL
 * parsing (not substring matching) so a foreign QR such as
 * `https://evil.com/x/pay/<uuid>` is rejected: the host must be allowlisted and
 * the path must be exactly `/pay/<uuid>`.
 */
export function parsePayUrl(raw: string): string {
  const url = raw.trim();

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Not a Navy invoice');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Not a Navy invoice');
  }
  if (!ALLOWED_HTTPS_HOSTS.has(parsed.hostname)) throw new Error('Not a Navy invoice');
  const segments = parsed.pathname.split('/').filter(Boolean); // ['pay', '<uuid>']
  if (segments.length !== 2 || segments[0] !== 'pay') throw new Error('Not a Navy invoice');
  const id = segments[1];

  if (!id || !UUID.test(id)) throw new Error('Invalid invoice id');
  return id;
}
