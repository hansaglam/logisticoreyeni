export interface CanonicalTruckResaleInput {
  basePrice: number;
  condition: number;
  mileageKm?: number;
  ageOrUsage?: number;
  upgradeValue?: number;
  rarity?: number;
  marketModifier?: number;
  isLeased?: boolean;
}

export interface CanonicalTruckResaleBalance {
  truckBaseResaleRate: number;
  minTruckResaleRate: number;
  maxTruckResaleRate: number;
  mileageDepreciationReferenceKm: number;
  maxMileageDepreciationRate: number;
  maxAgeDepreciationRate: number;
  upgradeRecoveryRate: number;
  minMarketResaleModifier: number;
  maxMarketResaleModifier: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Client ve trusted backend tarafından kullanılan tek saf ikinci el değerleme çekirdeği. */
export function calculateCanonicalTruckResaleValue(
  resale: CanonicalTruckResaleInput,
  balance: CanonicalTruckResaleBalance,
): number {
  if (resale.isLeased) return 0;
  const basePrice = Number.isFinite(resale.basePrice)
    ? Math.max(0, resale.basePrice)
    : 0;
  if (basePrice <= 0) return 0;

  const condition = clamp(Number(resale.condition) || 0, 0, 100);
  const conditionMultiplier = 0.35 + (condition / 100) * 0.65;
  const mileageDepreciation = clamp(
    (Math.max(0, Number(resale.mileageKm) || 0) /
      balance.mileageDepreciationReferenceKm) *
      balance.maxMileageDepreciationRate,
    0,
    balance.maxMileageDepreciationRate,
  );
  const rawUsage = Math.max(0, Number(resale.ageOrUsage) || 0);
  const normalizedUsage = rawUsage <= 1 ? rawUsage : rawUsage / (24 * 365 * 5);
  const ageDepreciation = clamp(
    normalizedUsage * balance.maxAgeDepreciationRate,
    0,
    balance.maxAgeDepreciationRate,
  );
  const marketMultiplier = clamp(
    (Number(resale.rarity) || 1) * (Number(resale.marketModifier) || 1),
    balance.minMarketResaleModifier,
    balance.maxMarketResaleModifier,
  );
  const recoveredUpgradeValue =
    Math.max(0, Number(resale.upgradeValue) || 0) *
    balance.upgradeRecoveryRate;
  const rawPrice =
    basePrice *
      balance.truckBaseResaleRate *
      conditionMultiplier *
      (1 - mileageDepreciation) *
      (1 - ageDepreciation) *
      marketMultiplier +
    recoveredUpgradeValue;
  const minPrice = basePrice * balance.minTruckResaleRate;
  const maxPrice = Math.min(
    basePrice * 0.95,
    basePrice * balance.maxTruckResaleRate + recoveredUpgradeValue,
  );
  return Math.round(clamp(rawPrice, minPrice, maxPrice));
}
