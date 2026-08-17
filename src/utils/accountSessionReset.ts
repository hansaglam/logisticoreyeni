/**
 * Bağlı hesaptan çıkış sonrası cihazdaki oyun ilerlemesini sıfırlar.
 * Bulut kaydı korunur; aynı hesaba tekrar girişte buluttan yüklenir.
 */
export async function resetLocalSessionAfterLinkedAccountSignOut(): Promise<void> {
  const { resetLeaderboardSubmitCache } = await import('../services/leaderboardService');
  resetLeaderboardSubmitCache();

  const { useGameStore } = await import('../store/gameStore');
  await useGameStore.getState().clearSave();
}
