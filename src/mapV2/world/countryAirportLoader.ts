import type { TurkeyAirportPackageV1 } from '../geo/geoAirport';

let cached: TurkeyAirportPackageV1 | null = null;

/** DEV/inspector only. Do not import from the player country dashboard. */
export function getTurkeyAirportPackage(): TurkeyAirportPackageV1 {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../generated/infrastructure/turkey-airports.json') as TurkeyAirportPackageV1;
  return cached;
}
