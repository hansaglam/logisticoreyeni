/**
 * LogistiCore - Ürün tanımları
 *
 * Statik ürün meta verileri. Fiyat ve stok bilgileri şehir bazında
 * cities.ts içinde tutulur; burada yalnızca ürün kimliği ve genel özellikler yer alır.
 */

import type { Product, ProductId } from '../types/game';

/** Tüm ürünlerin listesi — sıra UI'da gösterim önceliğini belirler */
export const PRODUCTS: Product[] = [
  {
    id: 'fruit',
    name: 'Meyve',
    weightPerUnit: 1,
    description: 'Taze meyve ve sebze — tarım bölgelerinden tüketim merkezlerine taşınır.',
    perishability: 0.9,
    storageRequirement: {
      preferredWarehouseTypes: ['cold'],
      allowedWarehouseTypes: ['cold', 'standard'],
      spoilageSensitive: true,
      spoilageRatePerDay: 0.08,
      valueLossRatePerDay: 0.1,
    },
  },
  {
    id: 'steel',
    name: 'Çelik',
    weightPerUnit: 2.5,
    description: 'Ham ve işlenmiş çelik — sanayi ve inşaat sektörünün temel girdisi.',
    perishability: 0.05,
    storageRequirement: {
      preferredWarehouseTypes: ['heavy', 'standard'],
      allowedWarehouseTypes: ['heavy', 'standard'],
      spoilageSensitive: false,
      valueLossRatePerDay: 0,
    },
  },
  {
    id: 'electronics',
    name: 'Elektronik',
    weightPerUnit: 0.5,
    description: 'Tüketici ve endüstriyel elektronik ürünler.',
    perishability: 0.15,
    storageRequirement: {
      preferredWarehouseTypes: ['secure', 'standard'],
      allowedWarehouseTypes: ['secure', 'standard'],
      spoilageSensitive: false,
      valueLossRatePerDay: 0.02,
    },
  },
  {
    id: 'machinery',
    name: 'Makine',
    weightPerUnit: 3,
    description: 'Ağır sanayi makineleri ve ekipmanları.',
    perishability: 0.05,
    storageRequirement: {
      preferredWarehouseTypes: ['heavy', 'standard'],
      allowedWarehouseTypes: ['heavy', 'standard', 'secure'],
      spoilageSensitive: false,
      valueLossRatePerDay: 0.01,
    },
  },
  {
    id: 'textile',
    name: 'Tekstil',
    weightPerUnit: 0.8,
    description: 'Kumaş, konfeksiyon ve ev tekstili ürünleri.',
    perishability: 0.2,
    storageRequirement: {
      preferredWarehouseTypes: ['standard'],
      allowedWarehouseTypes: ['standard', 'secure'],
      spoilageSensitive: false,
      valueLossRatePerDay: 0.01,
    },
  },
  {
    id: 'furniture',
    name: 'Mobilya',
    weightPerUnit: 1.5,
    description: 'Ev ve ofis mobilyaları — turizm ve konut talebiyle hareket eder.',
    perishability: 0.1,
    storageRequirement: {
      preferredWarehouseTypes: ['standard'],
      allowedWarehouseTypes: ['standard'],
      spoilageSensitive: false,
      valueLossRatePerDay: 0.005,
    },
  },
  {
    id: 'beverage',
    name: 'İçecek',
    weightPerUnit: 1.2,
    description: 'Alkolsüz içecekler, su ve meşrubat.',
    perishability: 0.75,
    storageRequirement: {
      preferredWarehouseTypes: ['cold'],
      allowedWarehouseTypes: ['cold', 'standard'],
      spoilageSensitive: true,
      spoilageRatePerDay: 0.06,
      valueLossRatePerDay: 0.08,
    },
  },
];

/** Hızlı erişim için id → Product eşlemesi */
export const PRODUCT_BY_ID: Record<ProductId, Product> = PRODUCTS.reduce(
  (acc, product) => {
    acc[product.id] = product;
    return acc;
  },
  {} as Record<ProductId, Product>,
);

/** TypeScript tip güvenliği için tüm ürün kimliklerinin sabit listesi */
export const PRODUCT_IDS: ProductId[] = PRODUCTS.map((p) => p.id);
