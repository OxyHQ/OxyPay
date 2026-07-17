import Constants from 'expo-constants';

const fromExtra = (key: string): string | undefined => {
  const extra = (Constants?.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const value = extra[key];
  return typeof value === 'string' ? value : undefined;
};

export const config = {
  /** Oxy Pay backend base URL. */
  payApiBaseUrl:
    process.env.EXPO_PUBLIC_PAY_API_BASE_URL ||
    fromExtra('payApiBaseUrl') ||
    'http://localhost:3001',
  /** Oxy core API base URL (for auth, sessions). */
  oxyApiBaseUrl:
    process.env.EXPO_PUBLIC_OXY_API_BASE_URL ||
    fromExtra('oxyApiBaseUrl') ||
    'https://api.oxy.so',
  /**
   * Oxy Pay's registered Oxy OAuth client id (ApplicationCredential publicKey).
   * Required by @oxyhq/services for the cross-app device sign-in flow.
   */
  oxyClientId:
    process.env.EXPO_PUBLIC_OXY_CLIENT_ID ||
    fromExtra('oxyClientId') ||
    'oxy_dk_857cabdaba3f79ec5c931706424f439b67f3bc7b7bc34fca',
};
