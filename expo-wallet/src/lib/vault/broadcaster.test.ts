import { makeProposalBroadcaster } from './broadcaster';

describe('makeProposalBroadcaster', () => {
  const leg = { to: '0xVault', data: '0xdeadbeef', value: '0' };

  it('maps the proposal `value` field onto the signer\'s `valueWei` argument', async () => {
    const send = jest.fn(async () => '0xhash');
    const b = makeProposalBroadcaster(send, { waitForTransaction: async () => ({ status: 1 }) });

    await b.sendTransaction({ to: '0xVault', data: '0xdeadbeef', value: '7' });

    expect(send).toHaveBeenCalledWith({ to: '0xVault', valueWei: '7', data: '0xdeadbeef' });
  });

  it('returns the broadcast hash', async () => {
    const b = makeProposalBroadcaster(
      async () => '0xabc',
      { waitForTransaction: async () => ({ status: 1 }) },
    );
    await expect(b.sendTransaction(leg)).resolves.toBe('0xabc');
  });

  it('resolves for a successful receipt', async () => {
    const b = makeProposalBroadcaster(
      async () => '0xabc',
      { waitForTransaction: async () => ({ status: 1 }) },
    );
    await expect(b.waitForTransaction('0xabc')).resolves.toBeUndefined();
  });

  it('THROWS on a reverted receipt — a mined revert still cost the user gas', async () => {
    const b = makeProposalBroadcaster(
      async () => '0xabc',
      { waitForTransaction: async () => ({ status: 0 }) },
    );
    await expect(b.waitForTransaction('0xabc')).rejects.toThrow('reverted');
  });

  it('throws when the transaction never mined', async () => {
    const b = makeProposalBroadcaster(
      async () => '0xabc',
      { waitForTransaction: async () => null },
    );
    await expect(b.waitForTransaction('0xabc')).rejects.toThrow('not mined');
  });

  it('throws when the receipt has no status rather than assuming success', async () => {
    const b = makeProposalBroadcaster(
      async () => '0xabc',
      { waitForTransaction: async () => ({}) },
    );
    await expect(b.waitForTransaction('0xabc')).rejects.toThrow('reverted');
  });

  it('propagates an RPC failure while waiting', async () => {
    const b = makeProposalBroadcaster(
      async () => '0xabc',
      {
        waitForTransaction: async () => {
          throw new Error('network down');
        },
      },
    );
    await expect(b.waitForTransaction('0xabc')).rejects.toThrow('network down');
  });
});
