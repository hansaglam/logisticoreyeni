import { parseSeaRouteDiagnostics, type SeaRouteDiagnosticsV1 } from '../gameplay/roadSeaRoadFixture';

let cached: SeaRouteDiagnosticsV1 | null = null;

/**
 * DEV only. SEA *build report* of canonical Dijkstra diagnostics.
 * Not turkey-sea-corridors.json visual geometry, and not the live 98 MB sea graph.
 */
export function getTurkeySeaRouteDiagnostics(): SeaRouteDiagnosticsV1 {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('../generated/countryOverview/turkey-sea-corridors.report.json') as Parameters<
    typeof parseSeaRouteDiagnostics
  >[0];
  cached = parseSeaRouteDiagnostics(raw);
  return cached;
}
