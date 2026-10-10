import { createHash } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { FieldPath, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { deleteLinkedAccount } from './accountDeletion';
import { runGlobalEconomyEpoch } from './globalEconomyWorker';
import {
  getLeaderboardSnapshot,
  submitLeaderboardScoreTransaction,
} from './leaderboard';
import { seedLeaderboardSeason } from './leaderboardSeasonSeed';
import {
  ensureSeasonFinalized,
  finalizeSeason,
  getPreviousLeaderboardSeasonKey,
  getSeasonResultForUid,
  isSeasonCloseSnapshotEnabled,
} from './seasonClose';
import {
  claimSeasonRewardTransaction,
  getSeasonRewardEntitlementForUid,
} from './seasonRewards';
import {
  migrateLegacyServerStateTransaction,
} from './serverState';
import { reconcileAuthoritativeFleetTransaction } from './authoritativeFleetReconciliation';
import { parseMarketplaceListRequest } from './vehicleMarketplaceListRequest';
import { getLeaderboardSeasonKey, isValidLeaderboardSeasonKey } from './leaderboardSeason';
import {
  checkUsernameAvailabilityTransaction,
  getUsernameProfileForUid,
  setUsernameTransaction,
} from './username';
import {
  suggestUsernameFromDisplayName,
  USERNAME_CHANGE_COOLDOWN_MS,
} from './usernameValidation';
import {
  cancelVehicleListingTransaction,
  cleanupVehicleMarketplaceEphemeralRecords,
  createVehicleListingTransaction,
  ensureVehicleMarketplaceStateTransaction,
  expireVehicleMarketplaceListings,
  purchaseVehicleListingTransaction,
} from './vehicleMarketplace';
import {
  VEHICLE_MARKETPLACE_API_VERSION,
  listingDtoToClientWire,
  serializeMarketplaceListingsForClient,
  serializeReconciliationVehicleForClient,
  timestampToMillis,
} from './vehicleMarketplaceSerialization';
import type {
  CancelVehicleListingInput,
  CreateVehicleListingInput,
  PurchaseVehicleListingInput,
} from './vehicleMarketplaceTypes';
import { revokeAppleAuthorizationCode } from './appleTokenRevocation';
import {
  claimChallengeRewardTransaction,
  getCurrentChallengeState,
} from './challenges';
import {
  isValidCanonicalDeliveryId,
  recordCanonicalDeliveryCompletionTransaction,
} from './canonicalDeliveryCompletion';
import {
  acceptCanonicalMultimodalShipmentTransaction,
  cancelCanonicalMultimodalShipmentTransaction,
  hasOnlyAcceptKeys,
  isValidCanonicalMultimodalShipmentId,
  reportCanonicalMultimodalShipmentCompletedTransaction,
} from './canonicalMultimodalShipment';
import {
  acceptCanonicalRoadDeliveryTransaction,
  hasOnlyCanonicalRoadAcceptKeys,
  hasOnlyCanonicalRoadCompleteKeys,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from './canonicalRoadDelivery';
import {
  applyCanonicalRoadDeliveryWearTransaction,
} from './canonicalFleetWear';
import { hasOnlyCanonicalRoadWearKeys } from '../../src/domain/canonicalFleetConditionWear';
import {
  finalizeCanonicalRoadExecutionTransaction,
  hasOnlyCanonicalRoadFinalizeKeys,
} from './canonicalRoadExecution';
import {
  repairCanonicalFleetAssetTransaction,
  upgradeCanonicalFleetAssetTransaction,
} from './canonicalFleetRepairUpgrade';
import {
  hasOnlyCanonicalFleetRepairKeys,
  hasOnlyCanonicalFleetUpgradeKeys,
} from '../../src/domain/canonicalFleetRepairUpgrade';
import { purchaseCanonicalCatalogAssetTransaction } from './canonicalCatalogPurchase';
import { containsForbiddenNonDeliveryXpClientKeys } from '../../src/domain/canonicalNonDeliveryCompanyXp';
import { hasOnlyCanonicalCatalogPurchaseKeys } from '../../src/domain/remainingRoadCashPathCanonicalization';
import { purchaseCanonicalFuelTransaction } from './canonicalFuel';
import { hasOnlyCanonicalFuelPurchaseKeys } from '../../src/domain/canonicalFuelTankPrice';
import {
  advanceCanonicalRoadExecutionTransaction,
  setCanonicalRoadExecutionPausedTransaction,
  setCanonicalRoadExecutionSpeedTransaction,
} from './canonicalProgressiveFuel';
import {
  hasOnlyCanonicalProgressiveAdvanceKeys,
  hasOnlyCanonicalProgressivePauseKeys,
  hasOnlyCanonicalProgressiveSpeedKeys,
} from '../../src/domain/canonicalProgressiveFuel';
import {
  createCanonicalVehicleLeaseTransaction,
  fireCanonicalDriverTransaction,
  hireCanonicalDriverTransaction,
  recoverCanonicalVehicleTransaction,
  sellCanonicalFleetAssetTransaction,
} from './canonicalCoreVehicleStaffCash';
import {
  hasOnlyCanonicalDriverFireKeys,
  hasOnlyCanonicalDriverHireKeys,
  hasOnlyCanonicalLeaseStartKeys,
  hasOnlyCanonicalVehicleRecoveryKeys,
  hasOnlyCanonicalVehicleSaleKeys,
} from '../../src/domain/canonicalCoreVehicleStaffCash';
import { settleCanonicalDailyOpexInternalTransaction } from './canonicalDailyOpex';
import { hasOnlyCanonicalDailyOpexKeys } from '../../src/domain/canonicalDailyOpexStaffState';
import {
  openCanonicalWarehouseTransaction,
  upgradeCanonicalWarehouseTransaction,
} from './canonicalWarehouse';
import {
  hasOnlyCanonicalWarehouseOpenKeys,
  hasOnlyCanonicalWarehouseUpgradeKeys,
} from '../../src/domain/canonicalWarehouseState';
import {
  bootstrapInternalCanonicalCargoMarketTransaction,
  buyCanonicalCargoTransaction,
  sellCanonicalCargoTransaction,
} from './canonicalCargoMarket';
import { advanceCanonicalProductionMarketTickTransaction } from './canonicalProductionMarketTick';
import { generateCanonicalProductionRoadBatchTransaction } from './canonicalProductionRoadContractIssuance';
import { initializeCanonicalCompanyProgressionForNewAccount } from './canonicalCompanyProgression';
import {
  containsForbiddenProgressionClientKeys,
  hasOnlyCanonicalProgressionInitKeys,
} from '../../src/domain/canonicalCompanyProgression';
import {
  advanceCanonicalContractClockTransaction,
  setCanonicalContractClockPausedTransaction,
  setCanonicalContractClockSpeedTransaction,
} from './canonicalContractClock';
import {
  hasOnlyCanonicalContractClockPauseKeys,
  hasOnlyCanonicalContractClockSpeedKeys,
} from '../../src/domain/canonicalContractGameTimeExpiry';
import {
  hasOnlyCanonicalCargoBootstrapKeys,
  hasOnlyCanonicalCargoBuyKeys,
  hasOnlyCanonicalCargoSellKeys,
} from '../../src/domain/canonicalCargoMarketWorldState';
import { hasOnlyCanonicalMarketTickKeys } from '../../src/domain/canonicalProductionMarketTick';
import {
  hasOnlyCanonicalRoadRefreshKeys,
  parseCanonicalRefreshIntentId,
} from '../../src/domain/canonicalContractRefresh';
import { hasOnlyCanonicalProductionRoadIssuanceKeys } from '../../src/domain/canonicalProductionRoadContractIssuance';
import { claimCanonicalLocalRewardTransaction } from './canonicalLocalReward';
import { hasOnlyCanonicalLocalRewardKeys } from '../../src/domain/canonicalLocalRewardClaim';
import { claimCanonicalClientRewardTransaction } from './canonicalClientRewardXp';
import {
  applyCanonicalLegacyProgressionMigration,
  cutoverCanonicalLegacyProgressionMigration,
  freezeCanonicalProgressionMigrationSource,
  previewCanonicalLegacyProgressionMigration,
} from './canonicalLegacyProgressionMigration';
import {
  CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION,
  CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION,
  hasOnlyCanonicalProgressionImmediateCutoverKeys,
  hasOnlyCanonicalProgressionMigrationApplyKeys,
  hasOnlyCanonicalProgressionMigrationFreezeKeys,
  hasOnlyCanonicalProgressionMigrationPreviewKeys,
} from '../../src/domain/canonicalLegacyProgressionMigration';
import {
  hasOnlyCanonicalClientRewardClaimKeys,
  isCanonicalClientRewardXpAllowed,
} from '../../src/domain/canonicalClientRewardXp';
import {
  settleCanonicalRoadDeliveryInternalTransaction,
  hasOnlyCanonicalRoadSettleKeys,
} from './canonicalRoadSettlement';
import {
  bootstrapInternalCanonicalFleetFixturesTransaction,
} from './canonicalFleet';
import { hasOnlyCanonicalFleetBootstrapKeys } from '../../src/domain/canonicalRoadFleet';
import {
  assertIssuanceSchema,
  getOrIssueCanonicalRoadContractsTransaction,
  hasOnlyCanonicalRoadIssuanceKeys,
} from './canonicalRoadContract';
import { CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK } from '../../src/domain/canonicalRoadContract';
import { getSeasonDefinition } from './seasonPeriods';
import {
  claimWeeklyMissionRewardTransaction,
  ensureWeeklyMissionRotation,
  getWeeklyMissionsState,
} from './weeklyMissions';
import {
  APPLE_SIGNIN_SECRETS,
  readAppleSignInSecretValuesFromBinding,
} from './appleSignInSecrets';

initializeApp();

const VEHICLE_MARKETPLACE_FUNCTION_OPTIONS = {
  region: 'us-central1',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 20,
} as const;

const MAX_ID_LENGTH = 128;
const MAX_CLIENT_SAVE_VERSION = 1_000_000_000;
const RATE_LIMITS = {
  create: { windowMs: 60 * 60 * 1000, maxRequests: 10 },
  cancel: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  purchase: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  list: { windowMs: 60 * 1000, maxRequests: 120 },
  myListings: { windowMs: 60 * 1000, maxRequests: 60 },
  accountDeletion: { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3 },
  leaderboardSubmit: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  leaderboardGet: { windowMs: 60 * 1000, maxRequests: 60 },
  setUsername: { windowMs: 60 * 60 * 1000, maxRequests: 10 },
  checkUsername: { windowMs: 60 * 1000, maxRequests: 60 },
  migrateServerState: { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3 },
  challengeGet: { windowMs: 60 * 1000, maxRequests: 60 },
  challengeClaim: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  seasonCloseEnsure: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  seasonResultGet: { windowMs: 60 * 1000, maxRequests: 60 },
  seasonRewardGet: { windowMs: 60 * 1000, maxRequests: 60 },
  seasonRewardClaim: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  weeklyMissionGet: { windowMs: 60 * 1000, maxRequests: 60 },
  weeklyMissionClaim: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalDelivery: { windowMs: 60 * 60 * 1000, maxRequests: 60 },
  canonicalMultimodalAccept: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalMultimodalComplete: { windowMs: 60 * 60 * 1000, maxRequests: 60 },
  canonicalMultimodalCancel: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalRoadAccept: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalRoadComplete: { windowMs: 60 * 60 * 1000, maxRequests: 60 },
  canonicalRoadIssue: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalFleetBootstrap: { windowMs: 60 * 60 * 1000, maxRequests: 10 },
  canonicalRoadSettle: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalRoadWear: { windowMs: 60 * 60 * 1000, maxRequests: 60 },
  canonicalRoadFinalize: { windowMs: 60 * 60 * 1000, maxRequests: 60 },
  canonicalFleetRepair: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalFleetUpgrade: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalCatalogPurchase: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalFuelPurchase: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalRoadProgress: { windowMs: 60 * 60 * 1000, maxRequests: 120 },
  canonicalRoadSpeed: { windowMs: 60 * 60 * 1000, maxRequests: 60 },
  canonicalRoadPause: { windowMs: 60 * 60 * 1000, maxRequests: 60 },
  canonicalVehicleLease: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalDriverHire: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalDriverFire: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalVehicleSale: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalVehicleRecovery: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalDailyOpex: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalWarehouseOpen: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalWarehouseUpgrade: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalCargoMarketBootstrap: { windowMs: 60 * 60 * 1000, maxRequests: 10 },
  canonicalCargoBuy: { windowMs: 60 * 60 * 1000, maxRequests: 40 },
  canonicalCargoSell: { windowMs: 60 * 60 * 1000, maxRequests: 40 },
  canonicalProductionMarketTick: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalProductionRoadContractIssuance: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalContractClock: { windowMs: 60 * 60 * 1000, maxRequests: 120 },
  canonicalRoadContractRefresh: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalCompanyProgressionInit: { windowMs: 60 * 60 * 1000, maxRequests: 10 },
  canonicalLocalReward: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  canonicalClientReward: { windowMs: 60 * 60 * 1000, maxRequests: 60 },
  canonicalProgressionMigrationPreview: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  canonicalProgressionMigrationApply: { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3 },
  canonicalProgressionMigrationFreeze: { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3 },
  canonicalProgressionImmediateCutover: { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3 },
} as const;

function requestRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

function hasOnlyKeys(
  data: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(data).every((key) => allowed.has(key));
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isOptionalSaveVersion(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isInteger(value) &&
      Number(value) >= 0 &&
      Number(value) <= MAX_CLIENT_SAVE_VERSION)
  );
}

async function consumeRateLimit(
  uid: string,
  action: keyof typeof RATE_LIMITS,
  idempotencyKey?: string,
): Promise<boolean> {
  const firestore = getFirestore();
  const config = RATE_LIMITS[action];
  const nowMs = Date.now();
  const ref = firestore.doc(`vehicleMarketplaceRateLimits/${uid}_${action}`);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data() as {
      windowStartedAtMs?: number;
      requestCount?: number;
      recentKeys?: string[];
    } | undefined;
    const sameWindow =
      Number.isFinite(current?.windowStartedAtMs) &&
      nowMs - Number(current?.windowStartedAtMs) < config.windowMs;
    const recentKeys = sameWindow && Array.isArray(current?.recentKeys)
      ? current.recentKeys.filter((key): key is string => typeof key === 'string').slice(-19)
      : [];
    if (idempotencyKey && recentKeys.includes(idempotencyKey)) return true;
    const requestCount = sameWindow ? Number(current?.requestCount ?? 0) : 0;
    if (requestCount >= config.maxRequests) return false;
    const nextKeys = idempotencyKey ? [...recentKeys, idempotencyKey] : recentKeys;
    transaction.set(ref, {
      uid,
      action,
      windowStartedAtMs: sameWindow ? current?.windowStartedAtMs : nowMs,
      requestCount: requestCount + 1,
      recentKeys: nextKeys,
      updatedAt: Timestamp.fromMillis(nowMs),
      expiresAt: Timestamp.fromMillis(nowMs + config.windowMs * 2),
    });
    return true;
  });
}

