import {
  APPROVE_SELECTOR,
  isApproveProposal,
  preflightDepositGas,
  preflightProposalGas,
  sendProposals,
  type TransactionProposal,
} from './proposals';
import { APPROVE_GAS_UNITS, VAULT_CALL_GAS_UNITS } from './gas';

const GWEI = 1_000_000_000n;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const VAULT = '0x55E728b08FdB9432520FB3Fd1b9D7777320f8ED3';

/** approve(vault, 1000000) — real ABI encoding, not a placeholder. */
const APPROVE_DATA =
  APPROVE_SELECTOR +
  '00000000000000000000000055e728b08fdb9432520fb3fd1b9d7777320f8ed3' +
  '00000000000000000000000000000000000000000000000000000000000f4240';
/** deposit(1000000, owner) — selector 0x6e553f65. */
const DEPOSIT_DATA =
  '0x6e553f65' +
  '00000000000000000000000000000000000000000000000000000000000f4240' +
  '0000000000000000000000001111111111111111111111111111111111111111';

const approveLeg: TransactionProposal = {
  to: USDC, data: APPROVE_DATA, value: '0', chainId: 8453, description: 'Approve vault to spend 1000000 USDC',
};
const depositLeg: TransactionProposal = {
  to: VAULT, data: DEPOSIT_DATA, value: '0', chainId: 8453, description: 'Deposit 1000000 USDC into vault',
};

describe('isApproveProposal', () => {
  it('recognises an approve leg by its calldata selector', () => {
    expect(isApproveProposal(approveLeg)).toBe(true);
  });

  it('does not classify a vault deposit as an approve', () => {
    expect(isApproveProposal(depositLeg)).toBe(false);
  });

  it('is case-insensitive about the selector', () => {
    expect(isApproveProposal({ data: '0x095EA7B3abcd' })).toBe(true);
  });

  it('does not rely on the description or the ordering', () => {
    // A leg described as an approval but carrying deposit calldata is a deposit.
    const relabelled: TransactionProposal = { ...depositLeg, description: 'Approve vault' };
    expect(isApproveProposal(relabelled)).toBe(false);
  });

  it('tolerates empty or malformed calldata', () => {
    expect(isApproveProposal({ data: '' })).toBe(false);
    expect(isApproveProposal({ data: '0x' })).toBe(false);
    expect(isApproveProposal({ data: undefined as unknown as string })).toBe(false);
  });
});

describe('preflightProposalGas', () => {
  const legs = [approveLeg, depositLeg];
  const rawCost = (APPROVE_GAS_UNITS + VAULT_CALL_GAS_UNITS) * GWEI;

  it('passes a wallet holding the cost plus the default 25% buffer', () => {
    const r = preflightProposalGas(legs, {
      ethBalanceWei: (rawCost * 12_500n) / 10_000n,
      gasPriceWei: GWEI,
    });
    expect(r).toEqual({ ok: true, shortfallWei: 0n, estimatedWei: rawCost, unknown: false });
  });

  it('REFUSES a wallet holding exactly the un-buffered cost', () => {
    const r = preflightProposalGas(legs, { ethBalanceWei: rawCost, gasPriceWei: GWEI });
    expect(r.ok).toBe(false);
    expect(r.shortfallWei).toBe((rawCost * 12_500n) / 10_000n - rawCost);
  });

  it('reports the whole buffered requirement for an empty wallet', () => {
    const r = preflightProposalGas(legs, { ethBalanceWei: 0n, gasPriceWei: GWEI });
    expect(r.ok).toBe(false);
    expect(r.shortfallWei).toBe((rawCost * 12_500n) / 10_000n);
    expect(r.estimatedWei).toBe(rawCost);
  });

  it('prices a one-leg redeem below a two-leg deposit', () => {
    const one = preflightProposalGas([depositLeg], { ethBalanceWei: 0n, gasPriceWei: GWEI });
    const two = preflightProposalGas(legs, { ethBalanceWei: 0n, gasPriceWei: GWEI });
    expect(one.estimatedWei).toBeLessThan(two.estimatedWei);
    expect(one.estimatedWei).toBe(VAULT_CALL_GAS_UNITS * GWEI);
  });

  it('honours an explicit bufferBps override', () => {
    const r = preflightProposalGas(legs, { ethBalanceWei: rawCost, gasPriceWei: GWEI }, 0);
    expect(r.ok).toBe(true);
  });

  it('does not block the flow when the gas price is unreadable, but flags it', () => {
    const r = preflightProposalGas(legs, { ethBalanceWei: 0n, gasPriceWei: 0n });
    expect(r).toEqual({ ok: true, shortfallWei: 0n, estimatedWei: 0n, unknown: true });
  });

  it('scales with the gas price — a fee spike can turn a pass into a fail', () => {
    const chain = { ethBalanceWei: (rawCost * 12_500n) / 10_000n, gasPriceWei: GWEI };
    expect(preflightProposalGas(legs, chain).ok).toBe(true);
    expect(preflightProposalGas(legs, { ...chain, gasPriceWei: 2n * GWEI }).ok).toBe(false);
  });
});

