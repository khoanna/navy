import { delegationUiState } from './delegationStatus';

describe('delegationUiState', () => {
  it('is unavailable when the backend feature is off', () => {
    expect(delegationUiState({ available: false, enabled: false })).toBe('unavailable');
    expect(delegationUiState({ available: false, enabled: true })).toBe('unavailable');
  });
  it('reflects enabled/disabled when available', () => {
    expect(delegationUiState({ available: true, enabled: false })).toBe('off');
    expect(delegationUiState({ available: true, enabled: true })).toBe('on');
  });
});
