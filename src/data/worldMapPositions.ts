/**
 * worldMapPositions.ts
 *
 * Referans görseldeki gibi illüstratif bir harita kullanıyoruz (gerçek coğrafi
 * projeksiyon değil). Bu yüzden koordinatlar enlem/boylamdan değil, HARİTA
 * GÖRSELİNİN kendi genişlik/yüksekliğine göre YÜZDE olarak veriliyor:
 *
 *   xPct: 0   -> görselin sol kenarı
 *   xPct: 100 -> görselin sağ kenarı
 *   yPct: 0   -> görselin üst kenarı
 *   yPct: 100 -> görselin alt kenarı
 *
 * NASIL KALİBRE EDİLİR:
 * 1) WorldMapCanvas'ı `calibrationMode` prop'u ile aç.
 * 2) Haritanın üzerinde şehrin olması gereken noktaya dokun.
 * 3) Konsola basılan { id: 'tap', xPct, yPct } değerini buraya kopyala.
 * 4) calibrationMode'u kapat.
 *
 * Aşağıdaki değerler SADECE PLACEHOLDER'DIR — kendi görseline göre
 * kalibrasyon modunu kullanarak güncellemen gerekir.
 */

export interface WorldMapCityPosition {
  id: string;
  xPct: number; // 0-100
  yPct: number; // 0-100
}

// Placeholder — calibrationMode ile turkey-relief.png üzerinde yeniden kalibre et.
export const WORLD_MAP_POSITIONS: Record<string, WorldMapCityPosition> = {
  istanbul: { id: 'istanbul', xPct: 28.9, yPct: 36.8 },
  bursa: { id: 'bursa', xPct: 29.2, yPct: 44.8 },
  ankara: { id: 'ankara', xPct: 42.09, yPct: 45.4 },
  izmir: { id: 'izmir', xPct: 24.4, yPct: 61.1 },
  antalya: { id: 'antalya', xPct: 35.6, yPct: 73.6 },
};

export function getWorldMapCityPosition(cityId: string): WorldMapCityPosition | null {
  return WORLD_MAP_POSITIONS[cityId] ?? null;
}
