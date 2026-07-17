/**
 * Kamyon konumu UX metinleri — teslimat sonrası rehber ve toast.
 */

export const TRUCK_LOCATION_EDUCATION_MESSAGE =
  'Kamyonlar teslimatı bitirdiği şehirde kalır. Yeni işleri kamyonunun bulunduğu şehirden seçebilirsin.';

export const TRUCK_STAYS_AT_DESTINATION_NOTE =
  'Kamyonların teslimatı bitirdiği şehirde kalır.';

export function shouldShowPostDeliveryLocationHint(completedContracts: number): boolean {
  return completedContracts >= 1 && completedContracts <= 2;
}

export function formatDeliveryCompleteLocationToast(
  destinationCityName: string,
  hasAssignedDriver: boolean,
): string {
  const city = destinationCityName.trim() || 'varış şehrinde';
  if (hasAssignedDriver) {
    return `Kamyon ve şoför ${city}'da yeni işler için hazır.`;
  }
  return `Kamyonun artık ${city}'da.`;
}

export function formatIdleTruckSummaryLine(
  cityLabels: string,
  idleCount: number,
  playableCount: number,
): string {
  if (idleCount === 0) {
    return 'Boşta kamyon yok — teslimat bitince yeni iş al.';
  }

  const cities = cityLabels.trim() || '—';
  if (playableCount > 0) {
    return `Uygun çıkış: ${cities} · ${playableCount} uygun iş`;
  }

  return `Boşta kamyon: ${cities} · Kamyonunun bulunduğu şehirden iş seç.`;
}
