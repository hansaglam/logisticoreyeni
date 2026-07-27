/**
 * Geliştirici / internal test bayrakları.
 * Production ve normal internal test akışında kapalı tutulmalı.
 */

export const debugConfig = {
  /**
   * Harita koordinat kalibrasyonu — açıkken haritaya tıklayınca x/y (0–1) loglanır.
   * Tap on the map and copy x/y values into worldMapPositions.ts.
   */
  mapCalibrationEnabled: false,
  /**
   * Segment kalibrasyonu — örn. 'izmir-istanbul'
   * mapCalibrationEnabled true iken haritaya dokunarak points biriktirilir.
   * __mapCalibration.print() ile yapıştırılabilir JSON alınır.
   */
  mapCalibrationSegmentId: null as string | null,
} as const;

export type DebugConfig = typeof debugConfig;
