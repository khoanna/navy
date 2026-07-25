export const buildTransfer = {
  name: 'build_transfer',
  description:
    'Use when the user wants to send or pay USDC/ETH to someone. Builds a proposal the user reviews and signs in-app; it NEVER moves funds. Call this DIRECTLY with the recipient the user named — pass a @username as-is (the backend resolves it); do NOT ask for a 0x address. Only call this once you have BOTH a recipient AND an explicit amount from the user: if the amount is missing or vague ("some", "a bit"), ask the user how much first — never assume or default an amount. amountBase is base units of the chosen asset: USDC has 6 decimals (1 USDC = 1000000); ETH is wei (1 ETH = 1000000000000000000). Default asset is USDC (gasless).',
} as const;
