import { HealthController } from './health.controller';

function make(dbOk: boolean, rpcOk: boolean) {
  const prisma = {
    $queryRaw: dbOk ? jest.fn().mockResolvedValue([{ '?column?': 1 }]) : jest.fn().mockRejectedValue(new Error('db down')),
  } as any;
  const evm = {
    provider: {
      getBlockNumber: rpcOk ? jest.fn().mockResolvedValue(12345) : jest.fn().mockRejectedValue(new Error('rpc down')),
    },
  } as any;
  return new HealthController(prisma, evm);
}

describe('HealthController GET /health', () => {
  it('returns ok when both db and rpc are healthy', async () => {
    const res = await make(true, true).check();
    expect(res).toEqual({ status: 'ok', db: true, rpc: true });
  });

  it('returns degraded when the db is down', async () => {
    const res = await make(false, true).check();
    expect(res).toEqual({ status: 'degraded', db: false, rpc: true });
  });

  it('returns degraded when the rpc is down', async () => {
    const res = await make(true, false).check();
    expect(res).toEqual({ status: 'degraded', db: true, rpc: false });
  });

  it('returns degraded when both dependencies are down', async () => {
    const res = await make(false, false).check();
    expect(res).toEqual({ status: 'degraded', db: false, rpc: false });
  });
});
