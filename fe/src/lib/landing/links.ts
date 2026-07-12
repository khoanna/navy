/** Resolves the landing page's CTA targets. Plain-TS + injected env so it is
 *  unit-testable; the screen passes `process.env.NEXT_PUBLIC_WEB_WALLET_ORIGIN`. */

export const DEFAULT_WALLET_ORIGIN = 'http://localhost:3001';

export interface CtaLinks {
  wallet: string;
  merchant: string;
  adminLogin: string;
}

export function resolveLinks(env: { walletOrigin?: string }): CtaLinks {
  const origin = env.walletOrigin && env.walletOrigin.trim().length > 0
    ? env.walletOrigin.replace(/\/+$/, '')
    : DEFAULT_WALLET_ORIGIN;
  return {
    wallet: origin,
    merchant: '/merchant/login',
    adminLogin: '/admin/login',
  };
}
