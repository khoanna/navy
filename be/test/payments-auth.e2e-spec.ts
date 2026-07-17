import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { AppModule } from '../src/app.module';

describe('Payments auth e2e (user JWT required)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('rejects payment-authorization without a token (401)', async () => {
    await request(app.getHttpServer())
      .get('/v1/orders/any-id/payment-authorization')
      .expect(401);
  });

  it('rejects submit without a token (401)', async () => {
    await request(app.getHttpServer())
      .post('/v1/orders/any-id/submit')
      .send({ signature: '0xdeadbeef' })
      .expect(401);
  });
});
