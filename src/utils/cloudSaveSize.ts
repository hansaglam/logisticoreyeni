/**
 * Cloud save payload size probes — Node-safe (no React Native / Firebase imports).
 */

import type { SaveGamePayload } from '../storage/saveGame';
import { buildCloudSaveSummaryFromPayload } from './cloudSaveSummary';
import { sanitizeForFirestore } from './sanitizeForFirestore';

export const MAX_SAVE_SIZE_BYTES = 900_000;
export const CLOUD_SAVE_SIZE_WARN_RATIO = 0.8;

export function measureCloudSaveJsonBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).length;
    }
    return json.length;
  } catch {
    return MAX_SAVE_SIZE_BYTES + 1;
  }
}

/** Firestore save/current dokümanının tahmini UTF-8 boyutu. */
export function estimateCloudSaveDocumentBytes(savePayload: SaveGamePayload): number {
  const summary = buildCloudSaveSummaryFromPayload(savePayload);
  const sanitizedGameState = sanitizeForFirestore(savePayload);
  const sanitizedSummary = sanitizeForFirestore(summary);
  const deviceUpdatedAt = savePayload.meta?.savedAt ?? Date.now();

  const sizeProbe = sanitizeForFirestore({
    schemaVersion: 1,
    version: savePayload.version ?? 1,
    saveVersion: savePayload.meta?.saveVersion ?? savePayload.version ?? 1,
    updatedAt: deviceUpdatedAt,
    deviceUpdatedAt,
    gameState: sanitizedGameState,
    summary: sanitizedSummary,
  });

  return measureCloudSaveJsonBytes(sizeProbe);
}
