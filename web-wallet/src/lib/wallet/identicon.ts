/** Wallet short-form: `first4…last4`, or a provisioning placeholder. */
export function short(addr?: string): string {
  return addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : 'provisioning…';
}

/** Deterministic two-stop gradient derived from the wallet address — each
 *  wallet gets its own identicon so the avatar means something. */
export function avatarColors(addr?: string): [string, string] {
  if (!addr) return ['#3D74FF', '#2FE0C2'];
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return [`hsl(${hue} 72% 62%)`, `hsl(${(hue + 48) % 360} 76% 54%)`];
}
