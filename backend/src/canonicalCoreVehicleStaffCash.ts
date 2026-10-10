/**
 * INTERNAL_TEST core vehicle/staff cash (Step 29R).
 * Server derives lease prepaid, hire fee, severance, sale value.
 * Recovery is fail-closed. Does not mutate player.money / users/{uid}.money / saves.
 */

import type { Firestore } from 'firebase-admin/firestore';

import {
  CANONICAL_DRIVER_RECEIPTS_COLLECTION,
  CANONICAL_DRIVERS_COLLECTION,
  CANONICAL_DRIVER_ROSTER_META_COLLECTION,
  CANONICAL_DRIVER_ROSTER_META_DOC,
  CANONICAL_LEASE_RECEIPTS_COLLECTION,
  CANONICAL_LEASE_SCHEMA_VERSION,
  CANONICAL_LEASE_POLICY_VERSION,
  CANONICAL_VEHICLE_LEASES_COLLECTION,
  CANONICAL_VEHICLE_SALE_RECEIPTS_COLLECTION,
  CANONICAL_VEHICLE_STAFF_AUTHORITY_VERSION,
  CANONICAL_DRIVER_OFFER_POLICY_VERSION,
  VEHICLE_RECOVERY_FAMILY_STATUS,
  createCanonicalDriverFireTransactionId,
  createCanonicalDriverHireTransactionId,
  createCanonicalLeaseAssetId,
  createCanonicalLeaseId,
  createCanonicalLeaseStartTransactionId,
  createCanonicalVehicleSaleTransactionId,
  deriveCanonicalDriverSeveranceCost,
  deriveCanonicalLeaseStartCost,
  deriveCanonicalVehicleSaleValue,
  freezeCanonicalDriverOfferFromPool,
  isCanonicalCoreVehicleStaffCashAllowed,
  isValidCanonicalLeasePeriod,
  isValidCanonicalVehicleStaffIntentId,
  type CanonicalDriverDocument,
  type CanonicalDriverReceipt,
  type CanonicalLeaseReceipt,
  type CanonicalVehicleLeaseDocument,
  type CanonicalVehicleSaleReceipt,
} from '../../src/domain/canonicalCoreVehicleStaffCash';
import { buildCanonicalFleetAssetFromLease } from '../../src/domain/canonicalProductionFleet';
import {
  CANONICAL_FLEET_ASSETS_COLLECTION,
  parseCanonicalFleetAsset,
  type CanonicalFleetAssetDocument,
} from '../../src/domain/canonicalRoadFleet';
import {
  buildCanonicalDriverHireProgressionInput,
  progressionDriverHireOperationId,
  type CanonicalNonDeliveryXpOutcome,
} from '../../src/domain/canonicalNonDeliveryCompanyXp';
import {
  applyCanonicalCashMutationsInTransaction,
  isAuthenticatedUid,
} from './canonicalCashTransaction';
import {
  applyNonDeliveryXpInTransaction,
  precheckNonDeliveryXpForNewOperation,
  readNonDeliveryXpContext,
  resolveNonDeliveryXpReplay,
  type NonDeliveryXpOptions,
} from './canonicalNonDeliveryCompanyXp';

export type CoreVehicleStaffCashResult<T> =
  | { ok: true; alreadyApplied: boolean; receipt: T }
  | { ok: false; reason: string };

export type CanonicalDriverHireResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      receipt: CanonicalDriverReceipt;
      progression: CanonicalNonDeliveryXpOutcome;
    }
  | { ok: false; reason: string };

function leasePath(uid: string, leaseId: string): string {
  return `users/${uid}/${CANONICAL_VEHICLE_LEASES_COLLECTION}/${leaseId}`;
}
function leaseReceiptPath(uid: string, intentId: string): string {
  return `users/${uid}/${CANONICAL_LEASE_RECEIPTS_COLLECTION}/${intentId}`;
}
function assetPath(uid: string, assetId: string): string {
  return `users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}/${assetId}`;
}
function driverPath(uid: string, driverId: string): string {
  return `users/${uid}/${CANONICAL_DRIVERS_COLLECTION}/${driverId}`;
}
function driverReceiptPath(uid: string, intentId: string): string {
  return `users/${uid}/${CANONICAL_DRIVER_RECEIPTS_COLLECTION}/${intentId}`;
}
function rosterMetaPath(uid: string): string {
  return `users/${uid}/${CANONICAL_DRIVER_ROSTER_META_COLLECTION}/${CANONICAL_DRIVER_ROSTER_META_DOC}`;
}
function saleReceiptPath(uid: string, intentId: string): string {
  return `users/${uid}/${CANONICAL_VEHICLE_SALE_RECEIPTS_COLLECTION}/${intentId}`;
}

