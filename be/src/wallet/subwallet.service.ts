import { Inject, Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
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
    // EVM secp256k1 keypair (Solana→EVM migration). The private key is sealed by the
    // chain-agnostic Cipher; only the ciphertext is ever persisted. `pubkey` now holds
    // the checksummed EVM address (column name preserved, meaning reinterpreted).
    const wallet = ethers.Wallet.createRandom();
    const sealed = await this.cipher.seal(Buffer.from(wallet.privateKey.slice(2), 'hex'));
    const row = await this.prisma.farmingSubwallet.create({
      data: {
        userId,
        pubkey: wallet.address,
        encryptedPrivkey: sealed.encryptedPrivkey,
        dataKeyWrapped: sealed.dataKeyWrapped,
        policyJson: policy as any,
      },
    });
    await this.audit.record({ actor: `user:${userId}`, action: 'subwallet.provision', target: row.pubkey });
    return { id: row.id, pubkey: row.pubkey };
  }
}
