import * as SecureStore from 'expo-secure-store';
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

// expo-secure-store already matches the SecureBackend interface 1:1.
export function secureStoreBackend(): SecureBackend {
  return {
    getItemAsync: (k) => SecureStore.getItemAsync(k),
    setItemAsync: (k, v) => SecureStore.setItemAsync(k, v),
    deleteItemAsync: (k) => SecureStore.deleteItemAsync(k),
  };
}
