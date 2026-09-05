/**
 * Şoför XP / seviye sistemi — Phase 3.
 */

import type {
  Contract,
  ContractType,
  Driver,
  DriverSpecialty,
} from '../types/game';
import { clamp } from '../utils/math';
import { normalizeContractType } from './contractTypes';

export const MAX_DRIVER_LEVEL = 50;
export const DRIVER_SPECIALTY_UNLOCK_LEVEL = 5;

const LEGACY_DRIVER_LEVEL_XP_THRESHOLDS: Record<number, number> = {
  1: 0,
  2: 100,
  3: 250,
  4: 500,
  5: 1150,
};

/**
 * Deterministic cumulative XP curve.
 *
 * Levels 1–5 preserve the shipped thresholds. After level 5, each next level
 * asks for 100 XP more than the previous step (750, 850, 950…). This grows
 * quadratically rather than exponentially and remains integer-only/stable.
 */
export function getDriverLifetimeXpForLevel(level: number): number {
  const safeLevel = clamp(Math.floor(Number.isFinite(level) ? level : 1), 1, MAX_DRIVER_LEVEL);
  if (safeLevel <= DRIVER_SPECIALTY_UNLOCK_LEVEL) {
    return LEGACY_DRIVER_LEVEL_XP_THRESHOLDS[safeLevel] ?? 0;
  }
  let threshold = LEGACY_DRIVER_LEVEL_XP_THRESHOLDS[DRIVER_SPECIALTY_UNLOCK_LEVEL] ?? 1150;
  for (let nextLevel = DRIVER_SPECIALTY_UNLOCK_LEVEL + 1; nextLevel <= safeLevel; nextLevel += 1) {
    threshold += 650 + (nextLevel - DRIVER_SPECIALTY_UNLOCK_LEVEL) * 100;
  }
  return threshold;
}

export const DRIVER_LEVEL_XP_THRESHOLDS: Readonly<Record<number, number>> =
  Object.freeze(
    Object.fromEntries(
      Array.from({ length: MAX_DRIVER_LEVEL }, (_, index) => {
        const level = index + 1;
        return [level, getDriverLifetimeXpForLevel(level)];
      }),
    ),
  );

export interface DriverProgress {
  level: number;
  /** Lifetime XP; retained as `xp` for save compatibility. */
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  lifetimeXp: number;
}

const SPECIALTY_BY_TYPE: Partial<Record<ContractType, DriverSpecialty>> = {
  urgent: 'urgent',
  fragile: 'fragile',
  bulk: 'bulk',
};

export function normalizeDriverProgress(driver: Driver): Driver {
  const xp = Math.max(0, driver.xp ?? 0);
  const level = clamp(driver.level ?? computeDriverLevelFromXp(xp), 1, MAX_DRIVER_LEVEL);
  return {
    ...driver,
    xp,
    level,
    completedDeliveries: Math.max(0, driver.completedDeliveries ?? 0),
    onTimeDeliveries: Math.max(0, driver.onTimeDeliveries ?? 0),
  };
}

export function computeDriverLevelFromXp(xp: number): number {
  let level = 1;
  for (let l = MAX_DRIVER_LEVEL; l >= 1; l -= 1) {
    if (xp >= (DRIVER_LEVEL_XP_THRESHOLDS[l] ?? 0)) {
      level = l;
      break;
    }
  }
  return level;
}

export function getDriverXpProgress(driver: Driver): {
  level: number;
  xp: number;
  xpForCurrentLevel: number;
  xpForNextLevel: number;
  progressRatio: number;
} {
  const normalized = normalizeDriverProgress(driver);
  const level = normalized.level ?? 1;
  const xp = normalized.xp ?? 0;
  const xpForCurrentLevel = DRIVER_LEVEL_XP_THRESHOLDS[level] ?? 0;
  const xpForNextLevel =
    level >= MAX_DRIVER_LEVEL
      ? xpForCurrentLevel
      : DRIVER_LEVEL_XP_THRESHOLDS[level + 1] ?? xpForCurrentLevel;
  const span = Math.max(1, xpForNextLevel - xpForCurrentLevel);
  const progressRatio =
    level >= MAX_DRIVER_LEVEL ? 1 : clamp((xp - xpForCurrentLevel) / span, 0, 1);

  return {
    level,
    xp,
    xpForCurrentLevel,
    xpForNextLevel,
    progressRatio,
  };
}

