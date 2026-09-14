export const WEEKLY_MISSION_CATALOG_VERSION = 1;
export const WEEKLY_MISSION_SCHEMA_VERSION = 1;
export const WEEKLY_MISSION_WEEKLY_CASH_CAP = 16_000;
export const WEEKLY_MISSION_FLAG_ENV = 'WEEKLY_MISSIONS_BACKEND_ENABLED';

export type WeeklyMissionDifficulty = 'easy' | 'medium' | 'hard';
export type WeeklyMissionType = 'weekly_completed_deliveries';

export interface WeeklyMissionReward {
  cash: number;
}

export interface WeeklyMissionTemplate {
  id: string;
  type: WeeklyMissionType;
  target: number;
  difficulty: WeeklyMissionDifficulty;
  reward: WeeklyMissionReward;
  enabled: boolean;
  weight: number;
  minCompanyLevel?: number;
  title: string;
  description: string;
  version: number;
}

export interface WeeklyMissionSnapshot {
  id: string;
  type: WeeklyMissionType;
  target: number;
  difficulty: WeeklyMissionDifficulty;
  reward: WeeklyMissionReward;
  title: string;
  description: string;
}

export interface WeeklyMissionRotationDocument {
  weekKey: string;
  startsAt: number;
  endsAt: number;
  version: number;
  catalogVersion: number;
  locked: true;
  createdAt: number;
  missionIds: string[];
  missions: WeeklyMissionSnapshot[];
}

export interface WeeklyMissionBaselineDocument {
  ownerUid: string;
  weekKey: string;
  completedDeliveriesBaseline: number;
  createdAt: number;
  schemaVersion: number;
}

export interface WeeklyMissionClaimDocument {
  ownerUid: string;
  weekKey: string;
  missionId: string;
  idempotencyKey: string;
  reward: WeeklyMissionReward;
  claimedAt: number;
  schemaVersion: number;
  cashBefore: number;
  cashAfter: number;
}

export type WeeklyMissionFailureReason =
  | 'feature-disabled'
  | 'auth-required'
  | 'anonymous-not-supported'
  | 'invalid-request'
  | 'invalid-week-key'
  | 'week-not-current'
  | 'rotation-unavailable'
  | 'invalid-mission-id'
  | 'not-complete'
  | 'already-claimed'
  | 'weekly-cap-exceeded'
  | 'server-state-not-initialized'
  | 'service-unavailable';

export function isWeeklyMissionsBackendEnabled(): boolean {
  return process.env[WEEKLY_MISSION_FLAG_ENV] === 'true';
}
