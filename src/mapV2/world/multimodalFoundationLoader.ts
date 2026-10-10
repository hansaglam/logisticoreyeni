import { buildTurkeyMultimodalFoundation } from '../gameplay/multimodalFoundation';
import type { MultimodalFoundationView } from '../domain/multimodal';
import { getCityTransportAccessPackage } from './transportNetworkLoader';
import { getTurkeyAirportPackage } from './countryAirportLoader';
import { getTurkeyPortPackage } from './countryPortLoader';

let cached: MultimodalFoundationView | null = null;

/**
 * DEV / inspector / tests only.
 * Do not import from the player country dashboard or live delivery runtime.
 */
export function getTurkeyMultimodalFoundation(): MultimodalFoundationView {
  if (cached) return cached;
  cached = buildTurkeyMultimodalFoundation({
    railAccess: getCityTransportAccessPackage(),
    ports: getTurkeyPortPackage(),
    airports: getTurkeyAirportPackage(),
  });
  return cached;
}
