// Deterministic guard against the assistant inventing an amount the user never gave.
//
// Small models (e.g. gemini-2.5-flash) will happily fill a required `amount` field with a
// made-up value ("1", or the whole balance) when the user only said "send bob some usdc" or
// "deposit into farming". Prompt wording does not reliably stop this, so we enforce it in code:
// a build_* proposal is only allowed when the user's own message carried a quantity. The
// human confirm-and-sign step is still the final backstop; this just stops bogus proposals.
//
// Framework-free and unit-testable (no Nest/chain imports).

// A digit anywhere means the user typed a number (5, 0.5, 10usdc, $20, ...).
const HAS_DIGIT = /\d/;
// Explicit relative quantities the assistant may legitimately compute from the balance.
const QUANTITY_WORDS = /\b(all|everything|whole|entire|max|maximum|half|quarter)\b/i;

/** True when the user's message specifies an amount the assistant is allowed to act on. */
export function userSpecifiedAmount(userText: string | undefined): boolean {
  const t = userText ?? '';
  return HAS_DIGIT.test(t) || QUANTITY_WORDS.test(t);
}

export const CLARIFY = {
  transfer: 'No amount was specified — ask the user how much to send before building any transfer. Do not guess.',
  farming_deposit:
    'No amount was specified — ask the user how much USDC to deposit into farming before building the proposal. Do not guess.',
  farming_withdraw:
    'No amount was specified — ask the user how much to withdraw (a specific amount, or all of it) before building the proposal. Do not guess.',
} as const;
