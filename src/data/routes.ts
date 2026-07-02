/**
 * LogistiCore - Rota tanımları
 *
 * Şehir çiftleri arasındaki mesafe, zorluk ve geçiş ücretleri.
 * Mesafeler karayolu yaklaşık değerleridir; zorluk trafik ve arazi etkisini temsil eder.
 */

import type { Route } from '../types/game';
import { CITY_IDS } from './cities';

/** Rota oluşturma yardımcısı — tekrarlayan alanları standartlaştırır */
function route(
  fromCityId: string,
  toCityId: string,
  distanceKm: number,
  difficulty: number,
  tollCost: number,
): Route {
  return {
    id: `${fromCityId}-${toCityId}`,
    fromCityId,
    toCityId,
    distanceKm,
    difficulty,
    tollCost,
  };
}

/**
 * Tüm yönlü rotalar.
 * A→B ve B→A ayrı kayıtlardır; tollCost ve difficulty yön farkına göre değişebilir.
 */
export const ROUTES: Route[] = [
  // --- İzmir bağlantıları ---
  route('izmir', 'istanbul', 480, 0.82, 180),
  route('istanbul', 'izmir', 480, 0.85, 180),
  route('izmir', 'ankara', 585, 0.7, 120),
  route('ankara', 'izmir', 585, 0.72, 120),
  route('izmir', 'bursa', 410, 0.65, 90),
  route('bursa', 'izmir', 410, 0.65, 90),
  route('izmir', 'antalya', 455, 0.55, 75),
  route('antalya', 'izmir', 455, 0.58, 75),

  // --- İstanbul bağlantıları ---
  route('istanbul', 'ankara', 450, 0.88, 200),
  route('ankara', 'istanbul', 450, 0.9, 200),
  route('istanbul', 'bursa', 155, 0.92, 150),
  route('bursa', 'istanbul', 155, 0.9, 150),
  route('istanbul', 'antalya', 715, 0.8, 220),
  route('antalya', 'istanbul', 715, 0.82, 220),

  // --- Ankara bağlantıları ---
  route('ankara', 'bursa', 385, 0.68, 85),
  route('bursa', 'ankara', 385, 0.7, 85),
  route('ankara', 'antalya', 545, 0.62, 95),
  route('antalya', 'ankara', 545, 0.65, 95),

  // --- Bursa – Antalya ---
  route('bursa', 'antalya', 660, 0.72, 110),
  route('antalya', 'bursa', 660, 0.74, 110),
];

/** id → Route sözlüğü */
export const ROUTES_BY_ID: Record<string, Route> = Object.fromEntries(
  ROUTES.map((r) => [r.id, r]),
);

/**
 * İki şehir arasındaki rotayı döndürür.
 * Tanımsız çift için undefined döner — simülasyon yeni rota ekleyebilir.
 */
export function getRoute(fromCityId: string, toCityId: string): Route | undefined {
  return ROUTES_BY_ID[`${fromCityId}-${toCityId}`];
}

/** Belirli bir şehirden çıkan tüm rotalar */
export function getRoutesFrom(cityId: string): Route[] {
  return ROUTES.filter((r) => r.fromCityId === cityId);
}

/** Tanımlı rotaların kapsadığı benzersiz şehir çifti sayısını doğrular */
function assertRouteCoverage(): void {
  const expectedPairs = (CITY_IDS.length * (CITY_IDS.length - 1)) / 2;
  const uniquePairs = new Set(
    ROUTES.map((r) => [r.fromCityId, r.toCityId].sort().join('|')),
  );
  if (uniquePairs.size !== expectedPairs) {
    throw new Error(
      `Rota kapsamı eksik: ${uniquePairs.size}/${expectedPairs} şehir çifti tanımlı`,
    );
  }
}

assertRouteCoverage();
