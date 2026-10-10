import type { TurkeyPortPackageV1 } from '../geo/geoPort';

let cached: TurkeyPortPackageV1 | null = null;

/** DEV/inspector only. Do not import from the player country dashboard. */
export function getTurkeyPortPackage(): TurkeyPortPackageV1 {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../generated/infrastructure/turkey-ports.json') as TurkeyPortPackageV1;
  return cached;
}