export async function createCanonicalVehicleLeaseTransaction(
  firestore: Firestore,
  uid: string,
  catalogModelId: string,
  leaseIntentId: string,
  leasePeriodRaw: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<CoreVehicleStaffCashResult<CanonicalLeaseReceipt>> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalCoreVehicleStaffCashAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_CORE_VEHICLE_STAFF_CASH_OFF' };
  }
  if (!isValidCanonicalVehicleStaffIntentId(leaseIntentId)) {
    return { ok: false, reason: 'INVALID_LEASE_INTENT_ID' };
  }
  if (!isValidCanonicalLeasePeriod(leasePeriodRaw)) {
    return { ok: false, reason: 'INVALID_LEASE_PERIOD' };
  }
  if (typeof catalogModelId !== 'string' || catalogModelId.length < 1 || catalogModelId.length > 80) {
    return { ok: false, reason: 'UNKNOWN_CATALOG_MODEL' };
  }
  const priced = deriveCanonicalLeaseStartCost(catalogModelId, leasePeriodRaw);
  if (!priced.ok) return priced;
  const leaseId = createCanonicalLeaseId(leaseIntentId);
  const built = buildCanonicalFleetAssetFromLease({
    uid,
    catalogModelId: priced.catalogId,
    leaseIntentId,
    leaseId,
    nowMs,
  });
  if (!built.ok) return built;
  const assetId = createCanonicalLeaseAssetId(leaseIntentId);
  if (built.asset.assetId !== assetId) {
    return { ok: false, reason: 'CANONICAL_FLEET_ASSET_CONFLICT' };
  }
  const transactionId = createCanonicalLeaseStartTransactionId(assetId, leaseIntentId);

  return firestore.runTransaction(async (transaction) => {
    const aRef = firestore.doc(assetPath(uid, assetId));
    const lRef = firestore.doc(leasePath(uid, leaseId));
    const rRef = firestore.doc(leaseReceiptPath(uid, leaseIntentId));
    const [assetSnap, leaseSnap, receiptSnap] = await Promise.all([
      transaction.get(aRef),
      transaction.get(lRef),
      transaction.get(rRef),
    ]);
    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalLeaseReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.leaseIntentId !== leaseIntentId ||
        existing.assetId !== assetId ||
        existing.prepaidCost !== priced.prepaidCost ||
        existing.transactionId !== transactionId
      ) {
        return { ok: false as const, reason: 'CANONICAL_LEASE_CONFLICT' };
      }
      if (!assetSnap.exists || !leaseSnap.exists) {
        return { ok: false as const, reason: 'CANONICAL_LEASE_CONFLICT' };
      }
      return { ok: true as const, alreadyApplied: true, receipt: existing };
    }
    if (assetSnap.exists || leaseSnap.exists) {
      return { ok: false as const, reason: 'CANONICAL_LEASE_CONFLICT' };
    }
    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId,
          operationType: 'CANONICAL_VEHICLE_LEASE_START',
          sourceId: assetId,
          amountDelta: -priced.prepaidCost,
          nowMs,
          metadata: {
            catalogId: priced.catalogId,
            leasePeriod: leasePeriodRaw,
            policyVersion: CANONICAL_LEASE_POLICY_VERSION,
          },
        },
      ],
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    if (cash.alreadyApplied) return { ok: false as const, reason: 'CANONICAL_LEASE_CONFLICT' };
    const lease: CanonicalVehicleLeaseDocument = {
      leaseId,
      canonicalFleetAssetId: assetId,
      catalogModelId: priced.catalogId,
      leasePolicyVersion: CANONICAL_LEASE_POLICY_VERSION,
      canonicalLeaseSchemaVersion: CANONICAL_LEASE_SCHEMA_VERSION,
      leasePeriod: leasePeriodRaw,
      prepaidCost: priced.prepaidCost,
      recurringCost: priced.recurringDailyCost,
      weeklyLeaseCost: priced.weeklyLeaseCost,
      status: 'ACTIVE',
      ownerUid: uid,
      createdAt: nowMs,
      updatedAt: nowMs,
    };
    const receipt: CanonicalLeaseReceipt = {
      leaseIntentId,
      leaseId,
      assetId,
      catalogId: priced.catalogId,
      leasePeriod: leasePeriodRaw,
      cashBefore: cash.cashBefore,
      prepaidCost: priced.prepaidCost,
      cashAfter: cash.cashAfter,
      transactionId,
      createdAt: nowMs,
      authorityVersion: CANONICAL_VEHICLE_STAFF_AUTHORITY_VERSION,
      policyVersion: CANONICAL_LEASE_POLICY_VERSION,
      ownerUid: uid,
    };
    transaction.create(aRef, built.asset);
    transaction.create(lRef, lease);
    transaction.create(rRef, receipt);
    return { ok: true as const, alreadyApplied: false, receipt };
  });
}

