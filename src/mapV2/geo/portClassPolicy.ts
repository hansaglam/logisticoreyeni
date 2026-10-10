export const PORT_CLASSIFICATION_POLICY_VERSION = 'map-v2-port-class-v2' as const;
export const PORT_CLUSTER_POLICY_VERSION = 'map-v2-port-cluster-v1' as const;
export const PORT_INGEST_PROCESSING_VERSION = 'map-v2-port-osm-1' as const;

export const PORT_CLASSIFICATIONS = [
  'COMMERCIAL_PORT',
  'CONTAINER_PORT',
  'FREIGHT_PORT',
  'FERRY_PORT',
  'INDUSTRIAL_PORT',
  'MARINA',
  'FISHING_HARBOUR',
  'UNKNOWN_PORT',
] as const;
export type PortClassification = (typeof PORT_CLASSIFICATIONS)[number];

export const PORT_LOGISTICS_ELIGIBILITY = [
  'LOGISTICS_ELIGIBLE',
  'PASSENGER_ONLY',
  'LOCAL_MARITIME',
  'NON_LOGISTICS',
  'UNRESOLVED',
] as const;
export type PortLogisticsEligibility = (typeof PORT_LOGISTICS_ELIGIBILITY)[number];

export const PORT_CAPABILITY_STATES = ['KNOWN_TRUE', 'KNOWN_FALSE', 'UNKNOWN'] as const;
export type PortCapabilityState = (typeof PORT_CAPABILITY_STATES)[number];

export type PortCapabilityEvidence = {
  container: PortCapabilityState;
  bulk: PortCapabilityState;
  generalCargo: PortCapabilityState;
  roRo: PortCapabilityState;
  ferry: PortCapabilityState;
  passenger: PortCapabilityState;
};

function tag(props: Record<string, unknown> | undefined, key: string): string {
  const raw = props?.[key];
  if (raw == null || raw === '') return '';
  return String(raw).trim().toLowerCase();
}

function cargoTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[;,|/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isPassengerFerryName(props: Record<string, unknown> | undefined): boolean {
  return /feribot|ferry|iskele|vapur/i.test(String(props?.name ?? ''));
}

export function hasCommercialPortSignal(props: Record<string, unknown> | undefined): boolean {
  const operator = String(props?.operator ?? '');
  const name = String(props?.name ?? '');
  if (isPassengerFerryName(props)) return false;
  if (/port management|liman işlet|terminal işlet/i.test(operator)) return true;
  if (/\bport\b/i.test(name) && !/marina|yat/i.test(name) && tag(props, 'amenity') !== 'ferry_terminal') return true;
  if (/\bliman/i.test(name) && !/marina|yat|iskele|vapur/i.test(name)) return true;
  return false;
}

export function isMarinaTags(props: Record<string, unknown> | undefined): boolean {
  const leisure = tag(props, 'leisure');
  const harbour = tag(props, 'harbour');
  const category = tag(props, 'seamark:harbour:category');
  if (leisure === 'marina' || leisure === 'slipway') return true;
  if (harbour === 'marina') return true;
  if (category === 'marina' || category === 'yacht' || category === 'yacht_harbour') return true;
  const name = String(props?.name ?? '').toLowerCase();
  if (/\bmarina\b|yat liman/.test(name) && tag(props, 'industrial') !== 'port' && tag(props, 'port') !== 'cargo') {
    return true;
  }
  return false;
}

export function isStandalonePier(props: Record<string, unknown> | undefined): boolean {
  if (tag(props, 'man_made') !== 'pier' && tag(props, 'man_made') !== 'breakwater') return false;
  if (tag(props, 'industrial') === 'port') return false;
  if (tag(props, 'harbour') === 'yes') return false;
  if (tag(props, 'amenity') === 'ferry_terminal') return false;
  if (tag(props, 'landuse') === 'harbour' || tag(props, 'landuse') === 'port') return false;
  return true;
}

export function isNoiseAmenity(props: Record<string, unknown> | undefined): boolean {
  const amenity = tag(props, 'amenity');
  if (!amenity) return false;
  if (amenity === 'ferry_terminal') return false;
  return ['toilets', 'shower', 'parking', 'ticket_validator', 'power'].includes(amenity);
}

export function classifyPortTags(props: Record<string, unknown> | undefined): {
  classification: PortClassification;
  eligibility: PortLogisticsEligibility;
  includeAsGeoPort: boolean;
  capabilities: PortCapabilityEvidence;
} {
  const industrial = tag(props, 'industrial');
  const landuse = tag(props, 'landuse');
  const harbour = tag(props, 'harbour');
  const amenity = tag(props, 'amenity');
  const port = tag(props, 'port');
  const cargo = cargoTokens(tag(props, 'cargo'));
  const manMade = tag(props, 'man_made');
  const seamark = tag(props, 'seamark:type');
  const ferry = tag(props, 'ferry');
  const hasPassengerCargo = cargo.some((token) => token.includes('passenger') || token === 'bicycle');
  const hasContainer = cargo.includes('container') || manMade === 'container_terminal';
  const hasRoRo = port === 'roro' || cargo.includes('vehicle') || cargo.includes('roro');
  const hasFreightCargo = hasContainer || cargo.includes('bulk') || cargo.includes('general') || port === 'cargo';
  const ferryTerminal = amenity === 'ferry_terminal' || ferry === 'yes';
  const portLand = industrial === 'port' || landuse === 'port' || landuse === 'harbour';

  const capabilities: PortCapabilityEvidence = {
    container: hasContainer ? 'KNOWN_TRUE' : 'UNKNOWN',
    bulk: cargo.includes('bulk') ? 'KNOWN_TRUE' : 'UNKNOWN',
    generalCargo: cargo.includes('general') || port === 'cargo' ? 'KNOWN_TRUE' : 'UNKNOWN',
    roRo: hasRoRo ? 'KNOWN_TRUE' : 'UNKNOWN',
    ferry: ferryTerminal ? 'KNOWN_TRUE' : 'UNKNOWN',
    passenger: hasPassengerCargo || ferryTerminal ? 'KNOWN_TRUE' : 'UNKNOWN',
  };

  if (isStandalonePier(props) || isNoiseAmenity(props)) {
    return { classification: 'UNKNOWN_PORT', eligibility: 'NON_LOGISTICS', includeAsGeoPort: false, capabilities };
  }
  if (isPassengerFerryName(props) && !hasFreightCargo && !hasContainer && port !== 'cargo') {
    return { classification: 'FERRY_PORT', eligibility: 'PASSENGER_ONLY', includeAsGeoPort: true, capabilities };
  }
  if (hasCommercialPortSignal(props) && (tag(props, 'harbour') === 'yes' || tag(props, 'industrial') === 'port' || tag(props, 'leisure') === 'marina')) {
    return { classification: 'COMMERCIAL_PORT', eligibility: 'LOGISTICS_ELIGIBLE', includeAsGeoPort: true, capabilities };
  }
  if (isMarinaTags(props) && !portLand && !hasFreightCargo) {
    return { classification: 'MARINA', eligibility: 'NON_LOGISTICS', includeAsGeoPort: false, capabilities };
  }
  if (tag(props, 'leisure') === 'slipway') {
    return { classification: 'UNKNOWN_PORT', eligibility: 'NON_LOGISTICS', includeAsGeoPort: false, capabilities };
  }

  if (hasContainer || manMade === 'container_terminal') {
    return { classification: 'CONTAINER_PORT', eligibility: 'LOGISTICS_ELIGIBLE', includeAsGeoPort: true, capabilities };
  }
  if (hasFreightCargo || port === 'cargo' || port === 'roro') {
    return { classification: 'FREIGHT_PORT', eligibility: 'LOGISTICS_ELIGIBLE', includeAsGeoPort: true, capabilities };
  }
  if (industrial === 'port') {
    return { classification: 'INDUSTRIAL_PORT', eligibility: 'LOGISTICS_ELIGIBLE', includeAsGeoPort: true, capabilities };
  }
  if (landuse === 'port') {
    return { classification: 'COMMERCIAL_PORT', eligibility: 'LOGISTICS_ELIGIBLE', includeAsGeoPort: true, capabilities };
  }
  if (landuse === 'harbour' && !isMarinaTags(props)) {
    return { classification: 'COMMERCIAL_PORT', eligibility: 'LOGISTICS_ELIGIBLE', includeAsGeoPort: true, capabilities };
  }
  if (harbour === 'yes') {
    if (hasPassengerCargo && !hasFreightCargo) {
      return { classification: 'FERRY_PORT', eligibility: 'PASSENGER_ONLY', includeAsGeoPort: true, capabilities };
    }
    const namedCommercial =
      /\bliman|\bport\b/i.test(String(props?.name ?? '')) && !isMarinaTags(props) && !isPassengerFerryName(props);
    if (namedCommercial || hasFreightCargo) {
      return { classification: 'COMMERCIAL_PORT', eligibility: 'LOGISTICS_ELIGIBLE', includeAsGeoPort: true, capabilities };
    }
    return { classification: 'UNKNOWN_PORT', eligibility: 'UNRESOLVED', includeAsGeoPort: true, capabilities };
  }
  if (ferryTerminal && !portLand && !hasFreightCargo) {
    return { classification: 'FERRY_PORT', eligibility: 'PASSENGER_ONLY', includeAsGeoPort: true, capabilities };
  }
  if (seamark === 'harbour' || seamark === 'harbour_basin') {
    const category = tag(props, 'seamark:harbour:category');
    if (category === 'fishing' || harbour === 'fishing') {
      return { classification: 'FISHING_HARBOUR', eligibility: 'LOCAL_MARITIME', includeAsGeoPort: true, capabilities };
    }
    if (category === 'marina') {
      return { classification: 'MARINA', eligibility: 'NON_LOGISTICS', includeAsGeoPort: false, capabilities };
    }
    return { classification: 'UNKNOWN_PORT', eligibility: 'UNRESOLVED', includeAsGeoPort: true, capabilities };
  }
  if (harbour === 'fishing' || tag(props, 'seamark:harbour:category') === 'fishing') {
    return { classification: 'FISHING_HARBOUR', eligibility: 'LOCAL_MARITIME', includeAsGeoPort: true, capabilities };
  }
  return { classification: 'UNKNOWN_PORT', eligibility: 'UNRESOLVED', includeAsGeoPort: false, capabilities };
}

export function mergeClusterClassification(
  rows: readonly { classification: PortClassification; eligibility: PortLogisticsEligibility }[],
): { classification: PortClassification; eligibility: PortLogisticsEligibility } {
  const rank: Record<PortClassification, number> = {
    CONTAINER_PORT: 80,
    FREIGHT_PORT: 70,
    INDUSTRIAL_PORT: 60,
    COMMERCIAL_PORT: 50,
    FERRY_PORT: 30,
    FISHING_HARBOUR: 20,
    UNKNOWN_PORT: 10,
    MARINA: 0,
  };
  let best = rows[0] ?? { classification: 'UNKNOWN_PORT' as const, eligibility: 'UNRESOLVED' as const };
  for (const row of rows) {
    if (rank[row.classification] > rank[best.classification]) best = row;
  }
  if (rows.some((row) => row.eligibility === 'LOGISTICS_ELIGIBLE')) {
    return { classification: best.classification, eligibility: 'LOGISTICS_ELIGIBLE' };
  }
  if (best.classification === 'FERRY_PORT') return { classification: 'FERRY_PORT', eligibility: 'PASSENGER_ONLY' };
  if (best.classification === 'FISHING_HARBOUR') return { classification: 'FISHING_HARBOUR', eligibility: 'LOCAL_MARITIME' };
  if (best.classification === 'MARINA') return { classification: 'MARINA', eligibility: 'NON_LOGISTICS' };
  return { classification: best.classification, eligibility: best.eligibility };
}

export function mergeCapabilities(rows: readonly PortCapabilityEvidence[]): PortCapabilityEvidence {
  const pick = (key: keyof PortCapabilityEvidence): PortCapabilityState => {
    if (rows.some((row) => row[key] === 'KNOWN_TRUE')) return 'KNOWN_TRUE';
    if (rows.some((row) => row[key] === 'KNOWN_FALSE') && rows.every((row) => row[key] !== 'KNOWN_TRUE')) {
      return rows.some((row) => row[key] === 'UNKNOWN') ? 'UNKNOWN' : 'KNOWN_FALSE';
    }
    return 'UNKNOWN';
  };
  return {
    container: pick('container'),
    bulk: pick('bulk'),
    generalCargo: pick('generalCargo'),
    roRo: pick('roRo'),
    ferry: pick('ferry'),
    passenger: pick('passenger'),
  };
}
