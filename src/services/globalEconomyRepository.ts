/**
 * Backend boundary for the authoritative global economy.
 *
 * Production clients read `globalEconomy/current`; snapshot creation belongs
 * to a trusted backend worker. The transaction method exists for that worker
 * and deterministic integration tests.
 */

import type {
  GlobalEconomySnapshot,
  GlobalMarketHistoryEntry,
} from '../types/game';
import { CITIES } from '../data/cities';
import {
  buildGlobalEconomySnapshot,
  buildGlobalMarketHistoryEntries,
} from '../simulation/globalMarketSnapshot';
import {
  ECONOMY_CONFIG_VERSION,
  getEconomyNow,
  getMarketEpoch,
} from '../simulation/economyClock';

export type GlobalMarketRepositorySource =
  | 'backend'
  | 'development-fallback'
  | 'cache';

export interface GlobalSnapshotReadResult {
  snapshot: GlobalEconomySnapshot | null;
  source: GlobalMarketRepositorySource;
  serverTimeMs?: number;
}

export interface GlobalMarketHistoryQuery {
  fromEpoch: number;
  toEpoch: number;
  cityId?: string;
  productId?: string;
  limit?: number;
}

export interface GlobalEconomyRepository {
  getCurrentSnapshot(): Promise<GlobalSnapshotReadResult>;
  getHistory(query: GlobalMarketHistoryQuery): Promise<GlobalMarketHistoryEntry[]>;
  getOrCreateSnapshot(
    epoch: number,
    configVersion?: number,
  ): Promise<GlobalEconomySnapshot>;
}

function snapshotKey(epoch: number, configVersion: number): string {
  return `${epoch}_${configVersion}`;
}

function historyKey(entry: GlobalMarketHistoryEntry): string {
  return `${entry.epoch}_${entry.cityId}_${entry.productId}`;
}

export class InMemoryGlobalEconomyRepository implements GlobalEconomyRepository {
  private readonly snapshots = new Map<string, GlobalEconomySnapshot>();
  private readonly history = new Map<string, GlobalMarketHistoryEntry>();
  private currentKey: string | null = null;
  private createCount = 0;

  constructor(
    seedSnapshots: GlobalEconomySnapshot[] = [],
    private readonly now: () => number = getEconomyNow,
  ) {
    for (const snapshot of seedSnapshots) this.persist(snapshot);
  }

  private persist(snapshot: GlobalEconomySnapshot): void {
    const key = snapshotKey(snapshot.epoch, snapshot.configVersion);
    this.snapshots.set(key, snapshot);
    if (
      this.currentKey == null ||
      snapshot.epoch >= (this.snapshots.get(this.currentKey)?.epoch ?? -1)
    ) {
      this.currentKey = key;
    }
    for (const entry of buildGlobalMarketHistoryEntries(snapshot)) {
      this.history.set(historyKey(entry), entry);
    }
  }

  getSnapshotCreateCount(): number {
    return this.createCount;
  }

  async getCurrentSnapshot(): Promise<GlobalSnapshotReadResult> {
    const epoch = getMarketEpoch(this.now());
    const snapshot = await this.getOrCreateSnapshot(epoch, ECONOMY_CONFIG_VERSION);
    return {
      snapshot,
      source: 'development-fallback',
      serverTimeMs: this.now(),
    };
  }

  async getOrCreateSnapshot(
    epoch: number,
    configVersion = ECONOMY_CONFIG_VERSION,
  ): Promise<GlobalEconomySnapshot> {
    const key = snapshotKey(epoch, configVersion);
    const existing = this.snapshots.get(key);
    if (existing) return existing;

    // No await before insertion: concurrent callers observe the same document.
    const snapshot = buildGlobalEconomySnapshot({
      epoch,
      configVersion,
      cities: CITIES,
    });
    this.createCount += 1;
    this.persist(snapshot);
    return snapshot;
  }

  async getHistory(
    historyQuery: GlobalMarketHistoryQuery,
  ): Promise<GlobalMarketHistoryEntry[]> {
    return [...this.history.values()]
      .filter(
        (entry) =>
          entry.epoch >= historyQuery.fromEpoch &&
          entry.epoch <= historyQuery.toEpoch &&
          (!historyQuery.cityId || entry.cityId === historyQuery.cityId) &&
          (!historyQuery.productId || entry.productId === historyQuery.productId),
      )
      .sort((a, b) => a.epoch - b.epoch)
      .slice(-(historyQuery.limit ?? 2_000));
  }
}

let repositoryOverride: GlobalEconomyRepository | null = null;
let fallbackRepository: InMemoryGlobalEconomyRepository | null = null;

export function setGlobalEconomyRepositoryForTests(
  repository: GlobalEconomyRepository | null,
): void {
  repositoryOverride = repository;
}

export function getGlobalEconomyRepository(): GlobalEconomyRepository | null {
  if (repositoryOverride) return repositoryOverride;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // Firebase yapılandırılmışsa dev'de de Firestore canonical kaynağı kullan.
    if (!process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID) {
      fallbackRepository ??= new InMemoryGlobalEconomyRepository();
      return fallbackRepository;
    }
    return null;
  }
  return null;
}
