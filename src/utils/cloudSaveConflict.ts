export type CloudSaveConflictReason =
  | 'auth-user-mismatch'
  | 'owner-mismatch'
  | 'cloud-save-not-found'
  | 'cloud-save-corrupted'
  | 'cloud-save-fetch-failed'
  | 'cloud-save-invalid'
  | 'unsupported-save-version'
  | 'restore-migration-failed'
  | 'migration-failed'
  | 'marketplace-reconciliation-failed'
  | 'network-error'
  | 'timeout'
  | 'permission-denied'
  | 'already-resolving'
  | 'restore-already-applied'
  | 'save-conflict'
  | 'account-transition-cancelled'
  | 'missing-conflict'
  | 'conflict-stale'
  | 'local-save-invalid'
  | 'cloud-restore-failed'
  | 'cloud-upload-failed'
  | 'transition-busy'
  | 'unknown';

export function getCloudSaveConflictErrorMessage(
  reason: CloudSaveConflictReason,
): string {
  switch (reason) {
    case 'auth-user-mismatch':
      return 'Bu kayıt seçili Google hesabına ait değil.';
    case 'owner-mismatch':
      return 'Bu bulut kaydı seçili hesaba ait değil.';
    case 'cloud-save-not-found':
      return 'Bu hesapta kullanılabilir bir bulut kaydı bulunamadı.';
    case 'cloud-save-corrupted':
    case 'cloud-save-invalid':
      return 'Bulut kaydı doğrulanamadı.';
    case 'cloud-save-fetch-failed':
      return 'Bulut kaydı şu anda yüklenemedi. Tekrar dene.';
    case 'unsupported-save-version':
      return 'Bu kayıt uygulamanın desteklemediği daha yeni bir sürümle oluşturulmuş.';
    case 'restore-migration-failed':
    case 'migration-failed':
      return 'Bulut kaydı güncel kayıt biçimine dönüştürülemedi.';
    case 'marketplace-reconciliation-failed':
      return 'Araç Pazarı sahiplik bilgileri doğrulanamadı.';
    case 'network-error':
      return 'Ağ bağlantısı kurulamadı. Bağlantını kontrol edip tekrar dene.';
    case 'timeout':
      return 'Kayıt geçişi zaman aşımına uğradı. Lütfen tekrar dene.';
    case 'permission-denied':
      return 'Bu bulut kaydına erişim iznin bulunmuyor.';
    case 'already-resolving':
    case 'transition-busy':
      return 'İşlem devam ediyor.';
    case 'restore-already-applied':
      return 'Bu bulut kaydı daha önce güvenli şekilde uygulandı.';
    case 'save-conflict':
      return 'Hangi kaydın kullanılacağını seçmelisin.';
    case 'account-transition-cancelled':
      return 'Hesap geçişi iptal edildi.';
    case 'missing-conflict':
    case 'conflict-stale':
      return 'Seçilen kayıt artık kullanılamıyor.';
    case 'local-save-invalid':
      return 'Bu cihazdaki kayıt doğrulanamadı.';
    case 'cloud-restore-failed':
      return 'Bulut kaydı yüklenemedi. Tekrar dene.';
    case 'cloud-upload-failed':
      return 'Bu cihazdaki kayıt buluta yazılamadı. Tekrar dene.';
    default:
      return 'Bir hata oluştu. Lütfen tekrar dene.';
  }
}

export function isRetryableCloudSaveConflictReason(
  reason: CloudSaveConflictReason,
): boolean {
  return (
    reason === 'network-error' ||
    reason === 'timeout' ||
    reason === 'cloud-save-fetch-failed' ||
    reason === 'cloud-restore-failed' ||
    reason === 'cloud-upload-failed' ||
    reason === 'already-resolving' ||
    reason === 'transition-busy'
  );
}

