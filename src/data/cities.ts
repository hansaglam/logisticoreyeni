/**
 * LogistiCore - Şehir başlangıç verileri
 *
 * Her şehir GDD'deki üretim/tüketim profiline göre yapılandırılmıştır.
 * stock ve targetStock değerleri ilk piyasa dengesini temsil eder;
 * simülasyon ilerledikçe GameState.cities üzerinde güncellenir.
 */

import type { City, CityProductState, ProductId } from '../types/game';
import { PRODUCT_IDS } from './products';

/** Ürün bazlı varsayılan referans fiyatları ($/ton) */
const BASE_PRICES: Record<ProductId, number> = {
  fruit: 900,
  steel: 2000,
  electronics: 3500,
  machinery: 5000,
  textile: 1400,
  furniture: 2200,
  beverage: 800,
};

/**
 * Şehir ürün verisi oluşturur.
 * Üretim/tüketimi olmayan ürünler için stock yalnızca başlangıç tamponu olarak kalır.
 */
function product(
  id: ProductId,
  overrides: Partial<CityProductState> & Pick<CityProductState, 'stock' | 'targetStock' | 'productionPerDay' | 'consumptionPerDay'>,
): CityProductState {
  return {
    basePrice: BASE_PRICES[id],
    ...overrides,
  };
}

