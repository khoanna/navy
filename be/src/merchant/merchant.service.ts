import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyService } from './api-key.service';
import { verifyWalletSignature } from '../common/solana.util';
import { CIPHER } from '../crypto/cipher.interface';
import type { Cipher } from '../crypto/cipher.interface';

@Injectable()
export class MerchantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    @Inject(CIPHER) private readonly cipher: Cipher,
  ) {}

  async signup(email: string, password: string, businessName: string) {
    const passwordHash = await argon2.hash(password);
    return this.prisma.merchant.create({ data: { email, passwordHash, businessName } });
  }

  async login(email: string, password: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { email } });
    if (!merchant || !(await argon2.verify(merchant.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return merchant;
  }

  private async assertApproved(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new UnauthorizedException('Merchant not found');
    if (merchant.approvalStatus !== 'approved') throw new ForbiddenException('Merchant not approved');
    return merchant;
  }

  async issueApiKey(merchantId: string) {
    await this.assertApproved(merchantId);
    const issued = this.apiKeys.generate();
    const sealed = await this.cipher.seal(Buffer.from(issued.apiSecret, 'utf8'));
    await this.prisma.merchantApiKey.create({
      data: {
        merchantId,
        apiKey: issued.apiKey,
        secretHash: issued.secretHash,
        secretEnc: sealed.encryptedPrivkey,
        dataKeyWrapped: sealed.dataKeyWrapped,
      },
    });
    return { apiKey: issued.apiKey, apiSecret: issued.apiSecret };
  }

  async setPayoutAddress(merchantId: string, address: string, message: string, signature: string) {
    await this.assertApproved(merchantId);
    if (!verifyWalletSignature(address, message, signature)) {
      throw new BadRequestException('Invalid wallet signature');
    }
    return this.prisma.merchant.update({ where: { id: merchantId }, data: { payoutAddress: address } });
  }
}
