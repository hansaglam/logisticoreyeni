/**
 * Geliştirici / internal test bayrakları.
 * Production ve normal internal test akışında kapalı tutulmalı.
 *
 * Varsayılan preset: kalibrasyon — terminalde yalnız calibration logları görünür.
 */

export type DebugMapLogPreset = 'calibration' | 'road-debug' | 'truck-debug' | 'off';

export const debugConfig = {
  /**
   * Harita koordinat kalibrasyonu — açıkken haritaya tıklayınca x/y (0–1) loglanır.
   * Tap on the map and copy x/y values into worldMapPositions.ts / mapRoadNetwork.ts.
   */
  mapCalibrationEnabled: true,
  /**
   * Segment kalibrasyonu — örn. 'izmir-istanbul'
   * mapCalibrationEnabled true iken haritaya dokunarak points biriktirilir.
   * null → şehir merkezi kalibrasyon modu
   * __mapCalibration.print() ile yapıştırılabilir JSON alınır.
   */
  mapCalibrationSegmentId: 'izmir-istanbul' as string | null,

  /**
   * Map debug log preset — tek yerden kategori seçimi.
   * Individual flag’ler bu preset’e göre resolve edilir (aşağıda).
   */
  debugMapLogPreset: 'calibration' as DebugMapLogPreset,

  /**
   * Kalibrasyon oturum logları ([map-calibration:*], yapıştırılabilir { x, y }).
   */
  mapCalibrationLogsEnabled: true,
  /**
   * Kalibrasyon tıklamasında index/segmentId detay logu.
   * Kapalıyken yalnız yapıştırılabilir `{ x: …, y: … },` satırı basılır.
   */
  mapCalibrationVerboseLogsEnabled: false,

  /**
   * [map-road-endpoint-check]
   */
  mapRoadEndpointLogsEnabled: false,
  /**
   * [map-road-route-resolution]
   */
  mapRoadResolutionLogsEnabled: false,
  /**
   * [map-road-segment-check]
   */
  mapRoadSegmentLogsEnabled: false,
  /**
   * [road-graph-segment]
   */
  mapRoadGraphLogsEnabled: false,
  /**
   * [map-truck] — frame başına spam üretir.
   */
  mapTruckLogsEnabled: false,
  /**
   * [map-marker-audit] — render edilen dinamik marker kaynağını raporlar.
   */
  mapMarkerAuditEnabled: false,
  /**
   * [map-road] route not found / endpoint mismatch / invalid point uyarıları.
   */
  mapRoadWarningsEnabled: false,

  /**
   * Segment nokta sırası debug overlay (numaralı marker).
   */
  mapRoadSegmentPointDebugEnabled: false,

  /**
   * Sözleşme kamyon uygunluk logları — her render/evaluate'de spam üretebilir.
   */
  contractEligibilityLogsEnabled: false,

  /**
   * Teslimat başlatma kapasite snapshot logları ([delivery-start-capacity]).
   */
  deliveryStartLogsEnabled: true,

  /**
   * Debug sözleşme üretim logları ([debug-contract-generator-result]).
   */
  debugContractGenerationLogsEnabled: true,

  /**
   * Cloud save payload boyut analizi ([cloud-save-size]).
   */
  cloudSaveSizeLogsEnabled: false,

  /**
   * Teslimat tamamlama konum logları ([delivery-completion]).
   */
  deliveryCompletionLogsEnabled: false,
} as const;

export type DebugConfig = typeof debugConfig;

export interface ResolvedMapDebugFlags {
  calibrationLogs: boolean;
  calibrationVerbose: boolean;
  roadEndpoint: boolean;
  roadResolution: boolean;
  roadSegment: boolean;
  roadGraph: boolean;
  truck: boolean;
  roadWarnings: boolean;
}

/** Preset + individual flag birleşimi — kalibrasyon sırasında road spam’i kapatır. */
export function getResolvedMapDebugFlags(): ResolvedMapDebugFlags {
  const preset = debugConfig.debugMapLogPreset;

  if (preset === 'off') {
    return {
      calibrationLogs: false,
      calibrationVerbose: false,
      roadEndpoint: false,
      roadResolution: false,
      roadSegment: false,
      roadGraph: false,
      truck: false,
      roadWarnings: false,
    };
  }

  if (preset === 'calibration') {
    return {
      calibrationLogs: debugConfig.mapCalibrationLogsEnabled,
      calibrationVerbose: debugConfig.mapCalibrationVerboseLogsEnabled,
      roadEndpoint: false,
      roadResolution: false,
      roadSegment: false,
      roadGraph: false,
      truck: false,
      roadWarnings: false,
    };
  }

  if (preset === 'road-debug') {
    return {
      calibrationLogs: debugConfig.mapCalibrationLogsEnabled,
      calibrationVerbose: debugConfig.mapCalibrationVerboseLogsEnabled,
      roadEndpoint: true,
      roadResolution: true,
      roadSegment: true,
      roadGraph: true,
      truck: false,
      roadWarnings: true,
    };
  }

  if (preset === 'truck-debug') {
    return {
      calibrationLogs: debugConfig.mapCalibrationLogsEnabled,
      calibrationVerbose: debugConfig.mapCalibrationVerboseLogsEnabled,
      roadEndpoint: false,
      roadResolution: false,
      roadSegment: false,
      roadGraph: false,
      truck: true,
      roadWarnings: false,
    };
  }

  return {
    calibrationLogs: debugConfig.mapCalibrationLogsEnabled,
    calibrationVerbose: debugConfig.mapCalibrationVerboseLogsEnabled,
    roadEndpoint: debugConfig.mapRoadEndpointLogsEnabled,
    roadResolution: debugConfig.mapRoadResolutionLogsEnabled,
    roadSegment: debugConfig.mapRoadSegmentLogsEnabled,
    roadGraph: debugConfig.mapRoadGraphLogsEnabled,
    truck: debugConfig.mapTruckLogsEnabled,
    roadWarnings: debugConfig.mapRoadWarningsEnabled,
  };
}
