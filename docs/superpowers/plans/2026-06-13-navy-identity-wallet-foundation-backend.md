# Navy Identity & Wallet Foundation — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Nest.js backend that authenticates three identity sources (Privy users, password+TOTP admins, email/password merchants) into a unified Navy JWT, and provisions Navy-generated farming subwallets with envelope-encrypted keys behind a `Cipher` interface.

**Architecture:** A modular Nest.js API over PostgreSQL (Prisma). Each identity source authenticates natively, the backend verifies once and issues a short-lived role-bearing Navy JWT. A `CipherService` (AES-256-GCM envelope encryption, master secret from env) and an isolated `SigningService` (keypair gen + pre-sign policy) provide the farming-subwallet plumbing. Everything privileged is written to an append-only audit log.

**Tech Stack:** Nest.js 11 · TypeScript · Prisma + PostgreSQL 16 (Docker) · `@privy-io/server-auth` · `@nestjs/jwt` · `argon2` · `otplib` · `@solana/web3.js` · `tweetnacl` · Jest.

**Scope:** This plan is **Plan 1 of 3** for the foundation (Backend). Plan 2 = Mobile auth (Expo+Privy), Plan 3 = Web auth (Next.js admin+merchant). It implements the backend half of spec `docs/superpowers/specs/2026-06-13-navy-identity-wallet-foundation-design.md`.

---

## File Structure

All paths under `/home/khoa/Desktop/uni/be/`.

```
be/
├── docker-compose.yml              # local Postgres
├── .env.example / .env             # config + secrets
├── prisma/
│   └── schema.prisma               # all entities (§5 of spec)
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── config.module.ts
│   │   └── config.service.ts       # NETWORK→RPC/Privy/programIds resolution
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── crypto/
│   │   ├── cipher.interface.ts     # Cipher abstraction (KMS-swappable)
│   │   ├── cipher.service.ts       # AES-256-GCM envelope, env master key
│   │   └── cipher.service.spec.ts
│   ├── audit/
│   │   ├── audit.module.ts
│   │   └── audit.service.ts
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── navy-token.service.ts   # issue/verify/refresh Navy JWT
│   │   ├── navy-token.service.spec.ts
│   │   ├── jwt.guard.ts            # validates Navy access token
│   │   ├── roles.guard.ts         # @Roles() RBAC
│   │   ├── roles.decorator.ts
│   │   └── dto/
│   ├── user/
│   │   ├── user.module.ts
│   │   ├── user.service.ts         # upsert by Privy DID
│   │   ├── user.controller.ts      # POST /auth/privy
│   │   └── user.controller.spec.ts
│   ├── admin/
│   │   ├── admin.module.ts
│   │   ├── admin.service.ts        # Argon2 + TOTP + lockout
│   │   ├── admin.controller.ts     # POST /auth/admin
│   │   └── admin.service.spec.ts
│   ├── merchant/
│   │   ├── merchant.module.ts
│   │   ├── merchant.service.ts     # signup/login, API keys, payout addr
│   │   ├── merchant.controller.ts  # /auth/merchant, /merchant/api-keys, /merchant/payout
│   │   ├── api-key.service.ts      # HMAC key gen/verify
│   │   └── api-key.service.spec.ts
│   ├── wallet/
│   │   ├── wallet.module.ts
│   │   ├── privy.service.ts        # verify Privy access tokens (JWKS)
│   │   ├── subwallet.service.ts    # generate keypair, encrypt, store
│   │   ├── subwallet.service.spec.ts
│   │   ├── signing.service.ts      # isolated decrypt→policy→sign
│   │   ├── policy.validator.ts     # pre-sign policy checks
│   │   └── policy.validator.spec.ts
│   └── common/
│       └── solana.util.ts          # connection factory from config
└── test/
    └── auth.e2e-spec.ts            # 3 auth flows end-to-end
```

Each file has one responsibility. `CipherService` is the only place envelope crypto lives; `SigningService` is the only place a subwallet plaintext key ever materializes.

---

## Conventions for every task

- Test runner: `pnpm test <pattern>` (Jest, configured in Task 1).
- Commit after each task with the message shown in its final step.
- Run from `/home/khoa/Desktop/uni/be`.

---

### Task 1: Scaffold Nest.js project, Postgres, tooling

**Files:**
- Create: `be/package.json`, `be/tsconfig.json`, `be/nest-cli.json`, `be/jest.config.js`, `be/docker-compose.yml`, `be/.env.example`, `be/.env`, `be/.gitignore`, `be/src/main.ts`, `be/src/app.module.ts`

- [ ] **Step 1: Scaffold the Nest app**

```bash
cd /home/khoa/Desktop/uni
pnpm dlx @nestjs/cli@latest new be --package-manager pnpm --skip-git
cd be
pnpm add @nestjs/config @nestjs/jwt @prisma/client argon2 otplib @privy-io/server-auth @solana/web3.js tweetnacl bs58
pnpm add -D prisma @types/node
```

- [ ] **Step 2: Create `be/docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: navy
      POSTGRES_PASSWORD: navy
      POSTGRES_DB: navy
    ports:
      - "5432:5432"
    volumes:
      - navy_pg:/var/lib/postgresql/data
volumes:
  navy_pg:
```

- [ ] **Step 3: Create `be/.env.example` and copy to `.env`**

```bash
# .env.example
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://navy:navy@localhost:5432/navy?schema=public
NETWORK=devnet
SOLANA_RPC_DEVNET=https://api.devnet.solana.com
SOLANA_RPC_MAINNET=https://api.mainnet-beta.solana.com
PRIVY_APP_ID=replace_me
PRIVY_APP_SECRET=replace_me
NAVY_JWT_SECRET=dev_only_change_me_32+_chars_long_secret
NAVY_JWT_ACCESS_TTL=900
NAVY_JWT_REFRESH_TTL=2592000
# 32-byte hex master key for AES-256-GCM envelope encryption (dev only; KMS in prod)
SUBWALLET_MASTER_KEY=0000000000000000000000000000000000000000000000000000000000000000
ADMIN_MAX_TOTP_FAILS=5
```

Run: `cp .env.example .env`

- [ ] **Step 4: Add `.gitignore` entries**

Append to `be/.gitignore`: `.env`, `node_modules`, `dist`.

- [ ] **Step 5: Configure Jest in `be/jest.config.js`**

```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
};
```

- [ ] **Step 6: Start Postgres and verify the app boots**

Run: `docker compose up -d && pnpm start` (Ctrl-C after it prints `Nest application successfully started`).
Expected: Postgres container running; Nest boots with no errors.

- [ ] **Step 7: Commit**