function rateLimitedResult(data: Record<string, unknown>) {
  return {
    ok: false,
    reason: 'rate-limited',
    transactionId: typeof data.transactionId === 'string' ? data.transactionId : '',
    idempotencyKey: typeof data.idempotencyKey === 'string' ? data.idempotencyKey : '',
  };
}

export const generateGlobalEconomy = onSchedule(
  {
    schedule: '0,30 * * * *',
    timeZone: 'UTC',
    retryCount: 3,
    maxInstances: 1,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const startedAt = Date.now();
    try {
      const result = await runGlobalEconomyEpoch(getFirestore(), {
        nowMs: startedAt,
      });
      logger.info('[global-economy-worker]', {
        epoch: result.epoch,
        configVersion: result.configVersion,
        snapshotCreated: result.snapshotCreated,
        historyRecordsWritten: result.historyRecordsWritten,
        historyRecordsDeleted: result.historyRecordsDeleted,
        durationMs: Date.now() - startedAt,
        retryCount: result.retryCount,
      });
    } catch (error) {
      logger.error('[global-economy-worker]', {
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
      throw error;
    }
  },
);

/** Haftalık sezon rollover — kayıtlı oyuncuları yeni sezona taşır. */
export const seedWeeklyLeaderboard = onSchedule(
  {
    schedule: '5 0 * * *',
    timeZone: 'UTC',
    retryCount: 2,
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const startedAt = Date.now();
    const seasonKey = getLeaderboardSeasonKey(startedAt);
    try {
      const result = await seedLeaderboardSeason(getFirestore(), seasonKey, {
        nowMs: startedAt,
        maxDurationMs: 480_000,
      });
      logger.info('[leaderboard-season-seed]', {
        seasonKey: result.seasonKey,
        ran: result.ran,
        completed: result.completed,
        seeded: result.seeded,
        skipped: result.skipped,
        deleted: result.deleted,
        pagesProcessed: result.pagesProcessed,
        durationMs: result.durationMs,
      });
    } catch (error) {
      logger.error('[leaderboard-season-seed]', {
        seasonKey,
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
      throw error;
    }
  },
);

/**
 * Weekly Missions rotation — create-if-missing for the current UTC ISO week.
 * Gated by WEEKLY_MISSIONS_BACKEND_ENABLED=true (default off).
 * Runs after leaderboard seed (00:05) and season close (00:10).
 */
export const seedWeeklyMissionRotation = onSchedule(
  {
    schedule: '15 0 * * *',
    timeZone: 'UTC',
    retryCount: 2,
    maxInstances: 1,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const startedAt = Date.now();
    try {
      const result = await ensureWeeklyMissionRotation(getFirestore(), startedAt);
      if (result.ok && result.created) {
        logger.info('[weekly-rotation-created]', {
          weekKey: result.rotation.weekKey,
          missionCount: result.rotation.missionIds.length,
          durationMs: Date.now() - startedAt,
        });
      } else {
        logger.info('[weekly-mission-rotation]', {
          ok: result.ok,
          reason: result.ok ? 'existing' : result.reason,
          weekKey: result.ok ? result.rotation.weekKey : null,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (error) {
      logger.error('[weekly-mission-rotation]', {
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
      throw error;
    }
  },
);

/**
 * Phase 7 — Immutable season-close for the previous UTC ISO week.
 * Idempotent; shares finalizeSeason with lazy ensureSeasonFinalized.
 * Gated by SEASON_CLOSE_SNAPSHOT_ENABLED=true (default off).
 */
export const finalizeWeeklySeasonClose = onSchedule(
  {
    schedule: '10 0 * * *',
    timeZone: 'UTC',
    retryCount: 2,
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const startedAt = Date.now();
    if (!isSeasonCloseSnapshotEnabled()) {
      logger.info('[season-close-schedule]', {
        skipped: true,
        reason: 'feature-disabled',
        durationMs: 0,
      });
      return;
    }
    const seasonKey = getPreviousLeaderboardSeasonKey(startedAt);
    try {
      const result = await finalizeSeason(getFirestore(), seasonKey, {
        nowMs: startedAt,
        maxDurationMs: 480_000,
      });
      logger.info('[season-close-schedule]', {
        seasonKey: result.seasonKey,
        ok: result.ok,
        reason: result.reason,
        status: result.status,
        processedCount: result.processedCount,
        participantCount: result.participantCount,
        pagesProcessed: result.pagesProcessed,
        durationMs: result.durationMs,
      });
      if (result.ok && result.reason === 'timeout-partial') {
        // Allow Cloud Scheduler retry / next day to resume closing.
        throw new Error(`season-close-partial:${seasonKey}`);
      }
      if (!result.ok && result.reason === 'integrity-conflict') {
        throw new Error(`season-close-integrity:${seasonKey}`);
      }
    } catch (error) {
      logger.error('[season-close-schedule]', {
        seasonKey,
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
      throw error;
    }
  },
);

function callableIdentity(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}) {
  if (!request.auth?.uid) return null;
  const firebaseToken = request.auth.token.firebase;
  const signInProvider =
    firebaseToken &&
    typeof firebaseToken === 'object' &&
    'sign_in_provider' in firebaseToken
      ? String(
          (firebaseToken as { sign_in_provider?: unknown }).sign_in_provider ??
            '',
        )
      : '';
  if (signInProvider === 'anonymous') return null;
  return {
    uid: request.auth.uid,
    displayName:
      typeof request.auth.token.name === 'string'
        ? request.auth.token.name
        : null,
  };
}

function resolveSignInProvider(token: Record<string, unknown> | undefined): string {
  const firebaseToken = token?.firebase;
  if (
    firebaseToken &&
    typeof firebaseToken === 'object' &&
    'sign_in_provider' in firebaseToken
  ) {
    return String(
      (firebaseToken as { sign_in_provider?: unknown }).sign_in_provider ?? '',
    );
  }
  return '';
}

function resolveLeaderboardIdentity(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}):
  | { ok: true; identity: { uid: string; displayName: string | null } }
  | { ok: false; reason: 'auth-required' | 'anonymous-not-supported' } {
  if (!request.auth?.uid) {
    return { ok: false, reason: 'auth-required' };
  }
  const signInProvider = resolveSignInProvider(request.auth.token);
  if (signInProvider === 'anonymous') {
    return { ok: false, reason: 'anonymous-not-supported' };
  }
  return {
    ok: true,
    identity: {
      uid: request.auth.uid,
      displayName:
        typeof request.auth.token.name === 'string'
          ? request.auth.token.name
          : null,
    },
  };
}

/** Username callables: linked hesap zorunlu (misafir oluşturamaz). */
function resolveUsernameIdentity(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}):
  | {
      ok: true;
      identity: {
        uid: string;
        displayName: string | null;
        signInProvider: string;
      };
    }
  | { ok: false; reason: 'auth-required' | 'anonymous-not-supported' } {
  if (!request.auth?.uid) {
    return { ok: false, reason: 'auth-required' };
  }
  const signInProvider = resolveSignInProvider(request.auth.token);
  if (signInProvider === 'anonymous' || !signInProvider) {
    return { ok: false, reason: 'anonymous-not-supported' };
  }
  return {
    ok: true,
    identity: {
      uid: request.auth.uid,
      displayName:
        typeof request.auth.token.name === 'string'
          ? request.auth.token.name
          : null,
      signInProvider,
    },
  };
}

function uidHash(uid?: string | null): string | null {
  return uid
    ? createHash('sha256').update(uid).digest('hex').slice(0, 12)
    : null;
}

function unauthenticatedResult(data: Record<string, unknown>) {
  return {
    ok: false,
    reason: 'auth-required',
    transactionId:
      typeof data.transactionId === 'string' ? data.transactionId : '',
    idempotencyKey:
      typeof data.idempotencyKey === 'string' ? data.idempotencyKey : '',
  };
}

function invalidRequestResult(data: Record<string, unknown>) {
  return {
    ok: false,
    reason: 'invalid-request',
    transactionId:
      typeof data.transactionId === 'string' ? data.transactionId : '',
    idempotencyKey:
      typeof data.idempotencyKey === 'string' ? data.idempotencyKey : '',
  };
}

function hasActionEnvelope(
  data: unknown,
): data is { transactionId: string; idempotencyKey: string } {
  return Boolean(
    data &&
      typeof data === 'object' &&
      isBoundedId((data as Record<string, unknown>).transactionId) &&
      isBoundedId((data as Record<string, unknown>).idempotencyKey),
  );
}

export const createVehicleListing = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const record = requestRecord(request.data);
  if (
    !hasActionEnvelope(request.data) ||
    !hasOnlyKeys(record, [
      'transactionId',
      'idempotencyKey',
      'truckId',
      'askingPrice',
      'clientSaveVersion',
    ]) ||
    !isBoundedId(record.truckId) ||
    !Number.isFinite(record.askingPrice) ||
    Number(record.askingPrice) <= 0 ||
    !isOptionalSaveVersion(record.clientSaveVersion)
  ) {
    return invalidRequestResult(request.data ?? {});
  }
  if (!(await consumeRateLimit(identity.uid, 'create', record.idempotencyKey as string))) {
    return rateLimitedResult(record);
  }
  const data = request.data as CreateVehicleListingInput;
  const result = await createVehicleListingTransaction(
    getFirestore(),
    identity,
    data,
  );
  logger.info('[vehicle-marketplace-create]', {
    transactionId: data.transactionId,
    listingId: result.data?.listingId ?? null,
    sellerUidHash: uidHash(identity.uid),
    buyerUidHash: null,
    durationMs: Date.now() - startedAt,
    result: result.ok ? 'success' : result.reason,
    retryCount: result.retryCount ?? 0,
  });
  return result;
});

export const cancelVehicleListing = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const record = requestRecord(request.data);
  if (
    !hasActionEnvelope(request.data) ||
    !hasOnlyKeys(record, [
      'transactionId',
      'idempotencyKey',
      'listingId',
      'listingVersion',
    ]) ||
    !isBoundedId(record.listingId) ||
    !Number.isInteger(record.listingVersion) ||
    Number(record.listingVersion) < 1
  ) {
    return invalidRequestResult(request.data ?? {});
  }
  if (!(await consumeRateLimit(identity.uid, 'cancel', record.idempotencyKey as string))) {
    return rateLimitedResult(record);
  }
  const data = request.data as CancelVehicleListingInput;
  const result = await cancelVehicleListingTransaction(
    getFirestore(),
    identity,
    data,
  );
  logger.info('[vehicle-marketplace-cancel]', {
    transactionId: data.transactionId,
    listingId: data.listingId,
    sellerUidHash: uidHash(identity.uid),
    buyerUidHash: null,
    durationMs: Date.now() - startedAt,
    result: result.ok ? 'success' : result.reason,
    retryCount: result.retryCount ?? 0,
  });
  return result;
});

export const purchaseVehicleListing = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const record = requestRecord(request.data);
  if (
    !hasActionEnvelope(request.data) ||
    !hasOnlyKeys(record, [
      'transactionId',
      'idempotencyKey',
      'listingId',
      'listingVersion',
      'quotedPrice',
      'clientSaveVersion',
    ]) ||
    !isBoundedId(record.listingId) ||
    !Number.isInteger(record.listingVersion) ||
    Number(record.listingVersion) < 1 ||
    !Number.isFinite(record.quotedPrice) ||
    Number(record.quotedPrice) <= 0 ||
    !isOptionalSaveVersion(record.clientSaveVersion)
  ) {
    return invalidRequestResult(request.data ?? {});
  }
  if (!(await consumeRateLimit(identity.uid, 'purchase', record.idempotencyKey as string))) {
    return rateLimitedResult(record);
  }
  const data = request.data as PurchaseVehicleListingInput;
  const firestore = getFirestore();
  const sellerUid = (
    await firestore.doc(`vehicleMarketplaceListings/${data.listingId}`).get()
  ).data()?.sellerUid as string | undefined;
  const result = await purchaseVehicleListingTransaction(
    firestore,
    identity,
    data,
  );
  logger.info('[MARKETPLACE_PURCHASE] transaction committed', {
    transactionId: data.transactionId,
    listingId: data.listingId,
    sellerUidHash: uidHash(sellerUid),
    buyerUidHash: uidHash(identity.uid),
    price: data.quotedPrice,
    serverMoneyBefore: result.data?.buyerCashBefore ?? null,
    serverMoneyAfter: result.data?.buyerCashAfter ?? null,
    durationMs: Date.now() - startedAt,
    result: result.ok ? 'success' : result.reason,
    retryCount: result.retryCount ?? 0,
  });
  logger.info('[vehicle-marketplace-purchase]', {
    transactionId: data.transactionId,
    listingId: data.listingId,
    sellerUidHash: uidHash(sellerUid),
    buyerUidHash: uidHash(identity.uid),
    durationMs: Date.now() - startedAt,
    result: result.ok ? 'success' : result.reason,
    retryCount: result.retryCount ?? 0,
  });
  return result;
});

export const getVehicleMarketplaceListings = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const parsedRequest = parseMarketplaceListRequest(request.data);
  if (!parsedRequest) {
    logger.warn('[vehicle-marketplace-list-invalid-request]', {
      uidHash: uidHash(identity.uid),
      keys: Object.keys(requestRecord(request.data)),
      cursorType: typeof requestRecord(request.data).cursor,
    });
    return invalidRequestResult(requestRecord(request.data));
  }
  const { limit, cursor } = parsedRequest;
  if (!(await consumeRateLimit(identity.uid, 'list'))) return rateLimitedResult(requestRecord(request.data));
  try {
    let query = getFirestore()
      .collection('vehicleMarketplaceListings')
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (cursor) {
      query = query.startAfter(Timestamp.fromMillis(cursor.createdAt), cursor.id);
    }
    const snapshot = await query.limit(limit + 1).get();
    const visibleDocs = snapshot.docs.slice(0, limit);
    const lastDocument = visibleDocs.at(-1);
    const serialized = serializeMarketplaceListingsForClient(visibleDocs);
    if (serialized.rejectedCount > 0) {
      logger.warn('[vehicle-marketplace-list-serialize]', {
        rejectedCount: serialized.rejectedCount,
        samples: serialized.rejected.slice(0, 3),
      });
    }
    return {
      ok: true,
      apiVersion: VEHICLE_MARKETPLACE_API_VERSION,
      listings: serialized.listings.map((listing) => listingDtoToClientWire(listing)),
      rejectedCount: serialized.rejectedCount,
      hasMore: snapshot.docs.length > limit,
      nextCursor: lastDocument
        ? {
            createdAt:
              serialized.listings.at(-1)?.createdAtMs ??
              timestampToMillis(lastDocument.data().createdAt) ??
              0,
            id: lastDocument.id,
          }
        : null,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error('[MARKETPLACE_LOAD_ERROR]', {
      uidHash: uidHash(identity.uid),
      code,
      message: error instanceof Error ? error.message : String(error),
      pathOrFunction: 'vehicleMarketplaceListings',
    });
    return {
      ok: false,
      reason: code.includes('permission-denied') ? 'permission-denied' : 'service-unavailable',
      transactionId: '',
      idempotencyKey: '',
    };
  }
});

export const getMyVehicleListings = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const record = requestRecord(request.data);
  if (!hasOnlyKeys(record, [])) return invalidRequestResult(record);
  if (!(await consumeRateLimit(identity.uid, 'myListings'))) return rateLimitedResult(record);
  const firestore = getFirestore();
  const initializationId = `marketplace-read-${identity.uid}`;
  const initialization = await ensureVehicleMarketplaceStateTransaction(
    firestore,
    identity,
    {
      transactionId: initializationId,
      idempotencyKey: initializationId,
    },
  );
  if (!initialization.ok) return initialization;
  const [listings, state] = await Promise.all([
    firestore
      .collection('vehicleMarketplaceListings')
      .where('sellerUid', '==', identity.uid)
      .limit(50)
      .get(),
    firestore.doc(`users/${identity.uid}/marketplaceState/current`).get(),
  ]);
  const serialized = serializeMarketplaceListingsForClient(listings.docs);
  if (serialized.rejectedCount > 0) {
    logger.warn('[vehicle-marketplace-my-listings-serialize]', {
      uidHash: uidHash(identity.uid),
      rejectedCount: serialized.rejectedCount,
      samples: serialized.rejected.slice(0, 3),
    });
  }
  const ownedSnapshots = Array.isArray(state.data()?.ownedTruckSnapshots)
    ? (state.data()?.ownedTruckSnapshots as Record<string, unknown>[])
    : [];
  const serializedVehicles = ownedSnapshots.map((vehicle) =>
    serializeReconciliationVehicleForClient(vehicle),
  );
  const vehicles = serializedVehicles.filter(
    (vehicle): vehicle is Record<string, unknown> => vehicle != null,
  );
  const droppedOwnedCount = ownedSnapshots.length - vehicles.length;
  if (droppedOwnedCount > 0) {
    logger.error('[vehicle-marketplace-reconciliation-incomplete]', {
      uidHash: uidHash(identity.uid),
      ownedCount: ownedSnapshots.length,
      serializedCount: vehicles.length,
      droppedOwnedCount,
    });
  }
  const result = {
    ok: true,
    apiVersion: VEHICLE_MARKETPLACE_API_VERSION,
    listings: serialized.listings.map((listing) => listingDtoToClientWire(listing)),
    rejectedCount: serialized.rejectedCount,
    reconciliation: state.exists
      ? {
          marketplaceStateVersion: state.data()?.stateVersion ?? 0,
          cash: state.data()?.canonicalCash ?? 0,
          fleetLimit: state.data()?.fleetLimit ?? 0,
          soldTruckIds: state.data()?.soldTruckTombstones ?? [],
          vehicles,
          incomplete: droppedOwnedCount > 0,
          droppedOwnedCount,
        }
      : null,
  };
  logger.info('[vehicle-marketplace-reconciliation]', {
    transactionId: null,
    listingId: null,
    sellerUidHash: uidHash(identity.uid),
    buyerUidHash: null,
    durationMs: Date.now() - startedAt,
    result: result.reconciliation ? 'success' : 'state-missing',
    retryCount: 0,
  });
  return result;
});

