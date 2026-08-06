/**
 * Piyasa olayı kartı için oyuncu odaklı görüntü modeli.
 * WorldEvent + şablon + impact çarpanlarından türetilir.
 */

import { getWorldEventTemplate } from '../data/worldEvents';
import { gameDayFromTime } from '../simulation/worldEvents';
import type {
  WorldEvent,
  WorldEventImpact,
  WorldEventSeverity,
  WorldEventType,
} from '../types/game';
import { colors } from '../theme/colors';
import type { GameIconName } from '../theme/icons';
import { getCityName, getProductName } from './entityLookup';

function getWorldEventAccent(type: WorldEventType): string {
  switch (type) {
    case 'harvest_surplus':
      return colors.accentAmber;
    case 'port_congestion':
    case 'road_work':
      return '#22D3EE';
    case 'fuel_crisis':
      return colors.danger;
    default:
      return colors.accentBlue;
  }
}

export type WorldEventDisplayTone = 'crisis' | 'opportunity' | 'warning' | 'neutral';

export type WorldEventImpactDirection = 'up' | 'down' | 'mixed';

export type WorldEventImpactSentiment = 'positive' | 'negative' | 'neutral';

export interface WorldEventImpactItem {
  label: string;
  direction: WorldEventImpactDirection;
  sentiment: WorldEventImpactSentiment;
}

export interface WorldEventDisplayModel {
  title: string;
  shortDescription: string;
  causeText: string;
  impactItems: WorldEventImpactItem[];
  meaningBullets: string[];
  playerAdvice: string[];
  statusLabel: string;
  tone: WorldEventDisplayTone;
  accentColor: string;
  iconName: GameIconName;
  durationLabel: string | null;
  scopeLabel: string | null;
  isFallback: boolean;
}

const FALLBACK_DESCRIPTION =
  'Bu olay piyasa koşullarını etkiliyor. Detaylar yakında güncellenecek.';

const DISPLAY_COPY: Partial<
  Record<
    WorldEventType,
    {
      cause: string;
      meaning: string[];
      advice: string[];
      shortDescription?: string;
    }
  >