```bash
cd /home/khoa/Desktop/uni
git add be
git commit -m "chore(be): scaffold Nest.js, Postgres, tooling"
```

---

### Task 2: ConfigService (network/RPC/Privy resolution)

**Files:**
- Create: `be/src/config/config.module.ts`, `be/src/config/config.service.ts`, `be/src/config/config.service.spec.ts`

- [ ] **Step 1: Write the failing test** — `be/src/config/config.service.spec.ts`

```ts
import { NavyConfigService } from './config.service';

describe('NavyConfigService', () => {
  const base = {
    NETWORK: 'devnet',
    SOLANA_RPC_DEVNET: 'https://api.devnet.solana.com',
    SOLANA_RPC_MAINNET: 'https://api.mainnet-beta.solana.com',
    NAVY_JWT_SECRET: 'x'.repeat(32),
    NAVY_JWT_ACCESS_TTL: '900',
    NAVY_JWT_REFRESH_TTL: '2592000',
    SUBWALLET_MASTER_KEY: '00'.repeat(32),
    PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret',
    ADMIN_MAX_TOTP_FAILS: '5',
  };

  it('resolves the devnet RPC url from NETWORK', () => {
    const c = new NavyConfigService(base as any);
    expect(c.rpcUrl).toBe('https://api.devnet.solana.com');
    expect(c.network).toBe('devnet');
  });

  it('resolves the mainnet RPC url when NETWORK=mainnet', () => {
    const c = new NavyConfigService({ ...base, NETWORK: 'mainnet' } as any);
    expect(c.rpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });

  it('throws if the master key is not 32 bytes hex', () => {
    expect(() => new NavyConfigService({ ...base, SUBWALLET_MASTER_KEY: 'abcd' } as any))
      .toThrow(/SUBWALLET_MASTER_KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test config.service`
Expected: FAIL — cannot find `./config.service`.

- [ ] **Step 3: Implement `be/src/config/config.service.ts`**

```ts
import { Injectable } from '@nestjs/common';

export type Network = 'devnet' | 'mainnet';

@Injectable()
export class NavyConfigService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    if (!/^[0-9a-fA-F]{64}$/.test(this.req('SUBWALLET_MASTER_KEY'))) {
      throw new Error('SUBWALLET_MASTER_KEY must be 32 bytes (64 hex chars)');
    }
  }
  private req(k: string): string {
    const v = this.env[k];
    if (!v) throw new Error(`Missing required env var: ${k}`);
    return v;
  }
  get network(): Network { return this.req('NETWORK') as Network; }
  get rpcUrl(): string {
    return this.network === 'mainnet'
      ? this.req('SOLANA_RPC_MAINNET')
      : this.req('SOLANA_RPC_DEVNET');
  }
  get jwtSecret(): string { return this.req('NAVY_JWT_SECRET'); }
  get accessTtl(): number { return parseInt(this.req('NAVY_JWT_ACCESS_TTL'), 10); }
  get refreshTtl(): number { return parseInt(this.req('NAVY_JWT_REFRESH_TTL'), 10); }
  get masterKey(): Buffer { return Buffer.from(this.req('SUBWALLET_MASTER_KEY'), 'hex'); }
  get privyAppId(): string { return this.req('PRIVY_APP_ID'); }
  get privyAppSecret(): string { return this.req('PRIVY_APP_SECRET'); }
  get adminMaxTotpFails(): number { return parseInt(this.req('ADMIN_MAX_TOTP_FAILS'), 10); }
}
```

- [ ] **Step 4: Implement `be/src/config/config.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { NavyConfigService } from './config.service';

@Global()
@Module({
  providers: [{ provide: NavyConfigService, useFactory: () => new NavyConfigService(process.env) }],
  exports: [NavyConfigService],
})
export class NavyConfigModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test config.service`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add be/src/config
git commit -m "feat(be): network/secret-aware ConfigService"
```

---

### Task 3: Prisma schema + migration

**Files:**
- Create: `be/prisma/schema.prisma`, `be/src/prisma/prisma.service.ts`, `be/src/prisma/prisma.module.ts`

- [ ] **Step 1: Write `be/prisma/schema.prisma`** (mirrors spec §5)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id            String   @id @default(uuid())
  privyDid      String   @unique
  primaryWallet String?
  status        String   @default("active")
  createdAt     DateTime @default(now())
  subwallets    FarmingSubwallet[]
}

model Merchant {
  id             String   @id @default(uuid())
  email          String   @unique
  passwordHash   String
  businessName   String
  approvalStatus String   @default("pending") // pending|approved|rejected
  payoutAddress  String?
  createdAt      DateTime @default(now())
  apiKeys        MerchantApiKey[]
}

model MerchantApiKey {
  id         String   @id @default(uuid())
  merchantId String
  merchant   Merchant @relation(fields: [merchantId], references: [id])
  apiKey     String   @unique
  secretHash String
  status     String   @default("active") // active|revoked
  createdAt  DateTime @default(now())
}

model Admin {
  id              String @id @default(uuid())
  email           String @unique
  passwordHash    String
  totpSecret      String
  failedTotpCount Int    @default(0)
}

model FarmingSubwallet {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  pubkey          String   @unique
  encryptedPrivkey String  // base64 AES-256-GCM ciphertext (iv:tag:ct)
  dataKeyWrapped  String   // base64 wrapped per-subwallet data key
  policyJson      Json
  status          String   @default("active") // active|disabled
  createdAt       DateTime @default(now())
}

model AuthSession {
  id               String   @id @default(uuid())
  subjectId        String
  role             String   // user|merchant|admin
  refreshTokenHash String
  expiresAt        DateTime
  createdAt        DateTime @default(now())
}

model AuditLog {
  id        String   @id @default(uuid())
  actor     String
  action    String
  target    String?
  metadata  Json?
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: Generate client and run the migration**

Run:
```bash
cd /home/khoa/Desktop/uni/be
pnpm prisma migrate dev --name init
```
Expected: migration applied; `@prisma/client` generated; tables created.

- [ ] **Step 3: Implement `be/src/prisma/prisma.service.ts`**

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() { await this.$connect(); }
}
```

- [ ] **Step 4: Implement `be/src/prisma/prisma.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

- [ ] **Step 5: Verify the client compiles**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add be/prisma be/src/prisma
git commit -m "feat(be): Prisma schema and migration for identity/wallet entities"
```

---

### Task 4: CipherService (AES-256-GCM envelope encryption)

**Files:**
- Create: `be/src/crypto/cipher.interface.ts`, `be/src/crypto/cipher.service.ts`, `be/src/crypto/cipher.service.spec.ts`, `be/src/crypto/crypto.module.ts`

