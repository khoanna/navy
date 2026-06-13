import { Injectable } from '@nestjs/common';
import { PrivyClient } from '@privy-io/server-auth';
import { NavyConfigService } from '../config/config.service';

// SDK API found in @privy-io/server-auth@1.32.5:
// - PrivyClient constructor: (appId: string, appSecret: string, options?: {...})
// - verifyAuthToken(token: string): Promise<AuthTokenClaims> where AuthTokenClaims has { userId: string; ... }
// - getUser(userId: string): Promise<User> where User has { linkedAccounts: Array<LinkedAccountWithMetadata> }
// - WalletWithMetadata extends Wallet which has { address: string; chainType: ChainType }
//   ChainType includes 'solana' | 'ethereum'
//   WalletWithMetadata has type: 'wallet'

export interface VerifiedPrivyUser { userId: string; wallet?: string }

@Injectable()
export class PrivyService {
  private client: PrivyClient;
  constructor(private readonly cfg: NavyConfigService) {
    this.client = new PrivyClient(cfg.privyAppId, cfg.privyAppSecret);
  }
  async verifyAccessToken(token: string): Promise<VerifiedPrivyUser> {
    const claims = await this.client.verifyAuthToken(token);
    const user = await this.client.getUser(claims.userId);
    const solana = user.linkedAccounts.find(
      (a) => a.type === 'wallet' && (a as any).chainType === 'solana',
    ) as any;
    return { userId: claims.userId, wallet: solana?.address };
  }
}
