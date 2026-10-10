/**
 * Canonical ROAD INTERNAL_TEST server-cash shadow settlement (Step 29K).
 * Mutates serverState.cash + canonicalCashTransactions. Does not write save or HUD.
 */

import type { Firestore } from 'firebase-admin/firestore';

import { CANONICAL_CASH_CURRENCY } from '../../src/domain/canonicalCashOperation';
import { CANONICAL_ROAD_DELIVERIES_COLLECTION, isValidCanonicalRoadDocId } from '../../src/domain/canonicalRoadDelivery';
import { prepareCanonicalRoadDeliverySettlement } from '../../src/domain/canonicalRoadEconomics';
import { CANONICAL_ROAD_TIMING_POLICY_VERSION } from '../../src/domain/canonicalRoadTiming';
import {
  CANONICAL_ROAD_SETTLEMENTS_COLLECTION,
  CANONICAL_ROAD_SETTLEMENT_SCHEMA_VERSION,
  CANONICAL_ROAD_SHADOW_AUTHORITY_MODE,
  classifyCanonicalRoadSettlementSupport,
  createCanonicalRoadSettlementOperationId,
  isCanonicalRoadServerCashShadowAllowed,
  type CanonicalRoadSettlementReceipt,
} from '../../src/domain/canonicalRoadServerCashShadow';
import {
  applyCanonicalCashMutationsInTransaction,
  isAuthenticatedUid,
  type CanonicalCashMutationInput,
} from './canonicalCashTransaction';
import type { CanonicalRoadDeliveryDocument } from './canonicalRoadDelivery';

export { hasOnlyCanonicalRoadSettleKeys } from '../../src/domain/canonicalRoadServerCashShadow';

function deliveryPath(uid: string, deliveryId: string): string {
  return `users/${uid}/${CANONICAL_ROAD_DELIVERIES_COLLECTION}/${deliveryId}`;
}

function settlementPath(uid: string, deliveryId: string): string {
  return `users/${uid}/${CANONICAL_ROAD_SETTLEMENTS_COLLECTION}/${deliveryId}`;
}

export type SettleCanonicalRoadResult =
  | {
      ok: true;
      alreadySettled: boolean;
      receipt: CanonicalRoadSettlementReceipt;
    }
  | { ok: false; reason: string; deliveryId?: string };

