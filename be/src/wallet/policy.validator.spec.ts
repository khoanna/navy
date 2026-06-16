import { PolicyValidator, SubwalletPolicy } from './policy.validator';
const policy: SubwalletPolicy = {
  allowedProgramIds: ['Prog11111111111111111111111111111111111111', '11111111111111111111111111111111'],
  allowedDestinations: ['Self1111111111111111111111111111111111111', 'Owner111111111111111111111111111111111111'],
};
describe('PolicyValidator', () => {
  const v = new PolicyValidator();
  it('allows an allowlisted program with allowlisted destinations', () => {
    expect(v.check(policy, { programIds: ['Prog11111111111111111111111111111111111111'], transferDestinations: ['Self1111111111111111111111111111111111111'] })).toEqual({ ok: true });
  });
  it('rejects a non-allowlisted program', () => {
    const r = v.check(policy, { programIds: ['Evil11111111111111111111111111111111111111'], transferDestinations: [] });
    expect(r.ok).toBe(false); expect((r as any).reason).toMatch(/program/);
  });
  it('rejects a transfer to a non-allowlisted destination even if the program is allowed', () => {
    const r = v.check(policy, { programIds: ['Prog11111111111111111111111111111111111111'], transferDestinations: ['Attacker1111111111111111111111111111111111'] });
    expect(r.ok).toBe(false); expect((r as any).reason).toMatch(/destination/);
  });
  it('allows a withdrawal transfer to the owner', () => {
    expect(v.check(policy, { programIds: ['11111111111111111111111111111111'], transferDestinations: ['Owner111111111111111111111111111111111111'] })).toEqual({ ok: true });
  });
});
