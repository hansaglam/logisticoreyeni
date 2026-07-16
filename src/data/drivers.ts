/**
 * LogistiCore - Şoför kataloğu
 *
 * Başlangıç şoförü ve işe alınabilir şoför havuzu.
 */

import { getDriverTierRequiredLevel } from '../config/levelConfig';
import { operatingCostBalance } from '../config/balance';
import type { Driver, DriverTier } from '../types/game';

/** İşe alınabilir şoför şablonu — id, atama ve durum hariç */
export type DriverTemplate = Omit<Driver, 'assignedTruckId' | 'status' | 'poolId' | 'hireCost'> & {
  /** İşe alım ücreti ($) — işe alınca Driver.hireCost olur */
  hiringFee: number;
};

/** Mağazada listelenen şoför — tier ve level kilidi ile */
export interface DriverMarketItem extends DriverTemplate {
  tier: DriverTier;
  requiredLevel: number;
  /** Yurt dışı / gelecek içerik — görünür ama işe alınamaz */
  comingSoon?: boolean;
}

const TIER_LABELS: Record<DriverTier, string> = {
  rookie: 'Acemi',
  standard: 'Standart',
  experienced: 'Deneyimli',
  expert: 'Uzman',
  international: 'Uluslararası',
};

/** Oyuncunun oyuna başladığı varsayılan şoför */
export const STARTER_DRIVER: Driver = {
  id: 'driver-starter-1',
  poolId: 'driver-starter-1',
  name: 'Ahmet Yılmaz',
  tier: 'rookie',
  requiredLevel: 1,
  experience: 55,
  attention: 70,
  fuelSaving: 45,
  speed: 10,
  morale: 80,
  salaryPerDay: 120,
  hireCost: 0,
  assignedTruckId: 'truck-starter-1',
  status: 'idle',
};

/** Tüm şoför havuzu — level ile kilitlenir */
export const DRIVER_POOL: DriverMarketItem[] = [
  {
    id: 'driver-can-t',
    name: 'Can Tekin',
    tier: 'rookie',
    requiredLevel: 1,
    experience: 35,
    attention: 60,
    fuelSaving: 30,
    speed: 25,
    morale: 70,
    salaryPerDay: 110,
    hiringFee: 800,
  },
  {
    id: 'driver-seda-n',
    name: 'Seda Nalbant',
    tier: 'rookie',
    requiredLevel: 1,
    experience: 42,
    attention: 65,
    fuelSaving: 35,
    speed: 15,
    morale: 75,
    salaryPerDay: 115,
    hiringFee: 850,
  },
  {
    id: 'driver-ayse-d',
    name: 'Ayşe Demir',
    tier: 'standard',
    requiredLevel: 3,
    experience: 58,
    attention: 82,
    fuelSaving: 55,
    speed: -5,
    morale: 85,
    salaryPerDay: 150,
    hiringFee: 1_200,
  },
  {
    id: 'driver-burak-s',
    name: 'Burak Şen',
    tier: 'standard',
    requiredLevel: 3,
    experience: 62,
    attention: 78,
    fuelSaving: 50,
    speed: 5,
    morale: 80,
    salaryPerDay: 160,
    hiringFee: 1_350,
  },
  {
    id: 'driver-mehmet-k',
    name: 'Mehmet Kaya',
    tier: 'experienced',
    requiredLevel: 6,
    experience: 78,
    attention: 88,
    fuelSaving: 65,
    speed: 5,
    morale: 82,
    salaryPerDay: 200,
    hiringFee: 1_800,
  },
  {
    id: 'driver-elvan-t',
    name: 'Elvan Toprak',
    tier: 'experienced',
    requiredLevel: 6,
    experience: 82,
    attention: 85,
    fuelSaving: 62,
    speed: 0,
    morale: 78,
    salaryPerDay: 210,
    hiringFee: 1_950,
  },
  {
    id: 'driver-zeynep-a',
    name: 'Zeynep Arslan',
    tier: 'expert',
    requiredLevel: 10,
    experience: 92,
    attention: 94,
    fuelSaving: 72,
    speed: -8,
    morale: 88,
    salaryPerDay: 260,
    hiringFee: 2_500,
  },
  {
    id: 'driver-hakan-m',
    name: 'Hakan Mercan',
    tier: 'expert',
    requiredLevel: 10,
    experience: 90,
    attention: 90,
    fuelSaving: 68,
    speed: 8,
    morale: 85,
    salaryPerDay: 275,
    hiringFee: 2_700,
  },
  {
    id: 'driver-lars-h',
    name: 'Lars Hoffmann',
    tier: 'international',
    requiredLevel: 15,
    comingSoon: true,
    experience: 95,
    attention: 96,
    fuelSaving: 75,
    speed: 0,
    morale: 90,
    salaryPerDay: 320,
    hiringFee: 3_200,
  },
];

/** @deprecated DRIVER_POOL kullanın */
export const AVAILABLE_DRIVERS: DriverMarketItem[] = DRIVER_POOL;

export function getDriverTierLabel(tier: DriverTier | undefined): string {
  return TIER_LABELS[tier ?? 'rookie'];
}

export function resolveDriverRequiredLevel(item: DriverMarketItem): number {
  return item.requiredLevel ?? getDriverTierRequiredLevel(item.tier) ?? 1;
}

export function findDriverPoolItem(poolId: string): DriverMarketItem | undefined {
  return DRIVER_POOL.find((item) => item.id === poolId);
}

/** Oyuncu seviyesine göre görünür şoför havuzu — kilitli olanlar dahil */
export function getDriverPoolForLevel(_playerLevel?: number): DriverMarketItem[] {
  return [...DRIVER_POOL].sort(
    (a, b) => resolveDriverRequiredLevel(a) - resolveDriverRequiredLevel(b),
  );
}

export function normalizeDriver(driver: Driver): Driver {
  const tier = driver.tier ?? 'rookie';
  const dailySalary =
    driver.dailySalary ?? driver.salaryPerDay ?? operatingCostBalance.fallbackDriverDailySalary;
  return {
    ...driver,
    tier,
    requiredLevel: driver.requiredLevel ?? getDriverTierRequiredLevel(tier),
    dailySalary,
    salaryPerDay: dailySalary,
    salaryPeriod: driver.salaryPeriod ?? 'daily',
    hireCost: typeof driver.hireCost === 'number' && Number.isFinite(driver.hireCost)
      ? driver.hireCost
      : 0,
  };
}

export function isDriverPoolItemHired(
  drivers: Pick<Driver, 'id' | 'poolId'>[],
  poolId: string,
): boolean {
  return drivers.some((driver) => driver.id === poolId || driver.poolId === poolId);
}

export function getDriverCatalogId(driver: Pick<Driver, 'id' | 'poolId'>): string {
  return driver.poolId ?? driver.id;
}
