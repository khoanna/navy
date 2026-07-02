import { NavyTokens } from './types';

export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const KEY = 'navy.tokens';

export class TokenStore {
  constructor(private readonly backend: SecureBackend) {}

  async save(tokens: NavyTokens): Promise<void> {
    await this.backend.setItemAsync(KEY, JSON.stringify(tokens));
  }

  async load(): Promise<NavyTokens | null> {
    const raw = await this.backend.getItemAsync(KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<NavyTokens>;
      if (!parsed.accessToken || !parsed.refreshToken) return null;
      return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await this.backend.deleteItemAsync(KEY);
  }
}

// Browser localStorage backend. SSR-safe: no-ops when window is undefined.
export function localStorageBackend(): SecureBackend {
  const ls = (): Storage | null => (typeof window !== 'undefined' ? window.localStorage : null);
  return {
    getItemAsync: async (k) => ls()?.getItem(k) ?? null,
    setItemAsync: async (k, v) => { ls()?.setItem(k, v); },
    deleteItemAsync: async (k) => { ls()?.removeItem(k); },
  };
}
