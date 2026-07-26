import { normalizeCityId } from '../../data/networkPositions';
import type { NetworkFilterKey } from './mapTypes';
import type { MapDetailLevel } from './mapTransformUtils';

export type MapOverlayLayer = 'badge' | 'depot' | 'opportunity' | 'route' | 'truck';

export interface LayerVisibilityContext {
  layer: MapOverlayLayer;
  detailLevel: MapDetailLevel;
  filter: NetworkFilterKey;
  selectedCityId?: string | null;
  cityId?: string;
  isFeaturedOpportunity?: boolean;
}

function isSelectedCity(cityId: string | undefined, selectedCityId: string | null | undefined): boolean {
  if (!cityId || !selectedCityId) return false;
  return normalizeCityId(cityId) === normalizeCityId(selectedCityId);
}

/** Öncelik: seçili filtre → seçili şehir → zoom detail level */
export function isMapLayerVisible(ctx: LayerVisibilityContext): boolean {
  const { layer, detailLevel, filter, selectedCityId, cityId, isFeaturedOpportunity } = ctx;
  const citySelected = isSelectedCity(cityId, selectedCityId);

  if (citySelected && (layer === 'badge' || layer === 'depot' || layer === 'opportunity')) {
    return true;
  }

  switch (filter) {
    case 'depots':
      if (layer === 'depot') return true;
      if (layer === 'route' || layer === 'truck') return true;
      if (layer === 'badge') return detailLevel !== 'low' || citySelected;
      break;
    case 'routes':
      if (layer === 'route' || layer === 'truck') return true;
      if (layer === 'depot' || layer === 'opportunity' || layer === 'badge') return false;
      break;
    case 'opportunities':
      if (layer === 'opportunity') return true;
      if (layer === 'route' || layer === 'truck') return true;
      break;
    case 'trucks':
      if (layer === 'badge') return true;
      if (layer === 'truck') return true;
      if (layer === 'route') return true;
      if (layer === 'depot' || layer === 'opportunity') return false;
      break;
    default:
      break;
  }

  switch (layer) {
    case 'badge':
      return true;
    case 'route':
      return true;
    case 'depot':
      return detailLevel !== 'low';
    case 'opportunity':
      if (detailLevel !== 'low') return true;
      return Boolean(isFeaturedOpportunity);
    case 'truck':
      if (detailLevel === 'high') return true;
      if (detailLevel === 'medium') return true;
      return false;
    default:
      return true;
  }
}

export function getMapLayerOpacity(ctx: LayerVisibilityContext): number {
  if (!isMapLayerVisible(ctx)) return 0;

  const { layer, detailLevel, filter } = ctx;

  if (filter === 'routes' && layer !== 'route' && layer !== 'truck') {
    return 0;
  }
  if (filter === 'trucks' && layer === 'route') {
    return 0.55;
  }
  if ((filter === 'depots' || filter === 'opportunities') && (layer === 'route' || layer === 'truck')) {
    return 0.45;
  }
  if (filter === 'depots' && layer === 'badge') {
    return 0.45;
  }
  if (filter === 'opportunities' && layer !== 'opportunity') {
    return 0.4;
  }

  if (detailLevel === 'low' && layer === 'opportunity' && ctx.isFeaturedOpportunity) {
    return 0.92;
  }

  return 1;
}
