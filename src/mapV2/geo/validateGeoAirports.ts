import type { TurkeyAirportPackageV1 } from './geoAirport';

export type AirportValidationIssue = { code: string; message: string };

const TURKEY_WEST = 25.5;
const TURKEY_EAST = 45.1;
const TURKEY_SOUTH = 35.7;
const TURKEY_NORTH = 42.5;

export function validateTurkeyAirportPackage(pkg: TurkeyAirportPackageV1): AirportValidationIssue[] {
  const issues: AirportValidationIssue[] = [];
  const ids = new Set<string>();
  const iataSeen = new Map<string, string>();
  const icaoSeen = new Map<string, string>();
  for (const airport of pkg.airports) {
    if (ids.has(airport.id)) issues.push({ code: 'duplicate-id', message: airport.id });
    ids.add(airport.id);
    if (!airport.id.startsWith('infra.tur.airport.')) issues.push({ code: 'id-prefix', message: airport.id });
    if (!Number.isFinite(airport.position.longitude) || !Number.isFinite(airport.position.latitude)) {
      issues.push({ code: 'non-finite', message: airport.id });
    }
    if (!Number.isFinite(airport.projected.x) || !Number.isFinite(airport.projected.y)) {
      issues.push({ code: 'projected-non-finite', message: airport.id });
    }
    if (
      airport.position.longitude < TURKEY_WEST ||
      airport.position.longitude > TURKEY_EAST ||
      airport.position.latitude < TURKEY_SOUTH ||
      airport.position.latitude > TURKEY_NORTH
    ) {
      issues.push({ code: 'out-of-scope', message: airport.id });
    }
    if (new Set(airport.sourceIds).size !== airport.sourceIds.length) {
      issues.push({ code: 'duplicate-source-ids', message: airport.id });
    }
    if (airport.sourceIds.length === 0) issues.push({ code: 'missing-source-ids', message: airport.id });
    if (!airport.sourceIds.every((id) => /^(node|way|relation)\/\d+$/.test(id))) {
      issues.push({ code: 'source-id-format', message: airport.id });
    }
    if (airport.verificationStatus === 'VERIFIED') issues.push({ code: 'auto-verified', message: airport.id });
    if (airport.logisticsEligibility === 'MILITARY_RESTRICTED' && airport.cityAssociations.length > 0) {
      issues.push({ code: 'military-city-assoc', message: airport.id });
    }
    if (airport.logisticsEligibility === 'MILITARY_RESTRICTED' && airport.civilUse !== 'MILITARY' && airport.classification !== 'MILITARY_AIRFIELD') {
      issues.push({ code: 'military-class', message: airport.id });
    }
    if (airport.iataCode && !/^[A-Z]{3}$/.test(airport.iataCode)) issues.push({ code: 'iata-format', message: airport.id });
    if (airport.icaoCode && !/^[A-Z]{4}$/.test(airport.icaoCode)) issues.push({ code: 'icao-format', message: airport.id });
    if (airport.iataCode) {
      const prev = iataSeen.get(airport.iataCode);
      if (prev && prev !== airport.id) issues.push({ code: 'duplicate-iata', message: `${airport.iataCode}:${prev}:${airport.id}` });
      iataSeen.set(airport.iataCode, airport.id);
    }
    if (airport.icaoCode) {
      const prev = icaoSeen.get(airport.icaoCode);
      if (prev && prev !== airport.id) issues.push({ code: 'duplicate-icao', message: `${airport.icaoCode}:${prev}:${airport.id}` });
      icaoSeen.set(airport.icaoCode, airport.id);
    }
    if (airport.logisticsEligibility === 'LOGISTICS_ELIGIBLE' && airport.cargoCapability !== 'VERIFIED_SUPPORTED') {
      issues.push({ code: 'logistics-without-verified-cargo', message: airport.id });
    }
    if (airport.logisticsEligibility === 'LOGISTICS_ELIGIBLE_PREVIEW' && airport.cargoCapability !== 'PROVISIONAL_SUPPORTED') {
      issues.push({ code: 'preview-without-provisional-cargo', message: airport.id });
    }
    if (JSON.stringify(airport).includes('warehouseType')) issues.push({ code: 'warehouse-dependency', message: airport.id });
  }
  for (const row of pkg.cityAssociations) {
    for (const airportId of row.airportIds) {
      if (!ids.has(airportId)) issues.push({ code: 'city-airport-missing', message: `${row.gameplayCityId}:${airportId}` });
    }
    if (row.primaryPassengerAirportCandidateId && !row.airportIds.includes(row.primaryPassengerAirportCandidateId)) {
      issues.push({ code: 'passenger-primary-not-in-list', message: row.gameplayCityId });
    }
    if (row.primaryLogisticsAirportCandidateId && !row.airportIds.includes(row.primaryLogisticsAirportCandidateId) && row.primaryLogisticsAirportCandidateId) {
      const airport = pkg.airports.find((item) => item.id === row.primaryLogisticsAirportCandidateId);
      if (!airport || airport.logisticsEligibility !== 'LOGISTICS_ELIGIBLE') {
        issues.push({ code: 'logistics-primary-invalid', message: row.gameplayCityId });
      }
    }
    for (const access of row.airAccess) {
      if (!ids.has(access.geoAirportId)) issues.push({ code: 'air-access-missing', message: access.geoAirportId });
    }
  }
  return issues;
}

export function assertNoPlayerWarehouseDependency(pkg: TurkeyAirportPackageV1): boolean {
  return !JSON.stringify(pkg).includes('warehouseType');
}
