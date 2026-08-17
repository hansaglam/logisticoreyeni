export function requestRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

function hasOnlyKeys(
  data: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(data).every((key) => allowed.has(key));
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

export function parseMarketplaceListRequest(
  data: unknown,
): { limit: number; cursor?: { createdAt: number; id: string } } | null {
  const record = requestRecord(data);
  if (!hasOnlyKeys(record, ['limit', 'cursor'])) return null;

  const limitRaw = record.limit === undefined ? 20 : Number(record.limit);
  if (
    record.limit !== undefined &&
    (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > 50)
  ) {
    return null;
  }
  const limit = Math.min(50, Math.max(1, Math.floor(limitRaw)));

  if (record.cursor == null) {
    return { limit };
  }

  const cursorRecord = requestRecord(record.cursor);
  if (!hasOnlyKeys(cursorRecord, ['createdAt', 'id'])) return null;
  const createdAt = Number(cursorRecord.createdAt);
  const id = cursorRecord.id;
  if (
    !Number.isFinite(createdAt) ||
    createdAt <= 0 ||
    typeof id !== 'string' ||
    !isBoundedId(id)
  ) {
    return null;
  }

  return { limit, cursor: { createdAt, id } };
}
