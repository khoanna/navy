import { UserService } from '../../../src/user/user.service';

function fakePrisma() {
  const rows: any[] = [];
  return {
    rows,
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        rows.find((r) => (where.username ? r.username === where.username : r.id === where.id)) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      }),
    },
  } as any;
}

describe('UserService usernames', () => {
  it('resolveUsername returns the primaryWallet of an active user', async () => {
    const prisma = fakePrisma();
    prisma.rows.push({ id: 'u1', username: 'linh', primaryWallet: '0xabc', status: 'active' });
    const svc = new UserService(prisma);
    expect(await svc.resolveUsername('LINH')).toEqual({ username: 'linh', address: '0xabc' });
  });
  it('resolveUsername returns null for unknown/inactive/no-wallet', async () => {
    const prisma = fakePrisma();
    prisma.rows.push({ id: 'u2', username: 'gone', primaryWallet: null, status: 'active' });
    const svc = new UserService(prisma);
    expect(await svc.resolveUsername('nobody')).toBeNull();
    expect(await svc.resolveUsername('gone')).toBeNull();
  });
  it('setUsername rejects an invalid handle', async () => {
    const svc = new UserService(fakePrisma());
    await expect(svc.setUsername('u1', 'bad name')).rejects.toThrow(/invalid/i);
  });
});
