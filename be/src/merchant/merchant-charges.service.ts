import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ChargeMode = 'percent' | 'fixed';
export interface CreateChargeInput { name: string; mode: ChargeMode; value: number; sortOrder?: number; }
export interface UpdateChargeInput { name?: string; mode?: ChargeMode; value?: number; active?: boolean; sortOrder?: number; }

@Injectable()
export class MerchantChargesService {
  constructor(private readonly prisma: PrismaService) {}

  private validate(mode: ChargeMode | undefined, value: number | undefined) {
    if (mode !== undefined && mode !== 'percent' && mode !== 'fixed') throw new BadRequestException('mode must be percent or fixed');
    if (value !== undefined) {
      if (!Number.isInteger(value) || value < 0) throw new BadRequestException('value must be a non-negative integer');
      if (mode === 'percent' && value > 10000) throw new BadRequestException('percent value must be ≤ 10000 bps');
    }
  }

  private serialize(c: any) {
    return { id: c.id, name: c.name, mode: c.mode, value: c.value, active: c.active, sortOrder: c.sortOrder };
  }

  async listForMerchant(merchantId: string) {
    const rows = await this.prisma.merchantCharge.findMany({ where: { merchantId }, orderBy: { sortOrder: 'asc' } });
    return rows.map((c) => this.serialize(c));
  }

  /** Active charges in application order — used by order creation. */
  async activeForMerchant(merchantId: string) {
    return this.prisma.merchantCharge.findMany({ where: { merchantId, active: true }, orderBy: { sortOrder: 'asc' } });
  }

  async create(merchantId: string, input: CreateChargeInput) {
    this.validate(input.mode, input.value);
    const c = await this.prisma.merchantCharge.create({
      data: { merchantId, name: input.name, mode: input.mode, value: input.value, sortOrder: input.sortOrder ?? 0 },
    });
    return this.serialize(c);
  }

  private async own(merchantId: string, id: string) {
    const c = await this.prisma.merchantCharge.findFirst({ where: { id, merchantId } });
    if (!c) throw new NotFoundException('Charge not found');
    return c;
  }

  async update(merchantId: string, id: string, input: UpdateChargeInput) {
    const existing = await this.own(merchantId, id);
    this.validate(input.mode ?? (existing.mode as ChargeMode), input.value);
    const data: any = {};
    for (const k of ['name', 'mode', 'value', 'active', 'sortOrder'] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    const c = await this.prisma.merchantCharge.update({ where: { id }, data });
    return this.serialize(c);
  }

  async remove(merchantId: string, id: string) {
    await this.own(merchantId, id);
    await this.prisma.merchantCharge.delete({ where: { id } });
    return { ok: true };
  }
}
