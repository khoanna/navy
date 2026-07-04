export interface NavyTokens { accessToken: string; refreshToken: string; }
export interface AdminCreds { email: string; password: string; totp: string; }
export interface MerchantCreds { email: string; password: string; }
export interface MerchantSignup { email: string; password: string; businessName: string; }
export interface IssuedApiKey { apiKey: string; apiSecret: string; }
export interface PayoutInput { address: string; message: string; signature: string; }

export class NavyApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'NavyApiError'; }
}

export class NavyApi {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async post<T>(path: string, body: unknown, bearer?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new NavyApiError(`Navy API ${path} failed (HTTP ${res.status})`, res.status);
    return (await res.json()) as T;
  }

  adminLogin(c: AdminCreds): Promise<NavyTokens> { return this.post('/auth/admin', c); }
  merchantLogin(c: MerchantCreds): Promise<NavyTokens> { return this.post('/auth/merchant', c); }
  merchantSignup(c: MerchantSignup): Promise<NavyTokens> { return this.post('/auth/merchant/signup', c); }
  refresh(refreshToken: string): Promise<NavyTokens> { return this.post('/auth/refresh', { refreshToken }); }
  createApiKey(bearer: string): Promise<IssuedApiKey> { return this.post('/merchant/api-keys', {}, bearer); }
  setPayout(bearer: string, p: PayoutInput): Promise<{ payoutAddress: string }> { return this.post('/merchant/payout', p, bearer); }
}