/** Başlangıç şehir listesi — GDD Bölüm 6 ve 7'ye göre */
/** Genişletilmiş şehirler: adana (L5), trabzon (L7), diyarbakir (L9) — levelConfig.cityUnlockLevels */
export const CITIES: City[] = [
  // -------------------------------------------------------------------------
  // İzmir — tarım ve tekstil merkezi; elektronik ve makine ithal eder
  // -------------------------------------------------------------------------
  {
    id: 'izmir',
    name: 'İzmir',
    population: 4_200_000,
    industryLevel: 0.65,
    tourismLevel: 0.45,
    agricultureLevel: 0.8,
    productionMultiplier: 1.0,
    demandMultiplier: 1.0,
    fuelPriceModifier: 0.95,
    trafficDifficulty: 0.85,
    warehouseCostModifier: 1.0,
    products: {
      fruit: product('fruit', {
        stock: 500,
        targetStock: 400,
        productionPerDay: 120,
        consumptionPerDay: 40,
      }),
      steel: product('steel', {
        stock: 80,
        targetStock: 100,
        productionPerDay: 10,
        consumptionPerDay: 35,
      }),
      electronics: product('electronics', {
        stock: 70,
        targetStock: 150,
        productionPerDay: 8,
        consumptionPerDay: 55,
      }),
      machinery: product('machinery', {
        stock: 55,
        targetStock: 120,
        productionPerDay: 5,
        consumptionPerDay: 42,
      }),
      textile: product('textile', {
        stock: 300,
        targetStock: 250,
        productionPerDay: 80,
        consumptionPerDay: 45,
      }),
      furniture: product('furniture', {
        stock: 90,
        targetStock: 100,
        productionPerDay: 18,
        consumptionPerDay: 30,
      }),
      beverage: product('beverage', {
        stock: 110,
        targetStock: 120,
        productionPerDay: 22,
        consumptionPerDay: 48,
      }),
    },
  },

  // -------------------------------------------------------------------------
  // İstanbul — ticaret ve sanayi; elektronik/tekstil üretir, gıda ve çelik tüketir
  // -------------------------------------------------------------------------
  {
    id: 'istanbul',
    name: 'İstanbul',
    population: 15_800_000,
    industryLevel: 0.9,
    tourismLevel: 0.75,
    agricultureLevel: 0.2,
    productionMultiplier: 1.15,
    demandMultiplier: 1.25,
    fuelPriceModifier: 1.1,
    trafficDifficulty: 1.0,
    warehouseCostModifier: 1.35,
    products: {
      fruit: product('fruit', {
        stock: 120,
        targetStock: 280,
        productionPerDay: 15,
        consumptionPerDay: 95,
      }),
      steel: product('steel', {
        stock: 90,
        targetStock: 200,
        productionPerDay: 20,
        consumptionPerDay: 85,
      }),
      electronics: product('electronics', {
        stock: 350,
        targetStock: 300,
        productionPerDay: 110,
        consumptionPerDay: 70,
      }),
      machinery: product('machinery', {
        stock: 140,
        targetStock: 160,
        productionPerDay: 45,
        consumptionPerDay: 55,
      }),
      textile: product('textile', {
        stock: 280,
        targetStock: 240,
        productionPerDay: 95,
        consumptionPerDay: 60,
      }),
      furniture: product('furniture', {
        stock: 100,
        targetStock: 130,
        productionPerDay: 25,
        consumptionPerDay: 40,
      }),
      beverage: product('beverage', {
        stock: 200,
        targetStock: 180,
        productionPerDay: 75,
        consumptionPerDay: 65,
      }),
    },
  },

  // -------------------------------------------------------------------------
  // Ankara — savunma ve makine üretimi; gıda ve tekstil tüketir
  // -------------------------------------------------------------------------
  {
    id: 'ankara',
    name: 'Ankara',
    population: 5_700_000,
    industryLevel: 0.78,
    tourismLevel: 0.35,
    agricultureLevel: 0.35,
    productionMultiplier: 1.05,
    demandMultiplier: 1.1,
    fuelPriceModifier: 1.0,
    trafficDifficulty: 0.9,
    warehouseCostModifier: 1.05,
    products: {
      fruit: product('fruit', {
        stock: 100,
        targetStock: 180,
        productionPerDay: 20,
        consumptionPerDay: 70,
      }),
      steel: product('steel', {
        stock: 110,
        targetStock: 130,
        productionPerDay: 35,
        consumptionPerDay: 40,
      }),
      electronics: product('electronics', {
        stock: 220,
        targetStock: 200,
        productionPerDay: 70,
        consumptionPerDay: 45,
      }),
      machinery: product('machinery', {
        stock: 180,
        targetStock: 170,
        productionPerDay: 65,
        consumptionPerDay: 38,
      }),
      textile: product('textile', {
        stock: 95,
        targetStock: 160,
        productionPerDay: 25,
        consumptionPerDay: 72,
      }),
      furniture: product('furniture', {
        stock: 75,
        targetStock: 110,
        productionPerDay: 15,
        consumptionPerDay: 35,
      }),
      beverage: product('beverage', {
        stock: 130,
        targetStock: 150,
        productionPerDay: 30,
        consumptionPerDay: 55,
      }),
    },
  },

  // -------------------------------------------------------------------------
  // Bursa — otomotiv ve tekstil; çelik ve elektronik tüketir
  // -------------------------------------------------------------------------
  {
    id: 'bursa',
    name: 'Bursa',
    population: 3_100_000,
    industryLevel: 0.85,
    tourismLevel: 0.3,
    agricultureLevel: 0.45,
    productionMultiplier: 1.1,
    demandMultiplier: 1.05,
    fuelPriceModifier: 0.98,
    trafficDifficulty: 0.88,
    warehouseCostModifier: 1.0,
    products: {
      fruit: product('fruit', {
        stock: 70,
        targetStock: 100,
        productionPerDay: 25,
        consumptionPerDay: 45,
      }),
      steel: product('steel', {
        stock: 60,
        targetStock: 150,
        productionPerDay: 15,
        consumptionPerDay: 70,
      }),
      electronics: product('electronics', {
        stock: 85,
        targetStock: 140,
        productionPerDay: 20,
        consumptionPerDay: 65,
      }),
      machinery: product('machinery', {
        stock: 200,
        targetStock: 180,
        productionPerDay: 75,
        consumptionPerDay: 42,
      }),
      textile: product('textile', {
        stock: 320,
        targetStock: 260,
        productionPerDay: 90,
        consumptionPerDay: 48,
      }),
      furniture: product('furniture', {
        stock: 65,
        targetStock: 90,
        productionPerDay: 20,
        consumptionPerDay: 28,
      }),
      beverage: product('beverage', {
        stock: 95,
        targetStock: 110,
        productionPerDay: 28,
        consumptionPerDay: 38,
      }),
    },
  },

  // -------------------------------------------------------------------------
  // Antalya — turizm odaklı; içecek, gıda ve mobilya tüketir
  // -------------------------------------------------------------------------
  {
    id: 'antalya',
    name: 'Antalya',
    population: 2_600_000,
    industryLevel: 0.4,
    tourismLevel: 0.95,
    agricultureLevel: 0.55,
    productionMultiplier: 0.85,
    demandMultiplier: 1.2,
    fuelPriceModifier: 1.05,
    trafficDifficulty: 0.75,
    warehouseCostModifier: 1.15,
    products: {
      fruit: product('fruit', {
        stock: 80,
        targetStock: 140,
        productionPerDay: 35,
        consumptionPerDay: 75,
      }),
      steel: product('steel', {
        stock: 40,
        targetStock: 70,
        productionPerDay: 5,
        consumptionPerDay: 25,
      }),
      electronics: product('electronics', {
        stock: 50,
        targetStock: 100,
        productionPerDay: 8,
        consumptionPerDay: 40,
      }),
      machinery: product('machinery', {
        stock: 30,
        targetStock: 60,
        productionPerDay: 3,
        consumptionPerDay: 22,
      }),
      textile: product('textile', {
        stock: 45,
        targetStock: 80,
        productionPerDay: 10,
        consumptionPerDay: 35,
      }),
      furniture: product('furniture', {
        stock: 55,
        targetStock: 130,
        productionPerDay: 12,
        consumptionPerDay: 58,
      }),
      beverage: product('beverage', {
        stock: 70,
        targetStock: 160,
        productionPerDay: 15,
        consumptionPerDay: 82,
      }),
    },
  },

  // -------------------------------------------------------------------------
  // Adana — tarım, gıda, tekstil; güney liman lojistiği
  // -------------------------------------------------------------------------
  {
    id: 'adana',
    name: 'Adana',
    population: 2_250_000,
    industryLevel: 0.55,
    tourismLevel: 0.3,
    agricultureLevel: 0.88,
    productionMultiplier: 0.95,
    demandMultiplier: 1.05,
    fuelPriceModifier: 0.98,
    trafficDifficulty: 0.72,
    warehouseCostModifier: 0.92,
    products: {
      fruit: product('fruit', {
        stock: 420,
        targetStock: 320,
        productionPerDay: 110,
        consumptionPerDay: 45,
      }),
      steel: product('steel', {
        stock: 55,
        targetStock: 90,
        productionPerDay: 12,
        consumptionPerDay: 28,
      }),
      electronics: product('electronics', {
        stock: 45,
        targetStock: 110,
        productionPerDay: 6,
        consumptionPerDay: 38,
      }),
      machinery: product('machinery', {
        stock: 40,
        targetStock: 95,
        productionPerDay: 8,
        consumptionPerDay: 32,
      }),
      textile: product('textile', {
        stock: 260,
        targetStock: 200,
        productionPerDay: 72,
        consumptionPerDay: 40,
      }),
      furniture: product('furniture', {
        stock: 50,
        targetStock: 85,
        productionPerDay: 14,
        consumptionPerDay: 28,
      }),
      beverage: product('beverage', {
        stock: 140,
        targetStock: 130,
        productionPerDay: 38,
        consumptionPerDay: 42,
      }),
    },
  },

  // -------------------------------------------------------------------------
  // Diyarbakır — tarım, gıda, inşaat; bölgesel dağıtım merkezi
  // -------------------------------------------------------------------------
  {
    id: 'diyarbakir',
    name: 'Diyarbakır',
    population: 1_800_000,
    industryLevel: 0.48,
    tourismLevel: 0.25,
    agricultureLevel: 0.82,
    productionMultiplier: 0.88,
    demandMultiplier: 0.95,
    fuelPriceModifier: 1.08,
    trafficDifficulty: 0.68,
    warehouseCostModifier: 0.88,
    products: {
      fruit: product('fruit', {
        stock: 380,
        targetStock: 280,
        productionPerDay: 95,
        consumptionPerDay: 38,
      }),
      steel: product('steel', {
        stock: 70,
        targetStock: 110,
        productionPerDay: 18,
        consumptionPerDay: 32,
      }),
      electronics: product('electronics', {
        stock: 35,
        targetStock: 95,
        productionPerDay: 5,
        consumptionPerDay: 30,
      }),
      machinery: product('machinery', {
        stock: 45,
        targetStock: 100,
        productionPerDay: 10,
        consumptionPerDay: 35,
      }),
      textile: product('textile', {
        stock: 90,
        targetStock: 120,
        productionPerDay: 22,
        consumptionPerDay: 35,
      }),
      furniture: product('furniture', {
        stock: 40,
        targetStock: 75,
        productionPerDay: 10,
        consumptionPerDay: 25,
      }),
      beverage: product('beverage', {
        stock: 85,
        targetStock: 110,
        productionPerDay: 20,
        consumptionPerDay: 38,
      }),
    },
  },

  // -------------------------------------------------------------------------
  // Trabzon — gıda, soğuk zincir, Karadeniz liman lojistiği
  // -------------------------------------------------------------------------
  {
    id: 'trabzon',
    name: 'Trabzon',
    population: 820_000,
    industryLevel: 0.42,
    tourismLevel: 0.55,
    agricultureLevel: 0.72,
    productionMultiplier: 0.82,
    demandMultiplier: 1.08,
    fuelPriceModifier: 1.12,
    trafficDifficulty: 0.78,
    warehouseCostModifier: 1.05,
    products: {
      fruit: product('fruit', {
        stock: 180,
        targetStock: 140,
        productionPerDay: 48,
        consumptionPerDay: 42,
      }),
      steel: product('steel', {
        stock: 35,
        targetStock: 65,
        productionPerDay: 6,
        consumptionPerDay: 22,
      }),
      electronics: product('electronics', {
        stock: 40,
        targetStock: 90,
        productionPerDay: 5,
        consumptionPerDay: 32,
      }),
      machinery: product('machinery', {
        stock: 30,
        targetStock: 70,
        productionPerDay: 4,
        consumptionPerDay: 26,
      }),
      textile: product('textile', {
        stock: 55,
        targetStock: 80,
        productionPerDay: 14,
        consumptionPerDay: 30,
      }),
      furniture: product('furniture', {
        stock: 45,
        targetStock: 90,
        productionPerDay: 10,
        consumptionPerDay: 32,
      }),
      beverage: product('beverage', {
        stock: 95,
        targetStock: 120,
        productionPerDay: 28,
        consumptionPerDay: 48,
      }),
    },
  },
];

/** id → City sözlüğü — GameState başlatırken doğrudan kullanılabilir (derin kopya önerilir) */
export const CITIES_BY_ID: Record<string, City> = Object.fromEntries(
  CITIES.map((city) => [city.id, city]),
);

/** Geçerli şehir kimlikleri */
export const CITY_IDS: string[] = CITIES.map((c) => c.id);

/** Tüm şehirlerin tüm ürünlerini içerdiğini derleme zamanında doğrular */
function assertCityProductCoverage(): void {
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      if (!city.products[productId]) {
        throw new Error(`Şehir "${city.id}" eksik ürün verisi: ${productId}`);
      }
    }
  }
}

assertCityProductCoverage();
