/**
 * Trusted economy clock — server-ready.
 * Cihaz saati doğrudan source of truth değildir; V1 local trusted fallback kullanır.
 */

export interface EconomyClock {
  now(): number;
  lastSyncedAt(): number | null;
  isTrusted(): boolean;
  syncFromServer?(serverTimestampMs: number): void;
}

const MAX_CLOCK_JUMP_MS = 6 * 60 * 60 * 1000; // 6 saat ileri atlama şüphesi

let trustedAnchorServerMs: number | null = null;
let trustedAnchorPerfMs: number | null = null;
let lastEmittedMs = 0;

function readDeviceNow(): number {
  return Date.now();
}

function readMonotonicMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return readDeviceNow();
}

/**
 * V1 local clock: son güvenilir zamandan monotonic ilerler.
 * Cihaz saati geri/ileri alınsa bile büyük sıçramayı sınırlar.
 */
export class LocalEconomyClock implements EconomyClock {
  now(): number {
    const deviceNow = readDeviceNow();
    const perfNow = readMonotonicMs();

    if (trustedAnchorServerMs == null || trustedAnchorPerfMs == null) {
      trustedAnchorServerMs = deviceNow;
      trustedAnchorPerfMs = perfNow;
      lastEmittedMs = deviceNow;
      return deviceNow;
    }

    const elapsed = Math.max(0, perfNow - trustedAnchorPerfMs);
    let candidate = Math.round(trustedAnchorServerMs + elapsed);

    // Cihaz saati aşırı ileri alındıysa trusted+elapsed'e sadık kal
    if (deviceNow - candidate > MAX_CLOCK_JUMP_MS) {
      candidate = lastEmittedMs + Math.min(elapsed, 1000);
    }

    // Geriye gitmeyi engelle (monotonic economy time)
    candidate = Math.max(candidate, lastEmittedMs);
    lastEmittedMs = candidate;
    return candidate;
  }

  lastSyncedAt(): number | null {
    return trustedAnchorServerMs;
  }

  isTrusted(): boolean {
    return trustedAnchorServerMs != null;
  }

  syncFromServer(serverTimestampMs: number): void {
    if (!Number.isFinite(serverTimestampMs) || serverTimestampMs <= 0) {
      return;
    }
    trustedAnchorServerMs = Math.round(serverTimestampMs);
    trustedAnchorPerfMs = readMonotonicMs();
    lastEmittedMs = Math.max(lastEmittedMs, trustedAnchorServerMs);
  }
}

/**
 * Authoritative server clock. A server response anchors wall time once; all
 * following reads advance with the monotonic clock and ignore device changes.
 */
export class ServerEconomyClock implements EconomyClock {
  private serverAnchorMs: number | null = null;
  private monotonicAnchorMs: number | null = null;
  private lastValueMs = 0;

  constructor(serverTimestampMs?: number) {
    if (serverTimestampMs != null) this.syncFromServer(serverTimestampMs);
  }

  now(): number {
    if (this.serverAnchorMs == null || this.monotonicAnchorMs == null) {
      return this.lastValueMs;
    }
    const elapsed = Math.max(0, readMonotonicMs() - this.monotonicAnchorMs);
    this.lastValueMs = Math.max(
      this.lastValueMs,
      Math.round(this.serverAnchorMs + elapsed),
    );
    return this.lastValueMs;
  }

  lastSyncedAt(): number | null {
    return this.serverAnchorMs;
  }

  isTrusted(): boolean {
    return this.serverAnchorMs != null;
  }

  syncFromServer(serverTimestampMs: number): void {
    if (!Number.isFinite(serverTimestampMs) || serverTimestampMs <= 0) return;
    this.serverAnchorMs = Math.round(serverTimestampMs);
    this.monotonicAnchorMs = readMonotonicMs();
    this.lastValueMs = this.serverAnchorMs;
  }
}

let activeClock: EconomyClock = new LocalEconomyClock();

export function setEconomyClock(clock: EconomyClock): void {
  activeClock = clock;
}

export function getEconomyClock(): EconomyClock {
  return activeClock;
}

/** Ekonomi hesapları için tek giriş — UI/sim Date.now kullanmamalı */
export function getEconomyNow(): number {
  return activeClock.now();
}

/** Test/reset */
export function resetEconomyClockForTests(): void {
  trustedAnchorServerMs = null;
  trustedAnchorPerfMs = null;
  lastEmittedMs = 0;
  activeClock = new LocalEconomyClock();
}

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_24H = 24 * MS_PER_HOUR;

/** Domain config version — snapshot / event uyumu */
export const ECONOMY_CONFIG_VERSION = 1;

/** Ortak piyasa tick aralığı (gerçek ms) */
export const MARKET_TICK_INTERVAL_MS = 30 * MS_PER_MINUTE;

export function getMarketEpoch(nowMs: number = getEconomyNow()): number {
  return Math.floor(Math.max(0, nowMs) / MARKET_TICK_INTERVAL_MS);
}

export function getMarketEpochStartMs(epoch: number): number {
  return epoch * MARKET_TICK_INTERVAL_MS;
}

export function getNextMarketTickAt(nowMs: number = getEconomyNow()): number {
  return getMarketEpochStartMs(getMarketEpoch(nowMs) + 1);
}

export function getMsUntilNextMarketTick(nowMs: number = getEconomyNow()): number {
  return Math.max(0, getNextMarketTickAt(nowMs) - nowMs);
}
