/**
 * INTERNAL production market tick (Step 29Z).
 * Server epoch only. Does not move player cash. Does not tick unstamped 29U rows.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type { ProductId } from '../../src/types/game';
import { CANONICAL_WORLD_MARKETS_COLLECTION } from '../../src/domain/canonicalCargoMarketWorldState';
import { createCanonicalWorldMarketId } from '../../src/domain/canonicalCargoMarketWorldState';
import {
  CANONICAL_MARKET_CLOCK_COLLECTION,
  CANONICAL_MARKET_CLOCK_DOC_ID,
  CANONICAL_MARKET_TICKS_COLLECTION,
  CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY_MODE,
  CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
  canonicalMarketTickId,
  deriveCanonicalMarketEpoch,
  deriveCanonicalProductionMarketQuote,
  isCanonicalProductionMarketTickAllowed,
  isDynamicCanonicalMarketRow,
  marketTickIntervalMs,
  planCanonicalProductionMarketTick,
  type CanonicalTickMarketRow,
} from '../../src/domain/canonicalProductionMarketTick';

export type CanonicalMarketTickResult =
  | {
      ok: true;
      alreadyApplied: boolean;
      tickId: string;
      epoch: number;
      appliedRecordCount: number;
      alreadyAppliedCount: number;
      skippedFixedSnapshot: number;
      expectedDynamicCount: number;
    }
  | { ok: false; reason: string };

function clockPath(): string {
  return `${CANONICAL_MARKET_CLOCK_COLLECTION}/${CANONICAL_MARKET_CLOCK_DOC_ID}`;
}

function manifestPath(tickId: string): string {
  return `${CANONICAL_MARKET_TICKS_COLLECTION}/${tickId}`;
}

function marketPath(cityId: string, productId: ProductId): string {
  return `${CANONICAL_WORLD_MARKETS_COLLECTION}/${createCanonicalWorldMarketId(cityId, productId)}`;
}

export async function stampCanonicalProductionMarketTickPolicyTransaction(
  firestore: Firestore,
  nowMs: number,
  options?: { envValue?: string | null },
): Promise<{ ok: true; stamped: number } | { ok: false; reason: string }> {
  if (!isCanonicalProductionMarketTickAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY_OFF' };
  }
  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(firestore.collection(CANONICAL_WORLD_MARKETS_COLLECTION));
    const docs = (snap.docs ?? []) as Array<{ data: () => Record<string, unknown> | undefined }>;
    let stamped = 0;
    for (const docSnap of docs) {
      const data = docSnap.data();
      if (!data) continue;
      const cityId = String(data.cityId ?? '');
      const productId = String(data.productId ?? '') as ProductId;
      if (!cityId || !productId) continue;
      if (data.tickPolicyVersion === CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION) {
        continue;
      }
      if (typeof data.tickPolicyVersion === 'string') {
        return { ok: false as const, reason: 'UNKNOWN_MARKET_TICK_POLICY' };
      }
      transaction.update(firestore.doc(marketPath(cityId, productId)), {
        tickPolicyVersion: CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
        authorityMode: CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY_MODE,
        lastUpdatedAtMs: nowMs,
      });
      stamped += 1;
    }
    return { ok: true as const, stamped };
  });
}

export async function advanceCanonicalProductionMarketTickTransaction(
  firestore: Firestore,
  serverNowMs: number,
  options?: { envValue?: string | null; failAfterUpdates?: number },
): Promise<CanonicalMarketTickResult> {
  if (!isCanonicalProductionMarketTickAllowed(options)) {
    return { ok: false, reason: 'CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY_OFF' };
  }
  if (!Number.isFinite(serverNowMs) || serverNowMs < 0) {
    return { ok: false, reason: 'INVALID_SERVER_TIME' };
  }
  const epoch = deriveCanonicalMarketEpoch(serverNowMs);
  const tickId = canonicalMarketTickId(epoch);

  return firestore.runTransaction(async (transaction) => {
    const listed = await transaction.get(firestore.collection(CANONICAL_WORLD_MARKETS_COLLECTION));
    const docs = (listed.docs ?? []) as Array<{ data: () => Record<string, unknown> | undefined }>;
    const rows: CanonicalTickMarketRow[] = [];
    for (const docSnap of docs) {
      const data = docSnap.data();
      if (!data) continue;
      rows.push({
        cityId: String(data.cityId ?? ''),
        productId: String(data.productId ?? '') as ProductId,
        stock: Number(data.stock),
        currentPrice: Number(data.currentPrice),
        marketRevision: Number(data.marketRevision),
        tickPolicyVersion:
          typeof data.tickPolicyVersion === 'string' ? data.tickPolicyVersion : undefined,
        lastAppliedTickIndex:
          typeof data.lastAppliedTickIndex === 'number' ? data.lastAppliedTickIndex : undefined,
      });
    }
    const plan = planCanonicalProductionMarketTick({ epoch, rows });
    const expectedDynamicCount = rows.filter((row) => isDynamicCanonicalMarketRow(row)).length;
    let applied = 0;
    for (const update of plan.updates) {
      const liveQuote = deriveCanonicalProductionMarketQuote(
        epoch,
        update.cityId,
        update.productId,
      );
      if (!liveQuote || liveQuote.price !== update.quote.price) {
        return { ok: false as const, reason: 'MARKET_TICK_QUOTE_MISMATCH' };
      }
      transaction.update(firestore.doc(marketPath(update.cityId, update.productId)), {
        currentPrice: liveQuote.price,
        supplyIndex: liveQuote.epochSupply,
        demandIndex: liveQuote.epochDemand,
        marketRevision: update.nextRevision,
        lastAppliedTickIndex: epoch,
        lastAppliedTickId: tickId,
        epochSupply: liveQuote.epochSupply,
        epochDemand: liveQuote.epochDemand,
        marketStatus: liveQuote.status,
        eventIds: liveQuote.eventIds,
        targetStock: liveQuote.targetStock,
        lastUpdatedAtMs: serverNowMs,
        tickPolicyVersion: CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
        authorityMode: CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY_MODE,
      });
      applied += 1;
      if (
        typeof options?.failAfterUpdates === 'number' &&
        applied >= options.failAfterUpdates
      ) {
        throw new Error('TEST_PARTIAL_MARKET_TICK');
      }
    }
    const appliedRecordCount = plan.alreadyApplied + applied;
    const complete = appliedRecordCount === expectedDynamicCount;
    if (
      plan.updates.length === 0 &&
      expectedDynamicCount > 0 &&
      plan.alreadyApplied === expectedDynamicCount
    ) {
      return {
        ok: true as const,
        alreadyApplied: true,
        tickId,
        epoch,
        appliedRecordCount: 0,
        alreadyAppliedCount: plan.alreadyApplied,
        skippedFixedSnapshot: plan.skippedFixedSnapshot,
        expectedDynamicCount,
      };
    }
    const sample =
      plan.updates[0]?.quote ??
      deriveCanonicalProductionMarketQuote(epoch, rows[0]?.cityId ?? 'izmir', rows[0]?.productId ?? 'steel');
    if (!sample) return { ok: false as const, reason: 'MARKET_TICK_QUOTE_MISMATCH' };
    transaction.set(firestore.doc(clockPath()), {
      schemaVersion: 1,
      policyVersion: CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
      epochMs: marketTickIntervalMs(),
      lastAppliedTickIndex: complete ? epoch : null,
      lastCheckedEpoch: epoch,
      lastAppliedAtMs: serverNowMs,
      authorityMode: CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY_MODE,
    });
    transaction.set(firestore.doc(manifestPath(tickId)), {
      tickId,
      policyVersion: CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
      startedAt: serverNowMs,
      completedAt: complete ? serverNowMs : null,
      status: complete ? 'COMPLETE' : 'PARTIAL',
      expectedRecordCount: expectedDynamicCount,
      appliedRecordCount,
      seed: sample.seed,
      economyConfigVersion: sample.economyConfigVersion,
      fuelPricePerLiter: sample.fuelPricePerLiter,
      eventIds: sample.eventIds,
      authorityMode: CANONICAL_PRODUCTION_MARKET_TICK_AUTHORITY_MODE,
    });
    return {
      ok: true as const,
      alreadyApplied: plan.updates.length === 0 && plan.alreadyApplied === expectedDynamicCount,
      tickId,
      epoch,
      appliedRecordCount: applied,
      alreadyAppliedCount: plan.alreadyApplied,
      skippedFixedSnapshot: plan.skippedFixedSnapshot,
      expectedDynamicCount,
    };
  });
}
