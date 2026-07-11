import type { User } from '@privy-io/expo';
import {
  availableRecoveryMethods,
  recoveryMethodLabel,
  currentRecoveryState,
  isValidPasscode,
  passcodesMatch,
} from './recovery';

function userWith(recovery_method: string | undefined): User {
  const wallet: any = { type: 'wallet', wallet_client_type: 'privy', chain_type: 'solana' };
  if (recovery_method !== undefined) wallet.recovery_method = recovery_method;
  return { id: 'did', created_at: 0, linked_accounts: [wallet] } as unknown as User;
}

describe('availableRecoveryMethods', () => {
  it('offers iCloud + passcode on iOS', () => {
    expect(availableRecoveryMethods('ios')).toEqual(['icloud', 'user-passcode']);
  });
  it('offers Google Drive + passcode on Android', () => {
    expect(availableRecoveryMethods('android')).toEqual(['google-drive', 'user-passcode']);
  });
  it('offers passcode only on other platforms', () => {
    expect(availableRecoveryMethods('web')).toEqual(['user-passcode']);
  });
});

describe('recoveryMethodLabel', () => {
  it('labels each method', () => {
    expect(recoveryMethodLabel('user-passcode')).toBe('Passcode');
    expect(recoveryMethodLabel('icloud')).toBe('iCloud');
    expect(recoveryMethodLabel('google-drive')).toBe('Google Drive');
  });
});

describe('currentRecoveryState', () => {
  it('reports not-set for a null user', () => {
    expect(currentRecoveryState(null)).toEqual({ isSet: false, method: null });
  });
  it('treats the default privy-managed method as not-set', () => {
    expect(currentRecoveryState(userWith('privy'))).toEqual({ isSet: false, method: null });
    expect(currentRecoveryState(userWith(undefined))).toEqual({ isSet: false, method: null });
  });
  it('reports a user-selected method as set', () => {
    expect(currentRecoveryState(userWith('user-passcode'))).toEqual({ isSet: true, method: 'user-passcode' });
    expect(currentRecoveryState(userWith('icloud'))).toEqual({ isSet: true, method: 'icloud' });
    expect(currentRecoveryState(userWith('google-drive'))).toEqual({ isSet: true, method: 'google-drive' });
  });
});

describe('isValidPasscode / passcodesMatch', () => {
  it('requires at least 8 characters', () => {
    expect(isValidPasscode('1234567')).toBe(false);
    expect(isValidPasscode('12345678')).toBe(true);
  });
  it('matches only equal, valid passcodes', () => {
    expect(passcodesMatch('12345678', '12345678')).toBe(true);
    expect(passcodesMatch('12345678', '1234567')).toBe(false);
    expect(passcodesMatch('short', 'short')).toBe(false);
  });
});