describe('sendProposals', () => {
  const makeWallet = () => {
    const sent: Array<{ to: string; data: string; value: string }> = [];
    const waited: string[] = [];
    let n = 0;
    return {
      sent,
      waited,
      sendTransaction: jest.fn(async (tx: { to: string; data: string; value: string }) => {
        sent.push(tx);
        return `0xhash${++n}`;
      }),
      waitForTransaction: jest.fn(async (h: string) => {
        waited.push(h);
      }),
    };
  };

  it('broadcasts every leg in order and returns the hashes', async () => {
    const w = makeWallet();
    const hashes = await sendProposals(w, [approveLeg, depositLeg]);

    expect(hashes).toEqual(['0xhash1', '0xhash2']);
    expect(w.sent.map((t) => t.data)).toEqual([APPROVE_DATA, DEPOSIT_DATA]);
    expect(w.sent.map((t) => t.to)).toEqual([USDC, VAULT]);
  });

  it('waits for each leg BEFORE sending the next — a deposit sent early reverts', async () => {
    const order: string[] = [];
    let sends = 0;
    const w = {
      sendTransaction: jest.fn(async (tx: { data: string }) => {
        order.push(`send:${tx.data.slice(0, 10)}`);
        return `0x${++sends}`;
      }),
      waitForTransaction: jest.fn(async (h: string) => {
        order.push(`wait:${h}`);
      }),
    };
    await sendProposals(w, [approveLeg, depositLeg]);

    expect(order).toEqual(['send:0x095ea7b3', 'wait:0x1', 'send:0x6e553f65', 'wait:0x2']);
  });

  it('stops at a failed leg and does not broadcast the rest', async () => {
    const w = makeWallet();
    w.sendTransaction.mockImplementationOnce(async () => {
      throw new Error('user rejected the request');
    });

    await expect(sendProposals(w, [approveLeg, depositLeg])).rejects.toThrow('user rejected');
    expect(w.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('stops when a leg is mined but reverted', async () => {
    const w = makeWallet();
    w.waitForTransaction.mockImplementationOnce(async () => {
      throw new Error('transaction reverted');
    });

    await expect(sendProposals(w, [approveLeg, depositLeg])).rejects.toThrow('reverted');
    expect(w.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('annotates the failure with which leg failed', async () => {
    const w = makeWallet();
    w.sendTransaction
      .mockImplementationOnce(async () => '0xok')
      .mockImplementationOnce(async () => {
        throw new Error('out of gas');
      });

    const err = await sendProposals(w, [approveLeg, depositLeg]).catch((e) => e);
    expect(err.legIndex).toBe(1);
    expect(err.leg).toBe(depositLeg.description);
  });

  it('is a no-op for an empty proposal list', async () => {
    const w = makeWallet();
    await expect(sendProposals(w, [])).resolves.toEqual([]);
    expect(w.sendTransaction).not.toHaveBeenCalled();
  });
});

describe('preflightDepositGas', () => {
  const rawCost = (APPROVE_GAS_UNITS + VAULT_CALL_GAS_UNITS) * GWEI;

  it('budgets an approve plus a vault call, not two vault calls', () => {
    const r = preflightDepositGas({ ethBalanceWei: 0n, gasPriceWei: GWEI });
    expect(r.estimatedWei).toBe(rawCost);
    expect(r.estimatedWei).toBeLessThan(2n * VAULT_CALL_GAS_UNITS * GWEI);
  });

  it('warns an empty wallet before the user has typed an amount', () => {
    const r = preflightDepositGas({ ethBalanceWei: 0n, gasPriceWei: GWEI });
    expect(r.ok).toBe(false);
    expect(r.shortfallWei).toBeGreaterThan(0n);
  });

  it('stays silent when the wallet is funded', () => {
    const r = preflightDepositGas({
      ethBalanceWei: (rawCost * 12_500n) / 10_000n,
      gasPriceWei: GWEI,
    });
    expect(r).toEqual({ ok: true, shortfallWei: 0n, estimatedWei: rawCost, unknown: false });
  });

  it('reports unknown (and does not warn) when the gas price is unreadable', () => {
    expect(preflightDepositGas({ ethBalanceWei: 0n, gasPriceWei: 0n })).toEqual({
      ok: true, shortfallWei: 0n, estimatedWei: 0n, unknown: true,
    });
  });
});