export const revokeAppleSignInTokens = onCall(
  {
    ...VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
    secrets: [...APPLE_SIGNIN_SECRETS],
  },
  async (request) => {
    const identity = callableIdentity(request);
    if (!identity) return unauthenticatedResult(request.data ?? {});
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, ['authorizationCode'])) return invalidRequestResult(record);
    if (
      typeof record.authorizationCode !== 'string' ||
      record.authorizationCode.trim().length === 0 ||
      record.authorizationCode.length > 4096
    ) {
      return invalidRequestResult(record);
    }
    if (!(await consumeRateLimit(identity.uid, 'accountDeletion'))) {
      return rateLimitedResult(record);
    }
    const result = await revokeAppleAuthorizationCode(
      record.authorizationCode,
      readAppleSignInSecretValuesFromBinding(),
    );
    if (result.ok) {
      logger.info('[apple-revoke]', { uidHash: uidHash(identity.uid), revoked: true });
      return { ok: true };
    }
    logger.warn('[apple-revoke]', {
      uidHash: uidHash(identity.uid),
      reason: result.reason,
    });
    return { ok: false, reason: result.reason };
  },
);

export const prepareVehicleMarketplaceAccountDeletion = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const identity = callableIdentity(request);
    if (!identity) return unauthenticatedResult(request.data ?? {});
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, ['authorizationCode'])) return invalidRequestResult(record);
    const authorizationCode =
      typeof record.authorizationCode === 'string' ? record.authorizationCode.trim() : undefined;
    if (
      record.authorizationCode !== undefined &&
      (!authorizationCode || authorizationCode.length > 4096)
    ) {
      return invalidRequestResult(record);
    }
    if (!(await consumeRateLimit(identity.uid, 'accountDeletion'))) {
      return rateLimitedResult(record);
    }
    const firestore = getFirestore();
    const deletionResult = await deleteLinkedAccount(firestore, {
      uid: identity.uid,
      authorizationCode,
    });
    if (!deletionResult.ok) {
      logger.warn('[account-deletion-failed]', {
        uidHash: uidHash(identity.uid),
        stage: deletionResult.stage,
        reason: deletionResult.reason,
        code: deletionResult.code,
      });
      return {
        ok: false,
        stage: deletionResult.stage,
        reason: deletionResult.reason,
        code: deletionResult.code,
      };
    }
    logger.info('[account-deletion-cleanup]', {
      uidHash: uidHash(identity.uid),
      ...deletionResult,
    });
    return deletionResult;
  },
);

