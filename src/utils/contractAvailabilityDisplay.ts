/**
 * Sözleşme uygunluk badge ve detay metinleri — tek kaynak.
 */

import type { ContractAvailabilityReason } from '../types/game';

export interface ContractAvailabilityMessageContext {
  fromCityName?: string;
  cargoWeight?: number;
  bestAvailableTruckCapacity?: number;
  requiredLevel?: number;
  playerLevel?: number;
}

function formatTonCapacity(tons: number): string {
  const safe = Math.max(0, tons);
  const rounded = Math.round(safe * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${rounded} ton`;
  }
  return `${rounded.toFixed(1)} ton`;
}

export function getContractAvailabilityLabel(
  reason: ContractAvailabilityReason | undefined,
): string | null {
  switch (reason) {
    case 'LEVEL_INSUFFICIENT':
      return 'Seviye yetersiz';
    case 'NO_TRUCK_AT_ORIGIN':
    case 'NO_TRUCK_IN_ORIGIN_CITY':
      return 'Şehirde kamyon yok';
    case 'NO_IDLE_TRUCK_IN_ORIGIN_CITY':
      return 'Kamyon meşgul';
    case 'NO_TRUCK_WITH_CAPACITY':
    case 'CAPACITY_INSUFFICIENT':
      return 'Tonaj yetersiz';
    case 'TRUCK_CONDITION_TOO_LOW':
      return 'Kondisyon düşük';
    case 'CONTRACT_EXPIRED':
      return 'Süresi doldu';
    case 'LEASE_EXPIRED':
      return 'Kira süresi doldu';
    case 'NO_TRUCKS':
      return 'Kamyon yok';
    case 'NO_IDLE_TRUCKS':
      return 'Müsait kamyon yok';
    case 'NO_DRIVERS':
    case 'NO_IDLE_DRIVERS':
      return 'Şoför yok';
    case 'INVALID_ORIGIN_CITY':
      return 'Geçersiz çıkış';
    default:
      return null;
  }
}

export function buildContractAvailabilityMessage(
  reason: ContractAvailabilityReason,
  context: ContractAvailabilityMessageContext,
): string {
  const fromCityName = context.fromCityName?.trim() || 'bu şehir';
  const cargoWeight = Math.max(0, context.cargoWeight ?? 0);
  const bestCapacity = Math.max(0, context.bestAvailableTruckCapacity ?? 0);

  switch (reason) {
    case 'LEVEL_INSUFFICIENT': {
      const requiredLevel = context.requiredLevel ?? 1;
      return `Bu sözleşme için şirket seviyen Level ${requiredLevel} olmalı.`;
    }
    case 'NO_TRUCKS':
      return 'Bu işi almak için önce bir kamyon satın almalısın.';
    case 'NO_IDLE_TRUCKS':
      return 'Bu işi almak için şu anda uygun boştaki kamyonun yok. Mevcut teslimatların bitmesini bekleyebilir veya yeni kamyon satın alabilirsin.';
    case 'NO_DRIVERS':
      return 'Bu işi almak için önce bir şoför işe almalısın.';
    case 'NO_IDLE_DRIVERS':
      return 'Tüm şoförlerin şu anda görevde. Yeni bir şoför işe alabilir veya mevcut teslimatın bitmesini bekleyebilirsin.';
    case 'INVALID_ORIGIN_CITY':
      return 'Bu sözleşmenin çıkış şehri tanımlı değil.';
    case 'NO_TRUCK_IN_ORIGIN_CITY':
    case 'NO_TRUCK_AT_ORIGIN':
      return (
        `Bu iş ${fromCityName} çıkışlı. Bu şehirde kamyonun yok. ` +
        'Bu işi alabilmek için kamyonunu bu şehre taşımalı veya bu şehirden çıkan başka bir uygun iş beklemelisin.'
      );
    case 'NO_IDLE_TRUCK_IN_ORIGIN_CITY':
      return (
        `Bu iş ${fromCityName} çıkışlı. Bu şehirde kamyonun var ancak şu anda müsait değil. ` +
        'Mevcut teslimatın bitmesini bekleyebilir veya bu şehir için yeni bir kamyon ayırabilirsin.'
      );
    case 'NO_TRUCK_WITH_CAPACITY':
    case 'CAPACITY_INSUFFICIENT':
      if (bestCapacity > 0) {
        return (
          `Bu iş ${cargoWeight.toFixed(1)} ton yük gerektiriyor. ` +
          `${fromCityName} şehrindeki en uygun müsait kamyonun ${formatTonCapacity(bestCapacity)} taşıyabiliyor. ` +
          'Daha yüksek kapasiteli bir kamyon alabilir veya daha düşük tonajlı bir sözleşme seçebilirsin.'
        );
      }
      return (
        `Bu iş ${cargoWeight.toFixed(1)} ton yük gerektiriyor. ` +
        `${fromCityName} şehrinde müsait kamyonun var ancak bu yük için kapasitesi yetersiz. ` +
        'Daha yüksek kapasiteli bir kamyon alabilir veya daha düşük tonajlı bir sözleşme seçebilirsin.'
      );
    case 'TRUCK_CONDITION_TOO_LOW':
      return 'Bu iş için uygun kamyonun var ancak kondisyonu düşük. Bakım yaptırarak bu sözleşmeyi alabilirsin.';
    case 'CONTRACT_EXPIRED':
      return 'İşin süresi doldu.';
    case 'LEASE_EXPIRED':
      return 'Kiralık kamyonun süresi doldu.';
    default:
      return 'Bu iş şu anda başlatılamıyor.';
  }
}

export function buildContractAvailabilityCopy(
  reason: ContractAvailabilityReason,
  context: ContractAvailabilityMessageContext,
): { title: string; buttonLabel: string; message: string } {
  const label = getContractAvailabilityLabel(reason) ?? 'Alınamaz';
  return {
    title: label,
    buttonLabel: label,
    message: buildContractAvailabilityMessage(reason, context),
  };
}
