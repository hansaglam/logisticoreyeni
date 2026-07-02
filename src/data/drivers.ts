/**
 * LogistiCore - Şoför kataloğu
 *
 * Başlangıç şoförü ve işe alınabilir şoför şablonları.
 */

import type { Driver } from '../types/game';

/** İşe alınabilir şoför şablonu — id, atama ve durum hariç */
export type DriverTemplate = Omit<Driver, 'assignedTruckId' | 'status'> & {
  /** İşe alım ücreti ($) */
  hiringFee: number;
};

/** Oyuncunun oyuna başladığı varsayılan şoför */
export const STARTER_DRIVER: Driver = {
  id: 'driver-starter-1',
  name: 'Ahmet Yılmaz',
  experience: 55,
  attention: 70,
  fuelSaving: 45,
  speed: 10,
  morale: 80,
  salaryPerDay: 120,
  assignedTruckId: 'truck-starter-1',
  status: 'idle',
};

/** İşe alınabilir şoförler */
export const AVAILABLE_DRIVERS: DriverTemplate[] = [
  {
    id: 'driver-mehmet-k',
    name: 'Mehmet Kaya',
    experience: 72,
    attention: 82,
    fuelSaving: 60,
    speed: 5,
    morale: 75,
    salaryPerDay: 180,
    hiringFee: 1_500,
  },
  {
    id: 'driver-ayse-d',
    name: 'Ayşe Demir',
    experience: 48,
    attention: 90,
    fuelSaving: 55,
    speed: -5,
    morale: 85,
    salaryPerDay: 150,
    hiringFee: 1_200,
  },
  {
    id: 'driver-can-t',
    name: 'Can Tekin',
    experience: 35,
    attention: 60,
    fuelSaving: 30,
    speed: 25,
    morale: 70,
    salaryPerDay: 110,
    hiringFee: 800,
  },
];
