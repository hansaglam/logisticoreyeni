/**
 * LogistiCore - Kamyon kataloğu
 *
 * Başlangıç kamyonu ve satın alınabilir kamyon şablonları.
 */

import type { Truck } from '../types/game';

/** Satın alınabilir kamyon şablonu — id ve sahiplik durumu hariç */
export type TruckTemplate = Omit<Truck, 'currentCityId' | 'status'>;

/** Oyuncunun oyuna başladığı varsayılan kamyon */
export const STARTER_TRUCK: Truck = {
  id: 'truck-starter-1',
  name: 'İzmir Express',
  capacity: 25,
  fuelConsumptionPerKm: 0.32,
  speed: 72,
  reliability: 75,
  maintenanceCost: 0.18,
  comfort: 60,
  condition: 88,
  purchasePrice: 45_000,
  currentCityId: 'izmir',
  status: 'idle',
};

/** Galeride satın alınabilir kamyonlar */
export const AVAILABLE_TRUCKS: TruckTemplate[] = [
  {
    id: 'truck-volvo-fh',
    name: 'Volvo FH 460',
    capacity: 30,
    fuelConsumptionPerKm: 0.28,
    speed: 78,
    reliability: 88,
    maintenanceCost: 0.22,
    comfort: 75,
    condition: 100,
    purchasePrice: 85_000,
  },
  {
    id: 'truck-mercedes-actros',
    name: 'Mercedes Actros',
    capacity: 28,
    fuelConsumptionPerKm: 0.3,
    speed: 80,
    reliability: 85,
    maintenanceCost: 0.24,
    comfort: 82,
    condition: 100,
    purchasePrice: 92_000,
  },
  {
    id: 'truck-ford-cargo',
    name: 'Ford Cargo 1833',
    capacity: 18,
    fuelConsumptionPerKm: 0.35,
    speed: 68,
    reliability: 70,
    maintenanceCost: 0.14,
    comfort: 55,
    condition: 100,
    purchasePrice: 52_000,
  },
];
