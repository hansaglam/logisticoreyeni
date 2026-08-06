import type { MarketTutorialTargetId } from './marketTutorialTargetRegistry';
import type { MarketTutorialMarketState } from '../../tutorial/marketTutorialState';

export interface MarketTutorialStep {
  id: string;
  title: string;
  description: string;
  targetId?: MarketTutorialTargetId;
  primaryLabel?: string;
}

export const MARKET_TUTORIAL_FULL_STEPS: MarketTutorialStep[] = [
  {
    id: 'city-select',
    title: 'Şehirleri karşılaştır',
    description:
      'Her şehirde fiyatlar ve stok durumu farklıdır. Yukarıdaki şehirlerden birini seçerek o bölgenin piyasasını inceleyebilirsin.',
    targetId: 'city-chips',
  },
  {
    id: 'stock-status',
    title: 'Arzı takip et',
    description:
      'Stok fazlası olan ürünler genellikle daha ucuzdur. Stok az olan şehirlerde satış fiyatı daha yüksek olabilir.',
    targetId: 'stock-badge',
  },
  {
    id: 'price-trend',
    title: 'Fiyat hareketini oku',
    description:
      'Fiyatın yanında son değişim oranını ve küçük trend grafiğini görebilirsin. Tek başına yükselişe değil, stok durumuna da dikkat et.',
    targetId: 'price-trend',
  },
  {
    id: 'buy',
    title: 'Uygun fiyattan satın al',
    description:
      'Ürünü yalnız bulunduğun şehirdeki uygun depoya satın alabilirsin. Depo kapasitesi ve nakit sınırını kontrol et.',
    targetId: 'buy-button',
  },
  {
    id: 'warehouse-transfer',
    title: 'Depola veya başka şehre taşı',
    description:
      'Satın aldığın ürün depoda bekler. Daha yüksek fiyatlı bir şehre transfer ederek satış fırsatı oluşturabilirsin.',
    targetId: 'warehouse-transfer',
  },
  {
    id: 'profit',
    title: 'Gerçek kârı hesapla',
    description:
      'Alış ve satış fiyatı arasındaki fark tek başına yeterli değildir. Transfer, depo ve operasyon giderlerini de hesaba kat.',
    targetId: 'profit-summary',
  },
  {
    id: 'finish',
    title: 'Piyasayı düzenli takip et',
    description:
      'Fiyatlar zamanla değişir. Ucuz al, uygun depoda beklet ve doğru şehirde satarak şirketini büyüt.',
    primaryLabel: 'Piyasayı Keşfet',
  },
];

export const MARKET_TUTORIAL_SHORT_STEPS: MarketTutorialStep[] = [
  {
    id: 'city-select-short',
    title: 'Şehirleri karşılaştır',
    description:
      'Her şehirde fiyatlar ve stok durumu farklıdır. Şehir seçerek bölgesel piyasayı inceleyebilirsin.',
    targetId: 'city-chips',
  },
  {
    id: 'products-short',
    title: 'Ürünleri incele',
    description:
      'Ürün kartlarında fiyat, stok durumu ve alım-satım seçeneklerini görebilirsin.',
    targetId: 'products-section',
  },
  {
    id: 'refresh-short',
    title: 'Veriyi yenile',
    description:
      'Piyasa verisi güncel değilse sağ üstteki yenile butonuyla tekrar deneyebilirsin.',
    targetId: 'refresh-button',
    primaryLabel: 'Piyasayı Keşfet',
  },
];

export function getMarketTutorialSteps(
  marketState: MarketTutorialMarketState,
): MarketTutorialStep[] {
  if (marketState === 'unavailable') {
    return MARKET_TUTORIAL_SHORT_STEPS;
  }
  return MARKET_TUTORIAL_FULL_STEPS;
}
