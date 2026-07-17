import { ethers } from 'ethers';
import { CompoundYieldAdapter, COMET } from './compound-yield-adapter';
import { deriveTxSummary } from '../wallet/tx-summary';
import { PolicyValidator } from '../wallet/policy.validator';

// Circle USDC (Sepolia) — the unified farming + payment token (cfg.usdcAddress).
const USDC = ethers.getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
const OWNER = ethers.Wallet.createRandom().address;
const SUB = ethers.Wallet.createRandom().address;

function makeAdapter(balanceOf?: jest.Mock) {
  // build*/policy only need `usdcAddress`; getPosition + buildWithdraw('all') read
  // Comet.balanceOf via the ethers Contract, which we override for those tests.
  const evm = { provider: {} as any, usdcAddress: USDC } as any;
  const adapter = new CompoundYieldAdapter(evm);
  if (balanceOf) {
    (adapter as any).comet = { balanceOf };
  }
  return adapter;
}

describe('CompoundYieldAdapter', () => {
  it('buildDeposit returns approve(Comet) then supply(USDC, amount)', async () => {
    const calls = await makeAdapter().buildDeposit(SUB, 1_000_000n);
    expect(calls).toHaveLength(2);
    const summary = deriveTxSummary(calls);
    expect(summary.instructions[0]).toMatchObject({ to: USDC, kind: 'erc20-approve', spender: COMET, amount: 1_000_000n });
    expect(summary.instructions[1]).toMatchObject({ to: COMET, kind: 'compound-supply', amount: 1_000_000n });
  });

  it('buildWithdraw(amount) returns a single withdrawTo the owner main wallet', async () => {
    const calls = await makeAdapter().buildWithdraw(SUB, OWNER, 500_000n);
    expect(calls).toHaveLength(1);
    const [ix] = deriveTxSummary(calls).instructions;
    expect(ix).toMatchObject({ to: COMET, kind: 'compound-withdraw', recipient: OWNER, amount: 500_000n });
  });

  it("buildWithdraw('all') uses the subwallet's present Comet balance", async () => {
    const balanceOf = jest.fn().mockResolvedValue(777_000n);
    const calls = await makeAdapter(balanceOf).buildWithdraw(SUB, OWNER, 'all');
    expect(balanceOf).toHaveBeenCalledWith(SUB);
    const [ix] = deriveTxSummary(calls).instructions;
    expect(ix.amount).toBe(777_000n);
    expect(ix.recipient).toBe(OWNER);
  });

  it('getPosition returns the Comet supplier balance for principal + value', async () => {
    const balanceOf = jest.fn().mockResolvedValue(1_234_567n);
    const pos = await makeAdapter(balanceOf).getPosition(SUB);
    expect(balanceOf).toHaveBeenCalledWith(SUB);
    expect(pos).toEqual({ principalLamports: 1_234_567n, currentValueLamports: 1_234_567n, cTokenAmount: 1_234_567n });
  });

  it('policyAllowlist lists [USDC, Comet] contracts and [subwallet, Comet, owner] destinations', async () => {
    const allow = await makeAdapter().policyAllowlist(SUB, OWNER);
    expect(allow.programIds).toEqual([USDC, COMET]);
    expect(allow.destinations).toEqual([SUB, COMET, OWNER]);
  });

  it('the built deposit passes the PolicyValidator under the adapter-derived allowlist', async () => {
    const adapter = makeAdapter();
    const allow = await adapter.policyAllowlist(SUB, OWNER);
    const calls = await adapter.buildDeposit(SUB, 1_000_000n);
    const verdict = new PolicyValidator().check(
      { allowedProgramIds: allow.programIds, allowedDestinations: allow.destinations },
      deriveTxSummary(calls),
      { subwallet: SUB },
    );
    expect(verdict.ok).toBe(true);
  });

  it('the built withdraw passes the PolicyValidator (withdrawTo owner)', async () => {
    const adapter = makeAdapter();
    const allow = await adapter.policyAllowlist(SUB, OWNER);
    const calls = await adapter.buildWithdraw(SUB, OWNER, 500_000n);
    const verdict = new PolicyValidator().check(
      { allowedProgramIds: allow.programIds, allowedDestinations: allow.destinations },
      deriveTxSummary(calls),
      { subwallet: SUB },
    );
    expect(verdict.ok).toBe(true);
  });
});
