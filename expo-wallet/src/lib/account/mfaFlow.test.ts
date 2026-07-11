import { initialMfaPrompt, selectMethod, setCode, canSubmit, type MfaPromptState } from './mfaFlow';

describe('initialMfaPrompt', () => {
  it('selects the first available method by preference (passkey > totp > sms)', () => {
    expect(initialMfaPrompt(['totp', 'passkey']).selected).toBe('passkey');
    expect(initialMfaPrompt(['totp']).selected).toBe('totp');
    expect(initialMfaPrompt(['sms', 'totp']).selected).toBe('totp');
  });
  it('handles an empty method list', () => {
    const s = initialMfaPrompt([]);
    expect(s.selected).toBeNull();
    expect(s.code).toBe('');
  });
});

describe('selectMethod', () => {
  it('switches the selected method and clears the code', () => {
    const s = setCode(initialMfaPrompt(['totp', 'passkey']), '123456');
    const next = selectMethod(s, 'totp');
    expect(next.selected).toBe('totp');
    expect(next.code).toBe('');
  });
});

describe('setCode', () => {
  it('normalizes to digits, max 6', () => {
    const s = initialMfaPrompt(['totp']);
    expect(setCode(s, '12ab34567').code).toBe('123456');
  });
});

describe('canSubmit', () => {
  it('is always true for passkey', () => {
    expect(canSubmit(initialMfaPrompt(['passkey']))).toBe(true);
  });
  it('requires a complete 6-digit code for totp/sms', () => {
    let s: MfaPromptState = initialMfaPrompt(['totp']);
    expect(canSubmit(s)).toBe(false);
    s = setCode(s, '123456');
    expect(canSubmit(s)).toBe(true);
  });
  it('is false when nothing is selected', () => {
    expect(canSubmit(initialMfaPrompt([]))).toBe(false);
  });
});
