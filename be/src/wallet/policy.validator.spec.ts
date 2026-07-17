import { Interface, getAddress } from 'ethers';
import { PolicyValidator, SubwalletPolicy, PolicyContext } from './policy.validator';
import { deriveTxSummary } from './tx-summary';

const erc20 = new Interface([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const aavePool = new Interface([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to)',
]);

const USDC = getAddress('0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8');
const POOL = getAddress('0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951');
const ATOKEN = getAddress('0x16dA4541aD1807f4443d92D26044C1147406EB80');
const SUB = getAddress('0x00000000000000000000000000000000000000A1');
const OWNER = getAddress('0x00000000000000000000000000000000000000B2');
const ATTACKER = getAddress('0x00000000000000000000000000000000000000cc');
const RANDOM_CONTRACT = getAddress('0x00000000000000000000000000000000000000dd');

const policy: SubwalletPolicy = {
  allowedProgramIds: [USDC, POOL, ATOKEN],
  allowedDestinations: [POOL, OWNER], // subwallet is implicit
};
const ctx: PolicyContext = { subwallet: SUB };

const approve = (spender: string, amount: bigint) => erc20.encodeFunctionData('approve', [spender, amount]);
const transfer = (to: string, amount: bigint) => erc20.encodeFunctionData('transfer', [to, amount]);
const supply = (onBehalfOf: string, amount: bigint) =>
  aavePool.encodeFunctionData('supply', [USDC, amount, onBehalfOf, 0]);
const withdraw = (to: string, amount: bigint) => aavePool.encodeFunctionData('withdraw', [USDC, amount, to]);

describe('PolicyValidator (EVM)', () => {
  const v = new PolicyValidator();

  it('allows the deposit flow: approve(Pool) + supply(onBehalfOf=subwallet)', () => {
    const tx = deriveTxSummary([
      { to: USDC, data: approve(POOL, 9000n) },
      { to: POOL, data: supply(SUB, 9000n) },
    ]);
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });

  it('allows a withdraw to the owner main wallet', () => {
    const tx = deriveTxSummary([{ to: POOL, data: withdraw(OWNER, 4000n) }]);
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });

  it('allows a withdraw back to the subwallet (implicit destination)', () => {
    const tx = deriveTxSummary([{ to: POOL, data: withdraw(SUB, 4000n) }]);
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });

  it('rejects a call to a non-allowlisted contract', () => {
    const tx = deriveTxSummary([{ to: RANDOM_CONTRACT, data: approve(POOL, 1n) }]);
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/contract not allowlisted/);
  });

  it('rejects approve to a spender that is not the Aave Pool', () => {
    const tx = deriveTxSummary([{ to: USDC, data: approve(ATTACKER, 9000n) }]);
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/approve spender not allowed/);
  });

  it('rejects an ERC-20 transfer to a non-allowed recipient', () => {
    const tx = deriveTxSummary([{ to: USDC, data: transfer(ATTACKER, 9000n) }]);
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/erc20-transfer destination not allowed/);
  });

  it('rejects a withdraw to a non-allowed recipient', () => {
    const tx = deriveTxSummary([{ to: POOL, data: withdraw(ATTACKER, 9000n) }]);
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/aave-withdraw destination not allowed/);
  });

  it('rejects supply that credits an account other than the subwallet', () => {
    const tx = deriveTxSummary([{ to: POOL, data: supply(ATTACKER, 9000n) }]);
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/supply onBehalfOf not the subwallet/);
  });

  it('rejects an unknown selector on an allowlisted contract', () => {
    const tx = deriveTxSummary([{ to: USDC, data: '0xdeadbeef' }]);
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/not permitted/);
  });

  it('compares addresses case-insensitively', () => {
    const tx = deriveTxSummary([
      { to: USDC.toLowerCase(), data: approve(POOL.toLowerCase(), 1n) },
      { to: POOL.toLowerCase(), data: supply(SUB.toLowerCase(), 1n) },
    ]);
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });
});
