import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CIPHER } from '../crypto/cipher.interface';
import type { Cipher } from '../crypto/cipher.interface';
import type { SecretLookup } from './chain-watcher.service';

@Injectable()
export class SecretLookupService implements SecretLookup {
  constructor(private readonly prisma: PrismaService, @Inject(CIPHER) private readonly cipher: Cipher) {}
  async secretForMerchant(merchantId: string): Promise<string | null> {
    // Note: filtering null secretEnc/dataKeyWrapped in code rather than prisma `NOT` clause
    // to avoid Prisma type issues with nested null filter on optional fields.
    const key = await this.prisma.merchantApiKey.findFirst({
      where: { merchantId, status: 'active' },
    });
    if (!key || !key.secretEnc || !key.dataKeyWrapped) return null;
    return (await this.cipher.open({ encryptedPrivkey: key.secretEnc, dataKeyWrapped: key.dataKeyWrapped })).toString('utf8');
  }
}
