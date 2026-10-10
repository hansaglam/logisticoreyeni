/**
 * Production multimodal RAIL third-party carrier tariff (Map V2 Step 26).
 *
 * Pure / deterministic planning estimate. Does not move money, settle,
 * generate contracts, or import Map V2 prototypes / graphs / OSM.
 *
 * Monetary coefficients are GAMEPLAY_BALANCE_CONSTANT values.
 * They are not TCDD or any official railway tariff.
 */

export const MULTIMODAL_RAIL_TARIFF_POLICY_VERSION = 'multimodal-rail-tariff-v1' as const;

export const RAIL_TARIFF_DISTANCE_AUTHORITY = 'SOURCE_BACKED_RAIL_LENGTH' as const;

export const RAIL_TARIFF_CARGO_QUANTITY_UNIT = 'tonnes' as const;

/** Integer game dollars — same unit as Contract.payment and player.money. */
export const RAIL_TARIFF_CURRENCY = 'USD_GAME_INTEGER' as const;

/**
 * ECMAScript Math.round: ties round toward +∞ for positive values.
 * Matches production contractEconomics / finance Math.round usage.
 */
export const RAIL_TARIFF_ROUNDING_POLICY = 'math-round-half-toward-plus-infinity-integer-dollars' as const;

/** Frozen OSM RAIL package hash from the accepted corridor diagnostics report. */
export const RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH =
  'sha256:979ab9b9cae0645f4500f607234e735d4e71c6d22caea97c6577ae0ad5cb7d2b' as const;

export const RAIL_TARIFF_ROUTE_ALGORITHM_VERSION =
  'dijkstra-length-usageweight-undirected-overview-v1' as const;

/**
 * GAMEPLAY_BALANCE_CONSTANT — fixed third-party handling / booking fee.
 * Not derived from Step 24 transfer dwell (2700 g-s).
 */
export const RAIL_TARIFF_BASE_FEE_DOLLARS = 350;

/**
 * GAMEPLAY_BALANCE_CONSTANT — dollars per tonne-kilometre of source-backed RAIL length.
 * Quantity unit is production Contract.cargoWeight / Contract.amount (tonnes).
 */
export const RAIL_TARIFF_RATE_DOLLARS_PER_TONNE_KM = 0.08;

/** GAMEPLAY_BALANCE_CONSTANT — floor after base + line-haul (before this is not applied as a fake default cargo). */
export const RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS = 500;

/**
 * ROAD↔RAIL terminal monetary fee is explicitly zero in v1.
 * Transfer TIME remains Step 24 dwell; time is not converted to money.
 */
export const RAIL_TARIFF_TERMINAL_HANDLING_DOLLARS = 0;

export const RAIL_UNRESOLVED_CITY_IDS = ['antalya', 'bursa', 'trabzon'] as const;

export type RailTariffStatus =
  | 'READY'
  | 'INVALID_INPUT'
  | 'INVALID_DISTANCE'
  | 'INVALID_CARGO_QUANTITY'
  | 'UNSUPPORTED_CARGO_UNIT'
  | 'MISSING_ROUTE_REFERENCE'
  | 'UNSUPPORTED_RAIL_ROUTE'
  | 'UNRESOLVED_RAIL_INFRASTRUCTURE'
  | 'UNSUPPORTED_SCHEMA'
  | 'NOT_EXECUTABLE'
  | 'UNSAFE_ARITHMETIC';

export type AcceptedRailTariffCorridor = {
  leftCityId: string;
  rightCityId: string;
  routeReference: string;
  distanceMeters: number;
  corridorId: string;
};

/**
 * Frozen source-backed line-haul lengths (integer metres) from
 * turkey-rail-corridors.report.json `sourceRouteLengthMeters`.
 * Undirected overview graph ⇒ A→B and B→A share this table.
 */
