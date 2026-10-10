/**
 * Provisional simplification tolerances in normalized Web Mercator [0,1] space.
 * WORLD_LOW / WORLD_MEDIUM / COUNTRY_HIGH all derive from the same gbOpen ADM0 simplified source.
 */
export const MAP_V2_WORLD_PROCESSING_VERSION = 'map-v2-world-boundaries-2';
export const MAP_V2_SIMPLIFICATION_CONFIG_VERSION = 'world-dp-v1';

export const LOD_SIMPLIFY_TOLERANCE = {
  WORLD_LOW: 0.0032,
  WORLD_MEDIUM: 0.0009,
  COUNTRY_HIGH: 0.00022,
} as const;

export const LOD_MAX_RING_VERTICES = {
  WORLD_LOW: 28,
  WORLD_MEDIUM: 72,
  COUNTRY_HIGH: 160,
} as const;

export const LOD_MAX_POLYGONS_PER_COUNTRY = {
  WORLD_LOW: 48,
  WORLD_MEDIUM: 140,
  COUNTRY_HIGH: 400,
} as const;

export const LOD_MIN_POLYGON_AREA = {
  WORLD_LOW: 4e-7,
  WORLD_MEDIUM: 8e-8,
  COUNTRY_HIGH: 1e-8,
} as const;

export const GEOBOUNDARIES_API_URL = 'https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM0/';
export const GEOBOUNDARIES_RELEASE_COMMIT = '9469f09';
export const GEOBOUNDARIES_LICENSE = 'CC-BY-4.0';
export const GEOBOUNDARIES_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
export const GEOBOUNDARIES_SOURCE_NAME = 'geoBoundaries gbOpen ADM0 simplified';