export function validateCloudSaveRestorePayload(
  payload: unknown,
  supportedSaveVersion: number,
): CloudSaveConflictReason | null {
  if (!payload || typeof payload !== 'object') return 'cloud-save-corrupted';
  const record = payload as Record<string, unknown>;
  if (record.schemaVersion !== 1) return 'unsupported-save-version';
  const saveVersion = Number(record.saveVersion);
  if (!Number.isFinite(saveVersion) || saveVersion < 0) return 'cloud-save-corrupted';
  if (saveVersion > supportedSaveVersion) return 'unsupported-save-version';
  const gameState = record.gameState;
  if (!gameState || typeof gameState !== 'object' || Array.isArray(gameState)) {
    return 'cloud-save-corrupted';
  }
  const player = (gameState as Record<string, unknown>).player;
  if (!player || typeof player !== 'object' || Array.isArray(player)) {
    return 'cloud-save-corrupted';
  }
  const money = Number(
    (player as Record<string, unknown>).money ??
      (player as Record<string, unknown>).cash,
  );
  if (!Number.isFinite(money)) return 'cloud-save-corrupted';
  for (const key of ['trucks', 'drivers', 'trailers', 'warehouses']) {
    const value = (player as Record<string, unknown>)[key];
    if (value != null && !Array.isArray(value)) return 'cloud-save-corrupted';
  }
  return null;
}

export class CloudSaveConflictError extends Error {
  constructor(public readonly reason: CloudSaveConflictReason) {
    super(reason);
    this.name = 'CloudSaveConflictError';
  }
}

export function beginCloudSaveConflictResolution(
  inFlight: { current: boolean },
): boolean {
  if (inFlight.current) return false;
  inFlight.current = true;
  return true;
}

export function endCloudSaveConflictResolution(
  inFlight: { current: boolean },
): void {
  inFlight.current = false;
}

export async function executeAtomicCloudSaveRestore<TPayload, TState>(input: {
  selectedAccountUid: string;
  expectedAccountUid?: string;
  readMetadata: () => Promise<TPayload>;
  readPayload: () => Promise<TPayload>;
  validate: (payload: TPayload) => CloudSaveConflictReason | null;
  migrate: (payload: TPayload) => TState;
  reconcileMarketplace: (state: TState) => Promise<TState>;
  persistLocal: (state: TState) => Promise<boolean>;
  commitState: (state: TState) => void;
  getOwnerUid?: (payload: TPayload) => string | undefined;
  getRestoreId?: (payload: TPayload) => string;
  isRestoreApplied?: (restoreId: string) => Promise<boolean>;
  beginRestore?: (restoreId: string, ownerUid: string) => Promise<void>;
  completeRestore?: (restoreId: string, ownerUid: string) => Promise<void>;
  validateState?: (state: TState) => boolean;
}): Promise<TState> {
  if (
    input.expectedAccountUid &&
    input.expectedAccountUid !== input.selectedAccountUid
  ) {
    throw new CloudSaveConflictError('auth-user-mismatch');
  }

  const metadata = await input.readMetadata();
  const metadataOwner = input.getOwnerUid?.(metadata);
  if (metadataOwner && metadataOwner !== input.selectedAccountUid) {
    throw new CloudSaveConflictError('owner-mismatch');
  }
  const metadataError = input.validate(metadata);
  if (metadataError) throw new CloudSaveConflictError(metadataError);

  const payload = await input.readPayload();
  const payloadOwner = input.getOwnerUid?.(payload);
  if (payloadOwner && payloadOwner !== input.selectedAccountUid) {
    throw new CloudSaveConflictError('owner-mismatch');
  }
  const validationError = input.validate(payload);
  if (validationError) throw new CloudSaveConflictError(validationError);
  const restoreId = input.getRestoreId?.(payload);
  if (restoreId && (await input.isRestoreApplied?.(restoreId))) {
    throw new CloudSaveConflictError('restore-already-applied');
  }
  if (restoreId) await input.beginRestore?.(restoreId, input.selectedAccountUid);

  let pendingCloudRestore: TState;
  try {
    pendingCloudRestore = input.migrate(payload);
  } catch {
    throw new CloudSaveConflictError('restore-migration-failed');
  }

  if (input.validateState && !input.validateState(pendingCloudRestore)) {
    throw new CloudSaveConflictError('cloud-save-corrupted');
  }

  try {
    pendingCloudRestore = await input.reconcileMarketplace(pendingCloudRestore);
  } catch (error) {
    if (error instanceof CloudSaveConflictError) throw error;
    throw new CloudSaveConflictError('marketplace-reconciliation-failed');
  }

  const persisted = await input.persistLocal(pendingCloudRestore);
  if (!persisted) {
    throw new CloudSaveConflictError('restore-migration-failed');
  }
  input.commitState(pendingCloudRestore);
  if (restoreId) await input.completeRestore?.(restoreId, input.selectedAccountUid);
  return pendingCloudRestore;
}
