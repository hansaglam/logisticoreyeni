import { parseAirRouteDiagnostics, type AirRouteDiagnosticsV1 } from '../gameplay/roadAirRoadFixture';

let cached: AirRouteDiagnosticsV1 | null = null;

/**
 * DEV only. AIR *build report* of accepted geodesic diagnostics.
 * Not turkey-air-corridors.json visual geometry, and not on-device geodesic sampling.
 */
export function getTurkeyAirRouteDiagnostics(): AirRouteDiagnosticsV1 {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('../generated/countryOverview/turkey-air-corridors.report.json') as Parameters<
    typeof parseAirRouteDiagnostics
  >[0];
  cached = parseAirRouteDiagnostics(raw);
  return cached;
}
