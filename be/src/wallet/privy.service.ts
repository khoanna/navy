import { Injectable } from '@nestjs/common';
import { PrivyClient } from '@privy-io/server-auth';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { NavyConfigService } from '../config/config.service';

// SDK API found in @privy-io/server-auth@1.32.5:
// - PrivyClient constructor: (appId: string, appSecret: string, options?: { walletApi?: { authorizationPrivateKey?: string } })
// - verifyAuthToken(token: string): Promise<AuthTokenClaims> where AuthTokenClaims has { userId: string; ... }
// - getUser(userId: string): Promise<User> where User has { linkedAccounts: Array<LinkedAccountWithMetadata> }
// - Wallet interface has: id?: string | null, address: string, chainType: ChainType, delegated?: boolean
// - walletApi.solana.signTransaction(input: SolanaSignTransactionInputType): Promise<{ signedTransaction: Transaction | VersionedTransaction }>
//   where SolanaSignTransactionInputType = (walletId | {address, chainType:'solana'}) & { transaction, idempotencyKey? }

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
    const solana = user.linkedAccounts.find(
      (a) => a.type === 'wallet' && (a as any).chainType === 'solana',
    ) as any;
    return { userId: claims.userId, wallet: solana?.address };
  }

  /** The user's delegated (session-signer-enabled) Solana embedded wallet, or null. */
  async getDelegatedWallet(privyDid: string): Promise<{ walletId?: string; address: string } | null> {
    const user = await this.client.getUser(privyDid);
    const w = user.linkedAccounts.find(
      (a) => a.type === 'wallet' && (a as any).chainType === 'solana' && (a as any).delegated === true,
    ) as any;
    if (!w?.address) return null;
    return { walletId: w.id ?? undefined, address: w.address };
  }

  /** Sign a server-built tx on the user's delegated embedded wallet. Requires the auth key. */
  async signDelegatedTransaction(args: {
    walletId?: string;
    address: string;
    tx: Transaction;
    idempotencyKey?: string;
  }): Promise<Transaction> {
    if (!this.cfg.privyAuthorizationKey) throw new Error('Delegated signing not configured');
    const target = args.walletId
      ? { walletId: args.walletId }
      : { address: args.address, chainType: 'solana' as const };
    const { signedTransaction } = await this.client.walletApi.solana.signTransaction({
      ...target,
      transaction: args.tx,
      idempotencyKey: args.idempotencyKey,
    } as any);
    if (signedTransaction instanceof Transaction) return signedTransaction;
    return Transaction.from((signedTransaction as VersionedTransaction).serialize());
  }
}
