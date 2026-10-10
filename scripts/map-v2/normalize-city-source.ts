/**
 * Source-field normalization for city ingest. Does not invent coordinates.
 */
export function normalizePopulation(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

export function normalizeOptionalName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function assertWgs84(longitude: number, latitude: number, label: string): void {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`non-finite WGS84 for ${label}`);
  }
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error(`WGS84 out of range for ${label}`);
  }
}
