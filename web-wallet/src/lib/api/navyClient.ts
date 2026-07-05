import { NavyTokens } from '../auth/types';

export class NavyAuthError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'NavyAuthError';
  }
}

export class NavyClient {
  constructor(
    private readonly baseUrl: string,
    // Native fetch must be invoked with `this === window`; stored as an instance
    // property and called as `this.fetchImpl(...)` it would throw "Illegal invocation".
    // Bind the default to globalThis so the production (no-arg) construction works.
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async exchangePrivyToken(privyAccessToken: string): Promise<NavyTokens> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/auth/privy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: privyAccessToken }),
      });
    } catch (e) {
      throw new NavyAuthError(`Network error contacting Navy backend: ${(e as Error).message}`);
    }
    if (!res.ok) {
      throw new NavyAuthError(`Navy auth failed (HTTP ${res.status})`, res.status);
    }
    const body = (await res.json()) as Partial<NavyTokens>;
    if (!body.accessToken || !body.refreshToken) {
      throw new NavyAuthError('Navy response missing tokens');
    }
    return { accessToken: body.accessToken, refreshToken: body.refreshToken };
  }
}
