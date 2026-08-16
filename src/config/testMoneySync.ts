import Constants from 'expo-constants';

export { parseRemoteTestMoney } from './testMoneySyncPure';

function readExtraFeatureFlag(key: string): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { features?: Record<string, unknown> }
    | undefined;
  const value = extra?.features?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readEnvFlag(): string | undefined {
  return (
    process.env.EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC ??
    readExtraFeatureFlag('enableTestMoneySync')
  );
}

/**
 * Explicit opt-in only. Does NOT enable from __DEV__ alone so release Internal
 * Testing builds can turn it on via env without enabling it for store production.
 */
export function isTestMoneySyncEnabled(): boolean {
  return readEnvFlag() === 'true';
}

export const TEST_MONEY_SYNC_ENV_KEY = 'EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC';