export const setUsername = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const auth = resolveUsernameIdentity(request);
  const record = requestRecord(request.data);
  if (!auth.ok) {
    return { ok: false, reason: auth.reason };
  }
  if (
    !hasOnlyKeys(record, ['username']) ||
    typeof record.username !== 'string' ||
    record.username.length > 40
  ) {
    return { ok: false, reason: 'invalid-request' };
  }
  if (!(await consumeRateLimit(auth.identity.uid, 'setUsername'))) {
    return { ok: false, reason: 'rate-limited' };
  }
  const result = await setUsernameTransaction(
    getFirestore(),
    auth.identity,
    record.username,
  );
  logger.info('[username-set]', {
    uidHash: uidHash(auth.identity.uid),
    ok: result.ok,
    reason: result.ok ? 'success' : result.reason,
    durationMs: Date.now() - startedAt,
  });
  return result;
});

export const checkUsernameAvailability = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveUsernameIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (
      !hasOnlyKeys(record, ['username']) ||
      typeof record.username !== 'string' ||
      record.username.length > 40
    ) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'checkUsername'))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return checkUsernameAvailabilityTransaction(
      getFirestore(),
      auth.identity,
      record.username,
    );
  },
);

export const getUsernameProfile = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveUsernameIdentity(request);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, [])) {
      return { ok: false, reason: 'invalid-request' };
    }
    const profile = await getUsernameProfileForUid(getFirestore(), auth.identity.uid);
    return {
      ok: true,
      username: profile.username,
      usernameSetupCompleted: profile.usernameSetupCompleted,
      usernameChangeCount: profile.usernameChangeCount,
      usernameUpdatedAtMs: profile.usernameUpdatedAtMs,
      suggestedUsername: suggestUsernameFromDisplayName(auth.identity.displayName),
      nextChangeAvailableAtMs:
        profile.usernameUpdatedAtMs != null && profile.usernameSetupCompleted
          ? profile.usernameUpdatedAtMs + USERNAME_CHANGE_COOLDOWN_MS
          : null,
    };
  },
);

export const submitLeaderboardScore = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const startedAt = Date.now();
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return {
        ok: false,
        reason: auth.reason,
        transactionId: typeof record.transactionId === 'string' ? record.transactionId : '',
        idempotencyKey:
          typeof record.idempotencyKey === 'string' ? record.idempotencyKey : '',
      };
    }
    if (
      !hasActionEnvelope(request.data) ||
      !hasOnlyKeys(record, ['transactionId', 'idempotencyKey', 'clientSaveVersion']) ||
      !isOptionalSaveVersion(record.clientSaveVersion)
    ) {
      return invalidRequestResult(record);
    }
    // Client may not spoof UID — only request.auth.uid is used.
    if ('uid' in record || 'score' in record || 'companyScore' in record) {
      return invalidRequestResult(record);
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'leaderboardSubmit',
        record.idempotencyKey as string,
      ))
    ) {
      return rateLimitedResult(record);
    }
    const result = await submitLeaderboardScoreTransaction(
      getFirestore(),
      auth.identity,
      {
        transactionId: record.transactionId as string,
        idempotencyKey: record.idempotencyKey as string,
        clientSaveVersion:
          record.clientSaveVersion === undefined
            ? undefined
            : Number(record.clientSaveVersion),
      },
    );
    logger.info('[leaderboard-submit]', {
      uidHash: uidHash(auth.identity.uid),
      seasonKey: result.ok ? result.seasonKey : null,
      updated: result.ok ? result.updated : false,
      reason: result.ok ? result.reason ?? 'success' : result.reason,
      durationMs: Date.now() - startedAt,
      retryCount: result.retryCount ?? 0,
    });
    return result;
  },
);

export const getLeaderboard = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const startedAt = Date.now();
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return {
        ok: false,
        reason: auth.reason,
        seasonKey: '',
      };
    }
    const cursor = requestRecord(record.cursor);
    if (
      !hasOnlyKeys(record, ['seasonKey', 'limit', 'cursor']) ||
      (record.seasonKey !== undefined &&
        !isValidLeaderboardSeasonKey(record.seasonKey)) ||
      (record.limit !== undefined &&
        (!Number.isInteger(record.limit) ||
          Number(record.limit) < 1 ||
          Number(record.limit) > 100)) ||
      (record.cursor !== undefined &&
        (!hasOnlyKeys(cursor, ['companyScore', 'uid']) ||
          !Number.isFinite(cursor.companyScore) ||
          !isBoundedId(cursor.uid)))
    ) {
      return {
        ok: false,
        reason: 'invalid-request',
        seasonKey:
          typeof record.seasonKey === 'string' ? record.seasonKey : '',
      };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'leaderboardGet'))) {
      return {
        ok: false,
        reason: 'rate-limited',
        seasonKey:
          typeof record.seasonKey === 'string' ? record.seasonKey : '',
      };
    }
    const result = await getLeaderboardSnapshot(
      getFirestore(),
      auth.identity,
      {
        seasonKey:
          typeof record.seasonKey === 'string' ? record.seasonKey : undefined,
        limit: record.limit === undefined ? undefined : Number(record.limit),
        cursor:
          record.cursor === undefined
            ? undefined
            : {
                companyScore: Number(cursor.companyScore),
                uid: String(cursor.uid),
              },
      },
    );
    logger.info('[leaderboard-get]', {
      uidHash: uidHash(auth.identity.uid),
      seasonKey: result.seasonKey,
      ok: result.ok,
      entryCount: result.ok ? result.entries.length : 0,
      durationMs: Date.now() - startedAt,
    });
    return result;
  },
);

/**
 * Lazy fallback: finalize a closed season if the scheduler missed it.
 * Client may supply seasonKey only — never rank/score/count.
 */
export const ensureSeasonFinalizedCallable = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const startedAt = Date.now();
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return {
        ok: false,
        reason:
          auth.reason === 'auth-required' ? 'unauthenticated' : 'anonymous-not-allowed',
        seasonKey: typeof record.seasonKey === 'string' ? record.seasonKey : '',
        status: null,
        participantCount: null,
        processedCount: null,
        closedAt: null,
        pagesProcessed: 0,
        durationMs: 0,
      };
    }
    if (
      !hasOnlyKeys(record, ['seasonKey']) ||
      typeof record.seasonKey !== 'string' ||
      !isValidLeaderboardSeasonKey(record.seasonKey)
    ) {
      return {
        ok: false,
        reason: 'invalid-season-key',
        seasonKey: typeof record.seasonKey === 'string' ? record.seasonKey : '',
        status: null,
        participantCount: null,
        processedCount: null,
        closedAt: null,
        pagesProcessed: 0,
        durationMs: 0,
      };
    }
    // Reject client-fabricated authority fields if smuggled.
    if (
      'finalRank' in record ||
      'finalScore' in record ||
      'rank' in record ||
      'score' in record ||
      'participantCount' in record ||
      'uid' in record
    ) {
      return {
        ok: false,
        reason: 'invalid-request',
        seasonKey: record.seasonKey,
        status: null,
        participantCount: null,
        processedCount: null,
        closedAt: null,
        pagesProcessed: 0,
        durationMs: 0,
      };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'seasonCloseEnsure'))) {
      return {
        ok: false,
        reason: 'rate-limited',
        seasonKey: record.seasonKey,
        status: null,
        participantCount: null,
        processedCount: null,
        closedAt: null,
        pagesProcessed: 0,
        durationMs: 0,
      };
    }
    const result = await ensureSeasonFinalized(getFirestore(), record.seasonKey, {
      nowMs: startedAt,
      maxDurationMs: 45_000,
    });
    logger.info('[season-close-ensure]', {
      uidHash: uidHash(auth.identity.uid),
      seasonKey: result.seasonKey,
      ok: result.ok,
      reason: result.reason,
      status: result.status,
      durationMs: result.durationMs,
    });
    return result;
  },
);

