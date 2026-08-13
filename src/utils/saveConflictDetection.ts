import type { CloudSaveSummary } from './cloudSaveSummary';

/** True when local and cloud represent clearly different progression (real conflict). */
export function areLocalAndCloudSavesDifferent(
  local: CloudSaveSummary,
  cloud: CloudSaveSummary,
): boolean {
  if (local.completedDeliveries !== cloud.completedDeliveries) {
    return true;
  }
  if (local.level !== cloud.level) {
    return true;
  }
  if (local.trucksCount !== cloud.trucksCount) {
    return true;
  }
  if (local.warehousesCount !== cloud.warehousesCount) {
    return true;
  }
  if (Math.abs(local.money - cloud.money) > 500) {
    return true;
  }
  if (Math.abs(local.xp - cloud.xp) > 50) {
    return true;
  }
  if (Math.abs(local.lastGameTime - cloud.lastGameTime) > 12) {
    return true;
  }
  return false;
}
