import type { AccountTransitionError } from '../services/authService';
import type { StoreGameState } from '../types/game';

export function isLocalSaveSafeForAccountTransition(
  state: StoreGameState,
): boolean {
  return Boolean(
    state.player &&
      Number.isFinite(state.player.money) &&
      Number.isFinite(state.currentTime) &&
      Array.isArray(state.player.trucks) &&
      Array.isArray(state.player.drivers),
  );
}

export function getAccountTransitionErrorMessage(
  reason?: AccountTransitionError,
): string {
  switch (reason) {
    case 'cloud-sync-failed':
      return 'Bulut kaydı tamamlanamadı. Hesap değişikliği iptal edildi.';
    case 'sign-out-failed':
      return 'Google hesabından güvenli çıkış yapılamadı.';
    case 'google-disconnect-failed':
      return 'Google oturumu temizlenemedi. Hesabın değiştirilmedi.';
    case 'account-picker-cancelled':
      return 'Hesap seçimi iptal edildi. Mevcut hesabın açık kalmaya devam ediyor.';
    case 'auth-required':
      return 'Bu işlem için bağlı bir Google hesabı gerekiyor.';
    case 'marketplace-operation-active':
      return 'Aktif Araç Pazarı işlemi tamamlanmadan hesap değiştiremezsin.';
    case 'network-error':
      return 'Ağ bağlantısı kurulamadı. Mevcut hesabın ve yerel kaydın korundu.';
    default:
      return 'Hesap işlemi tamamlanamadı. Mevcut kaydın korundu.';
  }
}
