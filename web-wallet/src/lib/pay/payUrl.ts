const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Hosts we trust for the https invoice fallback. localhost allowed for local dev. */
const ALLOWED_HTTPS_HOSTS = new Set(['pay.navy', 'localhost', '127.0.0.1']);

/**
 * Parse `navy://pay/<uuid>` or `https://pay.navy/pay/<uuid>` into the order id.
 *
 * Uses strict URL parsing (not substring matching) so a foreign QR such as
 * `https://evil.com/x/pay/<uuid>` is rejected: the https host must be allowlisted
 * and the path must be exactly `/pay/<uuid>`.
 */
export function parsePayUrl(raw: string): string {
  const url = raw.trim();
  let id: string | undefined;

  if (url.startsWith('navy://')) {
    // navy://pay/<uuid>  -> host 'pay', path '/<uuid>'
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Not a Navy invoice');
    }
    if (parsed.host !== 'pay') throw new Error('Not a Navy invoice');
    id = parsed.pathname.replace(/^\//, '');
  } else if (url.startsWith('http://') || url.startsWith('https://')) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Not a Navy invoice');
    }
    if (!ALLOWED_HTTPS_HOSTS.has(parsed.hostname)) throw new Error('Not a Navy invoice');
    const segments = parsed.pathname.split('/').filter(Boolean); // ['pay', '<uuid>']
    if (segments.length !== 2 || segments[0] !== 'pay') throw new Error('Not a Navy invoice');
    id = segments[1];
  } else {
    throw new Error('Not a Navy invoice');
  }

  if (!id || !UUID.test(id)) throw new Error('Invalid invoice id');
  return id;
}