export const ACCEPTED_RAIL_TARIFF_CORRIDORS: readonly AcceptedRailTariffCorridor[] = [
  {
    leftCityId: 'adana',
    rightCityId: 'ankara',
    routeReference: 'domain.canonical.rail.adana.ankara',
    distanceMeters: 624830,
    corridorId: 'corridor.tur.rail.adana.ankara.v1',
  },
  {
    leftCityId: 'adana',
    rightCityId: 'diyarbakir',
    routeReference: 'domain.canonical.rail.adana.diyarbakir',
    distanceMeters: 968295,
    corridorId: 'corridor.tur.rail.adana.diyarbakir.v1',
  },
  {
    leftCityId: 'ankara',
    rightCityId: 'istanbul',
    routeReference: 'domain.canonical.rail.ankara.istanbul',
    distanceMeters: 559329,
    corridorId: 'corridor.tur.rail.ankara.istanbul.v1',
  },
  {
    leftCityId: 'ankara',
    rightCityId: 'izmir',
    routeReference: 'domain.canonical.rail.ankara.izmir',
    distanceMeters: 812366,
    corridorId: 'corridor.tur.rail.ankara.izmir.v1',
  },
  {
    leftCityId: 'istanbul',
    rightCityId: 'izmir',
    routeReference: 'domain.canonical.rail.istanbul.izmir',
    distanceMeters: 874998,
    corridorId: 'corridor.tur.rail.istanbul.izmir.v1',
  },
];

const CORRIDOR_BY_REFERENCE = new Map(
  ACCEPTED_RAIL_TARIFF_CORRIDORS.map((row) => [row.routeReference, row]),
);

export type MultimodalRailTariffInput = {
  routeReference?: string | null;
  distanceMeters?: number | null;
  distanceAuthority?: string | null;
  cargoQuantity?: number | null;
  cargoQuantityUnit?: string | null;
  /** Optional; if present must match the accepted OSM RAIL package hash. */
  sourceRailPackageHash?: string | null;
  cargoType?: string | null;
  /** CHARGE is never executable in this module. */
  intent?: 'PLAN' | 'CHARGE';
};

export type MultimodalRailTariffEstimate = {
  status: RailTariffStatus;
  policyVersion: typeof MULTIMODAL_RAIL_TARIFF_POLICY_VERSION;
  routeReference: string | null;
  distanceMeters: number | null;
  distanceAuthority: typeof RAIL_TARIFF_DISTANCE_AUTHORITY | null;
  cargoQuantity: number | null;
  cargoQuantityUnit: typeof RAIL_TARIFF_CARGO_QUANTITY_UNIT | null;
  baseCharge: number | null;
  distanceQuantityCharge: number | null;
  minimumChargeAdjustment: number | null;
  transferCharge: number | null;
  totalCarrierCost: number | null;
  currency: typeof RAIL_TARIFF_CURRENCY;
  roundingPolicy: typeof RAIL_TARIFF_ROUNDING_POLICY;
  geography: {
    sourceRailPackageHash: typeof RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH;
    routeAlgorithmVersion: typeof RAIL_TARIFF_ROUTE_ALGORITHM_VERSION;
    corridorId: string | null;
    distanceKind: 'SOURCE_BACKED_RAIL_LENGTH';
    pricingSymmetric: true;
  };
  design: {
    kind: 'GAMEPLAY_BALANCE_CONSTANT';
    notOfficialRailwayTariff: true;
    equation: 'max(minimum, baseFee + round(distanceKm * tonnes * rate) + terminalFee)';
    baseFeeDollars: typeof RAIL_TARIFF_BASE_FEE_DOLLARS;
    rateDollarsPerTonneKm: typeof RAIL_TARIFF_RATE_DOLLARS_PER_TONNE_KM;
    minimumChargeDollars: typeof RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS;
    terminalHandlingDollars: typeof RAIL_TARIFF_TERMINAL_HANDLING_DOLLARS;
    cargoTypeModifiers: 'none';
    cityModifiers: 'none';
    playerLevelModifiers: 'none';
    capacityModel: 'abstract-third-party-capacity';
  };
  diagnostic: string | null;
};