- [ ] **Step 1: Write `be/src/crypto/cipher.interface.ts`** (the KMS-swappable abstraction)

```ts
export interface SealedSecret {
  encryptedPrivkey: string; // base64 iv:tag:ciphertext
  dataKeyWrapped: string;   // base64 iv:tag:wrappedDataKey
}

export interface Cipher {
  /** Encrypt plaintext under a fresh per-secret data key, wrapped by the master key. */
  seal(plaintext: Buffer): Promise<SealedSecret>;
  /** Reverse of seal(). */
  open(sealed: SealedSecret): Promise<Buffer>;
}

export const CIPHER = Symbol('CIPHER');
```

- [ ] **Step 2: Write the failing test** — `be/src/crypto/cipher.service.spec.ts`

```ts
import { EnvelopeCipherService } from './cipher.service';

const masterKey = Buffer.alloc(32, 7);

describe('EnvelopeCipherService', () => {
  const cipher = new EnvelopeCipherService(masterKey);

  it('round-trips plaintext through seal/open', async () => {
    const secret = Buffer.from('a-solana-secret-key-bytes');
    const sealed = await cipher.seal(secret);
    expect(sealed.encryptedPrivkey).toEqual(expect.any(String));
    expect(sealed.dataKeyWrapped).toEqual(expect.any(String));
    const opened = await cipher.open(sealed);
    expect(opened.equals(secret)).toBe(true);
  });

  it('produces a different data key per seal (envelope)', async () => {
    const a = await cipher.seal(Buffer.from('x'));
    const b = await cipher.seal(Buffer.from('x'));
    expect(a.dataKeyWrapped).not.toEqual(b.dataKeyWrapped);
    expect(a.encryptedPrivkey).not.toEqual(b.encryptedPrivkey);
  });

  it('fails to open if the ciphertext is tampered (GCM auth)', async () => {
    const sealed = await cipher.seal(Buffer.from('secret'));
    const bad = { ...sealed, encryptedPrivkey: Buffer.from('00'.repeat(40), 'hex').toString('base64') };
    await expect(cipher.open(bad)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test cipher.service`
Expected: FAIL — cannot find `./cipher.service`.

- [ ] **Step 4: Implement `be/src/crypto/cipher.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { Cipher, SealedSecret } from './cipher.interface';

// Format per blob: base64( iv(12) || tag(16) || ciphertext )
function enc(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function dec(key: Buffer, blob: string): Buffer {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

@Injectable()
export class EnvelopeCipherService implements Cipher {
  constructor(private readonly masterKey: Buffer) {}

  async seal(plaintext: Buffer): Promise<SealedSecret> {
    const dataKey = randomBytes(32);
    const encryptedPrivkey = enc(dataKey, plaintext);
    const dataKeyWrapped = enc(this.masterKey, dataKey);
    return { encryptedPrivkey, dataKeyWrapped };
  }

  async open(sealed: SealedSecret): Promise<Buffer> {
    const dataKey = dec(this.masterKey, sealed.dataKeyWrapped);
    return dec(dataKey, sealed.encryptedPrivkey);
  }
}
```

- [ ] **Step 5: Implement `be/src/crypto/crypto.module.ts`** (wires master key from config; KMS swap point)

```ts
import { Global, Module } from '@nestjs/common';
import { NavyConfigService } from '../config/config.service';
import { CIPHER } from './cipher.interface';
import { EnvelopeCipherService } from './cipher.service';

@Global()
@Module({
  providers: [{
    provide: CIPHER,
    inject: [NavyConfigService],
    useFactory: (cfg: NavyConfigService) => new EnvelopeCipherService(cfg.masterKey),
  }],
  exports: [CIPHER],
})
export class CryptoModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test cipher.service`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add be/src/crypto
git commit -m "feat(be): AES-256-GCM envelope CipherService behind swappable interface"
```

---

### Task 5: AuditService

**Files:**
- Create: `be/src/audit/audit.service.ts`, `be/src/audit/audit.module.ts`, `be/src/audit/audit.service.spec.ts`

- [ ] **Step 1: Write the failing test** — `be/src/audit/audit.service.spec.ts`

```ts
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('writes an append-only audit record', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'a1' });
    const prisma = { auditLog: { create } } as any;
    const audit = new AuditService(prisma);
    await audit.record({ actor: 'user:1', action: 'subwallet.sign', target: 'pk', metadata: { ok: true } });
    expect(create).toHaveBeenCalledWith({
      data: { actor: 'user:1', action: 'subwallet.sign', target: 'pk', metadata: { ok: true } },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test audit.service`
Expected: FAIL — cannot find `./audit.service`.

- [ ] **Step 3: Implement `be/src/audit/audit.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  async record(e: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: { actor: e.actor, action: e.action, target: e.target ?? null, metadata: e.metadata ?? null } as any,
    });
  }
}
```

- [ ] **Step 4: Implement `be/src/audit/audit.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test audit.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add be/src/audit
git commit -m "feat(be): append-only AuditService"
```

---

### Task 6: NavyTokenService + guards (unified JWT)

**Files:**
- Create: `be/src/auth/navy-token.service.ts`, `be/src/auth/navy-token.service.spec.ts`, `be/src/auth/jwt.guard.ts`, `be/src/auth/roles.decorator.ts`, `be/src/auth/roles.guard.ts`, `be/src/auth/auth.module.ts`

- [ ] **Step 1: Write the failing test** — `be/src/auth/navy-token.service.spec.ts`

```ts
import { JwtService } from '@nestjs/jwt';
import { NavyTokenService } from './navy-token.service';

const cfg = { jwtSecret: 'k'.repeat(32), accessTtl: 900, refreshTtl: 2592000 } as any;

function makeService() {
  const jwt = new JwtService({ secret: cfg.jwtSecret });
  const prisma = { authSession: { create: jest.fn().mockResolvedValue({}) } } as any;
  return new NavyTokenService(jwt, cfg, prisma);
}

