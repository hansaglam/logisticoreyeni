/**
 * Haftalık sezon değişince liderlik skorunu otomatik sunucuya yazar.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getLeaderboardSeasonKey } from '../utils/leaderboardSeason';
import { getLeaderboardSubmitEligibility } from '../domain/leaderboardSubmitEligibility';
import { submitCurrentLeaderboardScore } from './leaderboardService';

const STORAGE_KEY = 'leaderboard:lastSubmittedSeasonKey';

let inFlight: Promise<void> | null = null;

export async function getLastSubmittedLeaderboardSeasonKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function markLeaderboardSeasonSubmitted(seasonKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, seasonKey);
  } catch {
    // non-fatal
  }
}

/**
 * Sezon anahtarı değiştiyse (Pazartesi rollover) skoru zorla gönder.
 * Uygulama açılışı / foreground / cloud sync sonrası çağrılır.
 */
export async function maybeSubmitLeaderboardForSeasonChange(): Promise<void> {
  if (inFlight) {
    await inFlight;
    return;
  }

  inFlight = (async () => {
    const eligibility = getLeaderboardSubmitEligibility();
    if (!eligibility.eligible) {
      return;
    }

    const currentSeasonKey = getLeaderboardSeasonKey();
    const lastSeasonKey = await getLastSubmittedLeaderboardSeasonKey();
    if (lastSeasonKey === currentSeasonKey) {
      return;
    }

    const result = await submitCurrentLeaderboardScore({ force: true });
    if (result.ok) {
      await markLeaderboardSeasonSubmitted(currentSeasonKey);
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
