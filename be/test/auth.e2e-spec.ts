import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { AppModule } from '../src/app.module';

describe('Auth e2e (merchant flow)', () => {
  let app: INestApplication;
  let prisma: any;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    const { PrismaService } = require('../src/prisma/prisma.service');
    prisma = app.get(PrismaService);
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
    await prisma.merchant.update({ where: { email }, data: { approvalStatus: 'approved' } });
    const res = await request(app.getHttpServer())
      .post('/merchant/api-keys')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .expect(201);
    expect(res.body.apiKey).toMatch(/^navy_pk_/);
    expect(res.body.apiSecret).toMatch(/^navy_sk_/);
  });

  it('forbids API key creation for an unapproved merchant', async () => {
    const email = `m_${Date.now()}_pending@x.com`;
    const signup = await request(app.getHttpServer())
      .post('/auth/merchant/signup')
      .send({ email, password: 'pw123456', businessName: 'Acme' });
    await request(app.getHttpServer())
      .post('/merchant/api-keys')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .expect(403);
  });

  it('rejects API key creation without a token', async () => {
    await request(app.getHttpServer()).post('/merchant/api-keys').expect(401);
  });
});
