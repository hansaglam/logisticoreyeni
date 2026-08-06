import { getSaveBootstrapAuthUid } from './saveAuthContext';
import {
  SAVE_BACKUP_INVALID_KEY,
  SAVE_BACKUP_MIGRATED_KEY,
  SAVE_GAME_VERSION,
  SAVE_STORAGE_KEY,
  type SaveGamePayload,
} from './saveGame';
import {
  SAVE_QUARANTINE_RAW_KEY,
  SAVE_RESTORE_STAGING_KEY,
} from './saveRecoveryQuarantine';

export type SaveBootstrapStage =
  | 'idle'
  | 'reading-primary'
  | 'verifying-primary'
  | 'migrating-primary'
  | 'normalizing-primary'
  | 'validating-primary'
  | 'reading-backup'
  | 'verifying-backup'
  | 'migrating-backup'
  | 'normalizing-backup'
  | 'validating-backup'
  | 'reading-previous-slot'
  | 'reading-cloud'
  | 'validating-cloud'
  | 'healing'
  | 'committing'
  | 'ready'
  | 'recovery-required';

export type SaveLoadFailureCode =
  | 'primary-missing'
  | 'primary-json-invalid'
  | 'primary-checksum-mismatch'
  | 'primary-schema-invalid'
  | 'migration-failed'
  | 'normalization-failed'
  | 'unsupported-version'
  | 'owner-mismatch'
  | 'backup-missing'
  | 'backup-invalid'
  | 'cloud-unavailable'
  | 'cloud-invalid'
  | 'storage-read-failed'
  | 'commit-failed'
  | 'quarantine-pending'
  | 'restore-interrupted'
  | 'unknown';

export type SaveBootstrapSource =
  | 'primary'
  | 'staging'
  | 'backup-migrated'
  | 'backup-invalid'
  | 'quarantine-raw'
  | 'restore-staging'
  | 'cloud';

export type SaveBootstrapLogEntry = {
  stage: SaveBootstrapStage;
  source?: SaveBootstrapSource;
  success: boolean;
  errorCode?: SaveLoadFailureCode;
  saveVersion?: number | null;
  migratedToVersion?: number | null;
  checksumPresent?: boolean;
  checksumValid?: boolean;
  payloadPresent?: boolean;
  payloadSize?: number;
  ownerUidPresent?: boolean;
  authUidPresent?: boolean;
  recoverable?: boolean;
  durationMs?: number;
};

const SAVE_SLOT_STAGING_SUFFIX = '_staging_v1';

let lastDiagnosticId = `sb-${Date.now().toString(36)}`;

export function createSaveBootstrapDiagnosticId(): string {
  lastDiagnosticId = `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return lastDiagnosticId;
}

export function getLastSaveBootstrapDiagnosticId(): string {
  return lastDiagnosticId;
}

export function logSaveBootstrap(entry: SaveBootstrapLogEntry): void {
  console.info('[save-bootstrap]', {
    diagnosticId: lastDiagnosticId,
    ...entry,
  });
}

export function mapDiagnosisToFailureCode(
  reason?: string,
  source: SaveBootstrapSource = 'primary',
): SaveLoadFailureCode {
  switch (reason) {
    case 'json-parse-failed':
      return source === 'primary' ? 'primary-json-invalid' : 'backup-invalid';
    case 'checksum-mismatch':
      return source === 'primary' ? 'primary-checksum-mismatch' : 'backup-invalid';
    case 'unsupported-save-version':
      return 'unsupported-version';
    case 'migration-failed':
      return 'migration-failed';
    case 'schema-validation-failed':
      return source === 'primary' ? 'primary-schema-invalid' : 'backup-invalid';
    default:
      return source === 'primary' ? 'unknown' : 'backup-invalid';
  }
}

export function getSaveBootstrapCandidateSources(): Array<{
  key: string;
  source: SaveBootstrapSource;
  stage: SaveBootstrapStage;
}> {
  return [
    { key: SAVE_STORAGE_KEY, source: 'primary', stage: 'reading-primary' },
    {
      key: `${SAVE_STORAGE_KEY}${SAVE_SLOT_STAGING_SUFFIX}`,
      source: 'staging',
      stage: 'reading-backup',
    },
    { key: SAVE_BACKUP_MIGRATED_KEY, source: 'backup-migrated', stage: 'reading-backup' },
    { key: SAVE_RESTORE_STAGING_KEY, source: 'restore-staging', stage: 'reading-previous-slot' },
    { key: SAVE_QUARANTINE_RAW_KEY, source: 'quarantine-raw', stage: 'reading-previous-slot' },
    { key: SAVE_BACKUP_INVALID_KEY, source: 'backup-invalid', stage: 'reading-previous-slot' },
  ];
}

export function describePayloadEnvelope(
  raw: string | null,
  payload?: SaveGamePayload | null,
  checksumStatus?: 'missing' | 'valid' | 'mismatch' | 'not-checked',
): Pick<
  SaveBootstrapLogEntry,
  | 'saveVersion'
  | 'checksumPresent'
  | 'checksumValid'
  | 'payloadPresent'
  | 'payloadSize'
  | 'ownerUidPresent'
  | 'authUidPresent'
  | 'migratedToVersion'
> {
  const authUid = getSaveBootstrapAuthUid();
  return {
    saveVersion: payload?.version ?? payload?.meta?.saveVersion ?? null,
    migratedToVersion: payload?.version === SAVE_GAME_VERSION ? SAVE_GAME_VERSION : payload?.version ?? null,
    checksumPresent:
      checksumStatus === 'valid' ||
      checksumStatus === 'mismatch' ||
      (typeof payload?.meta?.integrityChecksum === 'string' &&
        payload.meta.integrityChecksum.length > 0),
    checksumValid: checksumStatus === 'valid' || checksumStatus === 'missing',
    payloadPresent: payload != null,
    payloadSize: raw?.length ?? 0,
    ownerUidPresent: typeof payload?.ownerUid === 'string' && payload.ownerUid.length > 0,
    authUidPresent: typeof authUid === 'string' && authUid.length > 0,
  };
}