export async function hireCanonicalDriverTransaction(
  firestore: Firestore,
  uid: string,
  poolId: string,
  hireIntentId: string,
  nowMs: number,
  options?: { envValue?: string | null } & NonDeliveryXpOptions,
): Promise<CanonicalDriverHireResult> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalCoreVehicleStaffCashAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_CORE_VEHICLE_STAFF_CASH_OFF' };
  }
  if (!isValidCanonicalVehicleStaffIntentId(hireIntentId)) {
    return { ok: false, reason: 'INVALID_HIRE_INTENT_ID' };
  }
  const frozen = freezeCanonicalDriverOfferFromPool(poolId);
  if (!frozen.ok) return frozen;
  const offer = frozen.offer;
  const driverId = offer.poolId;
  const transactionId = createCanonicalDriverHireTransactionId(driverId, hireIntentId);
  const progressionOperationId = progressionDriverHireOperationId(hireIntentId);

  return firestore.runTransaction(async (transaction) => {
    const dRef = firestore.doc(driverPath(uid, driverId));
    const rRef = firestore.doc(driverReceiptPath(uid, hireIntentId));
    const mRef = firestore.doc(rosterMetaPath(uid));
    const [driverSnap, receiptSnap, metaSnap] = await Promise.all([
      transaction.get(dRef),
      transaction.get(rRef),
      transaction.get(mRef),
    ]);
    const xpContext = await readNonDeliveryXpContext(
      transaction,
      firestore,
      uid,
      progressionOperationId,
      options,
    );
    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalDriverReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.driverId !== driverId ||
        existing.operation !== 'HIRE' ||
        existing.amount !== offer.hiringFee ||
        existing.transactionId !== transactionId
      ) {
        return { ok: false as const, reason: 'CANONICAL_DRIVER_CONFLICT' };
      }
      if (!driverSnap.exists) {
        return { ok: false as const, reason: 'CANONICAL_DRIVER_CONFLICT' };
      }
      const replay = resolveNonDeliveryXpReplay(xpContext, progressionOperationId, 'COMPANY_DRIVER_HIRE');
      if (!replay.ok) return replay;
      return { ok: true as const, alreadyApplied: true, receipt: existing, progression: replay.outcome };
    }
    if (driverSnap.exists) {
      return { ok: false as const, reason: 'DRIVER_ALREADY_HIRED' };
    }
    const precheck = precheckNonDeliveryXpForNewOperation(xpContext, progressionOperationId);
    if (!precheck.ok) return precheck;
    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId,
          operationType: 'CANONICAL_DRIVER_HIRE',
          sourceId: driverId,
          amountDelta: -offer.hiringFee,
          nowMs,
          metadata: { poolId: offer.poolId, policyVersion: CANONICAL_DRIVER_OFFER_POLICY_VERSION },
        },
      ],
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    if (cash.alreadyApplied) return { ok: false as const, reason: 'CANONICAL_DRIVER_CONFLICT' };
    const driver: CanonicalDriverDocument = {
      driverId,
      poolId: offer.poolId,
      ownerUid: uid,
      name: offer.name,
      skill: offer.skill,
      attentionBaseline: offer.attention,
      salaryPerDay: offer.salaryPerDay,
      hiringFee: offer.hiringFee,
      status: 'hired',
      assignedCanonicalDeliveryId: null,
      schema: 1,
      authoritySource: 'DRIVER_POOL_CATALOG',
      policyVersion: CANONICAL_DRIVER_OFFER_POLICY_VERSION,
      revision: 1,
      createdAt: nowMs,
      updatedAt: nowMs,
    };
    const receipt: CanonicalDriverReceipt = {
      intentId: hireIntentId,
      driverId,
      operation: 'HIRE',
      cashBefore: cash.cashBefore,
      amount: offer.hiringFee,
      cashAfter: cash.cashAfter,
      transactionId,
      createdAt: nowMs,
      authorityVersion: CANONICAL_VEHICLE_STAFF_AUTHORITY_VERSION,
      policyVersion: CANONICAL_DRIVER_OFFER_POLICY_VERSION,
      ownerUid: uid,
    };
    const prevCount = Number(metaSnap.data()?.activeCount) || 0;
    const meta = {
      activeCount: prevCount + 1,
      revision: (Number(metaSnap.data()?.revision) || 0) + 1,
      ownerUid: uid,
      updatedAt: nowMs,
    };
    transaction.create(dRef, driver);
    transaction.create(rRef, receipt);
    if (metaSnap.exists) transaction.update(mRef, meta);
    else transaction.create(mRef, meta);
    const progression = applyNonDeliveryXpInTransaction(
      transaction,
      firestore,
      uid,
      xpContext,
      buildCanonicalDriverHireProgressionInput(receipt, nowMs),
    );
    return { ok: true as const, alreadyApplied: false, receipt, progression };
  });
}

