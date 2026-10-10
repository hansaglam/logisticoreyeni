import type { MultimodalRoadTransferAccessArtifactV1 } from '../../domain/multimodalRoadAccess';

let cached: MultimodalRoadTransferAccessArtifactV1 | null = null;

/**
 * DEV / inspector / tests / offline planning only.
 * Compact table. Do not import the 237 MB ROAD graph.
 */
export function getTurkeyRoadTransferAccessArtifact(): MultimodalRoadTransferAccessArtifactV1 {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  cached = require('../generated/multimodal/turkey-road-transfer-access.json') as MultimodalRoadTransferAccessArtifactV1;
  return cached;
}
