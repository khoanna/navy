/**
 * authedFetch — shared fetch helper with automatic Navy token refresh.
 *
 * Flow:
 *  1. Attach `Authorization: Bearer <accessToken>` to the outgoing request.
 *  2. If the response is 401, attempt one token refresh via `POST /auth/refresh`.
 *  3. On a successful refresh, persist the new tokens via `onTokens`, then retry
 *     the original request with the new access token.
 *  4. If the refresh itself fails (network error or non-2xx), call `onSignOut` so
 *     the session layer can clear tokens and redirect to login, then return the
 *     original 401 response (callers may handle or ignore it after sign-out).
 *
 * Design constraints:
 *  - Framework-free (no React, no Expo) so it's fully unit-testable.
 *  - Single-refresh guard: only one refresh attempt per call; the retried request
 *    is passed through regardless of its response code (prevents infinite loops).
 *  - The caller supplies `getAccessToken` / `getRefreshToken` so the latest tokens
 *    are used even if another concurrent call already refreshed them.
 */

export interface AuthedFetchOptions {
  /** Underlying fetch implementation (injected for testing). */
  fetchImpl: typeof fetch;
  /** Base URL of the Navy backend, e.g. "https://api.example.com" */
  baseUrl: string;
  /** Return the current Navy access token. Called before every request. */
  getAccessToken: () => string;
  /** Return the current Navy refresh token. Called only when a 401 is received. */
  getRefreshToken: () => string;
  /** Persist a new token pair after a successful refresh. */
  onTokens: (accessToken: string, refreshToken: string) => Promise<void> | void;
  /** Called when the refresh itself fails — the session layer should sign out. */
  onSignOut: () => Promise<void> | void;
}

/** Shape of `POST /auth/refresh` response (verified against be/src/auth/navy-token.service.ts). */
interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

/**
 * Perform a single Navy refresh request.
 * Returns the new token pair, or throws if the refresh fails.
 */
async function doRefresh(
  fetchImpl: typeof fetch,
  baseUrl: string,
  refreshToken: string,
): Promise<RefreshResponse> {
  const res = await fetchImpl(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as Partial<RefreshResponse>;
  if (!body.accessToken || !body.refreshToken) {
    throw new Error('Token refresh response missing tokens');
  }
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

/**
 * Make an authenticated fetch request, handling one auto-refresh on 401.
 *
 * @param opts      - Token getters/setters and fetch implementation.
 * @param url       - Full URL to request (already includes baseUrl).
 * @param init      - Standard RequestInit (method, headers, body, …).
 *                    The `Authorization` header is injected automatically;
 *                    any existing `Authorization` in `init.headers` is overwritten.
 * @returns The Response from the (possibly retried) request.
 */
export async function authedFetch(
  opts: AuthedFetchOptions,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const { fetchImpl, baseUrl, getAccessToken, getRefreshToken, onTokens, onSignOut } = opts;

  // Strip any caller-supplied Authorization; we always inject the current token.
  const { Authorization: _removed, authorization: _removed2, ...restHeaders } =
    (init.headers as Record<string, string> | undefined) ?? {};

  const makeInit = (token: string): RequestInit => ({
    ...init,
    headers: {
      ...restHeaders,
      Authorization: `Bearer ${token}`,
    },
  });

  // First attempt with the current access token.
  const firstResponse = await fetchImpl(url, makeInit(getAccessToken()));

  if (firstResponse.status !== 401) {
    return firstResponse;
  }

  // --- 401 path: try to refresh ---
  let newTokens: RefreshResponse;
  try {
    newTokens = await doRefresh(fetchImpl, baseUrl, getRefreshToken());
  } catch {
    // Refresh failed: sign out and surface the original 401.
    await onSignOut();
    return firstResponse;
  }

  // Persist the new tokens before retrying.
  await onTokens(newTokens.accessToken, newTokens.refreshToken);

  // Retry the original request exactly once with the new access token.
  return fetchImpl(url, makeInit(newTokens.accessToken));
}

/**
 * Create a bound version of `authedFetch` so clients don't have to pass `opts`
 * on every call.
 */
export function makeAuthedFetch(
  opts: AuthedFetchOptions,
): (url: string, init?: RequestInit) => Promise<Response> {
  return (url, init) => authedFetch(opts, url, init);
}
