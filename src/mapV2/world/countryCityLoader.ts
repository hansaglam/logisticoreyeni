import type { CountryCityPackageV1, GeoCityRecord } from '../geo/cityPackage';

let cached: CountryCityPackageV1 | null = null;

export function getTurkeyCityPackage(): CountryCityPackageV1 {
  if (cached) return cached;
  // Bundled DEV package. Not a production MapData release.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../generated/cities/turkeyCityPackage.json') as CountryCityPackageV1;
  return cached;
}

export function getTurkeyCities(): GeoCityRecord[] {
  return getTurkeyCityPackage().cities;
}

export function getTurkeyCityById(geoCityId: string): GeoCityRecord | undefined {
  return getTurkeyCities().find((city) => city.geoCityId === geoCityId);
}

export function gameplayIdForGeoCity(geoCityId: string): string | undefined {
  return getTurkeyCityPackage().gameplayMappings.find((row) => row.geoCityId === geoCityId)?.gameplayCityId;
}

export function geoCityIdForGameplayCity(gameplayCityId: string): string | undefined {
  return getTurkeyCityPackage().gameplayMappings.find((row) => row.gameplayCityId === gameplayCityId)?.geoCityId;
}

export function mappedGeoCityIds(): string[] {
  return getTurkeyCityPackage().gameplayMappings.map((row) => row.geoCityId);
}

export function turkeyOverviewGameplayCities(): GeoCityRecord[] {
  const mapped = new Set(mappedGeoCityIds());
  return getTurkeyCities().filter((city) => mapped.has(city.geoCityId));
}
