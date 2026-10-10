/**
 * INTERNAL production-parity ROAD offer batches (Step 29AA).
 * Does not move cash or market stock. Does not replace Step 29G simplified issuance.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { ProductId } from '../../src/types/game';
import { CITIES_BY_ID } from '../../src/data/cities';
import { getMarketEpoch } from '../../src/simulation/economyClock';
import { CANONICAL_WORLD_MARKETS_COLLECTION } from '../../src/domain/canonicalCargoMarketWorldState';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';
import { contractBalance } from '../../src/config/balance';
import {
  canonicalCompanyProgressionPath,
  isCanonicalCompanyProgressionAllowed,
  resolveCanonicalProgressionForIssuance,
} from '../../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4,
  canonicalProductionRoadBatchId,
  canonicalProductionRoadIssuanceWindowIndex,
  generateCanonicalProductionRoadOffers,
  isCanonicalProductionRoadIssuanceAllowed,
  type CanonicalTradableMarketRow,
} from '../../src/domain/canonicalProductionRoadContractIssuance';
import {
  CANONICAL_MANUAL_REFRESH_MAX_CONTRACTS,
  CANONICAL_ROAD_CONTRACT_REFRESH_COLLECTION,
  CANONICAL_ROAD_CONTRACT_REFRESH_DOC_ID,
  CANONICAL_ROAD_CONTRACT_REFRESH_POLICY_VERSION,
  CANONICAL_ROAD_CONTRACT_REFRESH_RECEIPT_COLLECTION,
  CANONICAL_ROAD_CONTRACT_REFRESH_SCHEMA_VERSION,
  canonicalRefreshBatchId,
  canonicalRefreshRemainingGameHours,
  isCanonicalRefreshEligible,
  isCanonicalRoadContractRefreshAllowed,
  validateCanonicalRoadContractRefreshState,
  type CanonicalRoadContractRefreshState,
} from '../../src/domain/canonicalContractRefresh';
import {
  CANONICAL_CONTRACT_CLOCK_COLLECTION,
  CANONICAL_CONTRACT_CLOCK_DOC_ID,
  advanceCanonicalContractClock,
  createInitialCanonicalContractClock,
  isCanonicalContractExpiryAllowed,
  validateCanonicalContractClockState,
  type CanonicalContractClockState,
} from '../../src/domain/canonicalContractGameTimeExpiry';
import {
  CANONICAL_ROAD_CONTRACT_EVENTS_DOC,
  activeContractEventSnapshot,
  isCanonicalContractWorldEventAllowed,
  parseCanonicalContractEventSnapshot,
  planCanonicalContractEventAdvance,
  type CanonicalContractEventSnapshot,
  type CanonicalContractEventState,
} from '../../src/domain/canonicalContractWorldEvents';
import {
  CANONICAL_FLEET_RUNTIME_COLLECTION,
  deriveCanonicalFleetAvailabilitySummary,
  isCanonicalFleetRuntimeAllowed,
  validateCanonicalFleetRuntimeState,
  type CanonicalFleetAvailabilitySummary,
  type CanonicalFleetRuntimeAssetInput,
} from '../../src/domain/canonicalFleetRuntimeLocation';

export type CanonicalProductionRoadIssuanceResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      batchId: string;
      offerCount: number;
      policyVersion: string;
      refreshSequence?: number;
    }
  | { ok: false; reason: string; remainingGameHours?: number };

function progressionPath(uid: string): string {
  return canonicalCompanyProgressionPath(uid);
}

export async function generateCanonicalProductionRoadBatchTransaction(
  firestore: Firestore,
  uid: string,
  serverNowMs: number,
  options?: {
    envValue?: string | null;
    eventEnvValue?: string | null;
    runtimeEnvValue?: string | null;
    expiryEnvValue?: string | null;
    refreshEnvValue?: string | null;
    refreshIntentId?: string | null;
    progressionEnvValue?: string | null;
    failAfterOffers?: number;
  },
): Promise<CanonicalProductionRoadIssuanceResult> {
  if (!isCanonicalProductionRoadIssuanceAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_ROAD_CONTRACT_ISSUANCE_AUTHORITY_OFF' };
  }
  if (typeof uid !== 'string' || uid.length < 3) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }

  return firestore.runTransaction(async (transaction) => {
    const progressionSnap = await transaction.get(firestore.doc(progressionPath(uid)));
    if (!progressionSnap.exists) {
      return { ok: false as const, reason: 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION' };
    }
    const progression = resolveCanonicalProgressionForIssuance(
      progressionSnap.data() as Record<string, unknown> | undefined,
      uid,
      {
        progressionGateAllowed: isCanonicalCompanyProgressionAllowed({
          envValue: options?.progressionEnvValue,
        }),
      },
    );
    if (!progression.ok) {
      return { ok: false as const, reason: progression.reason };
    }
    const playerLevel = progression.level;
    const playerReputation = progression.reputation;

    const fleetSnap = await transaction.get(
      firestore.collection(`users/${uid}/${CANONICAL_FLEET_ASSETS_COLLECTION}`),
    );
    const fleetAssets: CanonicalFleetRuntimeAssetInput[] = [];
    let ownedMaxTruckCapacity = 0;
    for (const docSnap of fleetSnap.docs) {
      const data = docSnap.data();
      if (data.assetType !== 'TRUCK') continue;
      if (data.lifecycleStatus === 'SOLD') continue;
      const capacity = Number(data.capacity);
      if (Number.isFinite(capacity) && capacity > ownedMaxTruckCapacity) {
        ownedMaxTruckCapacity = capacity;
      }
      fleetAssets.push({
        assetId: docSnap.id,
        capacity: Number.isFinite(capacity) ? capacity : 0,
        lifecycleStatus: typeof data.lifecycleStatus === 'string' ? data.lifecycleStatus : 'ACTIVE',
        assetType: 'TRUCK',
        runtime: null,
      });
    }
    if (ownedMaxTruckCapacity <= 0) {
      return { ok: false as const, reason: 'ROAD_CONTRACT_ISSUANCE_BLOCKED_FLEET_STATE' };
    }

    const marketSnap = await transaction.get(firestore.collection(CANONICAL_WORLD_MARKETS_COLLECTION));
    const marketRows: CanonicalTradableMarketRow[] = [];
    for (const docSnap of marketSnap.docs) {
      const data = docSnap.data();
      const cityId = String(data.cityId ?? '');
      const productId = String(data.productId ?? '') as ProductId;
      if (!cityId || !productId) continue;
      const catalogTarget = CITIES_BY_ID[cityId]?.products[productId]?.targetStock;
      const epochSupply = Number(data.epochSupply);
      if (!Number.isFinite(epochSupply)) continue;
      marketRows.push({
        cityId,
        productId,
        tradableStock: Number(data.stock),
        epochSupply,
        currentPrice: Number(data.currentPrice),
        targetStock: Number(catalogTarget ?? data.targetStock),
        marketRevision: Number(data.marketRevision ?? 0),
        lastAppliedTickIndex:
          typeof data.lastAppliedTickIndex === 'number' ? data.lastAppliedTickIndex : undefined,
      });
    }
    if (marketRows.length === 0) {
      return { ok: false as const, reason: 'CANONICAL_MARKET_REQUIRED' };
    }

    const tickIndexes = new Set(
      marketRows
        .map((row) => row.lastAppliedTickIndex)
        .filter((value): value is number => typeof value === 'number'),
    );
    const marketEpoch =
      tickIndexes.size === 1 ? [...tickIndexes][0]! : getMarketEpoch(serverNowMs);
    const refreshGate = isCanonicalRoadContractRefreshAllowed({
      envValue: options?.refreshEnvValue,
    });
    const expiryGate = isCanonicalContractExpiryAllowed({ envValue: options?.expiryEnvValue });
    if (options?.refreshIntentId && !refreshGate) {
      return { ok: false as const, reason: 'CANONICAL_ROAD_CONTRACT_REFRESH_AUTHORITY_OFF' };
    }
    if (refreshGate && !expiryGate) {
      return { ok: false as const, reason: 'CONTRACT_REFRESH_BLOCKED_GAME_CLOCK' };
    }
    const refreshRef = firestore.doc(
      `users/${uid}/${CANONICAL_ROAD_CONTRACT_REFRESH_COLLECTION}/${CANONICAL_ROAD_CONTRACT_REFRESH_DOC_ID}`,
    );
    const receiptRef = options?.refreshIntentId
      ? firestore.doc(
          `users/${uid}/${CANONICAL_ROAD_CONTRACT_REFRESH_RECEIPT_COLLECTION}/${options.refreshIntentId}`,
        )
      : null;
    const refreshSnap = refreshGate ? await transaction.get(refreshRef) : null;
    const receiptSnap = receiptRef ? await transaction.get(receiptRef) : null;
    const contractsSnap = options?.refreshIntentId
      ? await transaction.get(firestore.collection(`users/${uid}/canonicalRoadContracts`))
      : null;
    const parsedRefresh = refreshSnap?.exists
      ? validateCanonicalRoadContractRefreshState(refreshSnap.data())
      : null;
    if (parsedRefresh && !parsedRefresh.ok) {
      return { ok: false as const, reason: parsedRefresh.reason };
    }
    const refreshState = parsedRefresh && parsedRefresh.ok ? parsedRefresh.state : null;
    const receiptData = receiptSnap?.exists ? receiptSnap.data() ?? {} : null;
    if (receiptData && receiptData.status === 'COMPLETE') {
      return {
        ok: true as const,
        alreadyApplied: true,
        batchId: String(receiptData.newBatchId),
        offerCount: Number(receiptData.offerCount ?? 0),
        policyVersion: String(receiptData.generatorPolicyVersion ?? ''),
        refreshSequence: Number(receiptData.refreshSequence),
      };
    }
    const batchId = refreshGate
      ? canonicalRefreshBatchId(
          uid,
          receiptData
            ? Number(receiptData.refreshSequence)
            : options?.refreshIntentId
              ? (refreshState?.refreshSequence ?? 0) + 1
              : (refreshState?.refreshSequence ?? 0),
        )
      : canonicalProductionRoadBatchId(
          uid,
          canonicalProductionRoadIssuanceWindowIndex(serverNowMs),
        );
    const batchRef = firestore.doc(`users/${uid}/canonicalRoadContractBatches/${batchId}`);
    const existingBatch = await transaction.get(batchRef);
    if (
      refreshGate &&
      !options?.refreshIntentId &&
      existingBatch.exists &&
      existingBatch.data()?.status === 'COMPLETE'
    ) {
      return {
        ok: true as const,
        alreadyApplied: true,
        batchId,
        offerCount: Number(existingBatch.data()?.offerCount ?? 0),
        policyVersion: String(existingBatch.data()?.policyVersion ?? ''),
        refreshSequence: refreshState?.refreshSequence ?? 0,
      };
    }
    if (!refreshGate && existingBatch.exists && existingBatch.data()?.status === 'COMPLETE') {
      return {
        ok: true as const,
        alreadyApplied: true,
        batchId,
        offerCount: Number(existingBatch.data()?.offerCount ?? 0),
        policyVersion: String(
          existingBatch.data()?.policyVersion ?? CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
        ),
      };
    }

    const eventGate = isCanonicalContractWorldEventAllowed({ envValue: options?.eventEnvValue });
    const eventRef = firestore.doc(CANONICAL_ROAD_CONTRACT_EVENTS_DOC);
    let contractEventSnapshot: CanonicalContractEventSnapshot | null = null;
    let eventStateToWrite: CanonicalContractEventState | null = null;
    const storedSnapshot = existingBatch.exists
      ? existingBatch.data()?.contractEventSnapshot
      : undefined;
    if (storedSnapshot) {
      const parsed = parseCanonicalContractEventSnapshot(storedSnapshot);
      if (!parsed.ok) return { ok: false as const, reason: parsed.reason };
      contractEventSnapshot = parsed.snapshot;
    } else if (eventGate) {
      const eventSnap = await transaction.get(eventRef);
      const planned = planCanonicalContractEventAdvance(
        eventSnap.exists ? eventSnap.data() : null,
        serverNowMs,
      );
      if (!planned.ok) return { ok: false as const, reason: planned.reason };
      contractEventSnapshot = activeContractEventSnapshot(planned.state);
      if (!eventSnap.exists || planned.advanced) {
        eventStateToWrite = planned.state;
      }
    }

    let fleetRuntimeSummary: CanonicalFleetAvailabilitySummary | null = null;
    const storedFleet = existingBatch.exists ? existingBatch.data()?.fleetRuntimeSummary : undefined;
    if (storedFleet && typeof storedFleet === 'object') {
      fleetRuntimeSummary = storedFleet as CanonicalFleetAvailabilitySummary;
    } else if (isCanonicalFleetRuntimeAllowed({ envValue: options?.runtimeEnvValue })) {
      const runtimeSnap = await transaction.get(
        firestore.collection(`users/${uid}/${CANONICAL_FLEET_RUNTIME_COLLECTION}`),
      );
      const runtimeById = new Map<string, ReturnType<typeof validateCanonicalFleetRuntimeState>>();
      for (const docSnap of runtimeSnap.docs) {
        runtimeById.set(docSnap.id, validateCanonicalFleetRuntimeState(docSnap.data()));
      }
      const joined: CanonicalFleetRuntimeAssetInput[] = fleetAssets.map((asset) => {
        const parsed = runtimeById.get(asset.assetId);
        return {
          ...asset,
          runtime: parsed && parsed.ok ? parsed.state : null,
        };
      });
      const summary = deriveCanonicalFleetAvailabilitySummary(joined);
      if (!summary.ok) return { ok: false as const, reason: summary.reason };
      fleetRuntimeSummary = summary.summary;
    }

    let contractGameTime: {
      issuedAtCanonicalGameHours: number;
      clockRevisionAtIssue: number;
      clockAuthorityClass: 'INTERNAL_TEST_CONTRACT_CLOCK';
    } | null = null;
    let clockNext: CanonicalContractClockState | null = null;
    const clockRef = firestore.doc(
      `users/${uid}/${CANONICAL_CONTRACT_CLOCK_COLLECTION}/${CANONICAL_CONTRACT_CLOCK_DOC_ID}`,
    );
    const storedIssueHours = existingBatch.exists
      ? Number(existingBatch.data()?.issuedAtCanonicalGameHours)
      : NaN;
    if (expiryGate && Number.isFinite(storedIssueHours)) {
      contractGameTime = {
        issuedAtCanonicalGameHours: storedIssueHours,
        clockRevisionAtIssue: Number(existingBatch.data()?.clockRevisionAtIssue ?? 0),
        clockAuthorityClass: 'INTERNAL_TEST_CONTRACT_CLOCK',
      };
    } else if (expiryGate) {
      const clockSnap = await transaction.get(clockRef);
      const parsedClock = clockSnap.exists
        ? validateCanonicalContractClockState(clockSnap.data())
        : { ok: true as const, state: createInitialCanonicalContractClock(serverNowMs) };
      if (!parsedClock.ok) return { ok: false as const, reason: parsedClock.reason };
      const advanced = advanceCanonicalContractClock(parsedClock.state, serverNowMs);
      if (!advanced.ok) return { ok: false as const, reason: advanced.reason };
      clockNext = advanced.state;
      contractGameTime = {
        issuedAtCanonicalGameHours: advanced.state.currentGameHours,
        clockRevisionAtIssue: advanced.state.clockRevision,
        clockAuthorityClass: advanced.state.authorityClass,
      };
    }

    let refreshSequence: number | null = null;
    let refreshMaxNewContracts: number | null = null;
    if (refreshGate) {
      if (!contractGameTime) {
        return { ok: false as const, reason: 'CONTRACT_REFRESH_BLOCKED_GAME_CLOCK' };
      }
      if (options?.refreshIntentId && !receiptData) {
        if (!refreshState) {
          return { ok: false as const, reason: 'CONTRACT_REFRESH_INITIAL_BATCH_REQUIRED' };
        }
        if (
          !isCanonicalRefreshEligible({
            currentGameHours: contractGameTime.issuedAtCanonicalGameHours,
            lastRefreshGameHours: refreshState.lastRefreshGameHours,
          })
        ) {
          return {
            ok: false as const,
            reason: 'CONTRACT_REFRESH_COOLDOWN_ACTIVE',
            remainingGameHours: canonicalRefreshRemainingGameHours({
              currentGameHours: contractGameTime.issuedAtCanonicalGameHours,
              lastRefreshGameHours: refreshState.lastRefreshGameHours,
            }),
          };
        }
        refreshSequence = refreshState.refreshSequence + 1;
        refreshMaxNewContracts = CANONICAL_MANUAL_REFRESH_MAX_CONTRACTS;
      } else if (receiptData) {
        refreshSequence = Number(receiptData.refreshSequence);
        refreshMaxNewContracts = Number(
          receiptData.maxNewContracts ?? CANONICAL_MANUAL_REFRESH_MAX_CONTRACTS,
        );
      } else {
        refreshSequence = refreshState?.refreshSequence ?? 0;
        refreshMaxNewContracts = contractBalance.maxContractsPerTick;
      }
    }

    const fuelQuote = deriveCanonicalProductionMarketQuote(marketEpoch, 'izmir', 'steel');
    const generated = generateCanonicalProductionRoadOffers({
      uid,
      serverNowMs,
      playerLevel,
      playerReputation,
      ownedMaxTruckCapacity,
      marketRows,
      fuelPricePerLiter: fuelQuote?.fuelPricePerLiter ?? 1.72,
      contractEventSnapshot,
      fleetRuntimeSummary,
      contractGameTime,
      refreshSequence,
      refreshMaxNewContracts,
    });
    if (!generated.ok) return generated;

    const offerRefs = generated.offers.map((offer) => ({
      offer,
      ref: firestore.doc(`users/${uid}/canonicalRoadContracts/${offer.contractId}`),
    }));
    const existingOffers = await Promise.all(offerRefs.map((row) => transaction.get(row.ref)));
    const batchBody = {
      batchId: generated.batchId,
      policyVersion:
        generated.offers[0]?.policyVersion ??
        (generated.contractGameTime
          ? CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4
          : generated.fleetRuntimeSummary
          ? 'canonical-road-contract-issuance-internal-production-parity-v3'
          : generated.contractEventSnapshot
            ? CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2
            : CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION),
      issuanceWindow: generated.windowIndex,
      marketEpoch: generated.marketEpoch,
      seed: generated.seed,
      offerIds: generated.offers.map((offer) => offer.contractId),
      offerCount: generated.offers.length,
      issuedAtMs: serverNowMs,
      expiresAtMs: generated.expiresAtServerMs,
      authorityMode: 'INTERNAL_PRODUCTION_PARITY',
      fleetSnapshotClass: generated.fleetRuntimeSummary
        ? 'CANONICAL_RUNTIME_IDLE_ORIGIN'
        : 'CAPACITY_ONLY_LOCATION_UNVERIFIED',
      fleetRuntimeSummary: generated.fleetRuntimeSummary,
      contractEventMultiplier: generated.contractEventSnapshot ? null : 1,
      contractEventPolicyVersion: generated.contractEventSnapshot?.policyVersion ?? null,
      contractEventSnapshotId: generated.contractEventSnapshot?.snapshotId ?? null,
      contractEventIds:
        generated.contractEventSnapshot?.activeEvents.map((event) => event.id) ?? [],
      contractEventSnapshot: generated.contractEventSnapshot,
      issuedAtCanonicalGameHours: generated.contractGameTime?.issuedAtCanonicalGameHours ?? null,
      clockRevisionAtIssue: generated.contractGameTime?.clockRevisionAtIssue ?? null,
      expiryPolicyVersion: generated.offers[0]?.expiryPolicyVersion ?? null,
      clockAuthorityClass: generated.contractGameTime?.clockAuthorityClass ?? null,
      playerLevel: snapshotLevel(playerLevel),
      playerReputation: snapshotLevel(playerReputation),
    };
    if (eventStateToWrite) {
      transaction.set(eventRef, jsonSafe(eventStateToWrite));
    }
    if (clockNext) {
      transaction.set(clockRef, jsonSafe(clockNext));
    }
    if (refreshGate && contractGameTime && refreshSequence != null) {
      const frozenHours = Number(
        existingBatch.exists && Number.isFinite(Number(existingBatch.data()?.issuedAtCanonicalGameHours))
          ? existingBatch.data()?.issuedAtCanonicalGameHours
          : contractGameTime.issuedAtCanonicalGameHours,
      );
      const nextRefresh: CanonicalRoadContractRefreshState = {
        schemaVersion: CANONICAL_ROAD_CONTRACT_REFRESH_SCHEMA_VERSION,
        policyVersion: CANONICAL_ROAD_CONTRACT_REFRESH_POLICY_VERSION,
        refreshSequence,
        lastRefreshGameHours:
          receiptData && refreshState ? refreshState.lastRefreshGameHours : frozenHours,
        lastBatchId: generated.batchId,
        lastRefreshAtServerMs: receiptData
          ? Number(receiptData.createdAtServerMs ?? serverNowMs)
          : serverNowMs,
        authorityMode: 'INTERNAL_TEST',
      };
      transaction.set(refreshRef, jsonSafe(nextRefresh));
      if (receiptRef && options?.refreshIntentId) {
        transaction.set(
          receiptRef,
          jsonSafe({
            intentId: options.refreshIntentId,
            refreshSequence,
            previousBatchId: refreshState?.lastBatchId ?? null,
            newBatchId: generated.batchId,
            refreshGameHours: frozenHours,
            clockRevision: contractGameTime.clockRevisionAtIssue,
            marketEpoch: generated.marketEpoch,
            eventSnapshotId: generated.contractEventSnapshot?.snapshotId ?? null,
            generatorPolicyVersion: batchBody.policyVersion,
            createdAtServerMs: receiptData
              ? Number(receiptData.createdAtServerMs ?? serverNowMs)
              : serverNowMs,
            maxNewContracts: refreshMaxNewContracts,
            seed: generated.seed,
            offerCount: generated.offers.length,
            status: 'PARTIAL',
          }),
        );
      }
      if (contractsSnap && refreshSequence > 0) {
        for (const docSnap of contractsSnap.docs) {
          const data = docSnap.data();
          if (data.status !== 'AVAILABLE') continue;
          if (data.expiryAuthority !== 'CANONICAL_GAME_TIME') continue;
          if (typeof data.expiresAtGameHours !== 'number') continue;
          if (data.expiresAtGameHours > frozenHours) continue;
          if (generated.offers.some((offer) => offer.contractId === docSnap.id)) continue;
          transaction.update(firestore.doc(`users/${uid}/canonicalRoadContracts/${docSnap.id}`), {
            status: 'EXPIRED',
          });
        }
      }
    }
    if (generated.contractEventSnapshot || generated.contractGameTime) {
      transaction.set(batchRef, jsonSafe({ ...batchBody, status: 'PARTIAL' }));
    }
    let written = 0;
    for (let index = 0; index < offerRefs.length; index += 1) {
      const offer = offerRefs[index]!.offer;
      const existing = existingOffers[index]!;
      if (existing.exists) {
        const data = existing.data() ?? {};
        if (data.payment !== offer.payment || data.deadlineHours !== offer.deadlineHours) {
          return { ok: false as const, reason: 'CANONICAL_ROAD_CONTRACT_CONFLICT' };
        }
        continue;
      }
      transaction.create(offerRefs[index]!.ref, {
        ...offer,
        ownerUid: uid,
        status: 'AVAILABLE',
        issuedAtMs: serverNowMs,
        expiresAtMs: generated.expiresAtServerMs,
        authorityMode: 'INTERNAL_PRODUCTION_PARITY',
      });
      written += 1;
      if (typeof options?.failAfterOffers === 'number' && written >= options.failAfterOffers) {
        throw new Error('TEST_PARTIAL_ROAD_ISSUANCE');
      }
    }
    transaction.set(batchRef, jsonSafe({ ...batchBody, status: 'COMPLETE' }));
    if (receiptRef && options?.refreshIntentId) {
      transaction.set(
        receiptRef,
        jsonSafe({
          intentId: options.refreshIntentId,
          refreshSequence,
          previousBatchId: refreshState?.lastBatchId ?? null,
          newBatchId: generated.batchId,
          refreshGameHours: contractGameTime?.issuedAtCanonicalGameHours ?? null,
          clockRevision: contractGameTime?.clockRevisionAtIssue ?? null,
          marketEpoch: generated.marketEpoch,
          eventSnapshotId: generated.contractEventSnapshot?.snapshotId ?? null,
          generatorPolicyVersion: batchBody.policyVersion,
          createdAtServerMs: receiptData
            ? Number(receiptData.createdAtServerMs ?? serverNowMs)
            : serverNowMs,
          maxNewContracts: refreshMaxNewContracts,
          seed: generated.seed,
          offerCount: generated.offers.length,
          status: 'COMPLETE',
        }),
      );
    }
    return {
      ok: true as const,
      alreadyApplied: false,
      batchId: generated.batchId,
      offerCount: generated.offers.length,
      policyVersion: batchBody.policyVersion,
      refreshSequence: refreshSequence ?? undefined,
    };
  });
}

function snapshotLevel(value: number): number {
  return value;
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
