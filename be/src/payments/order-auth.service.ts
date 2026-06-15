import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyService } from '../merchant/api-key.service';
import { CIPHER } from '../crypto/cipher.interface';
import type { Cipher } from '../crypto/cipher.interface';

@Injectable()
export class OrderAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    @Inject(CIPHER) private readonly cipher: Cipher,
  ) {}

  async verify(apiKey: string, rawBody: string, signature: string): Promise<{ merchantId: string }> {
    const key = await this.prisma.merchantApiKey.findUnique({ where: { apiKey } });
    if (!key || key.status !== 'active' || !key.secretEnc || !key.dataKeyWrapped) {
      throw new UnauthorizedException('Invalid API key');
    }
    const secret = (await this.cipher.open({
      encryptedPrivkey: key.secretEnc, dataKeyWrapped: key.dataKeyWrapped,
    })).toString('utf8');
    if (!this.apiKeys.verify(secret, rawBody, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }
    return { merchantId: key.merchantId };
  }
}
