import type { NetworkFilterKey } from './mapTypes';
import type { MapDetailLevel } from './mapTransformUtils';

export type MapOverlayLayer = 'route' | 'truck';

export interface LayerVisibilityContext {
  layer: MapOverlayLayer;
  detailLevel: MapDetailLevel;
  filter: NetworkFilterKey;
}

/**
 * Legacy city/depot/opportunity/badge katmanları kaldırıldı.
 * Yalnızca aktif teslimat rotası ve kamyon overlay’leri kalır.
 * “Depolar” filtresi şimdilik boş placeholder — crash olmadan rota/kamyon gösterir.
 */
export function isMapLayerVisible(ctx: LayerVisibilityContext): boolean {
  const { layer, filter } = ctx;

  switch (filter) {
    case 'trucks':
      return layer === 'truck' || layer === 'route';
    case 'depots':
      // Placeholder filtre: legacy depo ikonu yok; aktif teslimat overlay’leri kalır.
      return layer === 'route' || layer === 'truck';
    default:
      break;
  }

  return layer === 'route' || layer === 'truck';
}

export function getMapLayerOpacity(ctx: LayerVisibilityContext): number {
  if (!isMapLayerVisible(ctx)) return 0;

  const { layer, filter } = ctx;

  if (filter === 'trucks' && layer === 'route') {
    return 0.55;
  }

  return 1;
}
