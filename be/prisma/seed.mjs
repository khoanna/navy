// Prisma seed — idempotent fixed dev accounts (admin + merchant).
// Run:  DATABASE_URL=... pnpm prisma db seed        (or: node prisma/seed.mjs)
// Loads be/.env so a bare `node prisma/seed.mjs` works; the credentials it
// creates are documented in docs/SEED_ACCOUNTS.md.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ── fixed credentials (dev only — NEVER seed these in production) ─────────────
const ADMIN = {
  email: 'admin@navy.test',
  password: 'adminpassword123',
  // Fixed base32 secret so a TOTP app (or `authenticator.generate`) yields
  // deterministic, reproducible codes across seeds/machines.
  totpSecret: 'JBSWY3DPEHPK3PXP',
};
const MERCHANT = {
  email: 'merchant@navy.test',
  password: 'merchantpw123',
  businessName: 'Navy Seed Bakery',
  // Approved + payout set so the fe merchant dashboard is usable immediately.
  // NOTE: this does NOT register the merchant on-chain (that happens via the
  // admin approve endpoint → EvmRegistrarService); on-chain payments need it.
  payoutAddress: '0x0000000000000000000000000000000000000001',
};

async function seedAdmin() {
  const passwordHash = await argon2.hash(ADMIN.password);
  await prisma.admin.upsert({
    where: { email: ADMIN.email },
    update: { passwordHash, totpSecret: ADMIN.totpSecret, failedTotpCount: 0, failedPasswordCount: 0, lockedUntil: null, lastTotpStep: null },
    create: { email: ADMIN.email, passwordHash, totpSecret: ADMIN.totpSecret },
  });
}

async function seedMerchant() {
  const passwordHash = await argon2.hash(MERCHANT.password);
  await prisma.merchant.upsert({
    where: { email: MERCHANT.email },
    update: { passwordHash, businessName: MERCHANT.businessName, approvalStatus: 'approved', payoutAddress: MERCHANT.payoutAddress },
    create: { email: MERCHANT.email, passwordHash, businessName: MERCHANT.businessName, approvalStatus: 'approved', payoutAddress: MERCHANT.payoutAddress },
  });
}

await seedAdmin();
await seedMerchant();

console.log('✓ Seeded fixed accounts:');
console.log(`  admin    : ${ADMIN.email} / ${ADMIN.password}  (TOTP now: ${authenticator.generate(ADMIN.totpSecret)})`);
console.log(`  merchant : ${MERCHANT.email} / ${MERCHANT.password}  (approved)`);

await prisma.$disconnect();
