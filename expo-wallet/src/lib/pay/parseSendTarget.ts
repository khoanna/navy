import { isAddress, getAddress } from 'ethers';

export interface SendTarget { address: string; amountWei?: string }

/** Decode a scanned/pasted string into a send target: a raw 0x address or an EIP-681 URI. Null if neither. */
export function parseSendTarget(raw: string): SendTarget | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith('ethereum:')) {
    const rest = s.slice('ethereum:'.length);
    const q = rest.indexOf('?');
    const addr = (q === -1 ? rest : rest.slice(0, q)).split('@')[0].trim();
    if (!isAddress(addr)) return null;
    let amountWei: string | undefined;
    if (q !== -1) {
      const params = new URLSearchParams(rest.slice(q + 1));
      const v = params.get('value');
      if (v && /^\d+$/.test(v)) amountWei = v;
    }
    return amountWei ? { address: getAddress(addr), amountWei } : { address: getAddress(addr) };
  }
  if (isAddress(s)) return { address: getAddress(s) };
  return null;
}
