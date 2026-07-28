import { Injectable } from '@nestjs/common';
import { PrivyClient } from '@privy-io/server-auth';
import { NavyConfigService } from '../config/config.service';

// SDK API found in @privy-io/server-auth@1.32.5:
// - PrivyClient constructor: (appId, appSecret, options?: { walletApi?: { authorizationPrivateKey?: string } })
// - verifyAuthToken(token): Promise<AuthTokenClaims> where AuthTokenClaims has { userId }
// - getUser(userId): Promise<User> where User has { linkedAccounts: Array<LinkedAccountWithMetadata> }
// - A wallet linked account has { id?, address, chainType: 'ethereum'|'solana', delegated? }

export interface VerifiedPrivyUser { userId: string; wallet?: string }

@Injectable()
export class PrivyService {
  private client: PrivyClient;

  constructor(private readonly cfg: NavyConfigService) {
    const authKey = cfg.privyAuthorizationKey;
    this.client = authKey
      ? new PrivyClient(cfg.privyAppId, cfg.privyAppSecret, { walletApi: { authorizationPrivateKey: authKey } })
      : new PrivyClient(cfg.privyAppId, cfg.privyAppSecret);
  }

  async verifyAccessToken(token: string): Promise<VerifiedPrivyUser> {
    const claims = await this.client.verifyAuthToken(token);
    const user = await this.client.getUser(claims.userId);
    const wallet = user.linkedAccounts.find(
      (a) => a.type === 'wallet' && (a as any).chainType === 'ethereum',
    ) as any;
    return { userId: claims.userId, wallet: wallet?.address };
  }
}
