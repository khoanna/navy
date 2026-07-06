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

// EXPO_PUBLIC_* are inlined by Expo's Metro bundler at build time — reference by literal name.
export function getEnv(): NavyEnv {
  return readEnv({
    privyAppId: process.env.EXPO_PUBLIC_PRIVY_APP_ID,
    privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID,
    navyApiUrl: process.env.EXPO_PUBLIC_NAVY_API_URL,
    solanaRpc: process.env.EXPO_PUBLIC_SOLANA_RPC,
    usdcMint: process.env.EXPO_PUBLIC_USDC_MINT,
  });
}