export async function fireCanonicalDriverTransaction(
  firestore: Firestore,
  uid: string,
  driverId: string,
  fireIntentId: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<CoreVehicleStaffCashResult<CanonicalDriverReceipt>> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalCoreVehicleStaffCashAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_CORE_VEHICLE_STAFF_CASH_OFF' };
  }
  if (!isValidCanonicalVehicleStaffIntentId(fireIntentId)) {
    return { ok: false, reason: 'INVALID_FIRE_INTENT_ID' };
  }
  if (typeof driverId !== 'string' || driverId.length < 1 || driverId.length > 80) {
    return { ok: false, reason: 'UNKNOWN_DRIVER' };
  }
  const transactionId = createCanonicalDriverFireTransactionId(driverId, fireIntentId);

  return firestore.runTransaction(async (transaction) => {
    const dRef = firestore.doc(driverPath(uid, driverId));
    const rRef = firestore.doc(driverReceiptPath(uid, fireIntentId));
    const mRef = firestore.doc(rosterMetaPath(uid));
    const [driverSnap, receiptSnap, metaSnap] = await Promise.all([
      transaction.get(dRef),
      transaction.get(rRef),
      transaction.get(mRef),
    ]);
    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalDriverReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.driverId !== driverId ||
        existing.operation !== 'FIRE' ||
        existing.transactionId !== transactionId
      ) {
        return { ok: false as const, reason: 'CANONICAL_DRIVER_CONFLICT' };
      }
      return { ok: true as const, alreadyApplied: true, receipt: existing };
    }
    if (!driverSnap.exists) {
      return { ok: false as const, reason: 'LEGACY_DRIVER_UNVERIFIED' };
    }
    const driver = driverSnap.data() as CanonicalDriverDocument;
    if (driver.ownerUid !== uid) return { ok: false as const, reason: 'UNAUTHENTICATED' };
    if (driver.status !== 'hired') return { ok: false as const, reason: 'DRIVER_NOT_HIRED' };
    if (driver.assignedCanonicalDeliveryId) {
      return { ok: false as const, reason: 'DRIVER_ASSIGNED_TO_CANONICAL_DELIVERY' };
    }
    const activeCount = Number(metaSnap.data()?.activeCount) || 0;
    if (activeCount <= 1) {
      return { ok: false as const, reason: 'LAST_DRIVER' };
    }
    const severance = deriveCanonicalDriverSeveranceCost(driver.salaryPerDay);
    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId,
          operationType: 'CANONICAL_DRIVER_FIRE',
          sourceId: driverId,
          amountDelta: -severance,
          nowMs,
          metadata: { salaryPerDay: driver.salaryPerDay },
        },
      ],
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    if (cash.alreadyApplied) return { ok: false as const, reason: 'CANONICAL_DRIVER_CONFLICT' };
    const receipt: CanonicalDriverReceipt = {
      intentId: fireIntentId,
      driverId,
      operation: 'FIRE',
      cashBefore: cash.cashBefore,
      amount: severance,
      cashAfter: cash.cashAfter,
      transactionId,
      createdAt: nowMs,
      authorityVersion: CANONICAL_VEHICLE_STAFF_AUTHORITY_VERSION,
      policyVersion: CANONICAL_DRIVER_OFFER_POLICY_VERSION,
      ownerUid: uid,
    };
    transaction.update(dRef, {
      status: 'fired',
      revision: driver.revision + 1,
      updatedAt: nowMs,
      firedAtMs: nowMs,
      assignedCanonicalDeliveryId: null,
    });
    transaction.create(rRef, receipt);
    transaction.update(mRef, {
      activeCount: activeCount - 1,
      revision: (Number(metaSnap.data()?.revision) || 0) + 1,
      updatedAt: nowMs,
    });
    return { ok: true as const, alreadyApplied: false, receipt };
  });
}