> = {
  fuel_crisis: {
    shortDescription:
      'Küresel arz baskısı nedeniyle yakıt maliyetleri arttı. Bu durum özellikle uzun rotalı teslimatlarda giderleri yükseltir.',
    cause:
      'Tedarik zinciri ve enerji piyasasındaki dalgalanma yakıt maliyetini artırdı.',
    meaning: [
      'Yakıt Krizi sırasında teslimat başına maliyet artar.',
      'Yakıt tüketimi yüksek kamyonlar daha pahalı çalışır.',
      'Kâr marjı düşük işlerde dikkatli seçim yapmak gerekir.',
      'Bazı şehirlerde fiyat dengesizliği yeni ticaret fırsatları doğurabilir.',
    ],
    advice: [
      'Yakın rotalara öncelik ver',
      'Kârı yüksek sözleşmeleri seç',
      'Piyasadaki fırsat ürünlerini takip et',
    ],
  },
  city_demand_boom: {
    shortDescription: 'Bazı ürünlerde ani talep artışı oluştu.',
    cause: 'Tüketim ve ihracat talebi kısa sürede yükseldi.',
    meaning: [
      'Bazı sözleşmelerin ödemesi artabilir.',
      'Stok az olan şehirlerde fiyat yükselebilir.',
      'Doğru ürün ve rota seçimiyle ticaret fırsatı doğabilir.',
    ],
    advice: [
      'Talep yüksek şehirleri haritada takip et',
      'Stoklu ve talepli rotaları karşılaştır',
      'Ödeme yüksek işlere öncelik ver',
    ],
  },
  city_supply_shortage: {
    shortDescription: 'Bazı ürünlerde arz daraldı, fiyat oynaklığı arttı.',
    cause: 'Üretim veya lojistik aksaması bölgesel arzı kısıtladı.',
    meaning: [
      'Stok azlığı fiyatları yukarı çekebilir.',
      'Bazı ürünlerde alım maliyeti artabilir.',
      'Fırsat ve risk aynı anda oluşabilir.',
    ],
    advice: [
      'Stok seviyelerini şehir bazında kontrol et',
      'Yüksek marjlı ürünleri öne al',
      'Alternatif şehirlerde arz ara',
    ],
  },
  electronics_boom: {
    shortDescription: 'Elektronik ürünlere talep kısa sürede yükseldi.',
    cause: 'Perakende ve ihracat kanallarında ani sipariş artışı yaşandı.',
    meaning: [
      'Elektronik fiyatları yükselme eğiliminde.',
      'Doğru şehirde satış daha kârlı olabilir.',
    ],
    advice: ['Elektronik stoklarını gözden geçir', 'Talep yüksek şehirlere odaklan'],
  },
  harvest_surplus: {
    shortDescription: 'Hasat bolluğu bazı ürünlerde alım fiyatlarını düşürdü.',
    cause: 'Sezonluk üretim artışı piyasaya fazla arz sağladı.',
    meaning: [
      'Ucuz alım fırsatı oluşabilir.',
      'Depo maliyetini göz önünde bulundurarak stok planla.',
    ],
    advice: ['Düşük fiyattan stokla', 'Talep yüksek şehirlere taşı'],
  },
  port_congestion: {
    shortDescription: 'Liman yoğunluğu sevkiyatları yavaşlatıyor; bazı işler daha iyi ödüyor.',
    cause: 'Liman kapasitesi ve yükleme sıraları gecikmeye yol açtı.',
    meaning: [
      'Teslimat süreleri uzayabilir.',
      'Bazı sözleşmeler ek ödeme sunabilir.',
    ],
    advice: ['Süre baskısı olan işlerde dikkatli ol', 'Yüksek ödemeli liman işlerini değerlendir'],
  },
  road_work: {
    shortDescription: 'Yol çalışmaları bölgesel sevkiyatları yavaşlatıyor.',
    cause: 'Bakım ve altyapı çalışmaları trafik akışını kısıtladı.',
    meaning: ['Rota süreleri uzayabilir.', 'Planlama yaparken ekstra süre bırak.'],
    advice: ['Alternatif rotaları düşün', 'Kısa mesafeli işlere öncelik ver'],
  },
  cold_chain_demand: {
    shortDescription: 'Soğuk zincir taşımacılığına talep arttı.',
    cause: 'Hassas ürün sevkiyatlarında kapasite baskısı oluştu.',
    meaning: [
      'İlgili ürünlerde ödeme artışı görülebilir.',
      'Yeni sözleşme fırsatları doğabilir.',
    ],
    advice: ['Meyve ve içecek rotalarını kontrol et', 'Soğuk depo avantajını kullan'],
  },
  industrial_support: {
    shortDescription: 'Sanayi bölgelerinde üretim destekleri talebi hareketlendirdi.',
    cause: 'Yerel teşvikler çelik ve makine talebini artırdı.',
    meaning: [
      'Sanayi ürünlerinde fiyat ve iş hacmi değişebilir.',
      'Yeni kontrat fırsatları oluşabilir.',
    ],
    advice: ['Çelik ve makine piyasasını izle', 'Sanayi şehirlerine odaklan'],
  },
  maintenance_campaign: {
    shortDescription: 'Servis kampanyası bakım maliyetlerini geçici olarak düşürdü.',
    cause: 'Yetkili servislerde dönemsel indirim ve kampanya uygulanıyor.',
    meaning: [
      'Bakım giderleri kısa süreliğine daha düşük olabilir.',
      'Filo bakımı için uygun dönem.',
    ],
    advice: ['Ertelenmiş bakımları planla', 'Aşınmış araçları önceliklendir'],
  },
};

function isMultiplierUp(value: number | undefined, threshold = 1.01): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > threshold;
}

function isMultiplierDown(value: number | undefined, threshold = 0.99): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value < threshold;
}

function resolveEventIcon(type: WorldEventType): GameIconName {
  switch (type) {
    case 'harvest_surplus':
      return 'foodApple';
    case 'fuel_crisis':
      return 'fuel';
    case 'port_congestion':
    case 'road_work':
      return 'route';
    case 'cold_chain_demand':
      return 'cup';
    case 'electronics_boom':
      return 'chip';
    case 'industrial_support':
      return 'cog';
    case 'maintenance_campaign':
      return 'maintenance';
    case 'city_demand_boom':
    case 'city_supply_shortage':
      return 'city';
    default:
      return 'alert';
  }
}

function resolveTone(event: WorldEvent, impact: WorldEventImpact): WorldEventDisplayTone {
  if (event.type === 'fuel_crisis' || event.severity === 'high') {
    return 'crisis';
  }
  if (
    event.type === 'harvest_surplus' ||
    event.type === 'maintenance_campaign' ||
    isMultiplierDown(impact.maintenanceCostMultiplier) ||
    isMultiplierDown(impact.productPriceMultiplier)
  ) {
    return 'opportunity';
  }
  if (
    event.type === 'road_work' ||
    event.type === 'port_congestion' ||
    event.type === 'city_supply_shortage'
  ) {
    return 'warning';
  }
  if (
    isMultiplierUp(impact.contractPaymentMultiplier) ||
    isMultiplierUp(impact.productDemandMultiplier) ||
    isMultiplierUp(impact.contractSpawnWeightMultiplier)
  ) {
    return 'opportunity';
  }
  return event.severity === 'medium' ? 'warning' : 'neutral';
}