/**
 * Trusted read of the caller's immutable closed-season result.
 * Auth uid only — no client-supplied uid/rank/score.
 */
export const getSeasonResult = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const startedAt = Date.now();
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return {
        ok: false,
        reason:
          auth.reason === 'auth-required' ? 'unauthenticated' : 'anonymous-not-allowed',
        seasonKey: typeof record.seasonKey === 'string' ? record.seasonKey : '',
        season: null,
        result: null,
      };
    }
    if (
      !hasOnlyKeys(record, ['seasonKey']) ||
      typeof record.seasonKey !== 'string' ||
      !isValidLeaderboardSeasonKey(record.seasonKey)
    ) {
      return {
        ok: false,
        reason: 'invalid-season-key',
        seasonKey: typeof record.seasonKey === 'string' ? record.seasonKey : '',
        season: null,
        result: null,
      };
    }
    if (
      'uid' in record ||
      'finalRank' in record ||
      'finalScore' in record ||
      'rank' in record ||
      'score' in record
    ) {
      return {
        ok: false,
        reason: 'invalid-request',
        seasonKey: record.seasonKey,
        season: null,
        result: null,
      };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'seasonResultGet'))) {
      return {
        ok: false,
        reason: 'rate-limited',
        seasonKey: record.seasonKey,
        season: null,
        result: null,
      };
    }
    const result = await getSeasonResultForUid(
      getFirestore(),
      auth.identity.uid,
      record.seasonKey,
      { nowMs: startedAt, ensure: true, maxEnsureDurationMs: 20_000 },
    );
    logger.info('[season-result-get]', {
      uidHash: uidHash(auth.identity.uid),
      seasonKey: result.seasonKey,
      ok: result.ok,
      reason: result.reason,
      durationMs: Date.now() - startedAt,
    });
    return result;
  },
);

/**
 * Materialization is intentionally NOT exposed as a public onCall.
 * Ordinary players must never trigger entitlement creation.
 * Trusted path: Admin SDK / backend scripts calling
 * `materializeSeasonRewardEntitlements` from seasonRewards.ts directly.
 */

/** Trusted read of the caller's season reward entitlement. seasonKey only. */
export const getSeasonRewardEntitlement = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return {
        ok: false,
        reason:
          auth.reason === 'auth-required' ? 'unauthenticated' : 'anonymous-not-allowed',
        seasonKey: typeof record.seasonKey === 'string' ? record.seasonKey : '',
        entitlement: null,
      };
    }
    if (
      !hasOnlyKeys(record, ['seasonKey']) ||
      typeof record.seasonKey !== 'string' ||
      !isValidLeaderboardSeasonKey(record.seasonKey)
    ) {
      return {
        ok: false,
        reason: 'invalid-season-key',
        seasonKey: typeof record.seasonKey === 'string' ? record.seasonKey : '',
        entitlement: null,
      };
    }
    if (
      'uid' in record ||
      'finalRank' in record ||
      'cashAmount' in record ||
      'tierId' in record
    ) {
      return {
        ok: false,
        reason: 'invalid-request',
        seasonKey: record.seasonKey,
        entitlement: null,
      };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'seasonRewardGet'))) {
      return {
        ok: false,
        reason: 'rate-limited',
        seasonKey: record.seasonKey,
        entitlement: null,
      };
    }
    return getSeasonRewardEntitlementForUid(
      getFirestore(),
      auth.identity.uid,
      record.seasonKey,
    );
  },
);

/**
 * Manual season reward claim. Client may send seasonKey + idempotencyKey only.
 * Cash authority: frozen entitlement + challenge-style cash transaction.
 */
export const claimSeasonReward = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const startedAt = Date.now();
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return {
        ok: false,
        reason:
          auth.reason === 'auth-required' ? 'unauthenticated' : 'anonymous-not-allowed',
        seasonKey: typeof record.seasonKey === 'string' ? record.seasonKey : '',
        cashBefore: null,
        cashAfter: null,
        cashAmount: null,
        tierId: null,
        claimedAt: null,
      };
    }
    if (
      !hasOnlyKeys(record, ['seasonKey', 'idempotencyKey']) ||
      typeof record.seasonKey !== 'string' ||
      !isValidLeaderboardSeasonKey(record.seasonKey) ||
      typeof record.idempotencyKey !== 'string'
    ) {
      return {
        ok: false,
        reason: 'invalid-request',
        seasonKey: typeof record.seasonKey === 'string' ? record.seasonKey : '',
        cashBefore: null,
        cashAfter: null,
        cashAmount: null,
        tierId: null,
        claimedAt: null,
      };
    }
    if (
      'uid' in record ||
      'finalRank' in record ||
      'finalScore' in record ||
      'participantCount' in record ||
      'tierId' in record ||
      'cashAmount' in record ||
      'rewardCatalogVersion' in record
    ) {
      return {
        ok: false,
        reason: 'invalid-request',
        seasonKey: record.seasonKey,
        cashBefore: null,
        cashAfter: null,
        cashAmount: null,
        tierId: null,
        claimedAt: null,
      };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'seasonRewardClaim',
        record.idempotencyKey,
      ))
    ) {
      return {
        ok: false,
        reason: 'rate-limited',
        seasonKey: record.seasonKey,
        cashBefore: null,
        cashAfter: null,
        cashAmount: null,
        tierId: null,
        claimedAt: null,
      };
    }
    const result = await claimSeasonRewardTransaction(
      getFirestore(),
      auth.identity.uid,
      {
        seasonKey: record.seasonKey,
        idempotencyKey: record.idempotencyKey,
      },
      startedAt,
    );
    logger.info('[season-reward-claim]', {
      uidHash: uidHash(auth.identity.uid),
      seasonKey: result.seasonKey,
      ok: result.ok,
      reason: result.reason,
      durationMs: Date.now() - startedAt,
    });
    return result;
  },
);

/** Current weekly season metadata; server clock is authoritative. */
export const getCurrentSeason = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, [])) return { ok: false, reason: 'invalid-request' };
    if (!(await consumeRateLimit(auth.identity.uid, 'challengeGet'))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return { ok: true, season: getSeasonDefinition(Date.now()) };
  },
);

/** Read-only challenge projection derived from trusted marketplace history. */
export const getChallengeProgress = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, [])) return { ok: false, reason: 'invalid-request' };
    if (!(await consumeRateLimit(auth.identity.uid, 'challengeGet'))) {
      return { ok: false, reason: 'rate-limited' };
    }
    try {
      const state = await getCurrentChallengeState(
        getFirestore(),
        auth.identity.uid,
        Date.now(),
      );
      return { ok: true, ...state };
    } catch (error) {
      logger.error('[challenge-progress-failed]', {
        uidHash: uidHash(auth.identity.uid),
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, reason: 'service-unavailable' };
    }
  },
);

/** Atomic, idempotent reward claim. No client progress amount is accepted. */
export const claimChallengeReward = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (
      !hasActionEnvelope(request.data) ||
      !hasOnlyKeys(record, ['challengeId', 'periodKey', 'transactionId', 'idempotencyKey']) ||
      !isBoundedId(record.challengeId) ||
      !isBoundedId(record.periodKey)
    ) {
      return invalidRequestResult(record);
    }
    if (!(await consumeRateLimit(
      auth.identity.uid,
      'challengeClaim',
      record.idempotencyKey as string,
    ))) {
      return rateLimitedResult(record);
    }
    const result = await claimChallengeRewardTransaction(
      getFirestore(),
      auth.identity.uid,
      {
        challengeId: record.challengeId as string,
        periodKey: record.periodKey as string,
        transactionId: record.transactionId as string,
        idempotencyKey: record.idempotencyKey as string,
      },
      Date.now(),
    );
    logger.info('[challenge-claim]', {
      uidHash: uidHash(auth.identity.uid),
      challengeId: record.challengeId,
      periodKey: record.periodKey,
      ok: result.ok,
      reason: result.ok ? 'success' : result.reason,
    });
    return result;
  },
);

export const recordCanonicalDeliveryCompletion = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason, deliveryId: '' };
    }
    if (!hasOnlyKeys(record, ['deliveryId']) || !isValidCanonicalDeliveryId(record.deliveryId)) {
      return {
        ok: false,
        reason: 'invalid-request',
        deliveryId: typeof record.deliveryId === 'string' ? record.deliveryId : '',
      };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalDelivery',
        record.deliveryId as string,
      ))
    ) {
      return {
        ok: false,
        reason: 'rate-limited',
        deliveryId: record.deliveryId,
      };
    }
    const result = await recordCanonicalDeliveryCompletionTransaction(
      getFirestore(),
      auth.identity.uid,
      record.deliveryId as string,
      Date.now(),
    );
    if (result.ok) {
      logger.info('[canonical-delivery-recorded]', {
        uidHash: uidHash(auth.identity.uid),
        alreadyRecorded: result.alreadyRecorded,
      });
    } else {
      logger.info('[canonical-delivery-completion]', {
        uidHash: uidHash(auth.identity.uid),
        ok: false,
        reason: result.reason,
      });
    }
    return result;
  },
);

export const acceptCanonicalMultimodalShipment = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyAcceptKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalMultimodalAccept'))) {
      return { ok: false, reason: 'rate-limited' };
    }
    const result = await acceptCanonicalMultimodalShipmentTransaction(
      getFirestore(),
      auth.identity.uid,
      record,
      Date.now(),
    );
    logger.info('[canonical-multimodal-accept]', {
      uidHash: uidHash(auth.identity.uid),
      ok: result.ok,
      reason: result.ok ? (result.receipt.alreadyAccepted ? 'already-accepted' : 'accepted') : result.reason,
    });
    return result;
  },
);

export const reportCanonicalMultimodalShipmentCompleted = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason, shipmentId: '' };
    }
    if (!hasOnlyKeys(record, ['shipmentId']) || !isValidCanonicalMultimodalShipmentId(record.shipmentId)) {
      return {
        ok: false,
        reason: 'invalid-request',
        shipmentId: typeof record.shipmentId === 'string' ? record.shipmentId : '',
      };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalMultimodalComplete',
        record.shipmentId as string,
      ))
    ) {
      return { ok: false, reason: 'rate-limited', shipmentId: record.shipmentId };
    }
    const result = await reportCanonicalMultimodalShipmentCompletedTransaction(
      getFirestore(),
      auth.identity.uid,
      record.shipmentId,
      Date.now(),
    );
    logger.info('[canonical-multimodal-complete]', {
      uidHash: uidHash(auth.identity.uid),
      ok: result.ok,
      reason: result.ok ? (result.alreadyReported ? 'already-reported' : 'reported') : result.reason,
    });
    return result;
  },
);

