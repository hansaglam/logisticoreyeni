/**
 * Firestore setDoc/updateDoc için güvenli veri temizliği.
 * undefined, NaN, Infinity, function, symbol, circular ref kaldırılır.
 */

function isFirestoreSentinel(value: object): boolean {
  return '_methodName' in value;
}

export function sanitizeForFirestore(
  input: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (input === undefined) {
    return undefined;
  }

  if (input === null) {
    return null;
  }

  const valueType = typeof input;

  if (valueType === 'string' || valueType === 'boolean') {
    return input;
  }

  if (valueType === 'number') {
    return Number.isFinite(input as number) ? input : null;
  }

  if (valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    return undefined;
  }

  if (input instanceof Date) {
    return input.toISOString();
  }

  if (Array.isArray(input)) {
    return input.map((item) => {
      const sanitized = sanitizeForFirestore(item, seen);
      return sanitized === undefined ? null : sanitized;
    });
  }

  if (valueType === 'object') {
    const objectInput = input as Record<string, unknown>;

    // Firestore FieldValue (serverTimestamp, deleteField, ...) koru
    if (isFirestoreSentinel(objectInput)) {
      return input;
    }

    if (seen.has(objectInput)) {
      return null;
    }

    seen.add(objectInput);

    const output: Record<string, unknown> = {};

    Object.entries(objectInput).forEach(([key, value]) => {
      const sanitized = sanitizeForFirestore(value, seen);
      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    });

    seen.delete(objectInput);

    return output;
  }

  return null;
}

export function findUndefinedPaths(
  value: unknown,
  basePath = 'root',
  paths: string[] = [],
): string[] {
  if (value === undefined) {
    paths.push(basePath);
    return paths;
  }

  if (!value || typeof value !== 'object') {
    return paths;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findUndefinedPaths(item, `${basePath}[${index}]`, paths);
    });
    return paths;
  }

  if (isFirestoreSentinel(value as object)) {
    return paths;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    findUndefinedPaths(item, `${basePath}.${key}`, paths);
  });

  return paths;
}

/** Save payload optional alanları — undefined olması normal; uyarı spam'ini önler. */
const OPTIONAL_UNDEFINED_FIELD_SUFFIXES = new Set([
  'specialty',
  'requiredReputation',
  'recommendedTruckCondition',
  'requiredDriverLevel',
  'completedAt',
  'contractType',
  'riskLevel',
  'bonusMultiplier',
  'penaltyMultiplier',
  'requiredLevel',
  'selectionScoreBasis',
  'failureReason',
  'settledAt',
  'settlementId',
  'startedRealAtMs',
  'lastProgressedRealAtMs',
  'expectedDurationGameHours',
  'driverId',
  'triggeredAt',
  'targetPrice',
  'targetPercent',
  'resolvedChoiceId',
  'resolvedAtGameTime',
  'triggerProgress',
  'effectSummary',
  'incidentGenerated',
  'incidentRollsAttempted',
  'incidentResolved',
  'incidentResolutionHistory',
  'lastIncidentResolvedAt',
  'lastIncidentResolvedProgress',
  'severity',
  'polarity',
  'fuelLitersDelta',
  'incidentSummaries',
]);

function getPathLeafKey(path: string): string {
  const lastSegment = path.split('.').pop() ?? path;
  return lastSegment.replace(/\[\d+\]$/, '');
}

export function isKnownOptionalUndefinedPath(path: string): boolean {
  return OPTIONAL_UNDEFINED_FIELD_SUFFIXES.has(getPathLeafKey(path));
}

export function findUnexpectedUndefinedPaths(
  value: unknown,
  basePath = 'root',
): string[] {
  return findUndefinedPaths(value, basePath).filter(
    (path) => !isKnownOptionalUndefinedPath(path),
  );
}
