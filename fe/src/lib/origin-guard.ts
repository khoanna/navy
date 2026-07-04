// CSRF defense via the Origin header (a header the browser sets and pages
// cannot forge cross-site). Pure logic so it's unit-testable; route handlers
// call `assertSameOrigin` at the top of mutating requests.
//
// Policy: reject ONLY when a DIFFERENT origin is explicitly present. A missing
// Origin header (same-origin GET/navigation, some same-site POSTs) is allowed.
// The expected origin is derived from the request itself: the request URL's
// origin, or — for deployments behind a proxy that rewrites the URL origin —
// the `Host` header (matched against the Origin host).

export function isSameOrigin(req: Request): boolean {
  const originHeader = req.headers.get('origin');
  if (!originHeader) return true; // no Origin => not a cross-site fetch we can detect; allow

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false; // present but malformed => reject
  }

  // 1) Match against the request URL's own origin.
  try {
    if (origin.origin === new URL(req.url).origin) return true;
  } catch {
    // fall through to host check
  }

  // 2) Match the Origin host against the Host header (proxy fronting a
  //    different internal URL origin). Host has no scheme, so compare hosts.
  const host = req.headers.get('host');
  if (host && origin.host === host) return true;

  return false;
}

export class OriginError extends Error {
  constructor() {
    super('Cross-origin request rejected');
    this.name = 'OriginError';
  }
}

export function assertSameOrigin(req: Request): void {
  if (!isSameOrigin(req)) throw new OriginError();
}
