import type { GeoPort, TurkeyPortPackageV1 } from './geoPort';

export type PortValidationIssue = { code: string; message: string };

const TURKEY_WEST = 25.5;
const TURKEY_EAST = 45.1;
const TURKEY_SOUTH = 35.7;
const TURKEY_NORTH = 42.5;

export function validateTurkeyPortPackage(pkg: TurkeyPortPackageV1): PortValidationIssue[] {
  const issues: PortValidationIssue[] = [];
  const ids = new Set<string>();
  for (const port of pkg.ports) {
    if (ids.has(port.id)) issues.push({ code: 'duplicate-id', message: port.id });
    ids.add(port.id);
    if (!port.id.startsWith('infra.tur.port.')) issues.push({ code: 'id-prefix', message: port.id });
    if (!Number.isFinite(port.position.longitude) || !Number.isFinite(port.position.latitude)) {
      issues.push({ code: 'non-finite', message: port.id });
    }
    if (
      port.position.longitude < TURKEY_WEST ||
      port.position.longitude > TURKEY_EAST ||
      port.position.latitude < TURKEY_SOUTH ||
      port.position.latitude > TURKEY_NORTH
    ) {
      issues.push({ code: 'out-of-scope', message: port.id });
    }
    if (new Set(port.sourceIds).size !== port.sourceIds.length) issues.push({ code: 'duplicate-source-ids', message: port.id });
    if (port.verificationStatus === 'VERIFIED') issues.push({ code: 'auto-verified', message: port.id });
    if (!port.seaAccess) issues.push({ code: 'missing-sea-access', message: port.id });
  }
  for (const row of pkg.cityAssociations) {
    for (const portId of row.portIds) {
      if (!ids.has(portId)) issues.push({ code: 'city-port-missing', message: `${row.gameplayCityId}:${portId}` });
    }
  }
  return issues;
}

export function assertNoPlayerWarehouseDependency(ports: readonly GeoPort[]): boolean {
  return ports.every((port) => !JSON.stringify(port).includes('warehouseType'));
}
