/**
 * Player-facing RAIL is visual-network preview only.
 * Production / default: OFF. DEV may enable PREVIEW. Never gameplay-active.
 */
export const RAIL_PLAYER_VISUAL_OFF = 'RAIL_PLAYER_VISUAL_OFF' as const;
export const RAIL_PLAYER_VISUAL_PREVIEW = 'RAIL_PLAYER_VISUAL_PREVIEW' as const;

export type RailPlayerVisualMode = typeof RAIL_PLAYER_VISUAL_OFF | typeof RAIL_PLAYER_VISUAL_PREVIEW;

function readEnvPreview(): boolean {
  try {
    return process.env.EXPO_PUBLIC_MAP_V2_RAIL_PLAYER_VISUAL === 'PREVIEW';
  } catch {
    return false;
  }
}

/** Default OFF. Production builds never enable preview. */
export function railPlayerVisualMode(): RailPlayerVisualMode {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return RAIL_PLAYER_VISUAL_OFF;
  return readEnvPreview() ? RAIL_PLAYER_VISUAL_PREVIEW : RAIL_PLAYER_VISUAL_OFF;
}

export function isRailPlayerVisualPreviewEnabled(): boolean {
  return railPlayerVisualMode() === RAIL_PLAYER_VISUAL_PREVIEW;
}
