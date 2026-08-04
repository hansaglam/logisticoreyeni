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
import type {
  GlobalEconomySnapshot,
  GlobalMarketHistoryEntry,
} from '../types/game';
import type {
  GlobalEconomyRepository,
  GlobalMarketHistoryQuery,
  GlobalSnapshotReadResult,
} from './globalEconomyRepository';
import { parseGlobalEconomyCurrentDocument } from './globalEconomyClient';

const MAX_INITIAL_HISTORY_RECORDS = 3_000;

export class FirestoreGlobalEconomyRepository implements GlobalEconomyRepository {
  constructor(private readonly firestore: Firestore) {}

  async getCurrentSnapshot(): Promise<GlobalSnapshotReadResult> {
    const current = await getDoc(doc(this.firestore, 'globalEconomy', 'current'));
    if (!current.exists()) return { snapshot: null, source: 'backend' };
    const data = current.data();
    const parsed = parseGlobalEconomyCurrentDocument(data);
    if (data.configVersion != null && data.configVersion !== ECONOMY_CONFIG_VERSION) {
      throw new Error(
        `UNSUPPORTED_GLOBAL_ECONOMY_SNAPSHOT:${parsed.snapshot.version}:${parsed.snapshot.configVersion}`,
      );
    }
    return {
      snapshot: parsed.snapshot,
      source: 'backend',
      serverTimeMs: parsed.serverTimeMs,
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
    const boundedLimit = Math.max(
      1,
      Math.min(MAX_INITIAL_HISTORY_RECORDS, input.limit ?? MAX_INITIAL_HISTORY_RECORDS),
    );
    const result = await getDocs(query(
      collection(this.firestore, 'globalMarketHistory'),
      where('epoch', '>=', input.fromEpoch),
      where('epoch', '<=', input.toEpoch),
      orderBy('epoch', 'desc'),
      limit(boundedLimit),
    ));
    return result.docs
      .map((item) => item.data() as GlobalMarketHistoryEntry)
      .filter((entry) =>
        (!input.cityId || entry.cityId === input.cityId) &&
        (!input.productId || entry.productId === input.productId))
      .sort((left, right) => left.epoch - right.epoch);
  }
}
