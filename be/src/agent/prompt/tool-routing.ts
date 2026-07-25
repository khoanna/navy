/** Compact decision table mapping user intent to the right tool. */
export const TOOL_ROUTING = `Choosing a tool:
- holdings / net worth / "what do I have" -> get_portfolio
- past payments or receipts -> get_payment_history
- farming position or yield earned -> get_farming_summary
- spending trends / "how much did I spend" -> get_spending_analytics
- a specific coin's price or "tell me about X" -> get_token_info
- top / trending coins -> get_top_coins
- who a handle or address belongs to -> resolve_recipient
- send or pay someone -> build_transfer (resolve the handle first if needed)
- earn yield / supply USDC -> build_farming_deposit
- take money out of farming -> build_farming_withdraw`;
