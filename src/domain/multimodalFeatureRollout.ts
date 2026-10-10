/**
 * Map V2 Step 29 — INTERNAL_TEST rollout gate.
 *
 * Default remains MULTIMODAL_OFF. Missing/invalid env → OFF.
 * Preview UI env cannot mutate. No user preference toggle.
 */

export const MULTIMODAL_ROLLOUT_ENV_KEY = 'EXPO_PUBLIC_MULTIMODAL_ROLLOUT' as const;

export type MultimodalFeatureRolloutState = 'MULTIMODAL_OFF' | 'INTERNAL_TEST';

export const MULTIMODAL_ROLLOUT_DEFAULT: MultimodalFeatureRolloutState = 'MULTIMODAL_OFF';

function readRolloutEnv(): string {
  try {
    return String(process.env.EXPO_PUBLIC_MULTIMODAL_ROLLOUT ?? '');
  } catch {
    return '';
  }
}

export function resolveMultimodalFeatureRollout(options?: {
  envValue?: string | null;
}): MultimodalFeatureRolloutState {
  const raw =
    options?.envValue === undefined ? readRolloutEnv() : String(options.envValue ?? '');
  const trimmed = raw.trim();
  if (trimmed === 'INTERNAL_TEST') {
    return 'INTERNAL_TEST';
  }
  return 'MULTIMODAL_OFF';
}

export function isMultimodalInternalTestEnabled(options?: {
  envValue?: string | null;
  rollout?: string;
}): boolean {
  const rollout =
    options?.rollout ?? resolveMultimodalFeatureRollout({ envValue: options?.envValue });
  return rollout === 'INTERNAL_TEST';
}

/** New RAIL offers / acceptance. Kill switch: false under OFF. */
export function allowNewMultimodalContractCreation(options?: {
  envValue?: string | null;
  rollout?: string;
}): boolean {
  return isMultimodalInternalTestEnabled(options);
}

export function allowMultimodalRailAcceptance(options?: {
  envValue?: string | null;
  rollout?: string;
}): boolean {
  return isMultimodalInternalTestEnabled(options);
}
