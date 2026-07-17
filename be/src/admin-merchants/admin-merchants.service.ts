import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvmRegistrarService } from '../evm/evm-registrar.service';
import { merchantIdHex } from '../evm/payment-authorization';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AdminMerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrar: EvmRegistrarService,
    private readonly audit: AuditService,
  ) {}

  list(status: string, take: number, skip: number) {
    const where = status && status !== 'all' ? { approvalStatus: status } : {};
    return this.prisma.merchant.findMany({ where, take, skip, orderBy: { createdAt: 'desc' } });
  }

  get(id: string) { return this.prisma.merchant.findUnique({ where: { id } }); }

  async approve(id: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (!merchant.payoutAddress) throw new BadRequestException('Merchant must set a payout address before approval');
    let tx: string;
    try {
      tx = await this.registrar.ensureRegisteredActive({ id: merchant.id, payoutAddress: merchant.payoutAddress });
    } catch (e) {
      throw new BadGatewayException(`On-chain registration failed: ${(e as Error).message}`);
    }
    // Persist the deterministic 16-byte merchant_id (hex) that seeds the on-chain Merchant registry.
    const onchainMerchantId = merchantIdHex(merchant.id).slice(2); // strip 0x prefix for the DB column
    const updated = await this.prisma.merchant.update({
      where: { id },
      data: { approvalStatus: 'approved', onchainMerchantId, onchainRegisteredAt: new Date(), onchainRegisterTx: tx, rejectionReason: null },
    });
    await this.audit.record({ actor: 'admin', action: 'merchant.approve', target: id, metadata: { tx } });
    return updated;
  }

  async reject(id: string, reason?: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (merchant.onchainRegisteredAt) {
      try { await this.registrar.deactivate({ id: merchant.id, payoutAddress: merchant.payoutAddress! }); }
      catch (e) { throw new BadGatewayException(`On-chain deactivation failed: ${(e as Error).message}`); }
    }
    const updated = await this.prisma.merchant.update({
      where: { id },
      data: { approvalStatus: 'rejected', rejectionReason: reason ?? null },
    });
    await this.audit.record({ actor: 'admin', action: 'merchant.reject', target: id, metadata: { reason } });
    return updated;
  }
}
