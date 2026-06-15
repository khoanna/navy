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

export function getEnv(): NavyEnv {
  const Constants = require('expo-constants').default;
  return readEnv((Constants?.expoConfig?.extra ?? {}) as RawExtra);
}
