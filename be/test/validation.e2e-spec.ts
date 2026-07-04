import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { AppModule } from '../src/app.module';

describe('Validation e2e', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('rejects merchant signup with a missing email (400)', async () => {
    await request(app.getHttpServer())
      .post('/auth/merchant/signup')
      .send({ password: 'pw123456', businessName: 'Acme' })
      .expect(400);
  });

  it('rejects merchant signup with an invalid email (400)', async () => {
    await request(app.getHttpServer())
      .post('/auth/merchant/signup')
      .send({ email: 'not-an-email', password: 'pw123456', businessName: 'Acme' })
      .expect(400);
  });

  it('rejects merchant signup with a too-short password (400)', async () => {
    await request(app.getHttpServer())
      .post('/auth/merchant/signup')
      .send({ email: `m_${Date.now()}@x.com`, password: 'short', businessName: 'Acme' })
      .expect(400);
  });

  it('strips unknown extra fields (whitelist) and still validates known fields', async () => {
    const email = `m_${Date.now()}_wl@x.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/merchant/signup')
      .send({ email, password: 'pw123456', businessName: 'Acme', isAdmin: true, junk: 'x' })
      .expect(201);
    // The extra fields did not break validation; a valid JWT is issued.
    expect(res.body.accessToken).toEqual(expect.any(String));
  });
});
