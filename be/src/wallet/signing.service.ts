import { Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Keypair, Transaction } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { CIPHER } from '../crypto/cipher.interface';
import type { Cipher } from '../crypto/cipher.interface';
import { AuditService } from '../audit/audit.service';
import { PolicyValidator } from './policy.validator';
import type { SubwalletPolicy } from './policy.validator';
import { deriveTxSummary } from './tx-summary';

@Injectable()
export class SigningService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CIPHER) private readonly cipher: Cipher,
    private readonly policy: PolicyValidator,
    private readonly audit: AuditService,
  ) {}

  async signTransaction(subwalletId: string, tx: Transaction): Promise<Transaction> {
    const row = await this.prisma.farmingSubwallet.findUnique({ where: { id: subwalletId } });
    if (!row || row.status !== 'active') throw new NotFoundException('Subwallet not available');

    const summary = deriveTxSummary(tx);
    const verdict = this.policy.check(row.policyJson as unknown as SubwalletPolicy, summary, { subwallet: row.pubkey });
    if (!verdict.ok) {
      await this.audit.record({ actor: `subwallet:${row.pubkey}`, action: 'subwallet.sign.denied', metadata: { reason: verdict.reason } });
      throw new ForbiddenException(`Policy denied: ${verdict.reason}`);
    }

    const secret = await this.cipher.open({ encryptedPrivkey: row.encryptedPrivkey, dataKeyWrapped: row.dataKeyWrapped });
    try {
      const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
      tx.partialSign(kp);
    } finally {
      secret.fill(0);
    }
    await this.audit.record({ actor: `subwallet:${row.pubkey}`, action: 'subwallet.sign' });
    return tx;
  }
}
