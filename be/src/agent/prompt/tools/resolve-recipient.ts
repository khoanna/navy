export const resolveRecipient = {
  name: 'resolve_recipient',
  description:
    'Use to look up who a @username or 0x address belongs to WITHOUT sending money (e.g. "who is @bob"). To actually send, call build_transfer directly — it resolves the handle itself. Do NOT use this if the user gave a full 0x address you can pass straight through.',
} as const;
