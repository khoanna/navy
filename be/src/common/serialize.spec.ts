import { toMerchantDto, toOrderDto, toFarmingEventDto } from './serialize';

describe('toMerchantDto', () => {
  const raw = {
    id: 'm1',
    email: 'a@b.com',
    passwordHash: 'SECRET_HASH',
    totpSecret: 'SECRET_TOTP',
    businessName: 'Acme',
    approvalStatus: 'approved',
    payoutAddress: 'PubKey111',
    onchainRegisteredAt: new Date('2026-01-01'),
    onchainRegisterTx: 'sig',
    rejectionReason: null,
    createdAt: new Date('2026-01-01'),
  };

  it('omits passwordHash and totpSecret', () => {
    const dto = toMerchantDto(raw) as Record<string, unknown>;
    expect(dto).not.toHaveProperty('passwordHash');
    expect(dto).not.toHaveProperty('totpSecret');
  });

  it('keeps email and businessName', () => {
    const dto = toMerchantDto(raw)!;
    expect(dto.email).toBe('a@b.com');
    expect(dto.businessName).toBe('Acme');
  });

  it('returns null for null input', () => {
    expect(toMerchantDto(null)).toBeNull();
    expect(toMerchantDto(undefined)).toBeUndefined();
  });

  it('maps each element of a list', () => {
    const out = toMerchantDto([raw, raw]) as any[];
    expect(out).toHaveLength(2);
    expect(out[0]).not.toHaveProperty('passwordHash');
  });
});

describe('toOrderDto', () => {
  const raw = {
    id: 'o1',
    merchantId: 'm1',
    reference: 'ref',
    amount: 1000000n,
    feeBps: 100,
    status: 'paid',
    txSignature: 'sig',
    payer: 'payerPk',
    expiresAt: new Date('2026-01-01'),
    paidAt: new Date('2026-01-02'),
    createdAt: new Date('2026-01-01'),
  };

  it('returns amount as a string from a BigInt input', () => {
    const dto = toOrderDto(raw)!;
    expect(dto.amount).toBe('1000000');
    expect(typeof dto.amount).toBe('string');
  });

  it('exposes orderId alias for id', () => {
    expect(toOrderDto(raw)!.orderId).toBe('o1');
  });

  it('returns null for null input', () => {
    expect(toOrderDto(null)).toBeNull();
    expect(toOrderDto(undefined)).toBeUndefined();
  });
});

describe('toFarmingEventDto', () => {
  const raw = {
    id: 'e1',
    kind: 'deposit',
    amount: 500n,
    txSignature: 'sig',
    createdAt: new Date('2026-01-01'),
  };

  it('returns amount as a string', () => {
    const dto = toFarmingEventDto(raw)!;
    expect(dto.amount).toBe('500');
    expect(typeof dto.amount).toBe('string');
  });

  it('returns null for null input', () => {
    expect(toFarmingEventDto(null)).toBeNull();
    expect(toFarmingEventDto(undefined)).toBeUndefined();
  });
});
