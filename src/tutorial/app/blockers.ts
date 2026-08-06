import { isCloudSaveAccountConflictPending } from '../../services/cloudSaveConflictState';
import { isRewardedAdShowing } from '../../services/adProvider';

export function hasGlobalTutorialBlockers(options: {
  blockingModals?: boolean;
  hasPendingOfflineSummary?: boolean;
  hasPendingDeliveryIncident?: boolean;
  isOnboarding?: boolean;
  isSaveRecovery?: boolean;
  isAnotherTutorialActive?: boolean;
}): boolean {
  if (options.isOnboarding) {
    return true;
  }
  if (options.isSaveRecovery) {
    return true;
  }
  if (options.isAnotherTutorialActive) {
    return true;
  }
  if (options.blockingModals) {
    return true;
  }
  if (options.hasPendingOfflineSummary) {
    return true;
  }
  if (options.hasPendingDeliveryIncident) {
    return true;
  }
  if (isCloudSaveAccountConflictPending()) {
    return true;
  }
  if (isRewardedAdShowing()) {
    return true;
  }
  return false;
}
