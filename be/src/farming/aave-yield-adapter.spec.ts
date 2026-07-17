import { ethers } from 'ethers';
import { AaveYieldAdapter, AAVE_POOL, FARM_USDC, AAVE_AUSDC } from './aave-yield-adapter';
import { deriveTxSummary } from '../wallet/tx-summary';
import { PolicyValidator } from '../wallet/policy.validator';

const OWNER = ethers.Wallet.createRandom().address;
const SUB = ethers.Wallet.createRandom().address;

function makeAdapter(balanceOf?: jest.Mock) {
  // getPosition reads aToken.balanceOf via the ethers Contract; mock the provider.call
  // by stubbing the contract method through a fake provider is awkward — instead we
  // construct with a provider whose `call`/`resolveName` are unused for build*/policy,
  // and override balanceOf for getPosition tests via jest spy on Contract prototype.
  const evm = { provider: {} as any } as any;
  const adapter = new AaveYieldAdapter(evm);
  if (balanceOf) {
    (adapter as any).aToken = { balanceOf };
  }
  return adapter;
}

describe('AaveYieldAdapter', () => {
  it('buildDeposit returns approve(Pool) then supply(USDC, amount, subwallet, 0)', async () => {
    const calls = await makeAdapter().buildDeposit(SUB, 1_000_000n);
    expect(calls).toHaveLength(2);
    const summary = deriveTxSummary(calls);
    expect(summary.instructions[0]).toMatchObject({ to: FARM_USDC, kind: 'erc20-approve', spender: AAVE_POOL, amount: 1_000_000n });
    expect(summary.instructions[1]).toMatchObject({ to: AAVE_POOL, kind: 'aave-supply', onBehalfOf: SUB, amount: 1_000_000n });
  });

  it('buildWithdraw(amount) returns a single withdraw to the owner main wallet', async () => {
    const calls = await makeAdapter().buildWithdraw(SUB, OWNER, 500_000n);
    expect(calls).toHaveLength(1);
    const [ix] = deriveTxSummary(calls).instructions;
    expect(ix).toMatchObject({ to: AAVE_POOL, kind: 'aave-withdraw', recipient: OWNER, amount: 500_000n });
  });

  it("buildWithdraw('all') uses MaxUint256", async () => {
    const calls = await makeAdapter().buildWithdraw(SUB, OWNER, 'all');
    const [ix] = deriveTxSummary(calls).instructions;
    expect(ix.amount).toBe(ethers.MaxUint256);
    expect(ix.recipient).toBe(OWNER);
  });

  it('getPosition returns the aToken balance for principal + value (rebases 1:1)', async () => {
    const balanceOf = jest.fn().mockResolvedValue(1_234_567n);
    const pos = await makeAdapter(balanceOf).getPosition(SUB);
    expect(balanceOf).toHaveBeenCalledWith(SUB);
    expect(pos).toEqual({ principalLamports: 1_234_567n, currentValueLamports: 1_234_567n, cTokenAmount: 1_234_567n });
  });

  it('policyAllowlist lists [USDC, Pool, aToken] contracts and [subwallet, Pool, owner] destinations', async () => {
    const allow = await makeAdapter().policyAllowlist(SUB, OWNER);
    expect(allow.programIds).toEqual([FARM_USDC, AAVE_POOL, AAVE_AUSDC]);
    expect(allow.destinations).toEqual([SUB, AAVE_POOL, OWNER]);
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
});