function resolveStatusLabel(tone: WorldEventDisplayTone, event: WorldEvent): string {
  if (tone === 'crisis') return 'KRİZ';
  if (tone === 'opportunity') return 'FIRSAT';
  if (tone === 'warning') return 'UYARI';
  if (event.isActive) return 'CANLI';
  return 'AKTİF';
}

function buildImpactItems(impact: WorldEventImpact): WorldEventImpactItem[] {
  const items: WorldEventImpactItem[] = [];

  if (isMultiplierUp(impact.fuelPriceMultiplier)) {
    items.push({
      label: 'Yakıt fiyatı',
      direction: 'up',
      sentiment: 'negative',
    });
    items.push({
      label: 'Teslimat maliyeti',
      direction: 'up',
      sentiment: 'negative',
    });
    items.push({
      label: 'Uzun rota kârlılığı',
      direction: 'down',
      sentiment: 'negative',
    });
  }

  if (isMultiplierUp(impact.contractPaymentMultiplier)) {
    items.push({
      label: 'Sözleşme ödemesi',
      direction: 'up',
      sentiment: 'positive',
    });
  }

  if (isMultiplierUp(impact.deliveryDurationMultiplier)) {
    items.push({
      label: 'Teslimat süresi',
      direction: 'up',
      sentiment: 'negative',
    });
  }

  if (isMultiplierUp(impact.productPriceMultiplier)) {
    items.push({
      label: 'Ürün fiyatları',
      direction: 'up',
      sentiment: 'negative',
    });
  } else if (isMultiplierDown(impact.productPriceMultiplier)) {
    items.push({
      label: 'Alım fiyatları',
      direction: 'down',
      sentiment: 'positive',
    });
  }

  if (isMultiplierUp(impact.productDemandMultiplier)) {
    items.push({
      label: 'Talep',
      direction: 'up',
      sentiment: 'positive',
    });
    items.push({
      label: 'Bazı fırsat kontratları',
      direction: 'up',
      sentiment: 'positive',
    });
  }

  if (isMultiplierUp(impact.maintenanceCostMultiplier)) {
    items.push({
      label: 'Bakım maliyeti',
      direction: 'up',
      sentiment: 'negative',
    });
  } else if (isMultiplierDown(impact.maintenanceCostMultiplier)) {
    items.push({
      label: 'Bakım maliyeti',
      direction: 'down',
      sentiment: 'positive',
    });
  }

  if (isMultiplierUp(impact.contractSpawnWeightMultiplier)) {
    items.push({
      label: 'Yeni iş fırsatları',
      direction: 'up',
      sentiment: 'positive',
    });
  }

  const unique = new Map<string, WorldEventImpactItem>();
  for (const item of items) {
    unique.set(item.label, item);
  }
  return [...unique.values()].slice(0, 4);
}

function buildScopeLabel(event: WorldEvent): string | null {
  const cityName = event.cityId ? getCityName(event.cityId) : null;
  const productName = event.productId ? getProductName(event.productId) : null;
  if (cityName && productName) return `${cityName} · ${productName}`;
  if (cityName) return cityName;
  if (productName) return productName;
  return null;
}

function buildShortDescription(event: WorldEvent, templateDescription?: string): string {
  const copy = DISPLAY_COPY[event.type];
  if (copy?.shortDescription) {
    return copy.shortDescription;
  }
  const fromEvent = event.description?.trim();
  if (fromEvent && fromEvent.length > 12) {
    return fromEvent;
  }
  if (templateDescription?.trim()) {
    return templateDescription.trim();
  }
  return FALLBACK_DESCRIPTION;
}

function buildCauseText(event: WorldEvent): string {
  const copy = DISPLAY_COPY[event.type];
  if (copy?.cause) return copy.cause;
  const scope = buildScopeLabel(event);
  if (scope) {
    return `${scope} bölgesinde piyasa koşulları kısa sürede değişti.`;
  }
  return 'Piyasa koşullarındaki ani değişim bu olayı tetikledi.';
}

function buildMeaningBullets(event: WorldEvent): string[] {
  const copy = DISPLAY_COPY[event.type];
  if (copy?.meaning?.length) return copy.meaning;
  return [
    'Bu olay fiyat, talep veya maliyet dengesini etkileyebilir.',
    'Piyasa ekranından etkilenen ürünleri takip edebilirsin.',
  ];
}