describe('NavyTokenService', () => {
  it('issues an access token carrying sub/role/wallet and verifies it', async () => {
    const svc = makeService();
    const { accessToken } = await svc.issue({ subjectId: 'u1', role: 'user', walletAddress: 'PK' });
    const claims = svc.verifyAccess(accessToken);
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('user');
    expect(claims.walletAddress).toBe('PK');
  });

  it('persists a hashed refresh token (never plaintext)', async () => {
    const svc = makeService();
    const create = (svc as any).prisma.authSession.create;
    const { refreshToken } = await svc.issue({ subjectId: 'm1', role: 'merchant' });
    const stored = create.mock.calls[0][0].data.refreshTokenHash;
    expect(stored).not.toBe(refreshToken);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test navy-token.service`
Expected: FAIL — cannot find `./navy-token.service`.

- [ ] **Step 3: Implement `be/src/auth/navy-token.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { NavyConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

export type Role = 'user' | 'merchant' | 'admin';
export interface NavyClaims { sub: string; role: Role; walletAddress?: string }
export interface IssueInput { subjectId: string; role: Role; walletAddress?: string }

@Injectable()
export class NavyTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly cfg: NavyConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issue(input: IssueInput): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwt.sign(
      { sub: input.subjectId, role: input.role, walletAddress: input.walletAddress },
      { secret: this.cfg.jwtSecret, expiresIn: this.cfg.accessTtl },
    );
    const refreshToken = randomBytes(32).toString('hex');
    await this.prisma.authSession.create({
      data: {
        subjectId: input.subjectId,
        role: input.role,
        refreshTokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + this.cfg.refreshTtl * 1000),
      },
    });
    return { accessToken, refreshToken };
  }

  verifyAccess(token: string): NavyClaims {
    return this.jwt.verify<NavyClaims>(token, { secret: this.cfg.jwtSecret });
  }

  private hash(t: string): string { return createHash('sha256').update(t).digest('hex'); }
}
```

- [ ] **Step 4: Implement guards and decorator**

`be/src/auth/jwt.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { NavyTokenService } from './navy-token.service';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly tokens: NavyTokenService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    try { req.user = this.tokens.verifyAccess(token); return true; }
    catch { throw new UnauthorizedException('Invalid Navy token'); }
  }
}
```

`be/src/auth/roles.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
import { Role } from './navy-token.service';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

`be/src/auth/roles.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { Role } from './navy-token.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const { user } = ctx.switchToHttp().getRequest();
    if (!user || !required.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
```

- [ ] **Step 5: Implement `be/src/auth/auth.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NavyConfigService } from '../config/config.service';
import { NavyTokenService } from './navy-token.service';
import { JwtGuard } from './jwt.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  imports: [JwtModule.registerAsync({
    inject: [NavyConfigService],
    useFactory: (cfg: NavyConfigService) => ({ secret: cfg.jwtSecret }),
  })],
  providers: [NavyTokenService, JwtGuard, RolesGuard],
  exports: [NavyTokenService, JwtGuard, RolesGuard],
})
export class AuthModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test navy-token.service`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add be/src/auth
git commit -m "feat(be): unified Navy JWT service, JWT + roles guards"
```

---

### Task 7: PrivyService + user auth (`POST /auth/privy`)

**Files:**
- Create: `be/src/wallet/privy.service.ts`, `be/src/user/user.service.ts`, `be/src/user/user.controller.ts`, `be/src/user/user.controller.spec.ts`, `be/src/user/user.module.ts`

- [ ] **Step 1: Write the failing test** — `be/src/user/user.controller.spec.ts`

```ts
import { UserController } from './user.controller';

