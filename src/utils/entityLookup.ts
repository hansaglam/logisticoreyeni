/**
 * Runtime-safe entity lookup helpers.
 * Eski save veya bozuk market verisinde bilinmeyen id'ler uygulamayı çökertmez.
 */

import { CITIES_BY_ID } from '../data/cities';
import { PRODUCT_BY_ID } from '../data/products';
import { ROUTES_BY_ID } from '../data/routes';
import type { City, Product, ProductId, Route } from '../types/game';

const warnedUnknownProducts = new Set<string>();
const warnedUnknownCities = new Set<string>();
const warnedUnknownRoutes = new Set<string>();

function warnOnce(kind: 'product' | 'city' | 'route', id: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }

  const warnedSets = {
    product: warnedUnknownProducts,
    city: warnedUnknownCities,
    route: warnedUnknownRoutes,
  };
  const warned = warnedSets[kind];
  if (warned.has(id)) {
    return;
  }
  warned.add(id);
  console.warn(`[lookup] Unknown ${kind}Id`, id);
}

export function isProductId(value: string): value is ProductId {
  if (!value || typeof value !== 'string') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(PRODUCT_BY_ID, value);
}

export function getProductByIdSafe(productId?: string | null): Product | null {
  if (!productId) {
    return null;
  }
  if (!isProductId(productId)) {
    warnOnce('product', productId);
    return null;
  }
  return PRODUCT_BY_ID[productId];
}

export function getProductName(productId?: string | null): string {
  return getProductByIdSafe(productId)?.name ?? 'Bilinmeyen ürün';
}

export function isCityId(value: string): boolean {
  return value in CITIES_BY_ID;
}

export function getCityByIdSafe(cityId?: string | null): City | null {
  if (!cityId) {
    return null;
  }
  const city = CITIES_BY_ID[cityId];
  if (!city) {
    warnOnce('city', cityId);
    return null;
  }
  return city;
}

export function getCityName(cityId?: string | null): string {
  return getCityByIdSafe(cityId)?.name ?? 'Bilinmeyen şehir';
}

export function getRouteByIdSafe(routeId?: string | null): Route | null {
  if (!routeId) {
    return null;
  }
  const route = ROUTES_BY_ID[routeId];
  if (!route) {
    warnOnce('route', routeId);
    return null;
  }
  return route;
}

export function getRouteBetweenCitiesSafe(
  fromCityId?: string | null,
  toCityId?: string | null,
): Route | null {
  if (!fromCityId || !toCityId) {
    return null;
  }
  return getRouteByIdSafe(`${fromCityId}-${toCityId}`);
}
