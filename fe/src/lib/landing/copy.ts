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
    body: 'An EVM payment ecosystem — the gateway, the wallet, and yield, in one voyage.',
    points: [],
  },
  {
    id: 'port',
    eyebrow: 'Port of trade · Merchants',
    title: 'Get paid in seconds.',
    body: 'Accept digital dollars with a gasless, replay-proof checkout.',
    points: ['USDC on Ethereum', '1% flat fee', 'Gasless for payers', 'Instant settlement + webhook'],
  },
  {
    id: 'sea',
    eyebrow: 'Open sea · Ethereum',
    title: 'Settled on-chain, fast.',
    body: 'Every order settles only after its on-chain payment event is confirmed.',
    points: ['Sub-second finality', 'On-chain proof', 'Amount + payer reconciled'],
  },
  {
    id: 'treasure',
    eyebrow: 'Treasure · Farming',
    title: 'Idle balance, put to work.',
    body: 'Opt in and your idle USDC earns yield in an auto-rebalancing vault across trusted lending markets.',
    points: ['ERC-4626 vault shares', 'Auto-rebalanced across venues', 'Gasless deposit & redeem'],
  },
] as const;

export interface Feature {
  title: string;
  body: string;
}

export const FEATURES: readonly Feature[] = [
  { title: 'The Wallet', body: 'Scan-to-pay, balances, and farming in a mobile-first web wallet.' },
  { title: 'The Gateway', body: 'Server-built invoices, two-signer gasless pay, HMAC webhooks.' },
  { title: 'Farming', body: 'Put idle balance to work in an auto-rebalancing ERC-4626 yield vault.' },
  { title: 'Security', body: 'Envelope-encrypted keys, authoritative on-chain policy checks.' },
] as const;

/** Which side the copy sits on per story beat (index-aligned to SCENE_COPY).
 *  Lives here so both VoyageBeats and mediaAlignFor share one source of truth. */
export const ALIGN: ReadonlyArray<'left' | 'right'> = ['left', 'right', 'left', 'right'];

/** The product mock floats on the edge OPPOSITE the copy, clearing the vessel. */
export function mediaAlignFor(id: SceneCopyItem['id']): 'left' | 'right' {
  const i = SCENE_COPY.findIndex((c) => c.id === id);
  return (ALIGN[i] ?? 'left') === 'left' ? 'right' : 'left';
}

/** Static, plausible devnet content for the per-beat product mocks. Strings live
 *  beside the rest of the landing copy so they're editable without touching JSX. */
export const PRODUCT_MOCKS = {
  sail: {
    balance: '$1,248.50',
    wallet: 'Main wallet',
    network: 'Devnet',
    change: '+$18.20 · 1.4% today',
    spark: [8, 11, 9, 13, 12, 17, 15, 21, 19, 24],
    actions: ['Send', 'Scan', 'Farm'],
    activity: [
      { icon: '↓', label: 'Received', sub: 'from 7bF…q2', amount: '+120.00' },
      { icon: '✦', label: 'Farm yield', sub: 'Save · devnet', amount: '+1.84' },
    ],
  },
  port: { merchant: 'Ocean Coffee', amount: '12.00', unit: 'USDC', badges: ['Gasless', '1% fee'], cta: 'Pay 12.00 USDC' },
  sea: {
    event: 'InvoicePaid', sig: '5Qx7…8Kd', status: 'Confirmed',
    rows: [['Amount', '12.00 USDC'], ['Fee', '0.12 USDC'], ['Payer', '9aF2…tuv']],
  },
  treasure: { protocol: 'Save · devnet', apy: '5.2%', principal: '820.00 USDC', badges: ['Non-custodial', 'Policy-guarded'] },
} as const;
