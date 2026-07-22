export class UsernameClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  ) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.authedFetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`username ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }

  me() {
    return this.json<{ id: string; walletAddress: string | null; username: string | null }>(
      '/user/account/me',
    );
  }

  checkAvailable(u: string) {
    return this.json<{ available: boolean }>(
      `/user/account/username/available?u=${encodeURIComponent(u)}`,
    );
  }

  setUsername(username: string) {
    return this.json<{ username: string }>('/user/account/username', {
      method: 'PUT',
      body: JSON.stringify({ username }),
    });
  }

  clearUsername() {
    return this.json<{ username: null }>('/user/account/username', { method: 'DELETE' });
  }
}
