import { parseRailRouteDiagnostics, type RailRouteDiagnosticsV1 } from '../gameplay/roadRailRoadFixture';

let cached: RailRouteDiagnosticsV1 | null = null;

/**
 * DEV only. Rail *build report* of canonical Dijkstra diagnostics.
 * Not turkey-rail-corridors.json visual geometry, and not the live RAIL network graph.
 */
export function getTurkeyRailRouteDiagnostics(): RailRouteDiagnosticsV1 {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('../generated/countryOverview/turkey-rail-corridors.report.json') as Parameters<
    typeof parseRailRouteDiagnostics
  >[0];
  cached = parseRailRouteDiagnostics(raw);
  return cached;
}
