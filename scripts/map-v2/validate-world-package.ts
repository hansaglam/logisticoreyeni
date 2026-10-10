import { createHash } from 'node:crypto';

import { GEOMETRY_LOD_IDS } from '../../src/mapV2/geo/geometry';
import {
  MAX_PLAUSIBLE_RENDER_SEGMENT_DX,
  POLAR_RENDER_POLICY,
  WEB_MERCATOR_LAYER_INCLUDED,
  WEB_MERCATOR_LAYER_OMITTED_POLAR,
} from '../../src/mapV2/geo/polarPolicy';
import type { WorldBoundaryPackageV1 } from '../../src/mapV2/geo/worldBoundaryPackage';
import { dequantizePolygons } from '../../src/mapV2/geo/worldBoundaryPackage';

export type WorldPackageValidationIssue = {
  code: string;
  geoCountryId?: string;
  detail: string;
};

export function validateWorldBoundaryPackage(pkg: WorldBoundaryPackageV1): WorldPackageValidationIssue[] {
  const issues: WorldPackageValidationIssue[] = [];
  if (pkg.schemaVersion !== 1) {
    issues.push({ code: 'schema', detail: `schemaVersion ${pkg.schemaVersion}` });
  }
  if (pkg.projection.id !== 'WEB_MERCATOR' || pkg.projection.epsg !== 3857) {
    issues.push({ code: 'projection', detail: 'expected WEB_MERCATOR epsg 3857' });
  }
  if (pkg.polarRenderPolicy !== POLAR_RENDER_POLICY) {
    issues.push({ code: 'polar-policy', detail: String(pkg.polarRenderPolicy) });
  }
  if (pkg.sourceCountryCount !== pkg.countries.length) {
    issues.push({ code: 'source-count', detail: `${pkg.sourceCountryCount} vs ${pkg.countries.length}` });
  }
  const rendered = pkg.countries.filter((c) => c.webMercatorLayer === WEB_MERCATOR_LAYER_INCLUDED);
  const omitted = pkg.countries.filter((c) => c.webMercatorLayer === WEB_MERCATOR_LAYER_OMITTED_POLAR);
  if (pkg.renderedCountryCount !== rendered.length) {
    issues.push({ code: 'rendered-count', detail: `${pkg.renderedCountryCount} vs ${rendered.length}` });
  }
  if (pkg.omittedPolarFeatures.length !== omitted.length) {
    issues.push({
      code: 'omitted-count',
      detail: `${pkg.omittedPolarFeatures.length} vs ${omitted.length}`,
    });
  }
  const omittedIds = new Set(pkg.omittedPolarFeatures.map((f) => f.geoCountryId));
  for (const country of omitted) {
    if (!omittedIds.has(country.geoCountryId)) {
      issues.push({
        code: 'omitted-missing-provenance',
        geoCountryId: country.geoCountryId,
        detail: 'omitted country not listed in omittedPolarFeatures',
      });
    }
  }
  if (pkg.sourceManifest.geoBoundariesReleaseType !== 'gbOpen') {
    issues.push({ code: 'source', detail: 'geoBoundariesReleaseType must be gbOpen' });
  }
  if (pkg.sourceManifest.productionApproved) {
    issues.push({ code: 'approval', detail: 'world package must remain productionApproved false until Map V2 ships' });
  }
  const ids = new Set<string>();
  for (const country of pkg.countries) {
    if (ids.has(country.geoCountryId)) {
      issues.push({ code: 'duplicate-id', geoCountryId: country.geoCountryId, detail: 'duplicate geoCountryId' });
    }
    ids.add(country.geoCountryId);
    for (const lod of GEOMETRY_LOD_IDS) {
      const geom = country.lods[lod];
      if (!geom) {
        issues.push({ code: 'empty-lod', geoCountryId: country.geoCountryId, detail: lod });
        continue;
      }
      if (country.webMercatorLayer === WEB_MERCATOR_LAYER_OMITTED_POLAR) {
        if (geom.polygons.length !== 0) {
          issues.push({
            code: 'omitted-has-render-geometry',
            geoCountryId: country.geoCountryId,
            detail: lod,
          });
        }
        continue;
      }
      if (geom.polygons.length === 0) {
        issues.push({ code: 'empty-lod', geoCountryId: country.geoCountryId, detail: lod });
        continue;
      }
      const decoded = dequantizePolygons(geom.polygons);
      for (const polygon of decoded) {
        const ring = polygon.exterior;
        for (let i = 0; i < ring.length; i += 1) {
          const p = ring[i];
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            issues.push({ code: 'non-finite', geoCountryId: country.geoCountryId, detail: lod });
          }
          if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
            issues.push({ code: 'out-of-world', geoCountryId: country.geoCountryId, detail: lod });
          }
          if (i + 1 < ring.length) {
            const dx = Math.abs(ring[i + 1].x - p.x);
            if (dx >= MAX_PLAUSIBLE_RENDER_SEGMENT_DX) {
              issues.push({
                code: 'dateline-span',
                geoCountryId: country.geoCountryId,
                detail: `${lod} dx=${dx}`,
              });
            }
          }
        }
      }
    }
  }
  return issues;
}

export function hashCanonicalPackage(pkg: Omit<WorldBoundaryPackageV1, 'contentHash'>): `sha256:${string}` {
  const json = JSON.stringify(pkg);
  return `sha256:${createHash('sha256').update(json).digest('hex')}`;
}
