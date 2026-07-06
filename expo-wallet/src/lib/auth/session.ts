import { NavyClient } from '../api/navyClient';
import { TokenStore } from './tokenStore';
import { NavySession } from './types';

export class SessionManager {
  constructor(
    private readonly client: NavyClient,
    private readonly store: TokenStore,
  ) {}

  /** Exchange a Privy access token for Navy tokens and persist them. */
  async establish(privyAccessToken: string): Promise<NavySession> {
    const tokens = await this.client.exchangePrivyToken(privyAccessToken);
    await this.store.save(tokens);
    return { tokens };
  }

  /** Rehydrate a session from secure storage, or null if none. */
  async restore(): Promise<NavySession | null> {
    const tokens = await this.store.load();
    return tokens ? { tokens } : null;
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}
