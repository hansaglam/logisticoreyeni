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

  // --- Adana bağlantıları ---
  route('adana', 'ankara', 550, 0.65, 100),
  route('ankara', 'adana', 550, 0.67, 100),
  route('adana', 'antalya', 480, 0.58, 85),
  route('antalya', 'adana', 480, 0.6, 85),
  route('adana', 'istanbul', 940, 0.78, 210),
  route('istanbul', 'adana', 940, 0.8, 210),
  route('adana', 'izmir', 870, 0.72, 175),
  route('izmir', 'adana', 870, 0.74, 175),
  route('adana', 'bursa', 820, 0.7, 165),
  route('bursa', 'adana', 820, 0.72, 165),
  route('adana', 'diyarbakir', 540, 0.62, 95),
  route('diyarbakir', 'adana', 540, 0.64, 95),
  route('adana', 'trabzon', 680, 0.68, 120),
  route('trabzon', 'adana', 680, 0.7, 120),

  // --- Diyarbakır bağlantıları ---
  route('diyarbakir', 'ankara', 980, 0.7, 165),
  route('ankara', 'diyarbakir', 980, 0.72, 165),
  route('diyarbakir', 'istanbul', 1280, 0.82, 240),
  route('istanbul', 'diyarbakir', 1280, 0.84, 240),
  route('diyarbakir', 'izmir', 1180, 0.76, 210),
  route('izmir', 'diyarbakir', 1180, 0.78, 210),
  route('diyarbakir', 'bursa', 1100, 0.74, 195),
  route('bursa', 'diyarbakir', 1100, 0.76, 195),
  route('diyarbakir', 'antalya', 850, 0.68, 145),
  route('antalya', 'diyarbakir', 850, 0.7, 145),
  route('diyarbakir', 'trabzon', 520, 0.64, 90),
  route('trabzon', 'diyarbakir', 520, 0.66, 90),

  // --- Trabzon bağlantıları ---
  route('trabzon', 'ankara', 760, 0.72, 155),
  route('ankara', 'trabzon', 760, 0.74, 155),
  route('trabzon', 'istanbul', 1080, 0.8, 225),
  route('istanbul', 'trabzon', 1080, 0.82, 225),
  route('trabzon', 'izmir', 1180, 0.78, 215),
  route('izmir', 'trabzon', 1180, 0.8, 215),
  route('trabzon', 'bursa', 920, 0.74, 185),
  route('bursa', 'trabzon', 920, 0.76, 185),
  route('trabzon', 'antalya', 920, 0.76, 190),
  route('antalya', 'trabzon', 920, 0.78, 190),
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
