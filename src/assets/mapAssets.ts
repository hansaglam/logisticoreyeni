/**
 * Harita ekranı görsel asset registry.
 */

import type { ImageSourcePropType } from 'react-native';

const turkeyLogisticsNetworkModule =
  require('../../assets/maps/turkey-logistics-network-map.png') as number;

/** @deprecated turkey-logistics-network-map.png kullanın */
const turkeyRoadNetworkModule =
  require('../../assets/maps/turkey-road-network-map.png') as number;

export const mapAssets = {
  turkeyLogisticsNetwork: turkeyLogisticsNetworkModule as ImageSourcePropType,
  /** @deprecated Use turkeyLogisticsNetwork */
  turkeyRoadNetwork: turkeyRoadNetworkModule as ImageSourcePropType,
} as const;

export function getTurkeyLogisticsNetworkMap(): ImageSourcePropType {
  return mapAssets.turkeyLogisticsNetwork;
}

export function getTurkeyLogisticsNetworkMapModule(): number {
  return turkeyLogisticsNetworkModule;
}

/** @deprecated Use getTurkeyLogisticsNetworkMap */
export function getTurkeyRoadNetworkMap(): ImageSourcePropType {
  return mapAssets.turkeyRoadNetwork;
}

/** @deprecated Use getTurkeyLogisticsNetworkMapModule */
export function getTurkeyRoadNetworkMapModule(): number {
  return turkeyRoadNetworkModule;
}
