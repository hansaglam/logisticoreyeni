/**
 * Kiralık kamyon yaşam döngüsü yapılandırması.
 *
 * leaseDurationHours = 168 (7 gün) olduğu için 24 oyun saati uyarı eşiği ~%14 kala bildirim verir.
 */
export const rentalTruckConfig = {
  /** Kira bitmeden önce tek seferlik uyarı (oyun saati). */
  expiryWarningGameHours: 24,
} as const;
