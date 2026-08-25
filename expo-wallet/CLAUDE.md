@AGENTS.md

## Navy Expo Wallet Context

This is the end-user mobile wallet for Navy payments ecosystem.

**Key features:**
- Privy authentication (`@privy-io/expo`)
- USDC balances and payment scanning
- AI assistant for transactions (streams from `POST /agent/chat`)
- Farming vault integration (deposit/redeem navUSDC)

**Screen routing:** Uses Expo Router file-based routing in `app/` directory.

**AI Assistant:** Uses SSE streaming parser in `src/lib/agent/` (plain-TS, unit-tested). Tool results render via `src/features/assistant/*Card.tsx`.
