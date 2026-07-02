/**
 * @deprecated Harita ekranı networkPositions.ts kullanır.
 * Geriye dönük importlar için re-export.
 */

export {
  normalizeCityId,
  getNetworkCityPosition as getCityMapPosition,
  getNetworkCityPosition as getCityNetworkPosition,
  getCityPixelPosition,
  getDeliveryPixelPosition,
  NETWORK_CITY_POSITIONS as turkeyCityPositions,
} from './networkPositions';

export function getCityLabelOffset(_cityId: string): { x: number; y: number } {
  return { x: 0, y: 18 };
}
