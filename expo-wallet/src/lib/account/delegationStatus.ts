export interface DelegationStatus { available: boolean; enabled: boolean }
export type DelegationUiState = 'unavailable' | 'off' | 'on';

export function delegationUiState(s: DelegationStatus): DelegationUiState {
  if (!s.available) return 'unavailable';
  return s.enabled ? 'on' : 'off';
}
