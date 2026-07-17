export interface NavyEnv {
  privyAppId: string;
  privyClientId: string;
  navyApiUrl: string;
  /** Ethereum Sepolia JSON-RPC endpoint (used for balance reads). */
  sepoliaRpc: string;
  /** USDC (6-decimal) ERC-20 contract address on Sepolia. */
  usdcAddress: string;
  /** EVM chain id (Sepolia = 11155111), kept as a string in config. */
  chainId: string;
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
    sepoliaRpc: req('sepoliaRpc'), usdcAddress: req('usdcAddress'), chainId: req('chainId'),
  };
}

// EXPO_PUBLIC_* are inlined by Expo's Metro bundler at build time — reference by literal name.
export function getEnv(): NavyEnv {
  return readEnv({
    privyAppId: process.env.EXPO_PUBLIC_PRIVY_APP_ID,
    privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID,
    navyApiUrl: process.env.EXPO_PUBLIC_NAVY_API_URL,
    sepoliaRpc: process.env.EXPO_PUBLIC_SEPOLIA_RPC,
    usdcAddress: process.env.EXPO_PUBLIC_USDC_ADDRESS,
    chainId: process.env.EXPO_PUBLIC_CHAIN_ID,
  });
}
