import { normalizeOtp, isComplete } from '@/lib/ui/otp';
import type { MfaMethod } from './mfa';

export interface MfaPromptState {
  methods: MfaMethod[];
  selected: MfaMethod | null;
  code: string;
}

const PREFERENCE: MfaMethod[] = ['passkey', 'totp', 'sms'];

function pickDefault(methods: MfaMethod[]): MfaMethod | null {
  for (const m of PREFERENCE) if (methods.includes(m)) return m;
  return methods[0] ?? null;
}

export function initialMfaPrompt(methods: MfaMethod[]): MfaPromptState {
  return { methods, selected: pickDefault(methods), code: '' };
}

export function selectMethod(state: MfaPromptState, method: MfaMethod): MfaPromptState {
  return { ...state, selected: method, code: '' };
}

export function setCode(state: MfaPromptState, raw: string): MfaPromptState {
  return { ...state, code: normalizeOtp(raw, 6) };
}

export function canSubmit(state: MfaPromptState): boolean {
  if (!state.selected) return false;
  if (state.selected === 'passkey') return true;
  return isComplete(state.code, 6);
}
