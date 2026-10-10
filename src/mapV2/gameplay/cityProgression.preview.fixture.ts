/**
 * DEV_PREVIEW_ONLY / PROVISIONAL_DEV_ONLY
 * Visual city-lock fixture for Map V2. Not final balancing. Not a save schema.
 * Warehouse cityUnlockLevels in levelConfig remain warehouse-opening rules, not this policy.
 */
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../domain/ids';
import type { CityUnlockPolicy } from './cityProgression';
import { resolveStarterGameplayCityId } from './cityProgression';

export const MAP_V2_CITY_PROGRESSION_PREVIEW_POLICY_ID = 'map-v2-city-progression-preview-dev-v1' as const;

const PREVIEW_UNLOCKED_AFTER_STARTER = 2;

/**
 * Home/starter is always open. Next two cities in catalog order are UNLOCKED.
 * Remaining cities are LOCKED with provisional AND requirements.
 */
export function buildTurkeyCityProgressionPreviewPolicies(
  homeCityId: string | null | undefined,
): CityUnlockPolicy[] {
  const starter = resolveStarterGameplayCityId(homeCityId);
  const order = LEGACY_STABLE_GAMEPLAY_CITY_IDS.filter((id) => id !== starter);
  const unlocked = order.slice(0, PREVIEW_UNLOCKED_AFTER_STARTER);
  const locked = order.slice(PREVIEW_UNLOCKED_AFTER_STARTER);

  const policies: CityUnlockPolicy[] = [
    {
      cityId: starter,
      availability: 'STARTER',
      requirements: [],
      displayPriority: 0,
      provisionalDevOnly: true,
    },
  ];

  unlocked.forEach((cityId, index) => {
    policies.push({
      cityId,
      availability: 'UNLOCKED',
      requirements: [{ type: 'PLAYER_LEVEL', level: 1 }],
      displayPriority: index + 1,
      provisionalDevOnly: true,
    });
  });

  locked.forEach((cityId, index) => {
    const requirements: CityUnlockPolicy['requirements'] =
      cityId === 'bursa'
        ? [
            { type: 'PLAYER_LEVEL', level: 8 },
            { type: 'REPUTATION', value: 40 },
          ]
        : cityId === 'antalya'
          ? [{ type: 'CASH', amount: 25_000 }]
          : cityId === 'adana'
            ? [{ type: 'CITY_UNLOCKED', cityId: starter }]
            : cityId === 'trabzon'
              ? [{ type: 'WAREHOUSE_IN_CITY', cityId: starter }]
              : [{ type: 'PLAYER_LEVEL', level: 9 }];
    policies.push({
      cityId,
      availability: 'LOCKED',
      requirements,
      displayPriority: unlocked.length + 1 + index,
      provisionalDevOnly: true,
    });
  });

  return policies;
}

export function buildLegacyAllUnlockedPolicies(homeCityId: string | null | undefined): CityUnlockPolicy[] {
  const starter = resolveStarterGameplayCityId(homeCityId);
  return LEGACY_STABLE_GAMEPLAY_CITY_IDS.map((cityId, index) => ({
    cityId,
    availability: cityId === starter ? 'STARTER' : 'UNLOCKED',
    requirements: [],
    displayPriority: index,
    provisionalDevOnly: false,
  }));
}