export const cancelCanonicalMultimodalShipment = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason, shipmentId: '' };
    }
    if (!hasOnlyKeys(record, ['shipmentId']) || !isValidCanonicalMultimodalShipmentId(record.shipmentId)) {
      return {
        ok: false,
        reason: 'invalid-request',
        shipmentId: typeof record.shipmentId === 'string' ? record.shipmentId : '',
      };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalMultimodalCancel',
        record.shipmentId as string,
      ))
    ) {
      return { ok: false, reason: 'rate-limited', shipmentId: record.shipmentId };
    }
    const result = await cancelCanonicalMultimodalShipmentTransaction(
      getFirestore(),
      auth.identity.uid,
      record.shipmentId,
      Date.now(),
    );
    logger.info('[canonical-multimodal-cancel]', {
      uidHash: uidHash(auth.identity.uid),
      ok: result.ok,
      reason: result.ok ? (result.alreadyCancelled ? 'already-cancelled' : 'cancelled') : result.reason,
    });
    return result;
  },
);

export const bootstrapInternalCanonicalFleetFixtures = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalFleetBootstrapKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalFleetBootstrap'))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return bootstrapInternalCanonicalFleetFixturesTransaction(
      getFirestore(),
      auth.identity.uid,
      Date.now(),
      { envValue: process.env.CANONICAL_ROAD_INTERNAL_TEST },
    );
  },
);

export const getOrIssueCanonicalRoadContracts = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalRoadIssuanceKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (!assertIssuanceSchema(record.canonicalSchemaVersion)) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalRoadIssue'))) {
      return { ok: false, reason: 'rate-limited' };
    }
    let fuelPricePerLiter = CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK;
    try {
      const eco = await getFirestore().doc('globalEconomy/current').get();
      const raw = Number(eco.data()?.fuelPricePerLiter);
      if (Number.isFinite(raw) && raw > 0) {
        fuelPricePerLiter = raw;
      }
    } catch {
      fuelPricePerLiter = CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK;
    }
    return getOrIssueCanonicalRoadContractsTransaction(
      getFirestore(),
      auth.identity.uid,
      Date.now(),
      fuelPricePerLiter,
    );
  },
);

export const acceptCanonicalRoadDelivery = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalRoadAcceptKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalRoadAccept'))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return acceptCanonicalRoadDeliveryTransaction(
      getFirestore(),
      auth.identity.uid,
      {
        contractId: String(record.contractId ?? ''),
        originCityId:
          record.originCityId === undefined ? undefined : String(record.originCityId),
        destinationCityId:
          record.destinationCityId === undefined ? undefined : String(record.destinationCityId),
        productId: record.productId === undefined ? undefined : String(record.productId),
        cargoAmount:
          record.cargoAmount === undefined ? undefined : Number(record.cargoAmount),
        canonicalSchemaVersion: Number(record.canonicalSchemaVersion),
        selectedTruckId:
          record.selectedTruckId === undefined ? undefined : String(record.selectedTruckId),
        selectedTrailerId:
          record.selectedTrailerId === undefined ? undefined : String(record.selectedTrailerId),
        selectedDriverId:
          record.selectedDriverId === undefined ? undefined : String(record.selectedDriverId),
        canonicalTruckAssetId:
          record.canonicalTruckAssetId === undefined
            ? undefined
            : String(record.canonicalTruckAssetId),
        canonicalTrailerAssetId:
          record.canonicalTrailerAssetId === undefined
            ? undefined
            : String(record.canonicalTrailerAssetId),
      },
      Date.now(),
      { executionEnvValue: process.env.CANONICAL_ROAD_EXECUTION_AUTHORITY, fuelEnvValue: process.env.CANONICAL_FUEL_AUTHORITY, progressiveEnvValue: process.env.CANONICAL_PROGRESSIVE_FUEL_AUTHORITY, timingEnvValue: process.env.CANONICAL_ROAD_TIMING_AUTHORITY, runtimeEnvValue: process.env.CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY, expiryEnvValue: process.env.CANONICAL_ROAD_CONTRACT_GAME_TIME_EXPIRY, driverRiskEnvValue: process.env.CANONICAL_ROAD_DRIVER_RISK_AUTHORITY ?? null, eventEnvValue: process.env.CANONICAL_CONTRACT_WORLD_EVENT_AUTHORITY ?? null },
    );
  },
);

export const reportCanonicalRoadDeliveryCompleted = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason, deliveryId: '' };
    }
    if (!hasOnlyCanonicalRoadCompleteKeys(record)) {
      return { ok: false, reason: 'invalid-request', deliveryId: String(record.deliveryId ?? '') };
    }
    const deliveryId = String(record.deliveryId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalRoadComplete', deliveryId))) {
      return { ok: false, reason: 'rate-limited', deliveryId };
    }
    const outcome = record.outcome === 'FAILED' ? 'FAILED' : record.outcome === 'COMPLETED' ? 'COMPLETED' : '';
    if (outcome !== 'FAILED' && outcome !== 'COMPLETED') {
      return { ok: false, reason: 'invalid-request', deliveryId };
    }
    return reportCanonicalRoadDeliveryCompletedTransaction(
      getFirestore(),
      auth.identity.uid,
      deliveryId,
      outcome,
      Date.now(),
      record.actualTravelHours === undefined ? null : Number(record.actualTravelHours),
      {
        runtimeEnvValue: process.env.CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY,
        progressionEnvValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY,
      },
    );
  },
);

export const applyCanonicalRoadDeliveryWear = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason, deliveryId: String(record.deliveryId ?? '') };
    }
    if (!hasOnlyCanonicalRoadWearKeys(record)) {
      return { ok: false, reason: 'invalid-request', deliveryId: String(record.deliveryId ?? '') };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA', deliveryId: String(record.deliveryId ?? '') };
    }
    const deliveryId = String(record.deliveryId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalRoadWear', deliveryId))) {
      return { ok: false, reason: 'rate-limited', deliveryId };
    }
    return applyCanonicalRoadDeliveryWearTransaction(
      getFirestore(),
      auth.identity.uid,
      deliveryId,
      Date.now(),
    );
  },
);

export const finalizeCanonicalRoadExecution = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason, deliveryId: String(record.deliveryId ?? '') };
    }
    if (!hasOnlyCanonicalRoadFinalizeKeys(record)) {
      return { ok: false, reason: 'invalid-request', deliveryId: String(record.deliveryId ?? '') };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA', deliveryId: String(record.deliveryId ?? '') };
    }
    const deliveryId = String(record.deliveryId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalRoadFinalize', deliveryId))) {
      return { ok: false, reason: 'rate-limited', deliveryId };
    }
    return finalizeCanonicalRoadExecutionTransaction(
      getFirestore(),
      auth.identity.uid,
      deliveryId,
      Date.now(),
      { envValue: process.env.CANONICAL_ROAD_EXECUTION_AUTHORITY },
    );
  },
);

export const repairCanonicalFleetAsset = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason, assetId: String(record.assetId ?? '') };
    }
    if (!hasOnlyCanonicalFleetRepairKeys(record)) {
      return { ok: false, reason: 'invalid-request', assetId: String(record.assetId ?? '') };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA', assetId: String(record.assetId ?? '') };
    }
    const assetId = String(record.assetId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalFleetRepair', assetId))) {
      return { ok: false, reason: 'rate-limited', assetId };
    }
    return repairCanonicalFleetAssetTransaction(
      getFirestore(),
      auth.identity.uid,
      assetId,
      String(record.repairIntentId ?? ''),
      Date.now(),
      {
        envValue: process.env.CANONICAL_FLEET_MUTATIONS,
        repairAction: record.repairAction === undefined ? undefined : String(record.repairAction),
      },
    );
  },
);

export const purchaseCanonicalFuel = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalFuelPurchaseKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const assetId = String(record.assetId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalFuelPurchase', assetId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    let fuelPriceRaw: unknown;
    try {
      const eco = await getFirestore().doc('globalEconomy/current').get();
      fuelPriceRaw = eco.data()?.fuelPricePerLiter;
    } catch {
      fuelPriceRaw = undefined;
    }
    return purchaseCanonicalFuelTransaction(
      getFirestore(),
      auth.identity.uid,
      assetId,
      String(record.fuelPurchaseIntentId ?? ''),
      String(record.mode ?? ''),
      Date.now(),
      {
        envValue: process.env.CANONICAL_FUEL_AUTHORITY,
        requestedLiters:
          record.requestedLiters === undefined ? undefined : Number(record.requestedLiters),
        fuelPriceRaw,
      },
    );
  },
);

export const advanceCanonicalRoadExecution = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalProgressiveAdvanceKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    const deliveryId = String(record.deliveryId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalRoadProgress', deliveryId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return advanceCanonicalRoadExecutionTransaction(
      getFirestore(),
      auth.identity.uid,
      deliveryId,
      Number(record.canonicalSchemaVersion),
      Date.now(),
      { envValue: process.env.CANONICAL_PROGRESSIVE_FUEL_AUTHORITY, runtimeEnvValue: process.env.CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY },
    );
  },
);

export const setCanonicalRoadExecutionSpeed = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalProgressiveSpeedKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    const deliveryId = String(record.deliveryId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalRoadSpeed', deliveryId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return setCanonicalRoadExecutionSpeedTransaction(
      getFirestore(),
      auth.identity.uid,
      deliveryId,
      Number(record.gameSpeed),
      Number(record.canonicalSchemaVersion),
      Date.now(),
      { envValue: process.env.CANONICAL_PROGRESSIVE_FUEL_AUTHORITY, runtimeEnvValue: process.env.CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY },
    );
  },
);

export const setCanonicalRoadExecutionPaused = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalProgressivePauseKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (typeof record.paused !== 'boolean') {
      return { ok: false, reason: 'invalid-request' };
    }
    const deliveryId = String(record.deliveryId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalRoadPause', deliveryId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return setCanonicalRoadExecutionPausedTransaction(
      getFirestore(),
      auth.identity.uid,
      deliveryId,
      record.paused,
      Number(record.canonicalSchemaVersion),
      Date.now(),
      { envValue: process.env.CANONICAL_PROGRESSIVE_FUEL_AUTHORITY, runtimeEnvValue: process.env.CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY },
    );
  },
);

export const purchaseCanonicalCatalogAsset = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (containsForbiddenNonDeliveryXpClientKeys(record) || !hasOnlyCanonicalCatalogPurchaseKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const purchaseId = String(record.purchaseId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalCatalogPurchase', purchaseId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return purchaseCanonicalCatalogAssetTransaction(
      getFirestore(),
      auth.identity.uid,
      String(record.catalogModelId ?? ''),
      purchaseId,
      String(record.assetType ?? ''),
      Date.now(),
      {
        envValue: process.env.CANONICAL_CATALOG_PURCHASE,
        nonDeliveryXpEnvValue: process.env.CANONICAL_NON_DELIVERY_XP_AUTHORITY,
        progressionEnvValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY,
      },
    );
  },
);

