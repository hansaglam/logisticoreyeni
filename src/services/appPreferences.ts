/**
 * Oyuncu uygulama tercihleri — bildirim, ses, titreşim.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@logisticore/app-preferences/v1';

export interface AppPreferences {
  notificationsEnabled: boolean;
  vibrationEnabled: boolean;
  soundEnabled: boolean;
  /** Gelir özeti penceresi — dashboard toast */
  incomeSummaryEnabled: boolean;
}

const DEFAULT_PREFERENCES: AppPreferences = {
  notificationsEnabled: true,
  vibrationEnabled: true,
  soundEnabled: true,
  incomeSummaryEnabled: true,
};

let cached: AppPreferences | null = null;
const listeners = new Set<(prefs: AppPreferences) => void>();

function notify(): void {
  if (!cached) return;
  for (const listener of listeners) {
    listener(cached);
  }
}

export function getAppPreferences(): AppPreferences {
  return cached ?? DEFAULT_PREFERENCES;
}

export function subscribeAppPreferences(
  listener: (prefs: AppPreferences) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadAppPreferences(): Promise<AppPreferences> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cached = { ...DEFAULT_PREFERENCES };
      return cached;
    }
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    cached = { ...DEFAULT_PREFERENCES, ...parsed };
    return cached;
  } catch {
    cached = { ...DEFAULT_PREFERENCES };
    return cached;
  }
}

export async function updateAppPreference<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K],
): Promise<AppPreferences> {
  const next = { ...getAppPreferences(), [key]: value };
  cached = next;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  notify();
  return next;
}
