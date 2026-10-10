export const AIR_PLAYER_VISUAL_OFF = 'AIR_PLAYER_VISUAL_OFF' as const;
export const AIR_PLAYER_VISUAL_PREVIEW = 'AIR_PLAYER_VISUAL_PREVIEW' as const;

export type AirPlayerVisualMode = typeof AIR_PLAYER_VISUAL_OFF | typeof AIR_PLAYER_VISUAL_PREVIEW;

function readEnvPreview(): boolean {
  try {
    return process.env.EXPO_PUBLIC_MAP_V2_AIR_PLAYER_VISUAL === 'PREVIEW';
  } catch {
    return false;
  }
}

export function airPlayerVisualMode(): AirPlayerVisualMode {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return AIR_PLAYER_VISUAL_OFF;
  return readEnvPreview() ? AIR_PLAYER_VISUAL_PREVIEW : AIR_PLAYER_VISUAL_OFF;
}

export function isAirPlayerVisualPreviewEnabled(): boolean {
  return airPlayerVisualMode() === AIR_PLAYER_VISUAL_PREVIEW;
}
