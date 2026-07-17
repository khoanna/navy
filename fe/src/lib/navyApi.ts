export interface NavyTokens { accessToken: string; refreshToken: string; }
export interface AdminCreds { email: string; password: string; totp: string; }
export interface MerchantCreds { email: string; password: string; }
export interface MerchantSignup { email: string; password: string; businessName: string; }
export interface IssuedApiKey { apiKey: string; apiSecret: string; }
export interface PayoutInput { address: string; message: string; signature: string; }

export class NavyApiError extends Error {
  // `detail` is the human-readable reason from the backend (e.g. a validation
  // message), safe to surface to the user; `message` stays the generic label.
  constructor(message: string, readonly status: number, readonly detail?: string) {
    super(message);
    this.name = 'NavyApiError';
  }
}

// Nest's ValidationPipe returns `message` as a string OR string[]; other errors
// use a plain `message` string. Flatten to one line, ignore anything else.
function extractDetail(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const m = (body as { message?: unknown }).message;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(', ') || undefined;
  return undefined;
}

export class NavyApi {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async post<T>(path: string, body: unknown, bearer?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const detail = extractDetail(await res.json().catch(() => undefined));
      throw new NavyApiError(`Navy API ${path} failed (HTTP ${res.status})`, res.status, detail);
    }
    return (await res.json()) as T;
  }

  adminLogin(c: AdminCreds): Promise<NavyTokens> { return this.post('/auth/admin', c); }
  merchantLogin(c: MerchantCreds): Promise<NavyTokens> { return this.post('/auth/merchant', c); }
  merchantSignup(c: MerchantSignup): Promise<NavyTokens> { return this.post('/auth/merchant/signup', c); }
  refresh(refreshToken: string): Promise<NavyTokens> { return this.post('/auth/refresh', { refreshToken }); }
  createApiKey(bearer: string): Promise<IssuedApiKey> { return this.post('/merchant/api-keys', {}, bearer); }
  setPayout(bearer: string, p: PayoutInput): Promise<{ payoutAddress: string }> { return this.post('/merchant/payout', p, bearer); }
  requestPayoutChallenge(bearer: string): Promise<{ challenge: string; nonce: string; expiresAt: string }> { return this.post('/merchant/payout/challenge', {}, bearer); }
}