export async function settleCanonicalRoadDeliveryInternalTransaction(
  firestore: Firestore,
  uid: string,
  deliveryId: string,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<SettleCanonicalRoadResult> {
  if (!isAuthenticatedUid(uid)) {
    return { ok: false, reason: 'UNAUTHENTICATED', deliveryId };
  }
  if (!isCanonicalRoadServerCashShadowAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_ROAD_SERVER_CASH_SHADOW_OFF', deliveryId };
  }
  if (!isValidCanonicalRoadDocId(deliveryId)) {
    return { ok: false, reason: 'UNSUPPORTED_LEGACY_DELIVERY', deliveryId };
  }

  return firestore.runTransaction(async (transaction) => {
    const dRef = firestore.doc(deliveryPath(uid, deliveryId));
    const sRef = firestore.doc(settlementPath(uid, deliveryId));
    const [deliverySnap, settlementSnap] = await Promise.all([
      transaction.get(dRef),
      transaction.get(sRef),
    ]);

    if (settlementSnap.exists) {
      const existing = settlementSnap.data() as CanonicalRoadSettlementReceipt;
      if (existing.ownerUid !== uid || existing.deliveryId !== deliveryId) {
        return { ok: false as const, reason: 'UNAUTHENTICATED', deliveryId };
      }
      return {
        ok: true as const,
        alreadySettled: true,
        receipt: existing,
      };
    }

    if (!deliverySnap.exists) {
      return { ok: false as const, reason: 'UNSUPPORTED_LEGACY_DELIVERY', deliveryId };
    }
    const delivery = deliverySnap.data() as CanonicalRoadDeliveryDocument;
    if (delivery.ownerUid !== uid) {
      return { ok: false as const, reason: 'UNAUTHENTICATED', deliveryId };
    }

    const support = classifyCanonicalRoadSettlementSupport({
      deliveryId: delivery.deliveryId,
      ownerUid: delivery.ownerUid,
      sourceCanonicalContractId: delivery.sourceCanonicalContractId,
      canonicalSchemaVersion: delivery.canonicalSchemaVersion,
      lifecycleState: delivery.lifecycleState,
      settlementState: delivery.settlementState,
      completionOutcome: delivery.completionOutcome,
      failureAuthorityClass: delivery.failureAuthorityClass,
      executionEconomicsSnapshot: delivery.executionEconomicsSnapshot,
      timingSnapshot: delivery.timingSnapshot,
      derivedSettlement: delivery.derivedSettlement,
    });
    if (support !== 'SETTLEMENT_SUPPORTED_INTERNAL_STANDARD') {
      return { ok: false as const, reason: support, deliveryId };
    }

    const prepared =
      delivery.derivedSettlement ??
      prepareCanonicalRoadDeliverySettlement({
        snapshot: delivery,
        deliveryId,
        outcome: 'COMPLETED',
        actualTravelHours: delivery.timingSnapshot?.derivedActualTravelHours ?? 0,
        executionEconomics: delivery.executionEconomicsSnapshot,
      });

    if (
      delivery.derivedSettlement &&
      (prepared.grossRevenue !== delivery.derivedSettlement.grossRevenue ||
        prepared.netCashDelta !== delivery.derivedSettlement.netCashDelta)
    ) {
      return { ok: false as const, reason: 'UNSUPPORTED_SCHEMA', deliveryId };
    }

    const mutations: CanonicalCashMutationInput[] = prepared.ledger
      .filter((row) => row.amountDelta !== 0)
      .map((row) => ({
        uid,
        transactionId: row.transactionId,
        operationType: 'ROAD_DELIVERY_SETTLEMENT' as const,
        sourceId: createCanonicalRoadSettlementOperationId(deliveryId),
        amountDelta: row.amountDelta,
        nowMs,
        metadata: {
          deliveryId,
          component: row.transactionId.endsWith(':revenue') ? 'revenue' : 'completion-expenses',
        },
      }));

    if (mutations.length === 0) {
      return { ok: false as const, reason: 'UNSUPPORTED_SCHEMA', deliveryId };
    }

    const cash = await applyCanonicalCashMutationsInTransaction(
      transaction,
      firestore,
      uid,
      mutations,
      nowMs,
    );
    if (!cash.ok) {
      return { ok: false as const, reason: cash.reason, deliveryId };
    }

    const receipt: CanonicalRoadSettlementReceipt = {
      settlementSchemaVersion: CANONICAL_ROAD_SETTLEMENT_SCHEMA_VERSION,
      settlementOperationId: createCanonicalRoadSettlementOperationId(deliveryId),
      deliveryId,
      sourceContractId: delivery.sourceCanonicalContractId,
      ownerUid: uid,
      grossRevenue: prepared.grossRevenue,
      maintenanceCost: prepared.maintenanceCost,
      maintenanceExpense: prepared.maintenanceExpense,
      tollExpense: prepared.tollExpense,
      latePenalty: prepared.latePenalty,
      failurePenalty: prepared.failurePenalty,
      fragileSurcharge: prepared.fragileSurcharge,
      penaltyCost: prepared.penaltyCost,
      netCashDelta: prepared.netCashDelta,
      cashBefore: cash.cashBefore,
      cashAfter: cash.cashAfter,
      currency: CANONICAL_CASH_CURRENCY,
      transactionIds: cash.receipts.map((row) => row.transactionId),
      completionBand: prepared.completionBand,
      authorityMode: CANONICAL_ROAD_SHADOW_AUTHORITY_MODE,
      paymentPolicyVersion: delivery.paymentPolicyVersion,
      settlementPolicyVersion: delivery.settlementPolicyVersion,
      timingPolicyVersion: delivery.timingSnapshot?.timingPolicyVersion ?? CANONICAL_ROAD_TIMING_POLICY_VERSION,
      executionEconomicsSchemaVersion:
        delivery.executionEconomicsSnapshot?.executionEconomicsSchemaVersion ?? 1,
      settledAtMs: nowMs,
    };

    transaction.create(sRef, receipt);
    transaction.update(dRef, {
      settlementState: 'SETTLED',
      lifecycleState: 'SETTLED',
    });

    return {
      ok: true as const,
      alreadySettled: false,
      receipt,
    };
  });
}
