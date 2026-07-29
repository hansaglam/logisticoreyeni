/**
 * Firestore implementation of the global economy repository.
 *
 * Client apps construct this with allowSnapshotCreation=false. A trusted
 * backend worker may enable creation; runTransaction then guarantees one
 * canonical document per epoch + configVersion.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';

import { ECONOMY_CONFIG_VERSION } from '../simulation/economyClock';
import { isSupportedGlobalEconomySnapshot } from '../simulation/globalMarketAvailability';
import type {
  GlobalEconomySnapshot,
  GlobalMarketHistoryEntry,
} from '../types/game';
import type {
  GlobalEconomyRepository,
  GlobalMarketHistoryQuery,
  GlobalSnapshotReadResult,
} from './globalEconomyRepository';

export class FirestoreGlobalEconomyRepository implements GlobalEconomyRepository {
  constructor(private readonly firestore: Firestore) {}

  async getCurrentSnapshot(): Promise<GlobalSnapshotReadResult> {
    const current = await getDoc(doc(this.firestore, 'globalEconomy', 'current'));
    if (!current.exists()) return { snapshot: null, source: 'backend' };
    const data = current.data() as {
      snapshot?: GlobalEconomySnapshot;
      serverTimeMs?: number;
    } & Partial<GlobalEconomySnapshot>;
    const snapshot = data.snapshot ?? (data as GlobalEconomySnapshot);
    if (
      !isSupportedGlobalEconomySnapshot(snapshot) ||
      (data.configVersion != null &&
        data.configVersion !== ECONOMY_CONFIG_VERSION)
    ) {
      throw new Error(
        `UNSUPPORTED_GLOBAL_ECONOMY_SNAPSHOT:${snapshot.version}:${snapshot.configVersion}`,
      );
    }
    return {
      snapshot,
      source: 'backend',
      serverTimeMs: Number.isFinite(data.serverTimeMs) ? data.serverTimeMs : undefined,
    };
  }

  async getOrCreateSnapshot(
    _epoch: number,
    _configVersion = ECONOMY_CONFIG_VERSION,
  ): Promise<GlobalEconomySnapshot> {
    throw new Error('CLIENT_SNAPSHOT_CREATION_FORBIDDEN');
  }

  async getHistory(
    input: GlobalMarketHistoryQuery,
  ): Promise<GlobalMarketHistoryEntry[]> {
    const result = await getDocs(query(
      collection(this.firestore, 'globalMarketHistory'),
      where('epoch', '>=', input.fromEpoch),
      where('epoch', '<=', input.toEpoch),
      orderBy('epoch', 'asc'),
      limit(input.limit ?? 2_000),
    ));
    return result.docs
      .map((item) => item.data() as GlobalMarketHistoryEntry)
      .filter((entry) =>
        (!input.cityId || entry.cityId === input.cityId) &&
        (!input.productId || entry.productId === input.productId));
  }
}
