import { Inject, Injectable } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { CIPHER } from '../crypto/cipher.interface';
import type { Cipher } from '../crypto/cipher.interface';
import { AuditService } from '../audit/audit.service';
import { SubwalletPolicy } from './policy.validator';

@Injectable()
export class SubwalletService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CIPHER) private readonly cipher: Cipher,
    private readonly audit: AuditService,
  ) {}

  async provision(userId: string, policy: SubwalletPolicy) {
    const kp = Keypair.generate();
    const sealed = await this.cipher.seal(Buffer.from(kp.secretKey));
    const row = await this.prisma.farmingSubwallet.create({
      data: {
        userId,
        pubkey: kp.publicKey.toBase58(),
        encryptedPrivkey: sealed.encryptedPrivkey,
        dataKeyWrapped: sealed.dataKeyWrapped,
        policyJson: policy as any,
      },
    });
    await this.audit.record({ actor: `user:${userId}`, action: 'subwallet.provision', target: row.pubkey });
    return { id: row.id, pubkey: row.pubkey };
  }
}
