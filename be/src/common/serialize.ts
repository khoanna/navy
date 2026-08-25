// Pure response mappers applied at controller boundaries. They (a) strip secret
// columns that must never leave the server (passwordHash, totpSecret, api-key
// secret material) and (b) stringify BigInt columns (JSON can't encode BigInt,
// so returning a raw Prisma row with a BigInt field throws at response time).
//
// Each mapper accepts null/undefined gracefully (returns the same) and maps each
// element when given an array.

function mapMaybe<T, R>(input: T | T[] | null | undefined, fn: (v: T) => R): R | R[] | null | undefined {
  if (input === null || input === undefined) return input as null | undefined;
  if (Array.isArray(input)) return input.map(fn);
  return fn(input);
}

export interface MerchantDto {
  id: string;
  email: string;
  businessName: string;
  approvalStatus: string;
  payoutAddress: string | null;
  onchainRegisteredAt: Date | null;
  onchainRegisterTx: string | null;
  rejectionReason: string | null;
  createdAt: Date;
}

export function toMerchantDto<T>(m: T): T extends null ? null : T extends undefined ? undefined : MerchantDto | MerchantDto[] {
  return mapMaybe(m as any, (v: any): MerchantDto => ({
    id: v.id,
    email: v.email,
    businessName: v.businessName,
    approvalStatus: v.approvalStatus,
    payoutAddress: v.payoutAddress ?? null,
    onchainRegisteredAt: v.onchainRegisteredAt ?? null,
    onchainRegisterTx: v.onchainRegisterTx ?? null,
    rejectionReason: v.rejectionReason ?? null,
    createdAt: v.createdAt,
  })) as any;
}

export interface OrderDto {
  id: string;
  orderId: string;
  merchantId: string;
  reference: string;
  amount: string;
  feeBps: number;
  status: string;
  txSignature: string | null;
  payer: string;
  expiresAt: Date;
  paidAt: Date | null;
  createdAt: Date;
}

export function toOrderDto<T>(o: T): T extends null ? null : T extends undefined ? undefined : OrderDto | OrderDto[] {
  return mapMaybe(o as any, (v: any): OrderDto => ({
    id: v.id,
    orderId: v.id,
    merchantId: v.merchantId,
    reference: v.reference ?? '',
    amount: String(v.amount ?? 0),
    feeBps: v.feeBps ?? 0,
    status: v.status ?? 'unknown',
    txSignature: v.txSignature ?? null,
    payer: v.payer ?? '',
    expiresAt: v.expiresAt ?? new Date(),
    paidAt: v.paidAt ?? null,
    createdAt: v.createdAt ?? new Date(),
  })) as any;
}

export interface FarmingEventDto {
  id: string;
  kind: string;
  amount: string;
  txSignature: string | null;
  createdAt: Date;
}

export function toFarmingEventDto<T>(e: T): T extends null ? null : T extends undefined ? undefined : FarmingEventDto | FarmingEventDto[] {
  return mapMaybe(e as any, (v: any): FarmingEventDto => ({
    id: v.id,
    kind: v.kind ?? 'unknown',
    amount: String(v.amount ?? 0),
    txSignature: v.txSignature ?? null,
    createdAt: v.createdAt ?? new Date(),
  })) as any;
}