export const createCanonicalVehicleLease = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalLeaseStartKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const leaseIntentId = String(record.leaseIntentId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalVehicleLease', leaseIntentId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return createCanonicalVehicleLeaseTransaction(
      getFirestore(),
      auth.identity.uid,
      String(record.catalogModelId ?? ''),
      leaseIntentId,
      String(record.leasePeriod ?? ''),
      Date.now(),
      { envValue: process.env.CANONICAL_CORE_VEHICLE_STAFF_CASH },
    );
  },
);

export const hireCanonicalDriver = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (containsForbiddenNonDeliveryXpClientKeys(record) || !hasOnlyCanonicalDriverHireKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const hireIntentId = String(record.hireIntentId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalDriverHire', hireIntentId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return hireCanonicalDriverTransaction(
      getFirestore(),
      auth.identity.uid,
      String(record.poolId ?? ''),
      hireIntentId,
      Date.now(),
      {
        envValue: process.env.CANONICAL_CORE_VEHICLE_STAFF_CASH,
        nonDeliveryXpEnvValue: process.env.CANONICAL_NON_DELIVERY_XP_AUTHORITY,
        progressionEnvValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY,
      },
    );
  },
);

export const fireCanonicalDriver = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalDriverFireKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const fireIntentId = String(record.fireIntentId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalDriverFire', fireIntentId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return fireCanonicalDriverTransaction(
      getFirestore(),
      auth.identity.uid,
      String(record.driverId ?? ''),
      fireIntentId,
      Date.now(),
      { envValue: process.env.CANONICAL_CORE_VEHICLE_STAFF_CASH },
    );
  },
);

export const sellCanonicalFleetAsset = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalVehicleSaleKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const saleIntentId = String(record.saleIntentId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalVehicleSale', saleIntentId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return sellCanonicalFleetAssetTransaction(
      getFirestore(),
      auth.identity.uid,
      String(record.assetId ?? ''),
      saleIntentId,
      Date.now(),
      { envValue: process.env.CANONICAL_CORE_VEHICLE_STAFF_CASH },
    );
  },
);

export const recoverCanonicalVehicle = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalVehicleRecoveryKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const recoveryIntentId = String(record.recoveryIntentId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalVehicleRecovery', recoveryIntentId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return recoverCanonicalVehicleTransaction(
      getFirestore(),
      auth.identity.uid,
      String(record.assetId ?? ''),
      recoveryIntentId,
      { envValue: process.env.CANONICAL_CORE_VEHICLE_STAFF_CASH },
    );
  },
);

export const settleCanonicalDailyOpexInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalDailyOpexKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalDailyOpex', auth.identity.uid))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return settleCanonicalDailyOpexInternalTransaction(
      getFirestore(),
      auth.identity.uid,
      Date.now(),
      {
        envValue: process.env.CANONICAL_DAILY_OPEX,
        expectedPeriodIndex:
          record.expectedPeriodIndex === undefined ? undefined : Number(record.expectedPeriodIndex),
      },
    );
  },
);

export const openCanonicalWarehouse = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (containsForbiddenNonDeliveryXpClientKeys(record) || !hasOnlyCanonicalWarehouseOpenKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const openIntentId = String(record.openIntentId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalWarehouseOpen', openIntentId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return openCanonicalWarehouseTransaction(
      getFirestore(),
      auth.identity.uid,
      String(record.cityId ?? ''),
      String(record.warehouseType ?? ''),
      openIntentId,
      Date.now(),
      {
        envValue: process.env.CANONICAL_WAREHOUSE_AUTHORITY,
        nonDeliveryXpEnvValue: process.env.CANONICAL_NON_DELIVERY_XP_AUTHORITY,
        progressionEnvValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY,
      },
    );
  },
);

export const upgradeCanonicalWarehouse = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (containsForbiddenNonDeliveryXpClientKeys(record) || !hasOnlyCanonicalWarehouseUpgradeKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const warehouseId = String(record.warehouseId ?? '');
    const upgradeIntentId = String(record.upgradeIntentId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalWarehouseUpgrade', warehouseId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return upgradeCanonicalWarehouseTransaction(
      getFirestore(),
      auth.identity.uid,
      warehouseId,
      upgradeIntentId,
      Date.now(),
      {
        envValue: process.env.CANONICAL_WAREHOUSE_AUTHORITY,
        nonDeliveryXpEnvValue: process.env.CANONICAL_NON_DELIVERY_XP_AUTHORITY,
        progressionEnvValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY,
      },
    );
  },
);

export const bootstrapInternalCanonicalCargoMarket = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (!hasOnlyCanonicalCargoBootstrapKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (
      !(await consumeRateLimit(auth.identity.uid, 'canonicalCargoMarketBootstrap', auth.identity.uid))
    ) {
      return { ok: false, reason: 'rate-limited' };
    }
    return bootstrapInternalCanonicalCargoMarketTransaction(
      getFirestore(),
      auth.identity.uid,
      Date.now(),
      { envValue: process.env.CANONICAL_CARGO_MARKET_AUTHORITY },
    );
  },
);

export const buyCanonicalCargo = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (containsForbiddenNonDeliveryXpClientKeys(record) || !hasOnlyCanonicalCargoBuyKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const purchaseIntentId = String(record.purchaseIntentId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalCargoBuy', purchaseIntentId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return buyCanonicalCargoTransaction(
      getFirestore(),
      auth.identity.uid,
      String(record.cityId ?? ''),
      String(record.productId ?? ''),
      Number(record.quantity),
      String(record.warehouseId ?? ''),
      purchaseIntentId,
      Date.now(),
      {
        envValue: process.env.CANONICAL_CARGO_MARKET_AUTHORITY,
        nonDeliveryXpEnvValue: process.env.CANONICAL_NON_DELIVERY_XP_AUTHORITY,
        progressionEnvValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY,
      },
    );
  },
);

export const sellCanonicalCargo = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (containsForbiddenNonDeliveryXpClientKeys(record) || !hasOnlyCanonicalCargoSellKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const saleIntentId = String(record.saleIntentId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalCargoSell', saleIntentId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return sellCanonicalCargoTransaction(
      getFirestore(),
      auth.identity.uid,
      String(record.cityId ?? ''),
      String(record.productId ?? ''),
      Number(record.quantity),
      String(record.warehouseId ?? ''),
      saleIntentId,
      Date.now(),
      {
        envValue: process.env.CANONICAL_CARGO_MARKET_AUTHORITY,
        nonDeliveryXpEnvValue: process.env.CANONICAL_NON_DELIVERY_XP_AUTHORITY,
        progressionEnvValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY,
      },
    );
  },
);

export const advanceCanonicalProductionMarketInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalMarketTickKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalProductionMarketTick',
        auth.identity.uid,
      ))
    ) {
      return { ok: false, reason: 'rate-limited' };
    }
    return advanceCanonicalProductionMarketTickTransaction(
      getFirestore(),
      Date.now(),
      { envValue: process.env.CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY },
    );
  },
);

export const generateCanonicalProductionRoadBatchInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalProductionRoadIssuanceKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalProductionRoadContractIssuance',
        auth.identity.uid,
      ))
    ) {
      return { ok: false, reason: 'rate-limited' };
    }
    return generateCanonicalProductionRoadBatchTransaction(
      getFirestore(),
      auth.identity.uid,
      Date.now(),
      {
        envValue: process.env.CANONICAL_ROAD_CONTRACT_ISSUANCE_AUTHORITY,
        eventEnvValue: process.env.CANONICAL_CONTRACT_WORLD_EVENT_AUTHORITY,
        runtimeEnvValue: process.env.CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY,
        expiryEnvValue: process.env.CANONICAL_ROAD_CONTRACT_GAME_TIME_EXPIRY,
        refreshEnvValue: process.env.CANONICAL_ROAD_CONTRACT_REFRESH_AUTHORITY,
        progressionEnvValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY,
      },
    );
  },
);

export const refreshCanonicalRoadContractBatchInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalRoadRefreshKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const intent = parseCanonicalRefreshIntentId(record.refreshIntentId);
    if (!intent.ok) return { ok: false, reason: intent.reason };
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalRoadContractRefresh',
        auth.identity.uid,
      ))
    ) {
      return { ok: false, reason: 'rate-limited' };
    }
    return generateCanonicalProductionRoadBatchTransaction(
      getFirestore(),
      auth.identity.uid,
      Date.now(),
      {
        envValue: process.env.CANONICAL_ROAD_CONTRACT_ISSUANCE_AUTHORITY,
        eventEnvValue: process.env.CANONICAL_CONTRACT_WORLD_EVENT_AUTHORITY,
        runtimeEnvValue: process.env.CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY,
        expiryEnvValue: process.env.CANONICAL_ROAD_CONTRACT_GAME_TIME_EXPIRY,
        refreshEnvValue: process.env.CANONICAL_ROAD_CONTRACT_REFRESH_AUTHORITY,
        progressionEnvValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY,
        refreshIntentId: intent.intentId,
      },
    );
  },
);

export const initializeCanonicalCompanyProgressionInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (containsForbiddenProgressionClientKeys(record) || !hasOnlyCanonicalProgressionInitKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalCompanyProgressionInit',
        auth.identity.uid,
      ))
    ) {
      return { ok: false, reason: 'rate-limited' };
    }
    const result = await initializeCanonicalCompanyProgressionForNewAccount(
      getFirestore(),
      auth.identity.uid,
      Date.now(),
      { envValue: process.env.CANONICAL_COMPANY_PROGRESSION_AUTHORITY },
    );
    if (!result.ok) return result;
    return {
      ok: true,
      alreadyInitialized: result.alreadyInitialized,
      progressionRevision: result.state.progressionRevision,
    };
  },
);

export const advanceCanonicalContractClock = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalContractClockSpeedKeys({ canonicalSchemaVersion: record.canonicalSchemaVersion })) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Object.keys(record).some((key) => key !== 'canonicalSchemaVersion')) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalContractClock', auth.identity.uid))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return advanceCanonicalContractClockTransaction(
      getFirestore(),
      auth.identity.uid,
      Number(record.canonicalSchemaVersion),
      Date.now(),
      { envValue: process.env.CANONICAL_ROAD_CONTRACT_GAME_TIME_EXPIRY },
    );
  },
);

export const setCanonicalContractClockSpeed = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalContractClockSpeedKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalContractClock', `speed:${auth.identity.uid}`))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return setCanonicalContractClockSpeedTransaction(
      getFirestore(),
      auth.identity.uid,
      Number(record.gameSpeed),
      Number(record.canonicalSchemaVersion),
      Date.now(),
      { envValue: process.env.CANONICAL_ROAD_CONTRACT_GAME_TIME_EXPIRY },
    );
  },
);

