import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateProductInput { name: string; sku?: string | null; unitPrice: bigint; imageUrl: string; imagePublicId: string; }
export interface UpdateProductInput { name?: string; sku?: string | null; unitPrice?: bigint; active?: boolean; imageUrl?: string; imagePublicId?: string; }

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(p: any) {
    return { id: p.id, name: p.name, sku: p.sku ?? null, unitPrice: p.unitPrice.toString(), imageUrl: p.imageUrl ?? null, active: p.active };
  }

  async listForMerchant(merchantId: string) {
    const rows = await this.prisma.product.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((p) => this.serialize(p));
  }

  async create(merchantId: string, input: CreateProductInput) {
    const p = await this.prisma.product.create({
      data: {
        merchantId, name: input.name, sku: input.sku ?? null, unitPrice: input.unitPrice,
        imageUrl: input.imageUrl, imagePublicId: input.imagePublicId,
      },
    });
    return this.serialize(p);
  }

  private async own(merchantId: string, id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, merchantId } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  /** Returns the old imagePublicId when the image is being replaced, so the caller can delete the old asset. */
  async update(merchantId: string, id: string, input: UpdateProductInput): Promise<{ product: any; replacedPublicId: string | null }> {
    const existing = await this.own(merchantId, id);
    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice;
    if (input.active !== undefined) data.active = input.active;
    let replacedPublicId: string | null = null;
    if (input.imageUrl !== undefined && input.imagePublicId !== undefined) {
      data.imageUrl = input.imageUrl;
      data.imagePublicId = input.imagePublicId;
      replacedPublicId = existing.imagePublicId ?? null;
    }
    const p = await this.prisma.product.update({ where: { id }, data });
    return { product: this.serialize(p), replacedPublicId };
  }

  async archive(merchantId: string, id: string) {
    await this.own(merchantId, id);
    const p = await this.prisma.product.update({ where: { id }, data: { active: false } });
    return this.serialize(p);
  }
}
