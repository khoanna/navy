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
