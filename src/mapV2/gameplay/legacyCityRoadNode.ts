/**
 * Adapter: live gameplay cityId → ROAD operational planning node.
 * Does not migrate saves. Live Delivery.originCityId remains a cityId string.
 */
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS, type LegacyStableGameplayCityId } from '../domain/ids';
import { roadOperationalNodeId } from '../domain/multimodal';

export function isLegacyGameplayCityId(value: string): value is LegacyStableGameplayCityId {
  return (LEGACY_STABLE_GAMEPLAY_CITY_IDS as readonly string[]).includes(value);
}

export function roadOperationalNodeForLegacyCity(legacyCityId: string): string {
  return roadOperationalNodeId(legacyCityId);
}