export const setCanonicalContractClockPaused = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalContractClockPauseKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalContractClock', `pause:${auth.identity.uid}`))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return setCanonicalContractClockPausedTransaction(
      getFirestore(),
      auth.identity.uid,
      record.paused === true,
      Number(record.canonicalSchemaVersion),
      Date.now(),
      { envValue: process.env.CANONICAL_ROAD_CONTRACT_GAME_TIME_EXPIRY },
    );
  },
);

export const claimCanonicalLocalReward = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalLocalRewardKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const rewardId = String(record.rewardId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalLocalReward', rewardId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    if (isCanonicalClientRewardXpAllowed()) {
      return claimCanonicalClientRewardTransaction(getFirestore(), auth.identity.uid, rewardId, Date.now());
    }
    return claimCanonicalLocalRewardTransaction(
      getFirestore(),
      auth.identity.uid,
      rewardId,
      Date.now(),
      { envValue: process.env.CANONICAL_LOCAL_REWARD_AUTHORITY },
    );
  },
);

export const previewCanonicalLegacyProgressionMigrationInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalProgressionMigrationPreviewKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalProgressionMigrationPreview',
        auth.identity.uid,
      ))
    ) {
      return { ok: false, reason: 'rate-limited' };
    }
    return previewCanonicalLegacyProgressionMigration(getFirestore(), auth.identity.uid, Date.now(), {
      envValue: process.env.CANONICAL_PROGRESSION_MIGRATION,
    });
  },
);

export const freezeCanonicalProgressionMigrationSourceInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalProgressionMigrationFreezeKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const policy = record.migrationPolicyVersion;
    if (
      policy !== undefined &&
      policy !== CANONICAL_PROGRESSION_MIGRATION_SOURCE_POLICY_VERSION
    ) {
      return { ok: false, reason: 'MIGRATION_SOURCE_POLICY_UNKNOWN' };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalProgressionMigrationFreeze',
        auth.identity.uid,
      ))
    ) {
      return { ok: false, reason: 'rate-limited' };
    }
    return freezeCanonicalProgressionMigrationSource(getFirestore(), auth.identity.uid, Date.now(), {
      envValue: process.env.CANONICAL_PROGRESSION_MIGRATION,
      migrationPolicyVersion: typeof policy === 'string' ? policy : undefined,
    });
  },
);

export const cutoverCanonicalLegacyProgressionMigrationInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalProgressionImmediateCutoverKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const policy = record.cutoverPolicyVersion;
    if (policy !== undefined && policy !== CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER_POLICY_VERSION) {
      return { ok: false, reason: 'MIGRATION_SOURCE_POLICY_UNKNOWN' };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalProgressionImmediateCutover',
        auth.identity.uid,
      ))
    ) {
      return { ok: false, reason: 'rate-limited' };
    }
    return cutoverCanonicalLegacyProgressionMigration(getFirestore(), auth.identity.uid, Date.now(), {
      envValue: process.env.CANONICAL_PROGRESSION_IMMEDIATE_CUTOVER,
      cutoverPolicyVersion: typeof policy === 'string' ? policy : undefined,
    });
  },
);

export const applyCanonicalLegacyProgressionMigrationInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalProgressionMigrationApplyKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'canonicalProgressionMigrationApply',
        auth.identity.uid,
      ))
    ) {
      return { ok: false, reason: 'rate-limited' };
    }
    return applyCanonicalLegacyProgressionMigration(getFirestore(), auth.identity.uid, Date.now(), {
      envValue: process.env.CANONICAL_PROGRESSION_MIGRATION,
    });
  },
);

export const claimCanonicalClientReward = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    if (!hasOnlyCanonicalClientRewardClaimKeys(record) || !hasOnlyCanonicalLocalRewardKeys(record)) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA' };
    }
    const rewardId = String(record.rewardId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalClientReward', rewardId))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return claimCanonicalClientRewardTransaction(getFirestore(), auth.identity.uid, rewardId, Date.now());
  },
);

export const upgradeCanonicalFleetAsset = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason, assetId: String(record.assetId ?? '') };
    }
    if (!hasOnlyCanonicalFleetUpgradeKeys(record)) {
      return { ok: false, reason: 'invalid-request', assetId: String(record.assetId ?? '') };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA', assetId: String(record.assetId ?? '') };
    }
    const assetId = String(record.assetId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalFleetUpgrade', assetId))) {
      return { ok: false, reason: 'rate-limited', assetId };
    }
    return upgradeCanonicalFleetAssetTransaction(
      getFirestore(),
      auth.identity.uid,
      assetId,
      String(record.upgradeType ?? ''),
      String(record.upgradeIntentId ?? ''),
      Date.now(),
      { envValue: process.env.CANONICAL_FLEET_MUTATIONS },
    );
  },
);

export const settleCanonicalRoadDeliveryInternal = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason, deliveryId: String(record.deliveryId ?? '') };
    }
    if (!hasOnlyCanonicalRoadSettleKeys(record)) {
      return { ok: false, reason: 'invalid-request', deliveryId: String(record.deliveryId ?? '') };
    }
    if (Number(record.canonicalSchemaVersion) !== 1) {
      return { ok: false, reason: 'UNSUPPORTED_SCHEMA', deliveryId: String(record.deliveryId ?? '') };
    }
    const deliveryId = String(record.deliveryId ?? '');
    if (!(await consumeRateLimit(auth.identity.uid, 'canonicalRoadSettle', deliveryId))) {
      return { ok: false, reason: 'rate-limited', deliveryId };
    }
    return settleCanonicalRoadDeliveryInternalTransaction(
      getFirestore(),
      auth.identity.uid,
      deliveryId,
      Date.now(),
      { envValue: process.env.CANONICAL_ROAD_SERVER_CASH_SHADOW },
    );
  },
);

export const getWeeklyMissions = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    if (!request.auth?.uid) {
      return { ok: false, reason: 'auth-required' };
    }
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, [])) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (!(await consumeRateLimit(request.auth.uid, 'weeklyMissionGet'))) {
      return { ok: false, reason: 'rate-limited' };
    }
    const linkedAccount = resolveSignInProvider(request.auth.token) !== 'anonymous';
    return getWeeklyMissionsState(
      getFirestore(),
      {
        uid: request.auth.uid,
        linkedAccount,
      },
      Date.now(),
    );
  },
);

export const claimWeeklyMissionReward = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return {
        ok: false,
        reason: auth.reason,
        weekKey: typeof record.weekKey === 'string' ? record.weekKey : '',
        missionId: typeof record.missionId === 'string' ? record.missionId : '',
      };
    }
    if (
      !hasOnlyKeys(record, ['weekKey', 'missionId', 'idempotencyKey']) ||
      !isBoundedId(record.weekKey) ||
      !isBoundedId(record.missionId) ||
      !isBoundedId(record.idempotencyKey)
    ) {
      return {
        ok: false,
        reason: 'invalid-request',
        weekKey: typeof record.weekKey === 'string' ? record.weekKey : '',
        missionId: typeof record.missionId === 'string' ? record.missionId : '',
      };
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'weeklyMissionClaim',
        record.idempotencyKey as string,
      ))
    ) {
      return {
        ok: false,
        reason: 'rate-limited',
        weekKey: record.weekKey,
        missionId: record.missionId,
      };
    }
    const result = await claimWeeklyMissionRewardTransaction(
      getFirestore(),
      auth.identity.uid,
      {
        weekKey: record.weekKey as string,
        missionId: record.missionId as string,
        idempotencyKey: record.idempotencyKey as string,
      },
      Date.now(),
    );
    if (result.ok) {
      logger.info('[weekly-claim-succeeded]', {
        uidHash: uidHash(auth.identity.uid),
        weekKey: record.weekKey,
        missionId: record.missionId,
        cashAmount: result.cashAmount,
      });
    } else {
      logger.info('[weekly-claim-rejected]', {
        uidHash: uidHash(auth.identity.uid),
        weekKey: record.weekKey,
        missionId: record.missionId,
        reason: result.reason,
      });
    }
    return result;
  },
);

export const migrateLegacyServerState = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const identity = callableIdentity(request);
    if (!identity) return unauthenticatedResult(request.data ?? {});
    const record = requestRecord(request.data);
    if (
      !hasOnlyKeys(record, ['dryRun']) ||
      (record.dryRun !== undefined && typeof record.dryRun !== 'boolean')
    ) {
      return invalidRequestResult(record);
    }
    if (!(await consumeRateLimit(identity.uid, 'migrateServerState'))) {
      return rateLimitedResult(record);
    }
    const dryRun = record.dryRun === true;
    const result = await migrateLegacyServerStateTransaction(
      getFirestore(),
      identity.uid,
      dryRun,
    );
    logger.info('[server-state-migration]', {
      uidHash: uidHash(identity.uid),
      dryRun,
      ok: result.ok,
      reason: result.ok ? 'success' : result.reason,
      flags: result.report?.flags ?? [],
    });
    return result;
  },
);

export const reconcileAuthoritativeFleet = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const identity = callableIdentity(request);
    if (!identity) return unauthenticatedResult(request.data ?? {});
    const record = requestRecord(request.data);
    if (
      !hasOnlyKeys(record, ['force', 'requestedVehicleId']) ||
      (record.force !== undefined && typeof record.force !== 'boolean') ||
      (record.requestedVehicleId !== undefined &&
        !isBoundedId(record.requestedVehicleId))
    ) {
      return invalidRequestResult(record);
    }
    if (!(await consumeRateLimit(identity.uid, 'migrateServerState'))) {
      return rateLimitedResult(record);
    }
    const result = await reconcileAuthoritativeFleetTransaction(
      getFirestore(),
      identity.uid,
      Date.now(),
      {
        force: record.force === true,
        requestedVehicleId:
          typeof record.requestedVehicleId === 'string'
            ? record.requestedVehicleId
            : undefined,
      },
    );
    logger.info('[reconcile-authoritative-fleet]', {
      uidHash: uidHash(identity.uid),
      ok: result.ok,
      reconciled: result.ok ? result.reconciled : false,
      truckCount: result.ok ? result.state.ownedTruckSnapshots.length : 0,
      reason: result.ok ? null : result.reason,
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        transactionId: '',
        idempotencyKey: '',
      };
    }
    return {
      ok: true,
      reconciled: result.reconciled,
      marketplaceStateVersion: result.state.stateVersion,
      sourceSaveVersion: result.state.sourceSaveVersion,
      ownedTruckIds: result.state.ownedTruckSnapshots.map((truck) => truck.truckId),
    };
  },
);

export const expireVehicleMarketplace = onSchedule(
  {
    schedule: '15 * * * *',
    timeZone: 'UTC',
    retryCount: 2,
    maxInstances: 1,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const firestore = getFirestore();
    const [expiredListings, cleanup] = await Promise.all([
      expireVehicleMarketplaceListings(firestore),
      cleanupVehicleMarketplaceEphemeralRecords(firestore),
    ]);
    logger.info('[vehicle-marketplace-expiry]', {
      expiredListings,
      ...cleanup,
    });
  },
);
