import { Injectable, Logger } from '@nestjs/common';
import { PrivyClient } from '@privy-io/server-auth';
import { NavyConfigService } from '../config/config.service';

// SDK API found in @privy-io/server-auth@1.32.5:
// - PrivyClient constructor: (appId, appSecret, options?: { walletApi?: { authorizationPrivateKey?: string } })
// - verifyAuthToken(token): Promise<AuthTokenClaims> where AuthTokenClaims has { userId }
// - getUser(userId): Promise<User> where User has { linkedAccounts: Array<LinkedAccountWithMetadata> }
// - A wallet linked account has { id?, address, chainType: 'ethereum'|'solana', delegated? }
// - walletApi.ethereum.sendTransaction(input): Promise<{ hash, caip2 }>
//     input = (walletId | {address, chainType:'ethereum'}) & { transaction: {to,data,value,...},
//              caip2: `eip155:<chainId>`, sponsor?, idempotencyKey? }
//   The delegated wallet is msg.sender and Privy broadcasts the tx directly.

export interface VerifiedPrivyUser { userId: string; wallet?: string }

@Injectable()
export class PrivyService {
  private readonly logger = new Logger(PrivyService.name);
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

  /** The user's delegated (session-signer-enabled) EVM embedded wallet, or null. */
  async getDelegatedWallet(privyDid: string): Promise<{ walletId?: string; address: string } | null> {
    const user = await this.client.getUser(privyDid);
    const w = user.linkedAccounts.find(
      (a) => a.type === 'wallet' && (a as any).chainType === 'ethereum' && (a as any).delegated === true,
    ) as any;
    if (!w?.address) return null;
    return { walletId: w.id ?? undefined, address: w.address };
  }

  /**
   * Broadcast a server-built EVM tx from the user's delegated embedded wallet.
   * The delegated wallet is msg.sender; Privy signs AND submits (returns the tx hash).
   * Requires the walletApi authorization key.
   */
  async sendDelegatedTransaction(args: {
    walletId?: string;
    address: string;
    to: string;
    data?: string;
    value?: bigint;
    chainId: number;
    idempotencyKey?: string;
  }): Promise<{ hash: string }> {
    if (!this.cfg.privyAuthorizationKey) throw new Error('Delegated signing not configured');
    if (!args.walletId) {
      this.logger.warn(`Delegated send using deprecated address fallback (no walletId) for address ${args.address}`);
    }
    const target = args.walletId
      ? { walletId: args.walletId }
      : { address: args.address, chainType: 'ethereum' as const };
    const transaction: Record<string, unknown> = { to: args.to };
    if (args.data) transaction.data = args.data;
    if (args.value !== undefined) transaction.value = '0x' + args.value.toString(16);
    const { hash } = await this.client.walletApi.ethereum.sendTransaction({
      ...target,
      caip2: `eip155:${args.chainId}` as const,
      transaction,
      idempotencyKey: args.idempotencyKey,
    } as any);
    return { hash };
  }
}
