export interface NavyEnv {
  privyAppId: string;
  privyClientId: string;
  navyApiUrl: string;
  solanaRpc: string;
  usdcMint: string;
}

type RawExtra = Partial<Record<keyof NavyEnv, string>>;

export function readEnv(extra: RawExtra): NavyEnv {
  const req = (k: keyof NavyEnv): string => {
    const v = extra[k];
    if (!v) throw new Error(`Missing required config: ${k}`);
    return v;
  };
  return {
    privyAppId: req('privyAppId'), privyClientId: req('privyClientId'), navyApiUrl: req('navyApiUrl'),
    solanaRpc: req('solanaRpc'), usdcMint: req('usdcMint'),
  };
}

// NEXT_PUBLIC_* are statically inlined by Next — must be referenced by literal name.
export function getEnv(): NavyEnv {
  return readEnv({
    privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    privyClientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
    navyApiUrl: process.env.NEXT_PUBLIC_NAVY_API_URL,
    solanaRpc: process.env.NEXT_PUBLIC_SOLANA_RPC,
    usdcMint: process.env.NEXT_PUBLIC_USDC_MINT,
  });
}
