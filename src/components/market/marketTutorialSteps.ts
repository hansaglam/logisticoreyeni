import type { ProductId } from '../../types/game';
import {
  buildMarketProductTargetId,
  type MarketTutorialProductTargetKind,
  type MarketTutorialTargetId,
} from './marketTutorialTargetRegistry';
import type { MarketTutorialMarketState } from '../../tutorial/marketTutorialState';

export interface MarketTutorialStep {
  id: string;
  title: string;
  description: string;
  targetId?: MarketTutorialTargetId;
  spotlightPadding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  primaryLabel?: string;
}

export const MARKET_TUTORIAL_FULL_STEPS: MarketTutorialStep[] = [
  {
    id: 'city-select',
    title: 'Şehirleri karşılaştır',
    description:
      'Her şehirde fiyatlar ve stok durumu farklıdır. Yukarıdaki şehirlerden birini seçerek o bölgenin piyasasını inceleyebilirsin.',
    targetId: 'city-chips',
    spotlightPadding: 5,
  },
  {
    id: 'stock-status',
    title: 'Arzı takip et',
    description:
      'Stok fazlası olan ürünler genellikle daha ucuzdur. Stok az olan şehirlerde satış fiyatı daha yüksek olabilir.',
    spotlightPadding: 4,
  },
  {
    id: 'price-trend',
    title: 'Fiyat hareketini oku',
    description:
      'Fiyatın yanında son değişim oranını ve küçük trend grafiğini görebilirsin. Tek başına yükselişe değil, stok durumuna da dikkat et.',
    spotlightPadding: 6,
  },
  {
    id: 'buy',
    title: 'Uygun fiyattan satın al',
    description:
      'Ürünü yalnız bulunduğun şehirdeki uygun depoya satın alabilirsin. Depo kapasitesi ve nakit sınırını kontrol et.',
    spotlightPadding: 5,
  },
  {
    id: 'warehouse-transfer',
    title: 'Depola veya başka şehre taşı',
    description:
      'Satın aldığın ürün depoda bekler. Daha yüksek fiyatlı bir şehre transfer ederek satış fırsatı oluşturabilirsin.',
    spotlightPadding: 4,
  },
  {
    id: 'profit',
    title: 'Gerçek kârı hesapla',
    description:
      'Alış ve satış fiyatı arasındaki fark tek başına yeterli değildir. Transfer, depo ve operasyon giderlerini de hesaba kat.',
    targetId: 'profit-summary',
    spotlightPadding: 6,
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
    spotlightPadding: 5,
  },
  {
    id: 'products-short',
    title: 'Ürünleri incele',
    description:
      'Ürün kartlarında fiyat, stok durumu ve alım-satım seçeneklerini görebilirsin.',
    targetId: 'products-section',
    spotlightPadding: 6,
  },
  {
    id: 'refresh-short',
    title: 'Veriyi yenile',
    description:
      'Piyasa verisi güncel değilse sağ üstteki yenile butonuyla tekrar deneyebilirsin.',
    targetId: 'refresh-button',
    spotlightPadding: 4,
    primaryLabel: 'Piyasayı Keşfet',
  },
];

const PRODUCT_STEP_TARGET_MAP: Record<string, MarketTutorialProductTargetKind> = {
  'stock-status': 'price',
  'price-trend': 'chart',
  buy: 'buy',
  'warehouse-transfer': 'transfer',
};

export function resolveMarketTutorialStepTargetId(
  stepId: string,
  anchorProductId: ProductId | null | undefined,
): MarketTutorialTargetId | undefined {
  const kind = PRODUCT_STEP_TARGET_MAP[stepId];
  if (!kind || !anchorProductId) {
    return undefined;
  }
  return buildMarketProductTargetId(kind, anchorProductId);
}

export function getMarketTutorialSteps(
  marketState: MarketTutorialMarketState,
  anchorProductId?: ProductId | null,
): MarketTutorialStep[] {
  const steps =
    marketState === 'unavailable' ? MARKET_TUTORIAL_SHORT_STEPS : MARKET_TUTORIAL_FULL_STEPS;

  if (!anchorProductId) {
    return steps;
  }

  return steps.map((step) => {
    const resolvedTargetId = resolveMarketTutorialStepTargetId(step.id, anchorProductId);
    if (!resolvedTargetId) {
      return step;
    }
    return {
      ...step,
      targetId: resolvedTargetId,
    };
  });
}
