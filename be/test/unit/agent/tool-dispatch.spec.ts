import { dispatchTool } from '../../../src/agent/tool-dispatch';

describe('dispatchTool', () => {
  const handlers = {
    resolve_recipient: async (a: any) => ({ address: '0xabc', input: a.recipient }),
  } as any;

  it('parses JSON args, validates, and calls the handler', async () => {
    const r = await dispatchTool('resolve_recipient', JSON.stringify({ recipient: '@linh' }), handlers);
    expect(r).toEqual({ address: '0xabc', input: '@linh' });
  });
  it('returns a structured error on invalid JSON', async () => {
    const r = await dispatchTool('resolve_recipient', '{bad', handlers);
    expect(r).toHaveProperty('error');
  });
  it('returns a structured error on validation failure', async () => {
    const r: any = await dispatchTool('resolve_recipient', JSON.stringify({}), handlers);
    expect(r.error).toMatch(/missing required/);
  });
  it('captures a thrown handler error instead of throwing', async () => {
    const r: any = await dispatchTool('build_farming_withdraw', JSON.stringify({ amount: 'all' }),
      { build_farming_withdraw: async () => { throw new Error('kaboom'); } } as any);
    expect(r.error).toMatch(/kaboom/);
  });
});