function fail(
  status: RailTariffStatus,
  diagnostic: string,
  partial?: Partial<Pick<MultimodalRailTariffEstimate, 'routeReference' | 'distanceMeters' | 'cargoQuantity'>>,
): MultimodalRailTariffEstimate {
  return {
    status,
    policyVersion: MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
    routeReference: partial?.routeReference ?? null,
    distanceMeters: partial?.distanceMeters ?? null,
    distanceAuthority: null,
    cargoQuantity: partial?.cargoQuantity ?? null,
    cargoQuantityUnit: null,
    baseCharge: null,
    distanceQuantityCharge: null,
    minimumChargeAdjustment: null,
    transferCharge: null,
    totalCarrierCost: null,
    currency: RAIL_TARIFF_CURRENCY,
    roundingPolicy: RAIL_TARIFF_ROUNDING_POLICY,
    geography: {
      sourceRailPackageHash: RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH,
      routeAlgorithmVersion: RAIL_TARIFF_ROUTE_ALGORITHM_VERSION,
      corridorId: null,
      distanceKind: 'SOURCE_BACKED_RAIL_LENGTH',
      pricingSymmetric: true,
    },
    design: {
      kind: 'GAMEPLAY_BALANCE_CONSTANT',
      notOfficialRailwayTariff: true,
      equation: 'max(minimum, baseFee + round(distanceKm * tonnes * rate) + terminalFee)',
      baseFeeDollars: RAIL_TARIFF_BASE_FEE_DOLLARS,
      rateDollarsPerTonneKm: RAIL_TARIFF_RATE_DOLLARS_PER_TONNE_KM,
      minimumChargeDollars: RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS,
      terminalHandlingDollars: RAIL_TARIFF_TERMINAL_HANDLING_DOLLARS,
      cargoTypeModifiers: 'none',
      cityModifiers: 'none',
      playerLevelModifiers: 'none',
      capacityModel: 'abstract-third-party-capacity',
    },
    diagnostic,
  };
}

export function canonicalRailTariffRouteReference(cityA: string, cityB: string): string {
  const [left, right] = [cityA, cityB].map((id) => id.trim().toLowerCase()).sort();
  return `domain.canonical.rail.${left}.${right}`;
}

export function findAcceptedRailTariffCorridor(
  routeReference: string,
): AcceptedRailTariffCorridor | undefined {
  return CORRIDOR_BY_REFERENCE.get(routeReference);
}

function parseCanonicalRailPair(
  routeReference: string,
): { left: string; right: string } | null {
  const match = /^domain\.canonical\.rail\.([a-z]+)\.([a-z]+)$/.exec(routeReference);
  if (!match) return null;
  const left = match[1];
  const right = match[2];
  if (left >= right) return null;
  return { left, right };
}

function isUnresolvedCity(cityId: string): boolean {
  return (RAIL_UNRESOLVED_CITY_IDS as readonly string[]).includes(cityId);
}

/**
 * Planned third-party RAIL carrier COST. Never player reward, never settlement.
 */
