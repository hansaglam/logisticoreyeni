/**
 * One-boot cache so cold start does not parse/checksum the same save 3–4 times.
 * Invalidated on write and recovery reset.
 */

import type { SaveGamePayload } from './saveGame';

export type ColdStartSaveSession = {
  raw: string;
  rawBytes: number;
  payload: SaveGamePayload;
  migratedFromVersion: number | null;
  shouldPersistMigrated: boolean;
  parseMs: number;
  checksumMs: number;
  migrateMs: number;
};

let session: ColdStartSaveSession | null = null;
let deferredMigratedPersist = false;

export function rememberColdStartSaveSession(next: ColdStartSaveSession): void {
  session = next;
}

export function peekColdStartSaveSession(): ColdStartSaveSession | null {
  return session;
}

export function clearColdStartSaveSession(): void {
  session = null;
  deferredMigratedPersist = false;
}

export function scheduleDeferredMigratedPersist(): void {
  if (session?.shouldPersistMigrated) {
    deferredMigratedPersist = true;
  }
}

export function takeDeferredMigratedPersist(): ColdStartSaveSession | null {
  if (!deferredMigratedPersist || !session?.shouldPersistMigrated) {
    return null;
  }
  deferredMigratedPersist = false;
  return session;
}
