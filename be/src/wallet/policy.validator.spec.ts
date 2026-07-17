import { Interface, getAddress } from 'ethers';
import { PolicyValidator, SubwalletPolicy, PolicyContext } from './policy.validator';
import { deriveTxSummary } from './tx-summary';

const erc20 = new Interface([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const comet = new Interface([
  'function supply(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  'function withdrawTo(address to, address asset, uint256 amount)',
]);

// Circle USDC + Compound III (Comet) USDC market, Sepolia.
const USDC = getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
const COMET = getAddress('0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e');
const SUB = getAddress('0x00000000000000000000000000000000000000A1');
const OWNER = getAddress('0x00000000000000000000000000000000000000B2');
const ATTACKER = getAddress('0x00000000000000000000000000000000000000cc');
const RANDOM_CONTRACT = getAddress('0x00000000000000000000000000000000000000dd');

const policy: SubwalletPolicy = {
  allowedProgramIds: [USDC, COMET],
  allowedDestinations: [COMET, OWNER], // subwallet is implicit
};
const ctx: PolicyContext = { subwallet: SUB };

const approve = (spender: string, amount: bigint) => erc20.encodeFunctionData('approve', [spender, amount]);
const transfer = (to: string, amount: bigint) => erc20.encodeFunctionData('transfer', [to, amount]);
const supply = (amount: bigint) => comet.encodeFunctionData('supply', [USDC, amount]);
const withdrawTo = (to: string, amount: bigint) => comet.encodeFunctionData('withdrawTo', [to, USDC, amount]);
const withdraw = (amount: bigint) => comet.encodeFunctionData('withdraw', [USDC, amount]);

describe('PolicyValidator (EVM)', () => {
  const v = new PolicyValidator();

  it('allows the deposit flow: approve(Comet) + supply(USDC) (credits msg.sender)', () => {
    const tx = deriveTxSummary([
      { to: USDC, data: approve(COMET, 9000n) },
      { to: COMET, data: supply(9000n) },
    ]);
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });

  it('allows a withdrawTo the owner main wallet', () => {
    const tx = deriveTxSummary([{ to: COMET, data: withdrawTo(OWNER, 4000n) }]);
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });

  it('allows a bare withdraw (redeems to the implicit subwallet msg.sender)', () => {
    const tx = deriveTxSummary([{ to: COMET, data: withdraw(4000n) }]);
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });

  it('allows a withdrawTo back to the subwallet (implicit destination)', () => {
    const tx = deriveTxSummary([{ to: COMET, data: withdrawTo(SUB, 4000n) }]);
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });

  it('rejects a call to a non-allowlisted contract', () => {
    const tx = deriveTxSummary([{ to: RANDOM_CONTRACT, data: approve(COMET, 1n) }]);
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/contract not allowlisted/);
  });

  it('rejects approve to a spender that is not the Comet', () => {
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

  it('rejects a withdrawTo a non-allowed recipient', () => {
    const tx = deriveTxSummary([{ to: COMET, data: withdrawTo(ATTACKER, 9000n) }]);
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/compound-withdraw destination not allowed/);
  });

  it('rejects an unknown selector on an allowlisted contract', () => {
    const tx = deriveTxSummary([{ to: USDC, data: '0xdeadbeef' }]);
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/not permitted/);
  });

  it('compares addresses case-insensitively', () => {
    const tx = deriveTxSummary([
      { to: USDC.toLowerCase(), data: approve(COMET.toLowerCase(), 1n) },
      { to: COMET.toLowerCase(), data: supply(1n) },
    ]);
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });
});
