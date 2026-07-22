import { runTransferFlow } from './transferFlow';

describe('runTransferFlow', () => {
  it('builds, signs the typed data, then submits and returns the result', async () => {
    const client = {
      build: jest.fn(async () => ({ transferId: 't1', typedData: { domain: {}, types: {}, primaryType: 'TransferWithAuthorization', message: {} }, recipient: { address: '0xabc', username: 'linh' }, amount: '1000000' })),
      submit: jest.fn(async () => ({ txHash: '0xhash', status: 'confirmed' })),
    };
    const signTypedData = jest.fn(async () => '0xsig');
    const out = await runTransferFlow(client as any, signTypedData, { recipient: '@linh', amountBase: '1000000' });
    expect(client.build).toHaveBeenCalledWith('@linh', '1000000');
    expect(signTypedData).toHaveBeenCalled();
    expect(client.submit).toHaveBeenCalledWith('t1', '0xsig');
    expect(out).toEqual({ txHash: '0xhash', status: 'confirmed', recipient: { address: '0xabc', username: 'linh' }, amount: '1000000' });
  });
});
