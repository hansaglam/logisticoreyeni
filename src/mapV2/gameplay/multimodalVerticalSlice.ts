/**
 * Thin dispatcher: RAIL / SEA / AIR middle-leg adapters share MultimodalShipmentRuntime.
 * Not a second shipment engine. Adapters own eligibility, infra, diagnostics, lineage.
 */
import type { TurkeyPortPackageV1 } from '../geo/geoPort';
import type { MultimodalFoundationView } from '../domain/multimodal';
import {
  buildRoadAirRoadFixture,
  listRoadAirRoadEligiblePairs,
  type AirRouteDiagnosticsV1,
  type RoadAirRoadFixture,
} from './roadAirRoadFixture';
import {
  buildRoadRailRoadFixture,
  listRoadRailRoadEligiblePairs,
  type RailRouteDiagnosticsV1,
  type RoadRailRoadFixture,
} from './roadRailRoadFixture';
import {
  buildRoadSeaRoadFixture,
  listRoadSeaRoadEligiblePairs,
  type RoadSeaRoadFixture,
  type SeaRouteDiagnosticsV1,
} from './roadSeaRoadFixture';

export type MultimodalVerticalSlicePattern = 'ROAD_RAIL_ROAD' | 'ROAD_SEA_ROAD' | 'ROAD_AIR_ROAD';

export type MultimodalVerticalSliceFixture = RoadRailRoadFixture | RoadSeaRoadFixture | RoadAirRoadFixture;

export type MultimodalMiddleLegAdapter = 'RAIL' | 'SEA' | 'AIR';

export function listMultimodalVerticalSlicePairs(
  pattern: MultimodalVerticalSlicePattern,
  foundation: MultimodalFoundationView,
  railDiagnostics: RailRouteDiagnosticsV1,
  seaDiagnostics: SeaRouteDiagnosticsV1,
  airDiagnostics: AirRouteDiagnosticsV1,
): Array<{ origin: string; destination: string }> {
  if (pattern === 'ROAD_AIR_ROAD') return listRoadAirRoadEligiblePairs(foundation, airDiagnostics);
  if (pattern === 'ROAD_SEA_ROAD') return listRoadSeaRoadEligiblePairs(foundation, seaDiagnostics);
  return listRoadRailRoadEligiblePairs(foundation, railDiagnostics);
}

export function buildMultimodalVerticalSlice(input: {
  pattern: MultimodalVerticalSlicePattern;
  origin: string;
  destination: string;
  foundation: MultimodalFoundationView;
  railDiagnostics: RailRouteDiagnosticsV1;
  seaDiagnostics: SeaRouteDiagnosticsV1;
  airDiagnostics: AirRouteDiagnosticsV1;
  ports: TurkeyPortPackageV1;
}): MultimodalVerticalSliceFixture {
  if (input.pattern === 'ROAD_AIR_ROAD') {
    return buildRoadAirRoadFixture(input.origin, input.destination, input.foundation, input.airDiagnostics);
  }
  if (input.pattern === 'ROAD_SEA_ROAD') {
    return buildRoadSeaRoadFixture(
      input.origin,
      input.destination,
      input.foundation,
      input.seaDiagnostics,
      input.ports,
    );
  }
  return buildRoadRailRoadFixture(input.origin, input.destination, input.foundation, input.railDiagnostics);
}

export function middleLegAdapterForPattern(pattern: MultimodalVerticalSlicePattern): MultimodalMiddleLegAdapter {
  if (pattern === 'ROAD_AIR_ROAD') return 'AIR';
  if (pattern === 'ROAD_SEA_ROAD') return 'SEA';
  return 'RAIL';
}
