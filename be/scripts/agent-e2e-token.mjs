// Seed two users + an AuthSession and mint a Navy user JWT for agent E2E testing.
// Usage: node scripts/agent-e2e-token.mjs   (loads be/.env)
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import jwt from '../node_modules/.pnpm/jsonwebtoken@9.0.3/node_modules/jsonwebtoken/index.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const WALLET = '0x1111111111111111111111111111111111111111';
const PAYEE_WALLET = '0x2222222222222222222222222222222222222222';

async function upsertUser(privyDid, wallet, username) {
  return prisma.user.upsert({
    where: { privyDid },
    update: { primaryWallet: wallet, username },
    create: { privyDid, primaryWallet: wallet, username, status: 'active' },
  });
}

const me = await upsertUser('did:privy:e2e-payer', WALLET, 'alice');
await upsertUser('did:privy:e2e-payee', PAYEE_WALLET, 'bob');

const session = await prisma.authSession.create({
  data: {
    subjectId: me.id,
    role: 'user',
    refreshTokenHash: 'e2e-' + Date.now(),
    walletAddress: WALLET,
    expiresAt: new Date(Date.now() + 3600_000),
  },
});

const token = jwt.sign(
  { sub: me.id, role: 'user', walletAddress: WALLET, sid: session.id },
  process.env.NAVY_JWT_SECRET,
  { expiresIn: process.env.NAVY_JWT_ACCESS_TTL ? Number(process.env.NAVY_JWT_ACCESS_TTL) : 3600 },
);

console.log(token);
await prisma.$disconnect();
