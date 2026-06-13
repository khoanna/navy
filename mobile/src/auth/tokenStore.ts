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

// Default backend bound to expo-secure-store (lazy require so Jest never loads native).
export function expoSecureBackend(): SecureBackend {
  const SecureStore = require('expo-secure-store');
  return {
    getItemAsync: SecureStore.getItemAsync,
    setItemAsync: SecureStore.setItemAsync,
    deleteItemAsync: SecureStore.deleteItemAsync,
  };
}
