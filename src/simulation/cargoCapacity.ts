/**
 * @deprecated Import from ./capacity instead.
 * Thin re-export layer for backward compatibility.
 */

export {
  CAPACITY_EPSILON,
  HEAVY_CARGO_FEATURE_LEVEL_GUARD,
  OVERSIZED_CARGO_SYSTEM_MAX_TONS,
  MAX_UNREACHABLE_CONTRACT_LIST_RATIO,
  WELL_BEYOND_FLEET_SPAWN_CHANCE,
  FUTURE_TRAILER_SYSTEM_NOTE,
  hasEnoughCargoCapacity,
  hasEnoughCapacity,
  getTruckBaseCapacity,
  getTruckUpgradeCapacityBonus,
  getAttachedTrailer,
  getAttachedTrailerForTruck,
  getTruckEffectiveCapacityTons,
  getEffectiveCargoCapacity,
  getEffectiveTruckCapacityTons,
  canTruckCarryCargo,
  getContractRequiredCapacityTons,
  canTruckCarryContract,
  getCargoWeightClass,
  getCargoWeightClassLabel,
  getMaxPotentialTruckCapacityTons,
  getMaxFleetCapacityTons,
  getMaxPotentialFleetCapacityTons,
  getSystemMaxTruckCapacityTons,
  getSystemMaxFleetCapacityTons,
  isContractBeyondSystemCapacity,
  isContractUnreachableByFleet,
  isContractWellBeyondFleet,
  shouldSpawnBeyondFleetContract,
  buildCapacityDisabledReasonInput,
  resolveCapacityDisabledReasonKind,
  getCapacityDisabledReasonLabel,
  formatCapacityShortfallLabel,
  formatCombinedCapacityLabel,
  type CargoWeightClass,
  type CapacityDisabledReasonInput,
  type CapacityDisabledReasonKind,
} from './capacity';

export type FleetCapacitySnapshot = {
  maxFleetCapacityTons: number;
  maxIdleFleetCapacityTons: number;
  maxIdleAtOriginCapacityTons: number;
  maxPotentialFleetCapacityTons: number;
  systemMaxTruckCapacityTons: number;
};