export function estimateMultimodalRailTariff(
  input: MultimodalRailTariffInput,
): MultimodalRailTariffEstimate {
  if (input.intent === 'CHARGE') {
    return fail('NOT_EXECUTABLE', 'rail tariff domain is planning-only; CHARGE is not executable');
  }

  const ref = typeof input.routeReference === 'string' ? input.routeReference.trim() : '';
  if (!ref) {
    return fail('MISSING_ROUTE_REFERENCE', 'routeReference is required');
  }

  const parsed = parseCanonicalRailPair(ref);
  if (!parsed) {
    return fail('UNSUPPORTED_SCHEMA', `routeReference is not a sorted domain.canonical.rail pair: ${ref}`, {
      routeReference: ref,
    });
  }

  if (isUnresolvedCity(parsed.left) || isUnresolvedCity(parsed.right)) {
    return fail('UNRESOLVED_RAIL_INFRASTRUCTURE', `RAIL city unresolved: ${parsed.left}/${parsed.right}`, {
      routeReference: ref,
    });
  }

  const corridor = CORRIDOR_BY_REFERENCE.get(ref);
  if (!corridor) {
    return fail('UNSUPPORTED_RAIL_ROUTE', `no accepted RAIL tariff corridor for ${ref}`, {
      routeReference: ref,
    });
  }

  if (input.distanceAuthority !== RAIL_TARIFF_DISTANCE_AUTHORITY) {
    return fail('INVALID_DISTANCE', 'distanceAuthority must be SOURCE_BACKED_RAIL_LENGTH', {
      routeReference: ref,
    });
  }

  const meters = input.distanceMeters;
  if (meters == null || typeof meters !== 'number') {
    return fail('INVALID_DISTANCE', 'distanceMeters is required', { routeReference: ref });
  }
  if (!Number.isFinite(meters) || meters <= 0) {
    return fail('INVALID_DISTANCE', 'distanceMeters must be a finite number > 0', {
      routeReference: ref,
      distanceMeters: Number.isFinite(meters) ? meters : null,
    });
  }
  if (meters !== corridor.distanceMeters) {
    return fail(
      'INVALID_DISTANCE',
      `distanceMeters ${meters} does not match frozen source-backed ${corridor.distanceMeters}`,
      { routeReference: ref, distanceMeters: meters },
    );
  }

  if (
    input.sourceRailPackageHash != null &&
    input.sourceRailPackageHash !== RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH
  ) {
    return fail('INVALID_INPUT', 'sourceRailPackageHash does not match accepted RAIL package', {
      routeReference: ref,
      distanceMeters: meters,
    });
  }

  if (input.cargoQuantityUnit !== RAIL_TARIFF_CARGO_QUANTITY_UNIT) {
    return fail('UNSUPPORTED_CARGO_UNIT', 'cargoQuantityUnit must be tonnes (production Contract mass)', {
      routeReference: ref,
      distanceMeters: meters,
    });
  }

  const qty = input.cargoQuantity;
  if (qty == null || typeof qty !== 'number') {
    return fail('INVALID_CARGO_QUANTITY', 'cargoQuantity is required', {
      routeReference: ref,
      distanceMeters: meters,
    });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return fail('INVALID_CARGO_QUANTITY', 'cargoQuantity must be a finite number > 0', {
      routeReference: ref,
      distanceMeters: meters,
      cargoQuantity: Number.isFinite(qty) ? qty : null,
    });
  }

  const rate = RAIL_TARIFF_RATE_DOLLARS_PER_TONNE_KM;
  const base = RAIL_TARIFF_BASE_FEE_DOLLARS;
  const minCharge = RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS;
  const transfer = RAIL_TARIFF_TERMINAL_HANDLING_DOLLARS;
  if (![rate, base, minCharge, transfer].every((n) => Number.isFinite(n) && n >= 0)) {
    return fail('UNSAFE_ARITHMETIC', 'tariff constants are not finite non-negative', {
      routeReference: ref,
      distanceMeters: meters,
      cargoQuantity: qty,
    });
  }

  const distanceKm = meters / 1000;
  const rawLineHaul = distanceKm * qty * rate;
  if (!Number.isFinite(rawLineHaul) || rawLineHaul < 0) {
    return fail('UNSAFE_ARITHMETIC', 'line-haul product is not a finite non-negative number', {
      routeReference: ref,
      distanceMeters: meters,
      cargoQuantity: qty,
    });
  }

  const distanceQuantityCharge = Math.round(rawLineHaul);
  if (!Number.isSafeInteger(distanceQuantityCharge) || distanceQuantityCharge < 0) {
    return fail('UNSAFE_ARITHMETIC', 'rounded line-haul is not a safe non-negative integer', {
      routeReference: ref,
      distanceMeters: meters,
      cargoQuantity: qty,
    });
  }

  const gross = base + distanceQuantityCharge + transfer;
  if (!Number.isSafeInteger(gross) || gross < 0) {
    return fail('UNSAFE_ARITHMETIC', 'gross carrier charge overflow', {
      routeReference: ref,
      distanceMeters: meters,
      cargoQuantity: qty,
    });
  }

  const totalCarrierCost = Math.max(minCharge, gross);
  if (!Number.isSafeInteger(totalCarrierCost) || totalCarrierCost < 0) {
    return fail('UNSAFE_ARITHMETIC', 'total carrier cost overflow', {
      routeReference: ref,
      distanceMeters: meters,
      cargoQuantity: qty,
    });
  }

  const minimumChargeAdjustment = totalCarrierCost - gross;

  return {
    status: 'READY',
    policyVersion: MULTIMODAL_RAIL_TARIFF_POLICY_VERSION,
    routeReference: ref,
    distanceMeters: meters,
    distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
    cargoQuantity: qty,
    cargoQuantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
    baseCharge: base,
    distanceQuantityCharge,
    minimumChargeAdjustment,
    transferCharge: transfer,
    totalCarrierCost,
    currency: RAIL_TARIFF_CURRENCY,
    roundingPolicy: RAIL_TARIFF_ROUNDING_POLICY,
    geography: {
      sourceRailPackageHash: RAIL_TARIFF_EXPECTED_SOURCE_PACKAGE_HASH,
      routeAlgorithmVersion: RAIL_TARIFF_ROUTE_ALGORITHM_VERSION,
      corridorId: corridor.corridorId,
      distanceKind: 'SOURCE_BACKED_RAIL_LENGTH',
      pricingSymmetric: true,
    },
    design: {
      kind: 'GAMEPLAY_BALANCE_CONSTANT',
      notOfficialRailwayTariff: true,
      equation: 'max(minimum, baseFee + round(distanceKm * tonnes * rate) + terminalFee)',
      baseFeeDollars: RAIL_TARIFF_BASE_FEE_DOLLARS,
      rateDollarsPerTonneKm: RAIL_TARIFF_RATE_DOLLARS_PER_TONNE_KM,
      minimumChargeDollars: RAIL_TARIFF_MINIMUM_CHARGE_DOLLARS,
      terminalHandlingDollars: RAIL_TARIFF_TERMINAL_HANDLING_DOLLARS,
      cargoTypeModifiers: 'none',
      cityModifiers: 'none',
      playerLevelModifiers: 'none',
      capacityModel: 'abstract-third-party-capacity',
    },
    diagnostic: null,
  };
}

