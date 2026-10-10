import type { GameplayCityId, GeoCityId } from './ids';
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from './ids';

export type GameplayCityGeoMappingStatus = 'UNRESOLVED' | 'VERIFIED' | 'DEPRECATED';

export const GAMEPLAY_CITY_GEO_MAPPING_VERSION = 1 as const;

export interface GameplayCityGeoMapping {
  gameplayCityId: GameplayCityId;
  geoCityId: GeoCityId | null;
  mappingStatus: GameplayCityGeoMappingStatus;
  mappingVersion: number;
}

export function createUnresolvedGameplayCityMapping(
  gameplayCityId: GameplayCityId,
): GameplayCityGeoMapping {
  return {
    gameplayCityId,
    geoCityId: null,
    mappingStatus: 'UNRESOLVED',
    mappingVersion: GAMEPLAY_CITY_GEO_MAPPING_VERSION,
  };
}

/** Canonical UNRESOLVED table — no invented geoCityId values. */
export const UNRESOLVED_GAMEPLAY_CITY_GEO_MAPPINGS: readonly GameplayCityGeoMapping[] =
  LEGACY_STABLE_GAMEPLAY_CITY_IDS.map(createUnresolvedGameplayCityMapping);

export interface LegacyRouteMapping {
  fromGameplayCityId: GameplayCityId;
  toGameplayCityId: GameplayCityId;
  gameplayEdgeId: string | null;
  mappingStatus: GameplayCityGeoMappingStatus;
  mappingVersion: number;
}

export interface PlayerCountryProgressDraft {
  geoCountryId: string;
  unlockStatus: 'LOCKED' | 'AVAILABLE' | 'UNLOCKED';
  unlockedAt?: number;
}

export interface PlayerCityProgressDraft {
  gameplayCityId: GameplayCityId;
  geoCityId: GeoCityId | null;
  unlockStatus: 'LOCKED' | 'AVAILABLE' | 'UNLOCKED';
}
