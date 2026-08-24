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

