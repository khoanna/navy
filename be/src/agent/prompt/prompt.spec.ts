import { buildSystemPrompt, detectPromptContext } from './index';

describe('buildSystemPrompt', () => {
  it('always includes the base identity and hard invariants', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('Navy Assistant');
    expect(p).toContain('You NEVER move funds');
    expect(p).toContain('never invent');
  });

  it('includes every always-on section (guards against a dropped fragment)', () => {
    const p = buildSystemPrompt();
    for (const phrase of ['IMPORTANT — these rules are absolute', 'Choosing a tool:', 'Tool discipline:', 'Sending money:', 'Answering:']) {
      expect(p).toContain(phrase);
    }
  });

  it('omits detail blocks by default', () => {
    const p = buildSystemPrompt();
    expect(p).not.toContain('Farming detail:');
    expect(p).not.toContain('Market detail:');
  });

  it('appends only the farming block when farming is in play', () => {
    const p = buildSystemPrompt({ farming: true });
    expect(p).toContain('Farming detail:');
    expect(p).not.toContain('Market detail:');
  });

  it('appends only the market block when market is in play', () => {
    const p = buildSystemPrompt({ market: true });
    expect(p).toContain('Market detail:');
    expect(p).not.toContain('Farming detail:');
  });

  it('appends both blocks when both apply', () => {
    const p = buildSystemPrompt({ farming: true, market: true });
    expect(p).toContain('Farming detail:');
    expect(p).toContain('Market detail:');
  });
});

describe('detectPromptContext', () => {
  it('detects farming from the user message', () => {
    expect(detectPromptContext('deposit 10 usdc into farming')).toEqual({ farming: true, market: false });
  });

  it('detects market from the user message', () => {
    expect(detectPromptContext('what is the price of bitcoin?')).toEqual({ farming: false, market: true });
  });

  it('detects neither for a plain send', () => {
    expect(detectPromptContext('send 5 usdc to @bob')).toEqual({ farming: false, market: false });
  });

  it('stays sticky via prior tool names', () => {
    expect(detectPromptContext('and now take it out', ['get_farming_summary'])).toEqual({ farming: true, market: false });
    expect(detectPromptContext('how about that one', ['get_token_info'])).toEqual({ farming: false, market: true });
  });

  it('is safe with empty input', () => {
    expect(detectPromptContext('')).toEqual({ farming: false, market: false });
  });
});
