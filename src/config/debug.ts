/**
 * Geliştirici / internal test bayrakları.
 * Production ve normal internal test akışında kapalı tutulmalı.
 */

export const debugConfig = {
  /**
   * Harita koordinat kalibrasyonu — açıkken haritaya tıklayınca xPct/yPct loglanır.
   * Enable this temporarily to calibrate map city positions.
   * Tap on the map and copy xPct/yPct values into worldMapPositions.ts.
   */
  mapCalibrationEnabled: false,
} as const;

export type DebugConfig = typeof debugConfig;
