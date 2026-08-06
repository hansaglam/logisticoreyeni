import type { StatusBadgeVariant } from '../components/ui';
import type { CloudSaveStatusState } from '../storage/cloudSaveSync';

export type CloudSaveUserFacingStatus =
  | 'synced'
  | 'pending'
  | 'offline'
  | 'conflict'
  | 'retry'
  | 'link-required'
  | 'recovery';

export interface CloudSaveDisplayInfo {
  key: CloudSaveUserFacingStatus;
  title: string;
  description: string;
  badgeVariant: StatusBadgeVariant;
  ctaLabel?: string;
}

export function formatRelativeSaveAgo(timestamp: number | null, nowMs = Date.now()): string {
  if (!timestamp) {
    return 'Henüz kaydedilmedi';
  }
  const agoMs = Math.max(0, nowMs - timestamp);
  const minutes = Math.round(agoMs / 60_000);
  if (minutes < 1) {
    return 'Az önce';
  }
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) {
    return rem > 0 ? `${hours} sa ${rem} dk önce` : `${hours} sa önce`;
  }
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}

export function resolveCloudSaveDisplayInfo(options: {
  cloudStatus: CloudSaveStatusState;
  isGuest: boolean;
  recoveryRequired: boolean;
  hasAccountConflict: boolean;
}): CloudSaveDisplayInfo {
  const { cloudStatus, isGuest, recoveryRequired, hasAccountConflict } = options;

  if (recoveryRequired) {
    return {
      key: 'recovery',
      title: 'Kurtarma gerekli',
      description:
        'Hesap geçişi yarım kaldı. Eski hesabına yeniden giriş yapman gerekiyor.',
      badgeVariant: 'danger',
      ctaLabel: 'Hesap Değiştir',
    };
  }

  if (isGuest) {
    return {
      key: 'link-required',
      title: 'Hesap bağlantısı gerekli',
      description: 'İlerlemeni korumak için Google veya Apple hesabını bağla.',
      badgeVariant: 'amber',
    };
  }

  if (!cloudStatus.firebaseEnabled || cloudStatus.status === 'disabled') {
    return {
      key: 'offline',
      title: 'Çevrimdışı',
      description: 'Bulut kaydı şu anda kullanılamıyor.',
      badgeVariant: 'muted',
    };
  }

  if (hasAccountConflict || cloudStatus.restoreCandidate?.hasCandidate) {
    return {
      key: 'conflict',
      title: 'Çakışma var',
      description: 'Bu cihaz ve bulut kaydı farklı. Karar vermen gerekiyor.',
      badgeVariant: 'danger',
      ctaLabel: 'Bulut Kaydını Görüntüle',
    };
  }

  if (cloudStatus.status === 'failed') {
    return {
      key: 'retry',
      title: 'Yeniden denenecek',
      description: cloudStatus.lastError
        ? `Son hata: ${cloudStatus.lastError}`
        : 'Bağlantı kurulamadı, kayıt yeniden denenecek.',
      badgeVariant: 'amber',
      ctaLabel: 'Şimdi Senkronize Et',
    };
  }

  if (cloudStatus.status === 'pending' || cloudStatus.status === 'syncing') {
    return {
      key: 'pending',
      title: 'Senkronizasyon bekliyor',
      description: 'Kaydın buluta aktarılıyor.',
      badgeVariant: 'blue',
    };
  }

  return {
    key: 'synced',
    title: 'Senkronize',
    description: `Son kayıt ${formatRelativeSaveAgo(cloudStatus.lastSyncAt)}`,
    badgeVariant: 'success',
    ctaLabel: 'Şimdi Senkronize Et',
  };
}

export function getProviderBadgeLabel(provider: string, isGuest: boolean): string {
  if (isGuest) {
    return 'MİSAFİR';
  }
  if (provider === 'google') {
    return 'GOOGLE';
  }
  if (provider === 'apple') {
    return 'APPLE';
  }
  return 'BAĞLI';
}
