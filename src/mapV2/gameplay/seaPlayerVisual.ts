/**
 * Player-facing SEA is visual-network preview only.
 * Production / default: OFF. DEV may enable PREVIEW. Never gameplay-active.
 */
export const SEA_PLAYER_VISUAL_OFF = 'SEA_PLAYER_VISUAL_OFF' as const;
export const SEA_PLAYER_VISUAL_PREVIEW = 'SEA_PLAYER_VISUAL_PREVIEW' as const;

export type SeaPlayerVisualMode = typeof SEA_PLAYER_VISUAL_OFF | typeof SEA_PLAYER_VISUAL_PREVIEW;

function readEnvPreview(): boolean {
  try {
    return process.env.EXPO_PUBLIC_MAP_V2_SEA_PLAYER_VISUAL === 'PREVIEW';
  } catch {
    return false;
  }
}

/** Default OFF. Production builds never enable preview. */
export function seaPlayerVisualMode(): SeaPlayerVisualMode {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return SEA_PLAYER_VISUAL_OFF;
  return readEnvPreview() ? SEA_PLAYER_VISUAL_PREVIEW : SEA_PLAYER_VISUAL_OFF;
}

export function isSeaPlayerVisualPreviewEnabled(): boolean {
  return seaPlayerVisualMode() === SEA_PLAYER_VISUAL_PREVIEW;
}
