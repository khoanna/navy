import { Interface, getAddress } from 'ethers';
import { deriveTxSummary } from './tx-summary';
import { DelegatedPolicyValidator } from './delegated-policy.validator';

const erc20 = new Interface(['function transfer(address to, uint256 value)']);

const SUB = getAddress('0x00000000000000000000000000000000000000A1');
const OTHER = getAddress('0x00000000000000000000000000000000000000B2');
const USDC = getAddress('0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8');

const ctx = { subwallet: SUB, minLamports: 1000n, maxLamports: 1_000_000n };
const transfer = (to: string, amount: bigint) => erc20.encodeFunctionData('transfer', [to, amount]);

describe('DelegatedPolicyValidator (EVM)', () => {
  const v = new DelegatedPolicyValidator();

  it('allows a single bounded native transfer to the subwallet', () => {
    const tx = deriveTxSummary([{ to: SUB, data: '0x', value: 5000n }]);
    expect(v.check(tx, ctx)).toEqual({ ok: true });
  });

  it('allows a single bounded ERC-20 transfer to the subwallet', () => {
    const tx = deriveTxSummary([{ to: USDC, data: transfer(SUB, 5000n) }]);
    expect(v.check(tx, ctx)).toEqual({ ok: true });
  });

  it('denies when there is more than one call', () => {
    const tx = deriveTxSummary([
      { to: SUB, data: '0x', value: 5000n },
      { to: SUB, data: '0x', value: 5000n },
    ]);
    expect(v.check(tx, ctx).ok).toBe(false);
  });

  it('denies a native transfer to a destination other than the subwallet', () => {
    const tx = deriveTxSummary([{ to: OTHER, data: '0x', value: 5000n }]);
    expect(v.check(tx, ctx).ok).toBe(false);
  });

  it('denies an ERC-20 transfer to a destination other than the subwallet', () => {
    const tx = deriveTxSummary([{ to: USDC, data: transfer(OTHER, 5000n) }]);
    expect(v.check(tx, ctx).ok).toBe(false);
  });

  it('denies an amount below min or above max', () => {
    const low = deriveTxSummary([{ to: SUB, data: '0x', value: 500n }]);
    const high = deriveTxSummary([{ to: SUB, data: '0x', value: 2_000_000n }]);
    expect(v.check(low, ctx).ok).toBe(false);
    expect(v.check(high, ctx).ok).toBe(false);
  });

  it('denies a non-transfer call (e.g. an approve / unknown selector)', () => {
    const tx = deriveTxSummary([{ to: USDC, data: '0xdeadbeef' }]);
    expect(v.check(tx, ctx).ok).toBe(false);
  });

  it('compares the subwallet address case-insensitively', () => {
    const tx = deriveTxSummary([{ to: USDC, data: transfer(SUB.toLowerCase(), 5000n) }]);
    expect(v.check(tx, ctx)).toEqual({ ok: true });
  });
});
