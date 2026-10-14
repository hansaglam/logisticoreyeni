/**
 * Vehicle clusters are active so trucks that share a city are not stacked.
 * City and operation clusters stay inactive.
 */

export type MapClusterKind = 'CITY_CLUSTER' | 'VEHICLE_CLUSTER' | 'OPERATION_CLUSTER';

export function clusterPolicyActive(kind: MapClusterKind): boolean {
  return kind === 'VEHICLE_CLUSTER';
}
