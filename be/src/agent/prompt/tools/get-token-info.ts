export const getTokenInfo = {
  name: 'get_token_info',
  description:
    'Use to answer any question about a specific cryptocurrency\'s price or market ("how much is BTC", "tell me about solana"). Accepts a name or symbol (e.g. "BTC", "bitcoin", "solana"). Returns price, 24h/7d/30d change, market cap, rank, supply, ATH, and a short description. Summarize and analyze the result for the user — do not dump raw numbers.',
} as const;
