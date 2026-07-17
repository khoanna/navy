import { authedFetch, makeAuthedFetch, AuthedFetchOptions } from './authedFetch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function makeMockResponse(status: number, body: unknown): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Build a jest mock for `fetch` that returns a sequence of responses in order. */
function sequentialFetch(...responses: MockResponse[]): jest.Mock {
  const mock = jest.fn();
  let i = 0;
  mock.mockImplementation(() => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return Promise.resolve(r);
  });
  return mock;
}

function makeOpts(overrides?: Partial<AuthedFetchOptions>): AuthedFetchOptions & {
  onTokensMock: jest.Mock;
  onSignOutMock: jest.Mock;
} {
  const onTokensMock = jest.fn().mockResolvedValue(undefined);
  const onSignOutMock = jest.fn().mockResolvedValue(undefined);
  return {
    fetchImpl: jest.fn(),
    baseUrl: 'http://api',
    getAccessToken: () => 'access-token-1',
    getRefreshToken: () => 'refresh-token-1',
    onTokens: onTokensMock,
    onSignOut: onSignOutMock,
    onTokensMock,
    onSignOutMock,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path — 2xx on the first attempt
// ---------------------------------------------------------------------------

describe('authedFetch — happy path (2xx first attempt)', () => {
  it('attaches Authorization: Bearer <accessToken> to the request', async () => {
    const fetchImpl = sequentialFetch(makeMockResponse(200, { ok: true }));
    const opts = makeOpts({ fetchImpl });
    await authedFetch(opts, 'http://api/some/path');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api/some/path');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token-1');
  });

  it('returns the 2xx response directly without touching refresh or signOut', async () => {
    const fetchImpl = sequentialFetch(makeMockResponse(200, { data: 42 }));
    const opts = makeOpts({ fetchImpl });
    const res = await authedFetch(opts, 'http://api/data');
    expect(res.status).toBe(200);
    expect(opts.onTokensMock).not.toHaveBeenCalled();
    expect(opts.onSignOutMock).not.toHaveBeenCalled();
  });

  it('passes through non-401 error responses (e.g. 403, 500) without refreshing', async () => {
    for (const status of [403, 404, 500]) {
      const fetchImpl = sequentialFetch(makeMockResponse(status, {}));
      const opts = makeOpts({ fetchImpl });
      const res = await authedFetch(opts, 'http://api/x');
      expect(res.status).toBe(status);
      expect(opts.onTokensMock).not.toHaveBeenCalled();
      expect(opts.onSignOutMock).not.toHaveBeenCalled();
    }
  });

  it('merges caller-supplied headers with the Authorization header', async () => {
    const fetchImpl = sequentialFetch(makeMockResponse(200, {}));
    const opts = makeOpts({ fetchImpl });
    await authedFetch(opts, 'http://api/x', {
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'yes' },
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('application/json');
    expect(h['X-Custom']).toBe('yes');
    expect(h.Authorization).toBe('Bearer access-token-1');
  });

  it('overwrites any caller-supplied Authorization header with the current token', async () => {
    const fetchImpl = sequentialFetch(makeMockResponse(200, {}));
    const opts = makeOpts({ fetchImpl });
    await authedFetch(opts, 'http://api/x', {
      headers: { Authorization: 'Bearer stale-token' },
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token-1');
  });

  it('forwards method and body untouched', async () => {
    const fetchImpl = sequentialFetch(makeMockResponse(201, {}));
    const opts = makeOpts({ fetchImpl });
    await authedFetch(opts, 'http://api/resource', {
      method: 'POST',
      body: JSON.stringify({ foo: 'bar' }),
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
  });
});

// ---------------------------------------------------------------------------
// 401 → refresh → retry success
// ---------------------------------------------------------------------------

describe('authedFetch — 401 → refresh → retry success', () => {
  it('retries the original request with the new access token after a successful refresh', async () => {
    // Call 1: original request → 401
    // Call 2: POST /auth/refresh → 200 with new tokens
    // Call 3: retry original request → 200
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }),
      makeMockResponse(200, { result: 'ok' }),
    );
    const opts = makeOpts({ fetchImpl });
    const res = await authedFetch(opts, 'http://api/protected');
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('calls POST /auth/refresh with the current refresh token', async () => {
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }),
      makeMockResponse(200, {}),
    );
    const opts = makeOpts({ fetchImpl, getRefreshToken: () => 'my-refresh-token' });
    await authedFetch(opts, 'http://api/x');
    const [refreshUrl, refreshInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(refreshUrl).toBe('http://api/auth/refresh');
    expect(refreshInit.method).toBe('POST');
    expect(JSON.parse(refreshInit.body as string)).toEqual({ refreshToken: 'my-refresh-token' });
  });

  it('persists the new tokens via onTokens before retrying', async () => {
    let persistedTokens: [string, string] | null = null;
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }),
      makeMockResponse(200, {}),
    );
    const opts = makeOpts({
      fetchImpl,
      onTokens: async (a, r) => { persistedTokens = [a, r]; },
    });
    await authedFetch(opts, 'http://api/x');
    expect(persistedTokens).toEqual(['new-access', 'new-refresh']);
  });

  it('retries the original request with the new access token', async () => {
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(200, { accessToken: 'brand-new-access', refreshToken: 'brand-new-refresh' }),
      makeMockResponse(200, {}),
    );
    const opts = makeOpts({ fetchImpl });
    await authedFetch(opts, 'http://api/x');
    const [retryUrl, retryInit] = fetchImpl.mock.calls[2] as [string, RequestInit];
    expect(retryUrl).toBe('http://api/x');
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer brand-new-access');
  });

  it('does not call onSignOut when refresh succeeds', async () => {
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(200, { accessToken: 'a', refreshToken: 'r' }),
      makeMockResponse(200, {}),
    );
    const opts = makeOpts({ fetchImpl });
    await authedFetch(opts, 'http://api/x');
    expect(opts.onSignOutMock).not.toHaveBeenCalled();
  });

  it('returns the retry response (even if it is a non-200)', async () => {
    // After a successful refresh, if the retry itself returns 403, we surface it as-is.
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(200, { accessToken: 'a', refreshToken: 'r' }),
      makeMockResponse(403, { message: 'forbidden' }),
    );
    const opts = makeOpts({ fetchImpl });
    const res = await authedFetch(opts, 'http://api/x');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 401 → refresh fails → signOut
// ---------------------------------------------------------------------------

describe('authedFetch — 401 → refresh fails → signOut', () => {
  it('calls onSignOut and returns the original 401 when the refresh returns non-2xx', async () => {
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(401, { message: 'Invalid refresh token' }),
    );
    const opts = makeOpts({ fetchImpl });
    const res = await authedFetch(opts, 'http://api/x');
    expect(res.status).toBe(401);
    expect(opts.onSignOutMock).toHaveBeenCalledTimes(1);
    expect(opts.onTokensMock).not.toHaveBeenCalled();
    // Only 2 fetch calls: original + refresh (no retry)
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('calls onSignOut when the refresh endpoint is unreachable (network error)', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeMockResponse(401, {}))
      .mockRejectedValueOnce(new Error('Network error'));
    const opts = makeOpts({ fetchImpl });
    // authedFetch should not throw — it catches the network error and signs out.
    const res = await authedFetch(opts, 'http://api/x');
    expect(opts.onSignOutMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
    expect(opts.onTokensMock).not.toHaveBeenCalled();
  });

  it('calls onSignOut when the refresh response is missing tokens', async () => {
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(200, { accessToken: 'only-access' }), // missing refreshToken
    );
    const opts = makeOpts({ fetchImpl });
    const res = await authedFetch(opts, 'http://api/x');
    expect(opts.onSignOutMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it('does not retry the original request after a failed refresh', async () => {
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(500, {}), // refresh fails
    );
    const opts = makeOpts({ fetchImpl });
    await authedFetch(opts, 'http://api/x');
    // Only original + refresh attempt — no third call
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// No double-refresh loop guard
// ---------------------------------------------------------------------------

describe('authedFetch — no double-refresh loop', () => {
  it('does not refresh again if the retried request returns 401', async () => {
    // This confirms there is no recursive refresh: after one refresh cycle,
    // a 401 on the retry is returned as-is (not triggering another refresh).
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),  // original → 401
      makeMockResponse(200, { accessToken: 'a', refreshToken: 'r' }), // refresh → ok
      makeMockResponse(401, {}),  // retry → 401 (e.g. revoked session)
    );
    const opts = makeOpts({ fetchImpl });
    const res = await authedFetch(opts, 'http://api/x');
    // Total calls: original + refresh + retry = 3
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // The 401 from the retry is returned, not triggering another sign-out
    expect(res.status).toBe(401);
    // onSignOut is NOT called for the retry's 401 — only for a refresh failure
    expect(opts.onSignOutMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// makeAuthedFetch — bound helper
// ---------------------------------------------------------------------------

describe('makeAuthedFetch', () => {
  it('returns a function that calls authedFetch with the bound opts', async () => {
    const fetchImpl = sequentialFetch(makeMockResponse(200, { ok: true }));
    const opts = makeOpts({ fetchImpl });
    const fetcher = makeAuthedFetch(opts);
    const res = await fetcher('http://api/resource');
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token-1');
  });

  it('accepts optional init on individual calls', async () => {
    const fetchImpl = sequentialFetch(makeMockResponse(200, {}));
    const opts = makeOpts({ fetchImpl });
    const fetcher = makeAuthedFetch(opts);
    await fetcher('http://api/x', { method: 'DELETE' });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
  });

  it('handles the full 401→refresh→retry cycle through the bound helper', async () => {
    const fetchImpl = sequentialFetch(
      makeMockResponse(401, {}),
      makeMockResponse(200, { accessToken: 'fresh', refreshToken: 'fresh-r' }),
      makeMockResponse(200, { data: 'secret' }),
    );
    const opts = makeOpts({ fetchImpl });
    const fetcher = makeAuthedFetch(opts);
    const res = await fetcher('http://api/secret');
    expect(res.status).toBe(200);
    expect(opts.onTokensMock).toHaveBeenCalledWith('fresh', 'fresh-r');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
