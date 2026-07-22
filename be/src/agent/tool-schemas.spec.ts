import { TOOLS, TOOL_NAMES, validateArgs } from './tool-schemas';

describe('tool-schemas', () => {
  it('exposes the expected tool names', () => {
    expect(TOOL_NAMES.sort()).toEqual([
      'build_farming_deposit', 'build_farming_withdraw', 'build_transfer',
      'get_farming_summary', 'get_payment_history', 'get_portfolio',
      'get_spending_analytics', 'get_token_info', 'get_top_coins', 'resolve_recipient',
    ].sort());
  });
  it('every tool is a valid function schema', () => {
    for (const t of TOOLS) {
      expect(t.type).toBe('function');
      expect(typeof t.function.name).toBe('string');
      expect(t.function.parameters).toBeDefined();
    }
  });
  it('validateArgs enforces required params for build_transfer', () => {
    expect(validateArgs('build_transfer', { recipient: '@linh', amountBase: '1000000' }).ok).toBe(true);
    expect(validateArgs('build_transfer', { recipient: '@linh' }).ok).toBe(false);
    expect(validateArgs('build_transfer', { recipient: '@linh', amountBase: 12 }).ok).toBe(false);
  });
  it('validateArgs rejects an unknown tool', () => {
    expect(validateArgs('nope', {}).ok).toBe(false);
  });
});
