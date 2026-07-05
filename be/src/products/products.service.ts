import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateProductInput { name: string; sku?: string | null; unitPrice: bigint; }
export interface UpdateProductInput { name?: string; sku?: string | null; unitPrice?: bigint; active?: boolean; }

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(p: any) {
    return { id: p.id, name: p.name, sku: p.sku ?? null, unitPrice: p.unitPrice.toString(), active: p.active };
  }

  async listForMerchant(merchantId: string) {
    const rows = await this.prisma.product.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((p) => this.serialize(p));
  }

  async create(merchantId: string, input: CreateProductInput) {
    const p = await this.prisma.product.create({
      data: { merchantId, name: input.name, sku: input.sku ?? null, unitPrice: input.unitPrice },
    });
    return this.serialize(p);
  }

  private async own(merchantId: string, id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, merchantId } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async update(merchantId: string, id: string, input: UpdateProductInput) {
    await this.own(merchantId, id);
    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.sku !== undefined) data.sku = input.sku;
    if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice;
    if (input.active !== undefined) data.active = input.active;
    const p = await this.prisma.product.update({ where: { id }, data });
    return this.serialize(p);
  }

  async archive(merchantId: string, id: string) {
    await this.own(merchantId, id);
    const p = await this.prisma.product.update({ where: { id }, data: { active: false } });
    return this.serialize(p);
  }
}
