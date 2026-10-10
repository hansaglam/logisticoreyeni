import type { CountryGameplayAvailability } from '../gameplay/mapV2CountryAvailability.fixture';
import { worldToScreen } from '../geo/worldCamera';
import { ringAreaAbs } from '../geo/geometry';
import { dequantizePolygons } from '../geo/worldBoundaryPackage';
import type { WorldCountryRecord } from '../geo/worldBoundaryPackage';
import { getCountryLabelAnchor } from '../geo/countryLabelAnchor';
import { resolveCountryDisplayName, type MapV2NameLocale } from './countryDisplayName';

export const WORLD_LABEL_TIERS = ['WORLD_LABEL_MAJOR', 'WORLD_LABEL_MEDIUM', 'WORLD_LABEL_DETAIL'] as const;
export type WorldLabelTier = (typeof WORLD_LABEL_TIERS)[number];

export type WorldCountryLabel = {
  geoCountryId: string;
  displayName: string;
  projectedAnchor: { x: number; y: number };
  priority: number;
  minZoomTier: WorldLabelTier;
  gameplayState: CountryGameplayAvailability;
};

export const WORLD_LABEL_HYSTERESIS = {
  enterMedium: 1.38,
  exitMedium: 1.24,
  enterDetail: 2.15,
  exitDetail: 1.92,
} as const;

export const WORLD_LABEL_MAX: Record<WorldLabelTier, number> = {
  WORLD_LABEL_MAJOR: 16,
  WORLD_LABEL_MEDIUM: 32,
  WORLD_LABEL_DETAIL: 52,
};

const TIER_RANK: Record<WorldLabelTier, number> = {
  WORLD_LABEL_MAJOR: 0,
  WORLD_LABEL_MEDIUM: 1,
  WORLD_LABEL_DETAIL: 2,
};

export function worldLabelTierForRelativeZoom(relZoom: number, previous: WorldLabelTier): WorldLabelTier {
  if (previous === 'WORLD_LABEL_MAJOR') {
    if (relZoom >= WORLD_LABEL_HYSTERESIS.enterMedium) return 'WORLD_LABEL_MEDIUM';
    return 'WORLD_LABEL_MAJOR';
  }
  if (previous === 'WORLD_LABEL_MEDIUM') {
    if (relZoom < WORLD_LABEL_HYSTERESIS.exitMedium) return 'WORLD_LABEL_MAJOR';
    if (relZoom >= WORLD_LABEL_HYSTERESIS.enterDetail) return 'WORLD_LABEL_DETAIL';
    return 'WORLD_LABEL_MEDIUM';
  }
  if (relZoom < WORLD_LABEL_HYSTERESIS.exitDetail) return 'WORLD_LABEL_MEDIUM';
  return 'WORLD_LABEL_DETAIL';
}

export function worldLabelPriority(
  availability: CountryGameplayAvailability,
  selected: boolean,
  area: number,
): number {
  let score = area * 1_000_000;
  if (availability === 'NOT_GAMEPLAY_SUPPORTED') score += 100_000;
  else if (availability === 'LOCKED') score += 300_000;
  else if (availability === 'UNLOCKED') score += 400_000;
  else score += 500_000;
  if (selected) score += 1_000_000_000;
  return score;
}

export function worldLabelMinTier(availability: CountryGameplayAvailability, area: number): WorldLabelTier {
  if (availability === 'STARTER_AVAILABLE') return 'WORLD_LABEL_MAJOR';
  if (availability === 'UNLOCKED' && area >= 0.0008) return 'WORLD_LABEL_MAJOR';
  if (area >= 0.012) return 'WORLD_LABEL_MAJOR';
  if (area >= 0.0025) return 'WORLD_LABEL_MEDIUM';
  return 'WORLD_LABEL_DETAIL';
}

const areaCache = new Map<string, number>();

export function mainLandmassArea(country: WorldCountryRecord): number {
  const hit = areaCache.get(country.geoCountryId);
  if (hit != null) return hit;
  const overall = country.lods.WORLD_LOW.projectedBounds;
  const spanX = overall.maxX - overall.minX;
  const spanY = overall.maxY - overall.minY;
  let area: number;
  if (spanX < 0.4 && spanY < 0.4) {
    area = Math.max(spanX * spanY, 1e-12);
  } else {
    const polygons = dequantizePolygons(country.lods.WORLD_LOW.polygons);
    let best = 0;
    for (const polygon of polygons) {
      best = Math.max(best, ringAreaAbs(polygon.exterior));
    }
    area = Math.max(best, 1e-12);
  }
  areaCache.set(country.geoCountryId, area);
  return area;
}

export function estimateLabelWidthPx(displayName: string): number {
  return displayName.length * 6.4 + 10;
}

export function labelAabb(
  screenX: number,
  screenY: number,
  displayName: string,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const w = estimateLabelWidthPx(displayName);
  const h = 13;
  return { minX: screenX - w / 2, minY: screenY - h - 2, maxX: screenX + w / 2, maxY: screenY + 4 };
}

function aabbOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

export function buildWorldCountryLabel(
  country: WorldCountryRecord,
  availability: CountryGameplayAvailability,
  selected: boolean,
  locale: MapV2NameLocale,
): WorldCountryLabel {
  const area = mainLandmassArea(country);
  const anchor = getCountryLabelAnchor(country);
  return {
    geoCountryId: country.geoCountryId,
    displayName: resolveCountryDisplayName(country, locale),
    projectedAnchor: anchor.projected,
    priority: worldLabelPriority(availability, selected, area),
    minZoomTier: worldLabelMinTier(availability, area),
    gameplayState: availability,
  };
}

export function selectWorldCountryLabels(input: {
  labels: WorldCountryLabel[];
  viewTier: WorldLabelTier;
  translateX: number;
  translateY: number;
  scale: number;
  clip: { minX: number; minY: number; maxX: number; maxY: number };
}): WorldCountryLabel[] {
  const viewRank = TIER_RANK[input.viewTier];
  const eligible = input.labels
    .filter((label) => TIER_RANK[label.minZoomTier] <= viewRank)
    .sort((a, b) => b.priority - a.priority);
  const placed: WorldCountryLabel[] = [];
  const boxes: Array<ReturnType<typeof labelAabb>> = [];
  const max = WORLD_LABEL_MAX[input.viewTier];
  for (const label of eligible) {
    if (placed.length >= max) break;
    const screen = worldToScreen(
      label.projectedAnchor.x,
      label.projectedAnchor.y,
      input.translateX,
      input.translateY,
      input.scale,
    );
    const box = labelAabb(screen.x, screen.y, label.displayName);
    if (box.minX < input.clip.minX || box.maxX > input.clip.maxX || box.minY < input.clip.minY || box.maxY > input.clip.maxY) {
      continue;
    }
    if (boxes.some((other) => aabbOverlap(box, other))) continue;
    placed.push(label);
    boxes.push(box);
  }
  return placed;
}