function buildPlayerAdvice(event: WorldEvent): string[] {
  const copy = DISPLAY_COPY[event.type];
  if (copy?.advice?.length) return copy.advice;
  return [
    'Etkilenen şehir ve ürünleri kontrol et',
    'Kâr marjını düşük işlerde daha dikkatli seçim yap',
  ];
}

/** UI için kalan süre etiketi */
export function formatWorldEventDurationLabel(
  event: WorldEvent,
  currentTime: number,
): string | null {
  if (typeof event.endsAt === 'number' && Number.isFinite(event.endsAt)) {
    const remainingMs = Math.max(0, event.endsAt - Date.now());
    if (remainingMs <= 0) return 'Sona eriyor';
    const totalMinutes = Math.floor(remainingMs / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 24) return `${Math.floor(hours / 24)} gün kaldı`;
    if (hours > 0) return `${hours} sa ${minutes} dk`;
    return minutes > 0 ? `${minutes} dk kaldı` : 'Az kaldı';
  }

  const currentDay = gameDayFromTime(currentTime);
  const daysLeft = Math.max(0, event.endsAtDay - currentDay);
  if (daysLeft <= 0) return 'Bugün sona eriyor';
  if (daysLeft === 1) return '1 gün kaldı';
  return `${daysLeft} gün kaldı`;
}

export function buildWorldEventDisplay(
  event: WorldEvent,
  currentTime = 0,
): WorldEventDisplayModel {
  const template = getWorldEventTemplate(event.type);
  const title = template?.uiLabel ?? event.title ?? 'Piyasa Olayı';
  const tone = resolveTone(event, event.impact);
  const impactItems = buildImpactItems(event.impact);
  const hasRichContent = Boolean(template || DISPLAY_COPY[event.type] || impactItems.length > 0);

  return {
    title,
    shortDescription: buildShortDescription(event, template?.description),
    causeText: buildCauseText(event),
    impactItems,
    meaningBullets: buildMeaningBullets(event),
    playerAdvice: buildPlayerAdvice(event),
    statusLabel: resolveStatusLabel(tone, event),
    tone,
    accentColor: getWorldEventAccent(event.type),
    iconName: resolveEventIcon(event.type),
    durationLabel: currentTime > 0 ? formatWorldEventDurationLabel(event, currentTime) : null,
    scopeLabel: buildScopeLabel(event),
    isFallback: !hasRichContent,
  };
}

function severityRank(severity: WorldEventSeverity): number {
  if (severity === 'high') return 0;
  if (severity === 'medium') return 1;
  return 2;
}

/** En önemli olayı öne çıkarır */
export function sortWorldEventsByImportance(events: WorldEvent[]): WorldEvent[] {
  return [...events].sort((left, right) => {
    const severityDelta = severityRank(left.severity) - severityRank(right.severity);
    if (severityDelta !== 0) return severityDelta;
    const leftFuel = left.impact.fuelPriceMultiplier ?? 1;
    const rightFuel = right.impact.fuelPriceMultiplier ?? 1;
    return rightFuel - leftFuel;
  });
}

export function getWorldEventToneColors(tone: WorldEventDisplayTone): {
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
} {
  switch (tone) {
    case 'crisis':
      return {
        badgeBg: 'rgba(248, 113, 113, 0.14)',
        badgeText: '#FCA5A5',
        badgeBorder: 'rgba(248, 113, 113, 0.45)',
      };
    case 'opportunity':
      return {
        badgeBg: 'rgba(52, 211, 153, 0.12)',
        badgeText: '#6EE7B7',
        badgeBorder: 'rgba(52, 211, 153, 0.42)',
      };
    case 'warning':
      return {
        badgeBg: 'rgba(251, 191, 36, 0.12)',
        badgeText: '#FCD34D',
        badgeBorder: 'rgba(251, 191, 36, 0.42)',
      };
    default:
      return {
        badgeBg: 'rgba(57, 160, 255, 0.12)',
        badgeText: '#93C5FD',
        badgeBorder: 'rgba(57, 160, 255, 0.42)',
      };
  }
}

export function getImpactItemColors(sentiment: WorldEventImpactSentiment): {
  text: string;
  bg: string;
  border: string;
} {
  switch (sentiment) {
    case 'positive':
      return {
        text: '#6EE7B7',
        bg: 'rgba(16, 185, 129, 0.10)',
        border: 'rgba(16, 185, 129, 0.28)',
      };
    case 'negative':
      return {
        text: '#FCA5A5',
        bg: 'rgba(239, 68, 68, 0.10)',
        border: 'rgba(239, 68, 68, 0.28)',
      };
    default:
      return {
        text: '#93C5FD',
        bg: 'rgba(57, 160, 255, 0.10)',
        border: 'rgba(57, 160, 255, 0.28)',
      };
  }
}
