import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyService } from './api-key.service';
import { verifyWalletSignature, isEvmAddress } from '../common/evm-signature.util';
import { CIPHER } from '../crypto/cipher.interface';
import type { Cipher } from '../crypto/cipher.interface';
import { EvmRegistrarService } from '../evm/evm-registrar.service';

@Injectable()
export class MerchantService {
  private readonly logger = new Logger(MerchantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    @Inject(CIPHER) private readonly cipher: Cipher,
    private readonly registrar: EvmRegistrarService,
  ) {}

  async signup(email: string, password: string, businessName: string) {
    // Reject duplicates with a clear 409 instead of leaking Prisma's P2002 as a
    // raw 500. `email` is @unique, so the DB is the final guard against races.
    const existing = await this.prisma.merchant.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await argon2.hash(password);
    try {
      return await this.prisma.merchant.create({ data: { email, passwordHash, businessName } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ConflictException('Email already registered');
      throw e;
    }
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

  async issuePayoutChallenge(merchantId: string) {
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const challenge = `Navy payout authorization\nmerchant: ${merchantId}\nnonce: ${nonce}\nexpires: ${expiresAt.toISOString()}`;
    await this.prisma.payoutChallenge.create({ data: { merchantId, nonce, challenge, expiresAt } });
    return { challenge, nonce, expiresAt };
  }

  async setPayoutAddress(merchantId: string, address: string, message: string, signature: string) {
    // Payout must be set BEFORE approval: approve() requires a payoutAddress to register the
    // merchant on-chain. So this only requires the merchant to exist, not to be approved.
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new UnauthorizedException('Merchant not found');

    // The payout wallet is an EVM address (0x…); reject anything else before touching the challenge.
    if (!isEvmAddress(address)) throw new BadRequestException('Payout address must be a valid EVM address');

    // The signed message MUST be a live, unconsumed challenge we issued to this merchant.
    // This binds the signature to a single-use nonce + expiry (defeats replay of any signed blob).
    const challenge = await this.prisma.payoutChallenge.findFirst({
      where: { challenge: message, merchantId, consumedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!challenge) throw new BadRequestException('No valid payout challenge; request a new one');

    if (!verifyWalletSignature(address, message, signature)) {
      throw new BadRequestException('Invalid wallet signature');
    }

    // Atomically consume the challenge so it can be used exactly once, even under concurrency.
    const consumed = await this.prisma.payoutChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Challenge already used');

    const updated = await this.prisma.merchant.update({ where: { id: merchantId }, data: { payoutAddress: address } });

    // If the merchant is already registered on-chain (approved), keep the on-chain payout in sync.
    // Best-effort: an RPC failure must NOT roll back the (authoritative) DB write — log + surface a warning.
    if (updated.approvalStatus === 'approved') {
      try {
        await this.registrar.setPayout({ id: merchantId, payoutAddress: address });
      } catch (e) {
        this.logger.warn(
          `On-chain payout sync failed for merchant ${merchantId}; DB updated but chain is stale. ${String((e as Error)?.message ?? e)}`,
        );
      }
    }

    return updated;
  }
}
