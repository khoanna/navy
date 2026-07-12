/** Static landing copy. Keeping it here (not JSX) makes the section components
 *  thin and lets us reorder beats without touching layout code. */

export interface SceneCopyItem {
  id: 'sail' | 'port' | 'sea' | 'treasure';
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
}

export const SCENE_COPY: readonly SceneCopyItem[] = [
  {
    id: 'sail',
    eyebrow: 'Set sail',
    title: 'Payments, set to sea.',
    body: 'A Solana payment ecosystem — the gateway, the wallet, and yield, in one voyage.',
    points: [],
  },
  {
    id: 'port',
    eyebrow: 'Port of trade · Merchants',
    title: 'Get paid in seconds.',
    body: 'Accept digital dollars with a gasless, replay-proof checkout.',
    points: ['USDC on Solana', '1% flat fee', 'Gasless for payers', 'Instant settlement + webhook'],
  },
  {
    id: 'sea',
    eyebrow: 'Open sea · Solana',
    title: 'Settled on-chain, fast.',
    body: 'Every order settles only after its on-chain payment event is confirmed.',
    points: ['Sub-second finality', 'On-chain proof', 'Amount + payer reconciled'],
  },
  {
    id: 'treasure',
    eyebrow: 'Treasure · Farming',
    title: 'Idle balance, put to work.',
    body: 'Opt in and your balance earns through a policy-guarded, non-custodial subwallet.',
    points: ['Non-custodial', 'Policy-guarded signing', 'Keys never touch the agent'],
  },
] as const;

export interface Feature {
  title: string;
  body: string;
}

export const FEATURES: readonly Feature[] = [
  { title: 'The Wallet', body: 'Scan-to-pay, balances, and farming in a mobile-first web wallet.' },
  { title: 'The Gateway', body: 'Server-built invoices, two-signer gasless pay, HMAC webhooks.' },
  { title: 'Farming', body: 'Put idle balance to work with guarded, non-custodial yield.' },
  { title: 'Security', body: 'Envelope-encrypted keys, authoritative on-chain policy checks.' },
] as const;
