export interface ServerEnv { navyApiUrl: string; }

export function readServerEnv(src: Record<string, string | undefined>): ServerEnv {
  const navyApiUrl = src.NAVY_API_URL;
  if (!navyApiUrl) throw new Error('Missing required env: NAVY_API_URL');
  return { navyApiUrl };
}

export function serverEnv(): ServerEnv {
  return readServerEnv(process.env);
}
