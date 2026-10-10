import { Skia, type SkPath } from '@shopify/react-native-skia';

import type { TransportNetworkLod } from '../geo/transportNetwork';
import { edgeVisibleAtLod } from '../geo/transportNetwork';
import { inflateProjectedLine } from '../geo/transportGeometry';
import type { TransportStyleClass } from '../presentation/transportPaint';
import { getRailDebugView } from './transportNetworkLoader';

const batchCache = new Map<string, SkPath | null>();

function batchKey(contentHash: string, lod: TransportNetworkLod, style: TransportStyleClass): string {
  return `${contentHash}:${lod}:${style}`;
}

export function getRailDebugBatchPath(lod: TransportNetworkLod, style: TransportStyleClass): SkPath | null {
  const debug = getRailDebugView();
  const key = batchKey(debug.contentHash, lod, style);
  if (batchCache.has(key)) return batchCache.get(key) ?? null;
  const path = Skia.Path.Make();
  let added = 0;
  for (const edge of debug.edges) {
    if (edge.styleClass !== style) continue;
    if (!edgeVisibleAtLod(edge.networkLod, lod)) continue;
    const points = inflateProjectedLine(edge.projectedQuantized, debug.quantize);
    if (points.length < 2) continue;
    path.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) path.lineTo(points[i].x, points[i].y);
    added += 1;
  }
  const out = added > 0 ? path : null;
  batchCache.set(key, out);
  return out;
}

export const RAIL_DEBUG_STYLE_ORDER: TransportStyleClass[] = ['RAIL_SERVICE', 'RAIL_BRANCH', 'RAIL_MAIN', 'RAIL_UNKNOWN'];
