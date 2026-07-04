import { assertSameOrigin, isSameOrigin } from './origin-guard';

function req(url: string, headers: Record<string, string>): Request {
  return new Request(url, { method: 'POST', headers });
}

describe('isSameOrigin', () => {
  it('allows a request with no Origin header (same-origin navigation / same-site POST)', () => {
    expect(isSameOrigin(req('https://app.navy.example/api/x', {}))).toBe(true);
  });

  it('allows when Origin matches the request URL origin', () => {
    expect(
      isSameOrigin(
        req('https://app.navy.example/api/x', { origin: 'https://app.navy.example' }),
      ),
    ).toBe(true);
  });

  it('allows when Origin host matches the Host header (proxy fronting a different URL origin)', () => {
    expect(
      isSameOrigin(
        req('http://internal:3000/api/x', {
          origin: 'https://app.navy.example',
          host: 'app.navy.example',
        }),
      ),
    ).toBe(true);
  });

  it('rejects a foreign Origin', () => {
    expect(
      isSameOrigin(
        req('https://app.navy.example/api/x', { origin: 'https://evil.example' }),
      ),
    ).toBe(false);
  });

  it('rejects a malformed Origin header', () => {
    expect(
      isSameOrigin(req('https://app.navy.example/api/x', { origin: 'not-a-url' })),
    ).toBe(false);
  });
});

describe('assertSameOrigin', () => {
  it('does not throw for a matching Origin', () => {
    expect(() =>
      assertSameOrigin(
        req('https://app.navy.example/api/x', { origin: 'https://app.navy.example' }),
      ),
    ).not.toThrow();
  });

  it('does not throw when Origin is absent', () => {
    expect(() => assertSameOrigin(req('https://app.navy.example/api/x', {}))).not.toThrow();
  });

  it('throws for a foreign Origin', () => {
    expect(() =>
      assertSameOrigin(
        req('https://app.navy.example/api/x', { origin: 'https://evil.example' }),
      ),
    ).toThrow();
  });
});
