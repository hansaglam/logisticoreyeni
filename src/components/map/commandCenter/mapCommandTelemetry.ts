/**
 * Display counts already held by the map screen.
 * Does not derive cash, fuel, XP, or settlement.
 */

export interface MapCommandTelemetry {
  activeDeliveries: number;
  vehiclesOnRoad: number;
  availableVehicles: number;
  warehouseCount: number;
}

export function buildMapCommandTelemetry(input: MapCommandTelemetry): MapCommandTelemetry {
  return {
    activeDeliveries: finiteCount(input.activeDeliveries),
    vehiclesOnRoad: finiteCount(input.vehiclesOnRoad),
    availableVehicles: finiteCount(input.availableVehicles),
    warehouseCount: finiteCount(input.warehouseCount),
  };
}

function finiteCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
