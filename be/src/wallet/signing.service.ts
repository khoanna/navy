import { Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Keypair, Transaction } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { CIPHER } from '../crypto/cipher.interface';
import type { Cipher } from '../crypto/cipher.interface';
import { AuditService } from '../audit/audit.service';
import { PolicyValidator, SubwalletPolicy, TxSummary } from './policy.validator';

@Injectable()
export class SigningService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CIPHER) private readonly cipher: Cipher,
    private readonly policy: PolicyValidator,
    private readonly audit: AuditService,
  ) {}

  async signTransaction(subwalletId: string, tx: Transaction, summary: TxSummary): Promise<Transaction> {
    const row = await this.prisma.farmingSubwallet.findUnique({ where: { id: subwalletId } });
    if (!row || row.status !== 'active') throw new NotFoundException('Subwallet not available');

    // Derive authoritative program ids FROM the transaction itself — never trust caller-provided programIds.
    const programIds = tx.instructions.map((ix) => ix.programId.toBase58());
    // SECURITY TODO (farming phase): derive transferDestinations by decoding SystemProgram/SPL-token
    // transfer instructions from tx instead of trusting the caller.
    const authoritativeSummary: TxSummary = { programIds, transferDestinations: summary.transferDestinations };
    const verdict = this.policy.check(row.policyJson as unknown as SubwalletPolicy, authoritativeSummary);
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
