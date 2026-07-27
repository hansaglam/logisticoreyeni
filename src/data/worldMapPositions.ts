/**
 * worldMapPositions.ts
 *
 * Koordinatlar harita görselinin normalize edilmiş bounds'u içinde tutulur:
 *
 *   x: 0 -> sol kenar, 1 -> sağ kenar
 *   y: 0 -> üst kenar, 1 -> alt kenar
 *
 * Asset: assets/maps/turkey-logistics-network-map.png (1672×941)
 *
 * NASIL KALİBRE EDİLİR:
 * 1) src/config/debug.ts içinde mapCalibrationEnabled: true yap.
 * 2) Haritanın üzerinde şehrin olması gereken noktaya dokun.
 * 3) Konsola basılan { x, y } değerini buraya kopyala.
 * 4) mapCalibrationEnabled'ı tekrar false yap.
 */

export interface WorldMapCityPosition {
  id: string;
  /** 0–1 normalized x within map image bounds */
  x: number;
  /** 0–1 normalized y within map image bounds */
  y: number;
}

/**
 * turkey-logistics-network-map.png üzerinde kalibre edilmiş şehir dokunma noktaları.
 * Görselde şehir isimleri gömülü olduğundan yalnızca hit-test koordinatları tutulur.
 */
export const WORLD_MAP_POSITIONS: Record<string, WorldMapCityPosition> = {
  istanbul: { id: 'istanbul', x: 0.208, y: 0.168 },
  bursa: { id: 'bursa', x: 0.238, y: 0.278 },
  ankara: { id: 'ankara', x: 0.428, y: 0.298 },
  izmir: { id: 'izmir', x: 0.118, y: 0.408 },
  antalya: { id: 'antalya', x: 0.348, y: 0.578 },
  /** Geçici — mapCalibrationEnabled ile kalibre edin */
  adana: { id: 'adana', x: 0.52, y: 0.68 },
  /** Geçici — mapCalibrationEnabled ile kalibre edin */
  diyarbakir: { id: 'diyarbakir', x: 0.78, y: 0.42 },
  /** Geçici — mapCalibrationEnabled ile kalibre edin */
  trabzon: { id: 'trabzon', x: 0.62, y: 0.2 },
};

export function getWorldMapCityPosition(cityId: string): WorldMapCityPosition | null {
  return WORLD_MAP_POSITIONS[cityId] ?? null;
}
