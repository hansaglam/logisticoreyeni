/**
 * Account ↔ cloud connection state — Auth “linked” ile cloud-protected ayrımı.
 */

export type AccountConnectionState =
  | 'guest'
  | 'linking'
  | 'linked-local-only'
  | 'cloud-syncing'
  | 'cloud-protected'
  | 'sync-retry'
  | 'conflict'
  | 'error';

export type AccountLinkResolution =
  | 'uid-preserved-link'
  | 'existing-apple-account'
  | 'merge-required'
  | 'already-linked'
  | 'cancelled'
  | 'failed';

export type CloudSaveDisplayStatus = 'disabled' | 'pending' | 'syncing' | 'success' | 'failed';

export interface ResolveAccountConnectionStateInput {
  authReady: boolean;
  isAnonymous: boolean;
  provider: 'guest' | 'google' | 'apple' | 'unknown';
  isLinking: boolean;
  hasConflict: boolean;
  cloudStatus: CloudSaveDisplayStatus;
  lastCloudSaveAt: number | null;
  lastCloudErrorCode?: string | null;
}

export function isCloudProtectedState(state: AccountConnectionState): boolean {
  return state === 'cloud-protected';
}

export function resolveAccountConnectionState(
  input: ResolveAccountConnectionStateInput,
): AccountConnectionState {
  if (!input.authReady) {
    return 'guest';
  }
  if (input.hasConflict) {
    return 'conflict';
  }
  if (input.isLinking) {
    return 'linking';
  }

  const isGuest = input.isAnonymous || input.provider === 'guest';
  if (isGuest) {
    return 'guest';
  }

  if (input.cloudStatus === 'syncing' || input.cloudStatus === 'pending') {
    return 'cloud-syncing';
  }

  if (
    input.cloudStatus === 'success' &&
    input.lastCloudSaveAt != null &&
    input.lastCloudSaveAt > 0
  ) {
    return 'cloud-protected';
  }

  if (input.cloudStatus === 'failed') {
    const permanent =
      input.lastCloudErrorCode === 'permission-denied' ||
      input.lastCloudErrorCode === 'owner-mismatch' ||
      input.lastCloudErrorCode === 'unauthenticated' ||
      input.lastCloudErrorCode === 'invalid-argument' ||
      input.lastCloudErrorCode === 'save-too-large';
    return permanent ? 'error' : 'sync-retry';
  }

  return 'linked-local-only';
}

export function getAccountConnectionHeroCopy(state: AccountConnectionState): {
  title: string;
  subtitle: string;
  footnote: string | null;
  footnoteTone: 'success' | 'amber' | 'muted' | null;
} {
  switch (state) {
    case 'guest':
      return {
        title: 'Hesabını Güvenceye Al',
        subtitle:
          'Misafir modunda oynuyorsun. İlerlemeni kaybetmemek ve liderlik tablosuna katılmak için hesabını bağla.',
        footnote: null,
        footnoteTone: null,
      };
    case 'linking':
      return {
        title: 'Hesap bağlanıyor...',
        subtitle: 'Apple/Google bağlantısı tamamlanıyor.',
        footnote: null,
        footnoteTone: null,
      };
    case 'linked-local-only':
      return {
        title: 'Hesap Bağlı',
        subtitle: 'Hesabın bağlandı. İlk bulut kaydı henüz doğrulanmadı.',
        footnote: 'Hesabın bağlı · Bulut kaydı henüz doğrulanmadı',
        footnoteTone: 'amber',
      };
    case 'cloud-syncing':
      return {
        title: 'Hesap Bağlı',
        subtitle: 'İlk bulut kaydı gönderiliyor...',
        footnote: 'Hesabın bağlı · Bulut kaydı senkronize ediliyor',
        footnoteTone: 'amber',
      };
    case 'sync-retry':
      return {
        title: 'Hesap Bağlı',
        subtitle: 'Apple hesabın bağlandı. İlk bulut kaydı yeniden denenecek.',
        footnote: 'Hesabın bağlı · Bulut kaydı henüz doğrulanmadı',
        footnoteTone: 'amber',
      };
    case 'cloud-protected':
      return {
        title: 'Hesap Bağlı',
        subtitle: 'İlerlemen bulut kaydıyla korunuyor.',
        footnote: 'Hesabın güvende · Bulut kaydı aktif',
        footnoteTone: 'success',
      };
    case 'conflict':
      return {
        title: 'Hesap Çakışması',
        subtitle: 'Bu Apple hesabına ait mevcut bir kayıt bulundu.',
        footnote: null,
        footnoteTone: null,
      };
    case 'error':
      return {
        title: 'Hesap Bağlı',
        subtitle: 'Bulut kaydı kalıcı bir hata aldı. Detayı kontrol et veya tekrar dene.',
        footnote: 'Hesabın bağlı · Bulut kaydı doğrulanamadı',
        footnoteTone: 'amber',
      };
    default:
      return {
        title: 'Hesap',
        subtitle: '',
        footnote: null,
        footnoteTone: null,
      };
  }
}

export function getCloudSaveRowForConnectionState(state: AccountConnectionState): {
  label: string;
  variant: 'success' | 'amber' | 'muted' | 'danger';
} {
  switch (state) {
    case 'cloud-protected':
      return { label: 'Aktif', variant: 'success' };
    case 'cloud-syncing':
      return { label: 'Kaydediliyor', variant: 'amber' };
    case 'sync-retry':
      return { label: 'Yeniden dene', variant: 'amber' };
    case 'linked-local-only':
      return { label: 'Bekleniyor', variant: 'amber' };
    case 'error':
      return { label: 'Hata', variant: 'danger' };
    case 'guest':
      return { label: 'Yerel kayıt', variant: 'muted' };
    default:
      return { label: 'Bekleniyor', variant: 'muted' };
  }
}
