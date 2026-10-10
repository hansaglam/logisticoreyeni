import { STARTER_DRIVER } from '../../data/drivers';
import { STARTER_TRUCK } from '../../data/trucks';
import type { Driver, Trailer, Truck } from '../../types/game';
import type { MultimodalRoadFleetSnapshot } from '../../domain/multimodalRoadAssignment';

/** DEV inspector / tests only. Production-shaped Truck/Driver records, not live fleet. */
export function createDevMultimodalRoadPlanningFleet(input: {
  originCityId: string;
  destinationCityId: string;
  cargoWeightTons?: number;
}): MultimodalRoadFleetSnapshot {
  const originTruck: Truck = {
    ...STARTER_TRUCK,
    id: 'truck-plan-origin',
    currentCityId: input.originCityId,
    homeCityId: input.originCityId,
    status: 'idle',
  };
  const destTruck: Truck = {
    ...STARTER_TRUCK,
    id: 'truck-plan-destination',
    currentCityId: input.destinationCityId,
    homeCityId: input.destinationCityId,
    status: 'idle',
  };
  const originDriver: Driver = {
    ...STARTER_DRIVER,
    id: 'driver-plan-origin',
    assignedTruckId: originTruck.id,
    status: 'idle',
  };
  const destDriver: Driver = {
    ...STARTER_DRIVER,
    id: 'driver-plan-destination',
    assignedTruckId: destTruck.id,
    status: 'idle',
  };
  const trailers: Trailer[] = [];
  return {
    trucks: [originTruck, destTruck],
    drivers: [originDriver, destDriver],
    trailers,
    activeDeliveries: [],
    activeTransfers: [],
    currentTime: 0,
  };
}
