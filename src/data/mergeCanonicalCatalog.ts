/**
 * Ensures persisted save catalogs include every canonical city/route.
 * Old saves created before city expansion only store the starter five cities.
 */

import type { City, CityProductState, ProductId, Route } from '../types/game';
import { CITIES } from './cities';
import { normalizeCityId } from './networkPositions';
import { ROUTES } from './routes';

function cloneCanonicalCity(city: City): City {
  return structuredClone(city);
}

/** Saved market overrides layered on canonical city product defaults. */
function mergeCityProducts(
  canonicalProducts: City['products'],
  savedProducts: City['products'] | undefined,
): City['products'] {
  if (!savedProducts || Object.keys(savedProducts).length === 0) {
    return canonicalProducts;
  }

  const merged = { ...canonicalProducts };
  for (const [rawProductId, savedState] of Object.entries(savedProducts)) {
    if (!savedState) continue;
    const productId = rawProductId as ProductId;
    const base = merged[productId];
    if (!base) {
      merged[productId] = savedState as CityProductState;
      continue;
    }
    merged[productId] = {
      ...base,
      ...savedState,
      priceHistory: savedState.priceHistory ?? base.priceHistory,
    };
  }
  return merged;
}

/**
 * Keep saved market state for known cities; append any missing canonical cities.
 * Order follows CITIES (source of truth). Extra unknown save cities are appended.
 */
export function mergeCanonicalCities(saved: City[] | undefined | null): City[] {
  const byId = new Map<string, City>();
  for (const city of saved ?? []) {
    if (!city?.id) continue;
    byId.set(normalizeCityId(city.id), city);
  }

  const merged: City[] = [];
  for (const canonical of CITIES) {
    const id = normalizeCityId(canonical.id);
    const existing = byId.get(id);
    if (existing) {
      merged.push({
        ...cloneCanonicalCity(canonical),
        products: mergeCityProducts(canonical.products, existing.products),
      });
      byId.delete(id);
    } else {
      merged.push(cloneCanonicalCity(canonical));
    }
  }

  for (const leftover of byId.values()) {
    merged.push(leftover);
  }

  return merged;
}

/** Keep saved routes; append any missing canonical directed routes by id. */
export function mergeCanonicalRoutes(saved: Route[] | undefined | null): Route[] {
  const byId = new Map<string, Route>();
  for (const route of saved ?? []) {
    if (!route?.id) continue;
    byId.set(route.id, route);
  }

  const merged: Route[] = [];
  for (const canonical of ROUTES) {
    const existing = byId.get(canonical.id);
    if (existing) {
      merged.push(existing);
      byId.delete(canonical.id);
    } else {
      merged.push({ ...canonical });
    }
  }

  for (const leftover of byId.values()) {
    merged.push(leftover);
  }

  return merged;
}

export function catalogNeedsCanonicalMerge(
  cities: City[] | undefined | null,
  routes: Route[] | undefined | null,
): boolean {
  const cityIds = new Set((cities ?? []).map((c) => normalizeCityId(c.id)));
  for (const id of CITIES.map((c) => normalizeCityId(c.id))) {
    if (!cityIds.has(id)) return true;
  }

  const routeIds = new Set((routes ?? []).map((r) => r.id));
  for (const route of ROUTES) {
    if (!routeIds.has(route.id)) return true;
  }

  return false;
}