/**
 * Future acceptance freeze (not written to live save in Step 26).
 * Resume must reuse these values; never re-price from a later policy version.
 */
export type FutureMultimodalRailEconomicSnapshot = {
  railTariffPolicyVersion: typeof MULTIMODAL_RAIL_TARIFF_POLICY_VERSION;
  railCarrierCost: number;
  currency: typeof RAIL_TARIFF_CURRENCY;
  routeReference: string;
  distanceMeters: number;
  cargoQuantity: number;
  cargoQuantityUnit: typeof RAIL_TARIFF_CARGO_QUANTITY_UNIT;
  breakdown: {
    baseCharge: number;
    distanceQuantityCharge: number;
    transferCharge: number;
    minimumChargeAdjustment: number;
  };
};

export function snapshotReadyRailTariff(
  estimate: MultimodalRailTariffEstimate,
): FutureMultimodalRailEconomicSnapshot | null {
  if (
    estimate.status !== 'READY' ||
    estimate.totalCarrierCost == null ||
    estimate.routeReference == null ||
    estimate.distanceMeters == null ||
    estimate.cargoQuantity == null ||
    estimate.baseCharge == null ||
    estimate.distanceQuantityCharge == null ||
    estimate.transferCharge == null ||
    estimate.minimumChargeAdjustment == null
  ) {
    return null;
  }
  return {
    railTariffPolicyVersion: estimate.policyVersion,
    railCarrierCost: estimate.totalCarrierCost,
    currency: estimate.currency,
    routeReference: estimate.routeReference,
    distanceMeters: estimate.distanceMeters,
    cargoQuantity: estimate.cargoQuantity,
    cargoQuantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
    breakdown: {
      baseCharge: estimate.baseCharge,
      distanceQuantityCharge: estimate.distanceQuantityCharge,
      transferCharge: estimate.transferCharge,
      minimumChargeAdjustment: estimate.minimumChargeAdjustment,
    },
  };
}