describe('UserController POST /auth/privy', () => {
  it('verifies the Privy token, upserts the user, returns a Navy JWT', async () => {
    const privy = { verifyAccessToken: jest.fn().mockResolvedValue({ userId: 'did:privy:abc', wallet: 'PK' }) };
    const users = { upsertByDid: jest.fn().mockResolvedValue({ id: 'u1', primaryWallet: 'PK' }) };
    const tokens = { issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) };
    const audit = { record: jest.fn() };
    const ctrl = new UserController(privy as any, users as any, tokens as any, audit as any);

    const res = await ctrl.loginWithPrivy({ accessToken: 'privy-token' });

    expect(privy.verifyAccessToken).toHaveBeenCalledWith('privy-token');
    expect(users.upsertByDid).toHaveBeenCalledWith('did:privy:abc', 'PK');
    expect(tokens.issue).toHaveBeenCalledWith({ subjectId: 'u1', role: 'user', walletAddress: 'PK' });
    expect(res).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('rejects an invalid Privy token with 401', async () => {
    const privy = { verifyAccessToken: jest.fn().mockRejectedValue(new Error('bad')) };
    const ctrl = new UserController(privy as any, {} as any, {} as any, { record: jest.fn() } as any);
    await expect(ctrl.loginWithPrivy({ accessToken: 'x' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test user.controller`
Expected: FAIL — cannot find `./user.controller`.

- [ ] **Step 3: Implement `be/src/wallet/privy.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrivyClient } from '@privy-io/server-auth';
import { NavyConfigService } from '../config/config.service';

export interface VerifiedPrivyUser { userId: string; wallet?: string }

@Injectable()
export class PrivyService {
  private client: PrivyClient;
  constructor(private readonly cfg: NavyConfigService) {
    this.client = new PrivyClient(cfg.privyAppId, cfg.privyAppSecret);
  }
  async verifyAccessToken(token: string): Promise<VerifiedPrivyUser> {
    const claims = await this.client.verifyAuthToken(token);
    const user = await this.client.getUser(claims.userId);
    const solana = user.linkedAccounts.find(
      (a: any) => a.type === 'wallet' && a.chainType === 'solana',
    ) as any;
    return { userId: claims.userId, wallet: solana?.address };
  }
}
```

> Note: `@privy-io/server-auth` API names (`verifyAuthToken`, `getUser`, `linkedAccounts`) — confirm against the installed version's types during Step 6 and adjust if the SDK differs. The controller test mocks this service, so SDK shape changes don't affect the unit test.

- [ ] **Step 4: Implement `be/src/user/user.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}
  upsertByDid(privyDid: string, primaryWallet?: string) {
    return this.prisma.user.upsert({
      where: { privyDid },
      create: { privyDid, primaryWallet: primaryWallet ?? null },
      update: { primaryWallet: primaryWallet ?? undefined },
    });
  }
}
```

- [ ] **Step 5: Implement `be/src/user/user.controller.ts`**

```ts
import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { PrivyService } from '../wallet/privy.service';
import { UserService } from './user.service';
import { NavyTokenService } from '../auth/navy-token.service';
import { AuditService } from '../audit/audit.service';

class PrivyLoginDto { accessToken!: string; }

@Controller('auth')
export class UserController {
  constructor(
    private readonly privy: PrivyService,
    private readonly users: UserService,
    private readonly tokens: NavyTokenService,
    private readonly audit: AuditService,
  ) {}

  @Post('privy')
  async loginWithPrivy(@Body() dto: PrivyLoginDto) {
    let verified;
    try { verified = await this.privy.verifyAccessToken(dto.accessToken); }
    catch { throw new UnauthorizedException('Invalid Privy token'); }
    const user = await this.users.upsertByDid(verified.userId, verified.wallet);
    await this.audit.record({ actor: `user:${user.id}`, action: 'auth.privy.login' });
    return this.tokens.issue({ subjectId: user.id, role: 'user', walletAddress: user.primaryWallet ?? undefined });
  }
}
```

- [ ] **Step 6: Implement `be/src/user/user.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrivyService } from '../wallet/privy.service';
import { NavyConfigService } from '../config/config.service';

@Module({
  controllers: [UserController],
  providers: [UserService, PrivyService, NavyConfigService],
})
export class UserModule {}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test user.controller`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add be/src/user be/src/wallet/privy.service.ts
git commit -m "feat(be): Privy token verification and user auth endpoint"
```

---

### Task 8: Admin auth (Argon2 + TOTP + lockout)

**Files:**
- Create: `be/src/admin/admin.service.ts`, `be/src/admin/admin.service.spec.ts`, `be/src/admin/admin.controller.ts`, `be/src/admin/admin.module.ts`

- [ ] **Step 1: Write the failing test** — `be/src/admin/admin.service.spec.ts`

```ts
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { AdminService } from './admin.service';

const cfg = { adminMaxTotpFails: 3 } as any;

describe('AdminService.login', () => {
  it('returns the admin when password + TOTP are valid', async () => {
    const totpSecret = authenticator.generateSecret();
    const admin = {
      id: 'ad1', email: 'a@x.com',
      passwordHash: await argon2.hash('pw'), totpSecret, failedTotpCount: 0,
    };
    const prisma = {
      admin: { findUnique: jest.fn().mockResolvedValue(admin), update: jest.fn().mockResolvedValue(admin) },
    } as any;
    const svc = new AdminService(prisma, cfg);
    const result = await svc.login('a@x.com', 'pw', authenticator.generate(totpSecret));
    expect(result.id).toBe('ad1');
  });

  it('increments failedTotpCount and rejects a bad TOTP', async () => {
    const admin = {
      id: 'ad1', email: 'a@x.com',
      passwordHash: await argon2.hash('pw'), totpSecret: authenticator.generateSecret(), failedTotpCount: 0,
    };
    const update = jest.fn().mockResolvedValue(admin);
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update } } as any;
    const svc = new AdminService(prisma, cfg);
    await expect(svc.login('a@x.com', 'pw', '000000')).rejects.toThrow(/TOTP/);
    expect(update).toHaveBeenCalledWith({ where: { id: 'ad1' }, data: { failedTotpCount: 1 } });
  });

  it('locks the account once failedTotpCount reaches the max', async () => {
    const admin = {
      id: 'ad1', email: 'a@x.com',
      passwordHash: await argon2.hash('pw'), totpSecret: authenticator.generateSecret(), failedTotpCount: 3,
    };
    const prisma = { admin: { findUnique: jest.fn().mockResolvedValue(admin), update: jest.fn() } } as any;
    const svc = new AdminService(prisma, cfg);
    await expect(svc.login('a@x.com', 'pw', '000000')).rejects.toThrow(/locked/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test admin.service`
Expected: FAIL — cannot find `./admin.service`.

- [ ] **Step 3: Implement `be/src/admin/admin.service.ts`**

```ts
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly cfg: NavyConfigService) {}

  async login(email: string, password: string, totp: string) {
    const admin = await this.prisma.admin.findUnique({ where: { email } });
    if (!admin) throw new UnauthorizedException('Invalid credentials');
    if (admin.failedTotpCount >= this.cfg.adminMaxTotpFails) throw new ForbiddenException('Account locked');
    if (!(await argon2.verify(admin.passwordHash, password))) throw new UnauthorizedException('Invalid credentials');
    if (!authenticator.check(totp, admin.totpSecret)) {
      await this.prisma.admin.update({ where: { id: admin.id }, data: { failedTotpCount: admin.failedTotpCount + 1 } });
      throw new UnauthorizedException('Invalid TOTP');
    }
    if (admin.failedTotpCount > 0) {
      await this.prisma.admin.update({ where: { id: admin.id }, data: { failedTotpCount: 0 } });
    }
    return admin;
  }
}
```

- [ ] **Step 4: Implement `be/src/admin/admin.controller.ts`**

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { AdminService } from './admin.service';
import { NavyTokenService } from '../auth/navy-token.service';
import { AuditService } from '../audit/audit.service';

class AdminLoginDto { email!: string; password!: string; totp!: string; }

@Controller('auth')
export class AdminController {
  constructor(
    private readonly admins: AdminService,
    private readonly tokens: NavyTokenService,
    private readonly audit: AuditService,
  ) {}

  @Post('admin')
  async login(@Body() dto: AdminLoginDto) {
    const admin = await this.admins.login(dto.email, dto.password, dto.totp);
    await this.audit.record({ actor: `admin:${admin.id}`, action: 'auth.admin.login' });
    return this.tokens.issue({ subjectId: admin.id, role: 'admin' });
  }
}
```

- [ ] **Step 5: Implement `be/src/admin/admin.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({ controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test admin.service`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add be/src/admin
git commit -m "feat(be): admin auth with Argon2, TOTP, and lockout"
```

---

### Task 9: Merchant API keys (HMAC gen/verify)

**Files:**
- Create: `be/src/merchant/api-key.service.ts`, `be/src/merchant/api-key.service.spec.ts`

- [ ] **Step 1: Write the failing test** — `be/src/merchant/api-key.service.spec.ts`

```ts
import { ApiKeyService } from './api-key.service';

describe('ApiKeyService', () => {
  const svc = new ApiKeyService();

  it('issues an api_key and a secret, storing only the secret hash', () => {
    const issued = svc.generate();
    expect(issued.apiKey).toMatch(/^navy_pk_[a-f0-9]{32}$/);
    expect(issued.apiSecret).toMatch(/^navy_sk_[a-f0-9]{64}$/);
    expect(issued.secretHash).not.toContain(issued.apiSecret);
    expect(issued.secretHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies an HMAC signature over a request body', () => {
    const issued = svc.generate();
    const body = JSON.stringify({ amount: 100, invoice: 'INV-1' });
    const sig = svc.sign(issued.apiSecret, body);
    expect(svc.verify(issued.apiSecret, body, sig)).toBe(true);
    expect(svc.verify(issued.apiSecret, body, 'deadbeef')).toBe(false);
  });

  it('matches a stored secretHash to the issued secret', () => {
    const issued = svc.generate();
    expect(svc.matchesHash(issued.apiSecret, issued.secretHash)).toBe(true);
    expect(svc.matchesHash('navy_sk_' + '0'.repeat(64), issued.secretHash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test api-key.service`
Expected: FAIL — cannot find `./api-key.service`.

- [ ] **Step 3: Implement `be/src/merchant/api-key.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export interface IssuedApiKey { apiKey: string; apiSecret: string; secretHash: string; }

@Injectable()
export class ApiKeyService {
  generate(): IssuedApiKey {
    const apiKey = 'navy_pk_' + randomBytes(16).toString('hex');
    const apiSecret = 'navy_sk_' + randomBytes(32).toString('hex');
    return { apiKey, apiSecret, secretHash: this.hash(apiSecret) };
  }
  sign(secret: string, body: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }
  verify(secret: string, body: string, signature: string): boolean {
    const expected = this.sign(secret, body);
    return this.safeEq(expected, signature);
  }
  matchesHash(secret: string, secretHash: string): boolean {
    return this.safeEq(this.hash(secret), secretHash);
  }
  private hash(s: string): string { return createHash('sha256').update(s).digest('hex'); }
  private safeEq(a: string, b: string): boolean {
    const ba = Buffer.from(a), bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test api-key.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/merchant/api-key.service.ts be/src/merchant/api-key.service.spec.ts
git commit -m "feat(be): merchant API-key generation and HMAC verification"
```

---

### Task 10: Merchant auth + payout address (signature-verified)

**Files:**
- Create: `be/src/merchant/merchant.service.ts`, `be/src/merchant/merchant.service.spec.ts`, `be/src/merchant/merchant.controller.ts`, `be/src/merchant/merchant.module.ts`, `be/src/common/solana.util.ts`

- [ ] **Step 1: Write `be/src/common/solana.util.ts`** (signature verification helper)

```ts
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

/** Verify that `signatureB58` over `message` was produced by `addressB58`. */
export function verifyWalletSignature(addressB58: string, message: string, signatureB58: string): boolean {
  try {
    const pubkey = new PublicKey(addressB58).toBytes();
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signatureB58),
      pubkey,
    );
  } catch { return false; }
}
```

- [ ] **Step 2: Write the failing test** — `be/src/merchant/merchant.service.spec.ts`

```ts
import * as argon2 from 'argon2';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { MerchantService } from './merchant.service';
import { ApiKeyService } from './api-key.service';

function prismaMock(merchant: any) {
  return {
    merchant: {
      findUnique: jest.fn().mockResolvedValue(merchant),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'm1', ...merchant, ...data })),
    },
    merchantApiKey: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'k1', ...data })) },
  } as any;
}

describe('MerchantService', () => {
  it('logs in with a valid email + password', async () => {
    const merchant = { id: 'm1', email: 'm@x.com', passwordHash: await argon2.hash('pw'), approvalStatus: 'approved' };
    const svc = new MerchantService(prismaMock(merchant), new ApiKeyService());
    const result = await svc.login('m@x.com', 'pw');
    expect(result.id).toBe('m1');
  });

  it('registers a payout address only with a valid wallet signature', async () => {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const message = 'Navy payout binding for m1';
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    const prisma = prismaMock({ id: 'm1' });
    const svc = new MerchantService(prisma, new ApiKeyService());
    const out = await svc.setPayoutAddress('m1', address, message, signature);
    expect(out.payoutAddress).toBe(address);
  });

  it('rejects a payout address with a bad signature', async () => {
    const kp = Keypair.generate();
    const svc = new MerchantService(prismaMock({ id: 'm1' }), new ApiKeyService());
    await expect(
      svc.setPayoutAddress('m1', kp.publicKey.toBase58(), 'msg', bs58.encode(Buffer.alloc(64))),
    ).rejects.toThrow(/signature/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test merchant.service`
Expected: FAIL — cannot find `./merchant.service`.

- [ ] **Step 4: Implement `be/src/merchant/merchant.service.ts`**

```ts
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyService } from './api-key.service';
import { verifyWalletSignature } from '../common/solana.util';

@Injectable()
export class MerchantService {
  constructor(private readonly prisma: PrismaService, private readonly apiKeys: ApiKeyService) {}

  async signup(email: string, password: string, businessName: string) {
    const passwordHash = await argon2.hash(password);
    return this.prisma.merchant.create({ data: { email, passwordHash, businessName } });
  }

  async login(email: string, password: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { email } });
    if (!merchant || !(await argon2.verify(merchant.passwordHash, password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return merchant;
  }

  async issueApiKey(merchantId: string) {
    const issued = this.apiKeys.generate();
    await this.prisma.merchantApiKey.create({
      data: { merchantId, apiKey: issued.apiKey, secretHash: issued.secretHash },
    });
    return { apiKey: issued.apiKey, apiSecret: issued.apiSecret }; // secret returned once, never stored plaintext
  }

  async setPayoutAddress(merchantId: string, address: string, message: string, signature: string) {
    if (!verifyWalletSignature(address, message, signature)) {
      throw new BadRequestException('Invalid wallet signature');
    }
    return this.prisma.merchant.update({ where: { id: merchantId }, data: { payoutAddress: address } });
  }
}
```

- [ ] **Step 5: Implement `be/src/merchant/merchant.controller.ts`**

```ts
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { NavyTokenService } from '../auth/navy-token.service';
import { AuditService } from '../audit/audit.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class SignupDto { email!: string; password!: string; businessName!: string; }
class LoginDto { email!: string; password!: string; }
class PayoutDto { address!: string; message!: string; signature!: string; }

@Controller()
export class MerchantController {
  constructor(
    private readonly merchants: MerchantService,
    private readonly tokens: NavyTokenService,
    private readonly audit: AuditService,
  ) {}

  @Post('auth/merchant/signup')
  async signup(@Body() dto: SignupDto) {
    const m = await this.merchants.signup(dto.email, dto.password, dto.businessName);
    await this.audit.record({ actor: `merchant:${m.id}`, action: 'merchant.signup' });
    return this.tokens.issue({ subjectId: m.id, role: 'merchant' });
  }

  @Post('auth/merchant')
  async login(@Body() dto: LoginDto) {
    const m = await this.merchants.login(dto.email, dto.password);
    return this.tokens.issue({ subjectId: m.id, role: 'merchant' });
  }

  @Post('merchant/api-keys')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('merchant')
  async createApiKey(@Req() req: any) {
    const out = await this.merchants.issueApiKey(req.user.sub);
    await this.audit.record({ actor: `merchant:${req.user.sub}`, action: 'merchant.apikey.create' });
    return out;
  }

  @Post('merchant/payout')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('merchant')
  async setPayout(@Req() req: any, @Body() dto: PayoutDto) {
    const m = await this.merchants.setPayoutAddress(req.user.sub, dto.address, dto.message, dto.signature);
    await this.audit.record({ actor: `merchant:${req.user.sub}`, action: 'merchant.payout.set', target: dto.address });
    return { payoutAddress: m.payoutAddress };
  }
}
```

- [ ] **Step 6: Implement `be/src/merchant/merchant.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { MerchantController } from './merchant.controller';
import { ApiKeyService } from './api-key.service';

@Module({ controllers: [MerchantController], providers: [MerchantService, ApiKeyService] })
export class MerchantModule {}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test merchant.service`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add be/src/merchant be/src/common/solana.util.ts
git commit -m "feat(be): merchant auth, API-key issuance, signature-verified payout address"
```

---

### Task 11: Pre-sign PolicyValidator

**Files:**
- Create: `be/src/wallet/policy.validator.ts`, `be/src/wallet/policy.validator.spec.ts`

- [ ] **Step 1: Write the failing test** — `be/src/wallet/policy.validator.spec.ts`

```ts
import { PolicyValidator, SubwalletPolicy } from './policy.validator';

const policy: SubwalletPolicy = {
  allowedProgramIds: ['Prog1111111111111111111111111111111111111111'],
  ownerMainWallet: 'Owner111111111111111111111111111111111111111',
};

describe('PolicyValidator', () => {
  const v = new PolicyValidator();

  it('allows an instruction to a whitelisted program', () => {
    expect(v.check(policy, {
      programIds: ['Prog1111111111111111111111111111111111111111'],
      transferDestinations: [],
    })).toEqual({ ok: true });
  });

  it('rejects an instruction to a non-whitelisted program', () => {
    const r = v.check(policy, { programIds: ['Evil11111111111111111111111111111111111111'], transferDestinations: [] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/program/);
  });

  it('rejects a transfer to any address other than the owner main wallet', () => {
    const r = v.check(policy, {
      programIds: ['Prog1111111111111111111111111111111111111111'],
      transferDestinations: ['Attacker11111111111111111111111111111111111'],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/destination/);
  });

  it('allows a transfer back to the owner main wallet', () => {
    expect(v.check(policy, {
      programIds: ['Prog1111111111111111111111111111111111111111'],
      transferDestinations: ['Owner111111111111111111111111111111111111111'],
    })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test policy.validator`
Expected: FAIL — cannot find `./policy.validator`.

- [ ] **Step 3: Implement `be/src/wallet/policy.validator.ts`**

```ts
import { Injectable } from '@nestjs/common';

export interface SubwalletPolicy {
  allowedProgramIds: string[];
  ownerMainWallet: string;
}
export interface TxSummary {
  programIds: string[];
  transferDestinations: string[];
}
export type PolicyResult = { ok: true } | { ok: false; reason: string };

@Injectable()
export class PolicyValidator {
  check(policy: SubwalletPolicy, tx: TxSummary): PolicyResult {
    for (const pid of tx.programIds) {
      if (!policy.allowedProgramIds.includes(pid)) {
        return { ok: false, reason: `program not allowlisted: ${pid}` };
      }
    }
    for (const dest of tx.transferDestinations) {
      if (dest !== policy.ownerMainWallet) {
        return { ok: false, reason: `transfer destination not allowed: ${dest}` };
      }
    }
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test policy.validator`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add be/src/wallet/policy.validator.ts be/src/wallet/policy.validator.spec.ts
git commit -m "feat(be): pre-sign policy validator (allowlisted programs, owner-only transfers)"
```

---

### Task 12: SubwalletService + isolated SigningService

**Files:**
- Create: `be/src/wallet/subwallet.service.ts`, `be/src/wallet/subwallet.service.spec.ts`, `be/src/wallet/signing.service.ts`, `be/src/wallet/wallet.module.ts`

- [ ] **Step 1: Write the failing test** — `be/src/wallet/subwallet.service.spec.ts`

```ts
import { Keypair } from '@solana/web3.js';
import { EnvelopeCipherService } from '../crypto/cipher.service';
import { SubwalletService } from './subwallet.service';

const cipher = new EnvelopeCipherService(Buffer.alloc(32, 9));

describe('SubwalletService', () => {
  it('generates a keypair, seals the secret, stores ciphertext (never plaintext)', async () => {
    const created: any = {};
    const prisma = { farmingSubwallet: { create: jest.fn().mockImplementation(({ data }) => {
      Object.assign(created, data); return Promise.resolve({ id: 's1', ...data });
    }) } } as any;
    const audit = { record: jest.fn() } as any;
    const svc = new SubwalletService(prisma, cipher, audit);

    const policy = { allowedProgramIds: ['P'], ownerMainWallet: 'OWNER' };
    const result = await svc.provision('u1', policy);

    expect(result.pubkey).toEqual(expect.any(String));
    // stored ciphertext must not contain the raw secret bytes
    expect(created.encryptedPrivkey).toEqual(expect.any(String));
    expect(created.dataKeyWrapped).toEqual(expect.any(String));
    expect(created).not.toHaveProperty('privkey');
    // the stored sealed secret must decrypt back to a valid 64-byte keypair secret
    const opened = await cipher.open({ encryptedPrivkey: created.encryptedPrivkey, dataKeyWrapped: created.dataKeyWrapped });
    expect(opened.length).toBe(64);
    expect(Keypair.fromSecretKey(opened).publicKey.toBase58()).toBe(result.pubkey);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test subwallet.service`
Expected: FAIL — cannot find `./subwallet.service`.

- [ ] **Step 3: Implement `be/src/wallet/subwallet.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { CIPHER, Cipher } from '../crypto/cipher.interface';
import { AuditService } from '../audit/audit.service';
import { SubwalletPolicy } from './policy.validator';

@Injectable()
export class SubwalletService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CIPHER) private readonly cipher: Cipher,
    private readonly audit: AuditService,
  ) {}

  async provision(userId: string, policy: SubwalletPolicy) {
    const kp = Keypair.generate();
    const sealed = await this.cipher.seal(Buffer.from(kp.secretKey));
    const row = await this.prisma.farmingSubwallet.create({
      data: {
        userId,
        pubkey: kp.publicKey.toBase58(),
        encryptedPrivkey: sealed.encryptedPrivkey,
        dataKeyWrapped: sealed.dataKeyWrapped,
        policyJson: policy as any,
      },
    });
    await this.audit.record({ actor: `user:${userId}`, action: 'subwallet.provision', target: row.pubkey });
    return { id: row.id, pubkey: row.pubkey };
  }
}
```

- [ ] **Step 4: Implement `be/src/wallet/signing.service.ts`** (isolated decrypt → policy → sign)

```ts
import { Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Keypair, Transaction } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { CIPHER, Cipher } from '../crypto/cipher.interface';
import { AuditService } from '../audit/audit.service';
import { PolicyValidator, SubwalletPolicy, TxSummary } from './policy.validator';

@Injectable()
export class SigningService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CIPHER) private readonly cipher: Cipher,
    private readonly policy: PolicyValidator,
    private readonly audit: AuditService,
  ) {}

  /** Decrypt the subwallet key transiently, enforce policy, sign, then discard the key. */
  async signTransaction(subwalletId: string, tx: Transaction, summary: TxSummary): Promise<Transaction> {
    const row = await this.prisma.farmingSubwallet.findUnique({ where: { id: subwalletId } });
    if (!row || row.status !== 'active') throw new NotFoundException('Subwallet not available');

    const verdict = this.policy.check(row.policyJson as unknown as SubwalletPolicy, summary);
    if (!verdict.ok) {
      await this.audit.record({ actor: `subwallet:${row.pubkey}`, action: 'subwallet.sign.denied', metadata: { reason: verdict.reason } });
      throw new ForbiddenException(`Policy denied: ${verdict.reason}`);
    }

    const secret = await this.cipher.open({ encryptedPrivkey: row.encryptedPrivkey, dataKeyWrapped: row.dataKeyWrapped });
    try {
      const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
      tx.partialSign(kp);
    } finally {
      secret.fill(0); // best-effort wipe of plaintext key material
    }
    await this.audit.record({ actor: `subwallet:${row.pubkey}`, action: 'subwallet.sign' });
    return tx;
  }
}
```

- [ ] **Step 5: Implement `be/src/wallet/wallet.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PrivyService } from './privy.service';
import { SubwalletService } from './subwallet.service';
import { SigningService } from './signing.service';
import { PolicyValidator } from './policy.validator';
import { NavyConfigService } from '../config/config.service';

@Module({
  providers: [PrivyService, SubwalletService, SigningService, PolicyValidator, NavyConfigService],
  exports: [SubwalletService, SigningService],
})
export class WalletModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test subwallet.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add be/src/wallet/subwallet.service.ts be/src/wallet/subwallet.service.spec.ts be/src/wallet/signing.service.ts be/src/wallet/wallet.module.ts
git commit -m "feat(be): subwallet provisioning + isolated policy-gated SigningService"
```

---

### Task 13: Wire AppModule + boot + e2e smoke

**Files:**
- Modify: `be/src/app.module.ts`
- Create: `be/test/auth.e2e-spec.ts`, `be/test/jest-e2e.json`

- [ ] **Step 1: Wire `be/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { NavyConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { AdminModule } from './admin/admin.module';
import { MerchantModule } from './merchant/merchant.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    NavyConfigModule, PrismaModule, CryptoModule, AuditModule, AuthModule,
    UserModule, AdminModule, MerchantModule, WalletModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Create `be/test/jest-e2e.json`**

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.ts$": "ts-jest" }
}
```

- [ ] **Step 3: Write `be/test/auth.e2e-spec.ts`** (merchant flow end-to-end against a real DB)

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth e2e (merchant flow)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('signs up a merchant and returns a Navy JWT', async () => {
    const email = `m_${Date.now()}@x.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/merchant/signup')
      .send({ email, password: 'pw123456', businessName: 'Acme' })
      .expect(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
  });

  it('creates an API key for the authenticated merchant', async () => {
    const email = `m_${Date.now()}_2@x.com`;
    const signup = await request(app.getHttpServer())
      .post('/auth/merchant/signup')
      .send({ email, password: 'pw123456', businessName: 'Acme' });
    const res = await request(app.getHttpServer())
      .post('/merchant/api-keys')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .expect(201);
    expect(res.body.apiKey).toMatch(/^navy_pk_/);
    expect(res.body.apiSecret).toMatch(/^navy_sk_/);
  });

  it('rejects API key creation without a token', async () => {
    await request(app.getHttpServer()).post('/merchant/api-keys').expect(401);
  });
});
```

- [ ] **Step 4: Add e2e script and supertest**

Run:
```bash
cd /home/khoa/Desktop/uni/be
pnpm add -D supertest @types/supertest
npm pkg set scripts.test:e2e="jest --config ./test/jest-e2e.json"
```

- [ ] **Step 5: Run the e2e suite against the Docker DB**

Run: `docker compose up -d && pnpm test:e2e`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full unit suite**

Run: `pnpm test`
Expected: all unit specs PASS.

- [ ] **Step 7: Commit**

```bash
git add be/src/app.module.ts be/test be/package.json
git commit -m "feat(be): wire AppModule and add auth e2e smoke tests"
```

---

## Self-Review

**Spec coverage check (spec §→ task):**
- §2 architecture / modules → Tasks 1–13 (all modules present).
- §3.1 user/Privy auth → Task 7. §3.2 merchant ZaloPay model (dashboard login + API keys + payout) → Tasks 9, 10. §3.3 admin password+TOTP+lockout → Task 8.
- §4 wallet model (main non-custodial via Privy; subwallet Navy-generated) → Tasks 7, 12.
- §5 data model → Task 3 (all entities).
- §6 security: envelope encryption behind Cipher interface → Task 4; isolated SigningService → Task 12; pre-sign policy → Task 11; audit → Task 5; hashed refresh tokens/secrets → Tasks 6, 9.
- §7 networks/config → Task 2.
- §8 error handling (token rejection, lockout, bad signature, policy denial) → Tasks 6, 8, 10, 11, 12.
- §9 testing (unit per module + e2e auth flows + security/policy-bypass tests) → every task + Task 13.

**Deferred-by-design (spec §10, correctly NOT in this plan):** payment orders/QR/settlement; merchant-approval workflow UI; farming logic; KMS migration. The `approvalStatus` field exists (Task 3) but no workflow — matches spec.

**Placeholder scan:** No TBD/TODO/"add error handling" placeholders; every code step contains complete code. The one external-SDK caveat (Privy method names, Task 7 Step 3) is explicitly flagged with a mock-isolated test so it cannot block unit progress.

**Type consistency:** `Cipher.seal/open` + `SealedSecret` (Task 4) used identically in Tasks 12. `SubwalletPolicy`/`TxSummary`/`PolicyResult` (Task 11) used in Task 12. `NavyClaims`/`Role`/`issue()` (Task 6) used in Tasks 7, 8, 10. `IssuedApiKey` (Task 9) used in Task 10. Consistent.

**Note for executor:** Tasks 7's `PrivyService` calls the real Privy SDK — its method names (`verifyAuthToken`, `getUser`, `linkedAccounts`) must be confirmed against the installed `@privy-io/server-auth` version; unit tests mock it, so confirm during the e2e/manual Privy check, not during unit runs.
