/**
 * Kiralık kamyon yaşam döngüsü yapılandırması.
 *
 * leaseDurationHours = 168 (7 gün) olduğu için 24 oyun saati uyarı eşiği ~%14 kala bildirim verir.
 */
export const rentalTruckConfig = {
  /** Kira bitmeden önce tek seferlik uyarı (oyun saati). */
  expiryWarningGameHours: 24,
  /**
   * İş atama tamponu: max(minHours, estimatedTravelHours * ratio).
   * Kalan kira, tahmini teslimat + tamponun altındaysa iş atanamaz.
   */
  assignmentBufferMinHours: 1,
  assignmentBufferRatio: 0.1,
} as const;
