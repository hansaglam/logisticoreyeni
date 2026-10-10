/**
 * Ingest geoBoundaries gbOpen ADM0 simplified GeoJSON into a bundled Map V2 world package.
 * Raw downloads stay in data/map-raw/ (gitignored). Generated package is written to src/mapV2/generated/world/.
 *
 * Run: npx tsx scripts/map-v2/ingest-world-boundaries.ts
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { MapSourceManifest } from '../../src/mapData/mapSourcePolicy';
import {
  GEOMETRY_LOD_IDS,
  boundsOfPolygons,
  projectGeoJsonGeometry,
  type ProjectedPolygon,
} from '../../src/mapV2/geo/geometry';
import { RING_WINDING_CONVENTION } from '../../src/mapV2/geo/geometry';
import {
  POLAR_RENDER_POLICY,
  WEB_MERCATOR_LAYER_INCLUDED,
  WEB_MERCATOR_LAYER_OMITTED_POLAR,
  polarOmitReason,
  type OmittedPolarFeature,
} from '../../src/mapV2/geo/polarPolicy';
import { WEB_MERCATOR_PROJECTION_META, WEB_MERCATOR_PROJECTION_VERSION } from '../../src/mapV2/geo/webMercator';
import {
  WORLD_BOUNDARY_PACKAGE_SCHEMA_VERSION,
  WORLD_BOUNDARY_QUANTIZE,
  quantizePolygons,
  type WorldBoundaryBuildMeta,
  type WorldBoundaryPackageV1,
  type WorldCountryRecord,
} from '../../src/mapV2/geo/worldBoundaryPackage';
import {
  GEOBOUNDARIES_API_URL,
  GEOBOUNDARIES_LICENSE,
  GEOBOUNDARIES_LICENSE_URL,
  GEOBOUNDARIES_RELEASE_COMMIT,
  GEOBOUNDARIES_SOURCE_NAME,
  MAP_V2_SIMPLIFICATION_CONFIG_VERSION,
  MAP_V2_WORLD_PROCESSING_VERSION,
} from './config';
import { simplifyCountryPolygons } from './simplify-geometry';
import { hashCanonicalPackage, validateWorldBoundaryPackage } from './validate-world-package';

const root = resolve(__dirname, '../..');
const rawDir = resolve(root, 'data/map-raw/geoboundaries/gbOpen-ADM0-simplified');
const apiPath = resolve(root, 'data/map-raw/geoboundaries/gbOpen-ALL-ADM0-api.json');
const outDir = resolve(root, 'src/mapV2/generated/world');

type GbOpenEntry = {
  boundaryID: string;
  boundaryName: string;
  boundaryISO: string;
  boundaryLicense: string;
  boundaryType: string;
  buildDate: string;
  simplifiedGeometryGeoJSON: string;
  gjDownloadURL: string;
};

function sha256Bytes(buf: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function ensureApiIndex(): Promise<GbOpenEntry[]> {
  await mkdir(dirname(apiPath), { recursive: true });
  if (!existsSync(apiPath)) {
    const buf = await fetchBuffer(GEOBOUNDARIES_API_URL);
    await writeFile(apiPath, buf);
  }
  const parsed = JSON.parse(await readFile(apiPath, 'utf8')) as GbOpenEntry[];
  if (!Array.isArray(parsed) || parsed.length < 100) {
    throw new Error('geoBoundaries API index unexpected');
  }
  return parsed;
}

async function downloadSimplified(entries: GbOpenEntry[]): Promise<string[]> {
  await mkdir(rawDir, { recursive: true });
  const hashes: string[] = [];
  const queue = [...entries];
  const workers = 8;
  async function worker() {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) return;
      const dest = resolve(rawDir, `${entry.boundaryID}.geojson`);
      if (!existsSync(dest)) {
        const buf = await fetchBuffer(entry.simplifiedGeometryGeoJSON);
        await writeFile(dest, buf);
      }
      const buf = await readFile(dest);
      hashes.push(sha256Bytes(buf));
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return hashes.sort();
}

function iso3FromSource(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(trimmed)) return trimmed;
  return undefined;
}

function assignIds(entries: { iso3?: string; sourceFeatureId: string }[]): Map<string, { geoCountryId: string; status: 'RESOLVED' | 'UNRESOLVED' }> {
  const used = new Map<string, number>();
  const out = new Map<string, { geoCountryId: string; status: 'RESOLVED' | 'UNRESOLVED' }>();
  for (const entry of entries) {
    if (!entry.iso3) {
      out.set(entry.sourceFeatureId, {
        geoCountryId: `country.unresolved.${entry.sourceFeatureId.toLowerCase()}`,
        status: 'UNRESOLVED',
      });
      continue;
    }
    const base = `country.${entry.iso3.toLowerCase()}`;
    const seen = used.get(entry.iso3) ?? 0;
    used.set(entry.iso3, seen + 1);
    if (seen === 0) {
      out.set(entry.sourceFeatureId, { geoCountryId: base, status: 'RESOLVED' });
    } else {
      out.set(entry.sourceFeatureId, {
        geoCountryId: `${base}__${entry.sourceFeatureId.toLowerCase()}`,
        status: 'UNRESOLVED',
      });
    }
  }
  return out;
}

function emptyLods(): WorldCountryRecord['lods'] {
  const lods = {} as WorldCountryRecord['lods'];
  for (const lod of GEOMETRY_LOD_IDS) {
    lods[lod] = {
      lod,
      polygons: [],
      projectedBounds: { minX: 2, minY: 2, maxX: 2, maxY: 2 },
      polygonCount: 0,
      vertexCount: 0,
    };
  }
  return lods;
}

function vertexCount(polygons: ProjectedPolygon[]): number {
  let n = 0;
  for (const polygon of polygons) {
    n += polygon.exterior.length;
    for (const hole of polygon.holes) n += hole.length;
  }
  return n;
}

async function main() {
  console.log('Loading geoBoundaries gbOpen ADM0 API index…');
  const entries = await ensureApiIndex();
  const adm0 = entries.filter((e) => e.boundaryType === 'ADM0');
  console.log(`ADM0 entries: ${adm0.length}`);
  const fileHashes = await downloadSimplified(adm0);
  const combinedSourceHash = sha256Bytes(Buffer.from(fileHashes.join('\n'), 'utf8'));

  const idPlan = assignIds(
    adm0.map((e) => ({
      iso3: iso3FromSource(e.boundaryISO),
      sourceFeatureId: e.boundaryID,
    })),
  );

  const countries: WorldCountryRecord[] = [];
  const unresolvedIdentities: string[] = [];
  const omittedPolarFeatures: OmittedPolarFeature[] = [];

  for (const entry of adm0) {
    const dest = resolve(rawDir, `${entry.boundaryID}.geojson`);
    const gj = JSON.parse(await readFile(dest, 'utf8')) as {
      type: string;
      features?: Array<{ geometry: { type: string; coordinates: unknown }; properties?: Record<string, unknown> }>;
      geometry?: { type: string; coordinates: unknown };
    };
    const feature = gj.type === 'FeatureCollection' ? gj.features?.[0] : gj;
    const geometry = (feature as { geometry?: { type: string; coordinates: unknown } })?.geometry;
    if (!geometry) {
      throw new Error(`No geometry for ${entry.boundaryID}`);
    }
    const ids = idPlan.get(entry.boundaryID);
    if (!ids) throw new Error(`missing id plan ${entry.boundaryID}`);
    if (ids.status === 'UNRESOLVED') unresolvedIdentities.push(ids.geoCountryId);
    const iso3 = iso3FromSource(entry.boundaryISO);
    const omitReason = polarOmitReason(geometry);

    if (omitReason) {
      omittedPolarFeatures.push({
        geoCountryId: ids.geoCountryId,
        sourceFeatureId: entry.boundaryID,
        sourceDisplayName: entry.boundaryName,
        sourceIso3: iso3,
        reason: omitReason,
      });
      countries.push({
        geoCountryId: ids.geoCountryId,
        identityStatus: ids.status,
        sourceFeatureId: entry.boundaryID,
        sourceIso3: iso3,
        sourceDisplayName: entry.boundaryName,
        notes: omitReason,
        webMercatorLayer: WEB_MERCATOR_LAYER_OMITTED_POLAR,
        lods: emptyLods(),
      });
      continue;
    }

    const projected = projectGeoJsonGeometry(geometry);
    if (projected.length === 0) {
      throw new Error(`Empty projected geometry for ${entry.boundaryID}`);
    }

    const lods = {} as WorldCountryRecord['lods'];
    for (const lod of GEOMETRY_LOD_IDS) {
      const simplified = simplifyCountryPolygons(projected, lod);
      const bounds = boundsOfPolygons(simplified);
      if (!bounds) throw new Error(`no bounds ${entry.boundaryID} ${lod}`);
      lods[lod] = {
        lod,
        polygons: quantizePolygons(simplified),
        projectedBounds: bounds,
        polygonCount: simplified.length,
        vertexCount: vertexCount(simplified),
      };
    }

    countries.push({
      geoCountryId: ids.geoCountryId,
      identityStatus: ids.status,
      sourceFeatureId: entry.boundaryID,
      sourceIso3: iso3,
      sourceDisplayName: entry.boundaryName,
      notes: ids.status === 'UNRESOLVED' ? 'duplicate-or-missing-iso3' : undefined,
      webMercatorLayer: WEB_MERCATOR_LAYER_INCLUDED,
      lods,
    });
  }

  countries.sort((a, b) => a.geoCountryId.localeCompare(b.geoCountryId));

  const retrievedAt = '2023-12-12';
  const sourceManifest: MapSourceManifest = {
    policyVersion: 1,
    datasetId: 'geoboundaries.gbopen.adm0.simplified.world',
    datasetType: 'administrative-boundary',
    sourceName: GEOBOUNDARIES_SOURCE_NAME,
    sourceURL: GEOBOUNDARIES_API_URL,
    license: GEOBOUNDARIES_LICENSE,
    licenseURL: GEOBOUNDARIES_LICENSE_URL,
    sourceVersion: `gbOpen-ADM0-git-${GEOBOUNDARIES_RELEASE_COMMIT}`,
    retrievedAt,
    sourceHash: combinedSourceHash,
    originalFormat: 'GeoJSON',
    processedFormat: 'WorldBoundaryPackageV1-quantized',
    processingVersion: MAP_V2_WORLD_PROCESSING_VERSION,
    derivedFrom: [],
    attributionRequired: true,
    productionApproved: false,
    geoBoundariesReleaseType: 'gbOpen',
    notes:
      'World administrative boundaries from geoBoundaries gbOpen ADM0 simplified GeoJSON (API current ALL/ADM0, git pin 9469f09, dataset buildDate Dec 12, 2023). retrievedAt is the upstream build date, not the local download clock. Web Mercator polar policy OMIT_UNREPRESENTABLE_POLAR_FEATURE: source features remain in the package; pole-enclosing geometry is not projected into the interactive layer. Not a production MapData release. Renderer must not decide disputed borders. Attribution: geoBoundaries / CC BY 4.0.',
  };

  const renderedCountryCount = countries.filter((c) => c.webMercatorLayer === WEB_MERCATOR_LAYER_INCLUDED).length;
  const unsigned: Omit<WorldBoundaryPackageV1, 'contentHash'> = {
    schemaVersion: WORLD_BOUNDARY_PACKAGE_SCHEMA_VERSION,
    packageId: 'world-boundaries-gbopen-adm0-v1',
    projection: WEB_MERCATOR_PROJECTION_META,
    polarRenderPolicy: POLAR_RENDER_POLICY,
    sourceCountryCount: countries.length,
    renderedCountryCount,
    omittedPolarFeatures,
    sourceManifest,
    transformation: {
      processingVersion: MAP_V2_WORLD_PROCESSING_VERSION,
      projectionVersion: WEB_MERCATOR_PROJECTION_VERSION,
      simplificationConfigVersion: MAP_V2_SIMPLIFICATION_CONFIG_VERSION,
      winding: RING_WINDING_CONVENTION,
      quantize: WORLD_BOUNDARY_QUANTIZE,
      polarRenderPolicy: POLAR_RENDER_POLICY,
    },
    unresolvedIdentities,
    countries,
  };

  const contentHash = hashCanonicalPackage(unsigned);
  const pkg: WorldBoundaryPackageV1 = { ...unsigned, contentHash };
  const issues = validateWorldBoundaryPackage(pkg);
  if (issues.length > 0) {
    console.error(issues.slice(0, 20));
    throw new Error(`package validation failed: ${issues.length} issues`);
  }

  await mkdir(outDir, { recursive: true });
  const pkgPath = resolve(outDir, 'worldBoundaryPackage.json');
  const json = JSON.stringify(pkg);
  await writeFile(pkgPath, json);

  const stats: WorldBoundaryBuildMeta = {
    generatedAt: new Date().toISOString(),
    contentHash,
    stats: {
      countries: countries.length,
      sourceCountryCount: countries.length,
      renderedCountryCount,
      omittedPolarFeatures: omittedPolarFeatures.length,
      unresolvedIdentities: unresolvedIdentities.length,
      packageBytes: Buffer.byteLength(json),
      WORLD_LOW_vertices: countries.reduce((s, c) => s + c.lods.WORLD_LOW.vertexCount, 0),
      WORLD_MEDIUM_vertices: countries.reduce((s, c) => s + c.lods.WORLD_MEDIUM.vertexCount, 0),
      COUNTRY_HIGH_vertices: countries.reduce((s, c) => s + c.lods.COUNTRY_HIGH.vertexCount, 0),
      WORLD_LOW_polygons: countries.reduce((s, c) => s + c.lods.WORLD_LOW.polygonCount, 0),
      WORLD_MEDIUM_polygons: countries.reduce((s, c) => s + c.lods.WORLD_MEDIUM.polygonCount, 0),
      COUNTRY_HIGH_polygons: countries.reduce((s, c) => s + c.lods.COUNTRY_HIGH.polygonCount, 0),
    },
  };
  await writeFile(resolve(outDir, 'worldBoundaryBuildMeta.json'), JSON.stringify(stats, null, 2));
  console.log('Wrote', pkgPath);
  console.log(stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
