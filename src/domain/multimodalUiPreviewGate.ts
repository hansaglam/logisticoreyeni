/**
 * Step 28 internal UI preview gate.
 * UI preview ≠ gameplay activation. Default remains MULTIMODAL_OFF / hidden.
 */

import { MULTIMODAL_FEATURE_ROLLOUT } from './multimodalShipmentPersistence';

export const MULTIMODAL_UI_PREVIEW_ENV_KEY = 'EXPO_PUBLIC_MAP_V2_MULTIMODAL_UI_PREVIEW';
export const MULTIMODAL_UI_PREVIEW_SEED = 'rail-ui-preview-v1';

function readPreviewEnv(): string {
  try {
    return String(process.env.EXPO_PUBLIC_MAP_V2_MULTIMODAL_UI_PREVIEW ?? '');
  } catch {
    return '';
  }
}

/**
 * Internal RAIL offer UI may render only when:
 * - feature rollout is still MULTIMODAL_OFF (no gameplay)
 * - this is a DEV build
 * - EXPO_PUBLIC_MAP_V2_MULTIMODAL_UI_PREVIEW=true
 *
 * Production + env override alone is fail-closed.
 * Env alone does not enable accept / shipment / RAIL ACTIVE.
 */
export function isMultimodalUiPreviewEnabled(options?: {
  featureRollout?: string;
  envValue?: string | null;
  isDev?: boolean;
}): boolean {
  const rollout = options?.featureRollout ?? MULTIMODAL_FEATURE_ROLLOUT;
  if (rollout !== 'MULTIMODAL_OFF') {
    return false;
  }
  const isDev =
    options?.isDev ?? (typeof __DEV__ !== 'undefined' && __DEV__);
  if (!isDev) {
    return false;
  }
  const env = options?.envValue === undefined ? readPreviewEnv() : String(options.envValue ?? '');
  return env === 'true';
}
