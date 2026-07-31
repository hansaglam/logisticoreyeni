import type { CloudSaveSummary } from './cloudSaveSummary';

export type CloudSaveComparisonDecision = 'local-newer' | 'cloud-newer' | 'equal';

export interface CloudSaveComparison {
  decision: CloudSaveComparisonDecision;
  local: CloudSaveSummary;
  cloud: CloudSaveSummary;
}

export function compareLocalAndCloudSave(
  local: CloudSaveSummary,
  cloud: CloudSaveSummary,
): CloudSaveComparison {
  const localTime = Number(local.lastLocalSaveAt) || 0;
  const cloudTime = Number(cloud.lastLocalSaveAt) || 0;
  return {
    decision:
      cloudTime > localTime
        ? 'cloud-newer'
        : localTime > cloudTime
          ? 'local-newer'
          : 'equal',
    local,
    cloud,
  };
}