export async function sellCanonicalFleetAssetTransaction(
  firestore: Firestore,
  uid: string,
  assetId: string,
  saleIntentId: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<CoreVehicleStaffCashResult<CanonicalVehicleSaleReceipt>> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalCoreVehicleStaffCashAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_CORE_VEHICLE_STAFF_CASH_OFF' };
  }
  if (!isValidCanonicalVehicleStaffIntentId(saleIntentId)) {
    return { ok: false, reason: 'INVALID_SALE_INTENT_ID' };
  }
  if (typeof assetId !== 'string' || !assetId.startsWith('cfa_')) {
    return { ok: false, reason: 'LEGACY_FLEET_UNVERIFIED' };
  }
  const transactionId = createCanonicalVehicleSaleTransactionId(assetId, saleIntentId);

  return firestore.runTransaction(async (transaction) => {
    const aRef = firestore.doc(assetPath(uid, assetId));
    const rRef = firestore.doc(saleReceiptPath(uid, saleIntentId));
    const [assetSnap, receiptSnap] = await Promise.all([
      transaction.get(aRef),
      transaction.get(rRef),
    ]);
    if (receiptSnap.exists) {
      const existing = receiptSnap.data() as CanonicalVehicleSaleReceipt;
      if (
        existing.ownerUid !== uid ||
        existing.assetId !== assetId ||
        existing.saleIntentId !== saleIntentId ||
        existing.transactionId !== transactionId
      ) {
        return { ok: false as const, reason: 'CANONICAL_SALE_CONFLICT' };
      }
      return { ok: true as const, alreadyApplied: true, receipt: existing };
    }
    const parsed = parseCanonicalFleetAsset(
      assetSnap.exists ? (assetSnap.data() as Record<string, unknown>) : undefined,
      'TRUCK',
    );
    if (!parsed.ok) {
      return { ok: false as const, reason: parsed.reason === 'CANONICAL_TRUCK_NOT_FOUND' ? 'LEGACY_FLEET_UNVERIFIED' : parsed.reason };
    }
    const asset = parsed.asset;
    if (asset.ownerUid !== uid) return { ok: false as const, reason: 'UNAUTHENTICATED' };
    const valued = deriveCanonicalVehicleSaleValue(asset);
    if (!valued.ok) return valued;
    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      [
        {
          uid,
          transactionId,
          operationType: 'CANONICAL_VEHICLE_SALE',
          sourceId: assetId,
          amountDelta: valued.saleValue,
          nowMs,
          metadata: {
            catalogId: valued.catalogId,
            mileageKm: valued.mileageKm,
            condition: asset.economicCondition,
          },
        },
      ],
      nowMs,
    );
    if (!cash.ok) return { ok: false as const, reason: cash.reason };
    if (cash.alreadyApplied) return { ok: false as const, reason: 'CANONICAL_SALE_CONFLICT' };
    const receipt: CanonicalVehicleSaleReceipt = {
      saleIntentId,
      assetId,
      catalogId: valued.catalogId,
      cashBefore: cash.cashBefore,
      saleValue: valued.saleValue,
      cashAfter: cash.cashAfter,
      mileageKm: valued.mileageKm,
      condition: asset.economicCondition,
      transactionId,
      createdAt: nowMs,
      authorityVersion: CANONICAL_VEHICLE_STAFF_AUTHORITY_VERSION,
      ownerUid: uid,
    };
    transaction.update(aRef, {
      lifecycleStatus: 'SOLD',
      economicRevision: asset.economicRevision + 1,
      updatedAtMs: nowMs,
      activeCanonicalRoadDeliveryId: null,
      reservedAtMs: null,
      reservationRevision: null,
    });
    transaction.create(rRef, receipt);
    return { ok: true as const, alreadyApplied: false, receipt };
  });
}

export async function recoverCanonicalVehicleTransaction(
  firestore: Firestore,
  uid: string,
  _assetId: string,
  _recoveryIntentId: string,
  options?: { envValue?: string | null },
): Promise<{ ok: false; reason: string }> {
  void firestore;
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalCoreVehicleStaffCashAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_CORE_VEHICLE_STAFF_CASH_OFF' };
  }
  return { ok: false, reason: VEHICLE_RECOVERY_FAMILY_STATUS };
}
