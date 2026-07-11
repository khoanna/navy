import { useCallback, useRef, useState } from 'react';
import { useMfa, useRegisterMfaListener } from '@privy-io/expo';
import type { MfaMethod as PrivyMfaMethod } from '@privy-io/expo';
import { useToast } from '@/ui/Toast';
import { MfaPromptSheet } from './MfaPromptSheet';
import type { MfaMethod } from '@/lib/account/mfa';
import { initialMfaPrompt, selectMethod, setCode, type MfaPromptState } from '@/lib/account/mfaFlow';
import { RELYING_PARTY } from '@/lib/config/privy';

// The SDK does not supply a continuation/resolve callback — instead it awaits
// the async `onMfaRequired` callback itself. We use a deferred-promise pattern:
// when the listener fires we store the resolve/reject so the sheet's submit/
// cancel can settle it, unblocking Privy's internal await.
type Deferred = { resolve: () => void; reject: (e: unknown) => void };

// Filter SDK MfaMethod (which is 'sms'|'totp'|'passkey') down to our local
// MfaMethod type (same union). The cast is safe because both unions are
// identical — we just can't import the SDK union directly at the call site.
function toLocalMethods(methods: PrivyMfaMethod[]): MfaMethod[] {
  const known: MfaMethod[] = ['totp', 'sms', 'passkey'];
  return methods.filter((m): m is MfaMethod => (known as string[]).includes(m));
}

/**
 * Root-mounted invisible gate.
 *
 * Registers the Privy `onMfaRequired` listener. When any Privy action (e.g.
 * signTransaction) triggers a step-up MFA check, this gate opens
 * `MfaPromptSheet` with the available methods. The SDK awaits `onMfaRequired`
 * to complete before continuing the original operation — we bridge that with a
 * deferred-promise stored in `deferredRef`.
 */
export function MfaGate() {
  const mfa = useMfa();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<MfaPromptState>(initialMfaPrompt([]));

  // Holds the deferred promise that keeps `onMfaRequired` pending until the
  // user either completes verification or cancels.
  const deferredRef = useRef<Deferred | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setBusy(false);
    setState(initialMfaPrompt([]));
  }, []);

  // The SDK awaits this callback; we return a Promise that resolves/rejects
  // only when the user submits successfully or cancels.
  const onMfaRequired = useCallback((methods: PrivyMfaMethod[]) => {
    // A new step-up supersedes any still-pending one; abort the older gated
    // action rather than orphaning its awaited promise. Privy is holding an
    // `await` on the promise it received, so the rejection is always caught
    // by its internal handler — no unhandled-rejection crash is possible.
    if (deferredRef.current) {
      deferredRef.current.reject(new Error('MFA superseded by a newer request'));
      deferredRef.current = null;
    }
    return new Promise<void>((resolve, reject) => {
      deferredRef.current = { resolve, reject };
      setState(initialMfaPrompt(toLocalMethods(methods)));
      setOpen(true);
    });
  }, []);

  useRegisterMfaListener({ onMfaRequired });

  // Not wrapped in useCallback — must capture the latest state.code / state.selected each render.
  const submit = async () => {
    if (!state.selected) return;
    setBusy(true);
    try {
      if (state.selected === 'passkey') {
        // Passkey MFA is a two-step: init returns the credential request
        // options, which are then passed verbatim as `mfaCode` to submit.
        const credOptions = await mfa.init({ method: 'passkey', relyingParty: RELYING_PARTY });
        await mfa.submit({ method: 'passkey', mfaCode: credOptions, relyingParty: RELYING_PARTY });
      } else {
        // totp / sms: init triggers code delivery (totp: no-op server-side,
        // sms: sends the text), then submit with the 6-digit code.
        // Discriminate explicitly — `init` and `submit` use strict overloads
        // that don't accept the 'totp'|'sms' union without narrowing.
        if (state.selected === 'sms') {
          await mfa.init({ method: 'sms' });
          await mfa.submit({ method: 'sms', mfaCode: state.code });
        } else {
          await mfa.init({ method: 'totp' });
          await mfa.submit({ method: 'totp', mfaCode: state.code });
        }
      }
      deferredRef.current?.resolve();
      deferredRef.current = null;
      close();
    } catch (e: unknown) {
      toast(`Verification failed: ${e instanceof Error ? e.message : 'try again'}`);
      setBusy(false);
    }
  };

  const cancel = useCallback(() => {
    mfa.cancel();
    // Reject the deferred so Privy's awaiter unblocks (the original action
    // will throw, which is the correct behaviour for a user-cancelled MFA).
    deferredRef.current?.reject(new Error('MFA cancelled'));
    deferredRef.current = null;
    close();
  }, [mfa, close]);

  return (
    <MfaPromptSheet
      open={open}
      state={state}
      busy={busy}
      onSelectMethod={(m: MfaMethod) => setState((s) => selectMethod(s, m))}
      onChangeCode={(c: string) => setState((s) => setCode(s, c))}
      onSubmit={submit}
      onCancel={cancel}
    />
  );
}