export function getDriverProgress(driver: Driver): DriverProgress {
  const normalized = normalizeDriverProgress(driver);
  const level = normalized.level ?? 1;
  const lifetimeXp = normalized.xp ?? 0;
  const currentThreshold = getDriverLifetimeXpForLevel(level);
  const nextThreshold =
    level >= MAX_DRIVER_LEVEL
      ? currentThreshold
      : getDriverLifetimeXpForLevel(level + 1);
  return {
    level,
    xp: lifetimeXp,
    xpIntoLevel: Math.max(0, lifetimeXp - currentThreshold),
    xpForNextLevel: Math.max(0, nextThreshold - currentThreshold),
    lifetimeXp,
  };
}

export function getDriverOnTimeRate(driver: Driver): number {
  const completed = driver.completedDeliveries ?? 0;
  if (completed <= 0) {
    return 0;
  }
  return clamp((driver.onTimeDeliveries ?? 0) / completed, 0, 1);
}

/** Teslimat XP hesabı */
export function calculateDriverDeliveryXp(params: {
  contract: Contract;
  distanceKm: number;
  onTime: boolean;
  success: boolean;
}): number {
  if (!params.success) {
    return 0;
  }

  const contractType = normalizeContractType(params.contract);
  let base = 20 + Math.floor(params.distanceKm / 50) * 5;

  switch (contractType) {
    case 'urgent':
      base = Math.round(base * 1.3);
      break;
    case 'fragile':
      base = Math.round(base * 1.25);
      break;
    case 'high_reputation':
      base = Math.round(base * 1.4);
      break;
    case 'bulk':
      base = Math.round(base * 1.15);
      break;
    case 'refrigerated':
      base = Math.round(base * 1.2);
      break;
    default:
      break;
  }

  if (!params.onTime) {
    base = Math.round(base * 0.6);
  }

  return Math.max(params.success ? 10 : 0, base);
}

function inferSpecialty(driver: Driver): DriverSpecialty | undefined {
  const completed = driver.completedDeliveries ?? 0;
  if (completed < 10) {
    return undefined;
  }
  const onTimeRate = getDriverOnTimeRate(driver);
  if (onTimeRate >= 0.85 && (driver.onTimeDeliveries ?? 0) >= 8) {
    return 'urgent';
  }
  return undefined;
}

export interface ApplyDriverXpResult {
  driver: Driver;
  leveledUp: boolean;
  previousLevel: number;
  newLevel: number;
}

/** XP uygula ve seviye atlama kontrol et */
export function applyDriverXp(
  driver: Driver,
  xpGain: number,
  contract?: Contract,
): ApplyDriverXpResult {
  const normalized = normalizeDriverProgress(driver);
  const previousLevel = normalized.level ?? 1;
  const newXp = (normalized.xp ?? 0) + Math.max(0, xpGain);
  let newLevel = computeDriverLevelFromXp(newXp);

  let specialty = normalized.specialty;
  if (newLevel >= DRIVER_SPECIALTY_UNLOCK_LEVEL && !specialty && contract) {
    specialty = SPECIALTY_BY_TYPE[normalizeContractType(contract)] ?? inferSpecialty(normalized);
  }

  return {
    driver: {
      ...normalized,
      xp: newXp,
      level: newLevel,
      specialty,
    },
    leveledUp: newLevel > previousLevel,
    previousLevel,
    newLevel,
  };
}

export function recordDriverDeliveryStats(
  driver: Driver,
  onTime: boolean,
): Driver {
  const normalized = normalizeDriverProgress(driver);
  return {
    ...normalized,
    completedDeliveries: (normalized.completedDeliveries ?? 0) + 1,
    onTimeDeliveries: (normalized.onTimeDeliveries ?? 0) + (onTime ? 1 : 0),
  };
}

/** Seviye etkileri — küçük bonuslar */
export function getDriverDurationReduction(level: number): number {
  const safe = clamp(level, 1, MAX_DRIVER_LEVEL);
  return [0, 0.01, 0.02, 0.03, 0.04, 0.05][safe] ?? 0;
}

export function getDriverFuelEfficiencyBonus(level: number): number {
  const safe = clamp(level, 1, MAX_DRIVER_LEVEL);
  return [0, 0, 0.01, 0.02, 0.03, 0.04][safe] ?? 0;
}

export function getDriverFragilePenaltyReduction(level: number, specialty?: DriverSpecialty): number {
  const safe = clamp(level, 1, MAX_DRIVER_LEVEL);
  let reduction = [0, 0, 0, 0.05, 0.08, 0.1][safe] ?? 0;
  if (specialty === 'fragile') {
    reduction += 0.05;
  }
  return clamp(reduction, 0, 0.15);
}

export function getDriverLevel(driver: Driver): number {
  return normalizeDriverProgress(driver).level ?? 1;
}

export function meetsDriverLevelRequirement(driver: Driver, requiredLevel?: number): boolean {
  if (!requiredLevel || requiredLevel <= 1) {
    return true;
  }
  return getDriverLevel(driver) >= requiredLevel;
}
