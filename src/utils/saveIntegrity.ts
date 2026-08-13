/**
 * Versioned save integrity checksum — deterministic canonical serialization.
 */
import { sha256 } from './authNonce';
import { canonicalJsonStringify } from './canonicalJson';
import type { SaveRecoveryChecksumStatus } from '../storage/saveRecoveryQuarantine';

export const CURRENT_CHECKSUM_VERSION = 1 as const;
export type SaveChecksumVersion = typeof CURRENT_CHECKSUM_VERSION;

const CHECKSUM_EXCLUDED_META_KEYS = [
  'integrityChecksum',
  'checksumGeneratedAt',
  'integrityStatus',
  'savedAt',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strip checksum metadata before hashing; business fields stay intact. */
export function preparePayloadForChecksum(payload: unknown): unknown {
  const clone = structuredClone(payload);
  return stripVolatileMetaForChecksum(clone);
}

/** Shallow meta strip for freshly serialized payloads — avoids a second deep clone. */
export function preparePayloadForChecksumShallow(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  const meta = isRecord(payload.meta) ? { ...payload.meta } : {};
  const prepared = { ...payload, meta };
  stripVolatileMetaFromRecord(prepared);
  return prepared;
}

function stripVolatileMetaForChecksum(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  if (isRecord(value.meta)) {
    value.meta = { ...value.meta };
    stripVolatileMetaFromRecord(value);
  }
  return value;
}

function stripVolatileMetaFromRecord(record: Record<string, unknown>): void {
  if (!isRecord(record.meta)) {
    return;
  }
  const meta = record.meta as Record<string, unknown>;
  for (const key of CHECKSUM_EXCLUDED_META_KEYS) {
    delete meta[key];
  }
}

export async function computeSaveChecksum(
  payload: unknown,
  version: SaveChecksumVersion = CURRENT_CHECKSUM_VERSION,
  options?: { shallow?: boolean },
): Promise<string> {
  if (version !== CURRENT_CHECKSUM_VERSION) {
    throw new Error(`unsupported-checksum-version:${version}`);
  }
  const prepared = options?.shallow
    ? preparePayloadForChecksumShallow(payload)
    : preparePayloadForChecksum(payload);
  const result = await sha256(canonicalJsonStringify(prepared));
  if (!result.ok) {
    throw new Error('checksum-failed');
  }
  return result.hash;
}

export function readChecksumVersionFromMeta(meta: unknown): SaveChecksumVersion {
  if (isRecord(meta) && meta.checksumVersion === CURRENT_CHECKSUM_VERSION) {
    return CURRENT_CHECKSUM_VERSION;
  }
  return CURRENT_CHECKSUM_VERSION;
}

/** Verify integrity on the raw parsed payload BEFORE schema migration. */
export async function verifyRawSaveChecksum(rawParsed: unknown): Promise<SaveRecoveryChecksumStatus> {
  if (!isRecord(rawParsed)) {
    return 'mismatch';
  }
  const meta = isRecord(rawParsed.meta) ? rawParsed.meta : {};
  const expected =
    typeof meta.integrityChecksum === 'string' && meta.integrityChecksum.length > 0
      ? meta.integrityChecksum
      : undefined;
  if (!expected) {
    return 'missing';
  }
  try {
    const version = readChecksumVersionFromMeta(meta);
    const computed = await computeSaveChecksum(rawParsed, version);
    return computed === expected ? 'valid' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}
