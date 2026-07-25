import { buildSystemPrompt, detectPromptContext } from './prompt/index';
import { buildSystemPromptLegacy, detectPromptContextLegacy } from './prompt-legacy';

describe('prompt refactor parity', () => {
  const ctxs = [{}, { farming: true }, { market: true }, { farming: true, market: true }];

  it('composes byte-for-byte identically for every context combo', () => {
    for (const ctx of ctxs) {
      expect(buildSystemPrompt(ctx)).toBe(buildSystemPromptLegacy(ctx));
    }
  });

  it('detects context identically', () => {
    const cases: Array<[string, string[]]> = [
      ['send 5 usdc to @bob', []],
      ['deposit into farming', []],
      ['what is the price of bitcoin', []],
      ['and now take it out', ['get_farming_summary']],
      ['', []],
    ];
    for (const [text, tools] of cases) {
      expect(detectPromptContext(text, tools)).toEqual(detectPromptContextLegacy(text, tools));
    }
  });
});
