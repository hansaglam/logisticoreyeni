/**
 * Delivery incident catalog — severity, polarity, and player-facing templates.
 */

import type {
  DeliveryIncident,
  DeliveryIncidentChoice,
  DeliveryIncidentPolarity,
  DeliveryIncidentSeverity,
  DeliveryIncidentType,
} from '../types/game';
import { formatOperationChoiceEffectSummary } from './deliveryOperationChoice';

export interface IncidentDefinition {
  type: DeliveryIncidentType;
  severity: DeliveryIncidentSeverity;
  polarity: DeliveryIncidentPolarity;
  mechanical: boolean;
  repeatable: boolean;
  categoryLabel: string;
  title: string;
  description: string;
  choices: DeliveryIncidentChoice[];
}

function choice(
  id: string,
  label: string,
  description: string,
  effects: DeliveryIncidentChoice['effects'],
): DeliveryIncidentChoice {
  return {
    id,
    label,
    description,
    effects,
    effectSummary: formatOperationChoiceEffectSummary(effects),
  };
}

const DEFINITIONS: IncidentDefinition[] = [
  {
    type: 'roadwork',
    severity: 'minor',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Rota',
    title: 'Yol çalışması',
    description: 'Önündeki ana yol geçici olarak daraltıldı.',
    choices: [
      choice('detour', 'Alternatif rota', 'Daha hızlı olabilir · Yakıt tüketimi artabilir', {
        deliveryTimeDeltaHours: 0.15,
        fuelCostDelta: 70,
      }),
      choice('wait', 'Bekle', 'Daha güvenli · Kısa gecikme', {
        deliveryTimeDeltaHours: 0.45,
      }),
    ],
  },
  {
    type: 'loading_queue',
    severity: 'minor',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Depo',
    title: 'Yükleme kuyruğu',
    description: 'Rampada bekleyen araçlar var. Sıra biraz uzadı.',
    choices: [
      choice('wait_queue', 'Sırayı bekle', 'Ücretsiz · Kısa gecikme', {
        deliveryTimeDeltaHours: 0.4,
      }),
      choice('priority_fee', 'Hızlı rampa ücreti', 'Küçük maliyet · Zaman kazan', {
        cashDelta: -90,
        deliveryTimeDeltaHours: -0.15,
      }),
    ],
  },
  {
    type: 'cargo_recheck',
    severity: 'minor',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Kontrol',
    title: 'Yük yeniden kontrol',
    description: 'Bağlar gevşek görünüyor. Kısa bir kontrol yeterli.',
    choices: [
      choice('secure', 'Bağları sıkılaştır', 'Güvenli · Küçük gecikme', {
        deliveryTimeDeltaHours: 0.3,
      }),
      choice('continue', 'Yola devam et', 'Zaman kaybı yok · Hafif yıpranma riski', {
        truckConditionDelta: -1,
      }),
    ],
  },
  {
    type: 'weather_slowdown',
    severity: 'minor',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Hava',
    title: 'Hafif yağış',
    description: 'Görüş biraz düştü. Tempo düşünülebilir.',
    choices: [
      choice('slow', 'Tempoyu düşür', 'Daha güvenli · Kısa gecikme', {
        deliveryTimeDeltaHours: 0.35,
      }),
      choice('hold_pace', 'Tempoyu koru', 'Zaman korunur · Biraz daha yakıt', {
        fuelCostDelta: 45,
      }),
    ],
  },
  {
    type: 'checkpoint',
    severity: 'minor',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Kontrol',
    title: 'Kontrol noktası',
    description: 'Yolda rutin bir belge kontrolü var.',
    choices: [
      choice('complete_docs', 'Evrak kontrolünü tamamla', 'Standart prosedür · Kısa gecikme', {
        deliveryTimeDeltaHours: 0.5,
      }),
      choice('alt_checkpoint', 'Alternatif geçiş', 'Küçük ücret · Biraz zaman kazandırır', {
        cashDelta: -160,
        deliveryTimeDeltaHours: -0.15,
      }),
    ],
  },
  {
    type: 'local_operation',
    severity: 'minor',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Yerel Operasyon',
    title: 'Yerel trafik düzenlemesi',
    description: 'Şehir girişinde geçici bir yönlendirme başladı.',
    choices: [
      choice('local_guide', 'Yerel rehber kullan', 'Küçük maliyet · Zaman kazanımı', {
        cashDelta: -140,
        deliveryTimeDeltaHours: -0.25,
      }),
      choice('follow_queue', 'Mevcut sırayı takip et', 'Ücretsiz · Kısa gecikme', {
        deliveryTimeDeltaHours: 0.6,
      }),
    ],
  },
  {
    type: 'unexpected_cost',
    severity: 'minor',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Maliyet',
    title: 'Geçiş ücreti',
    description: 'Rota üzerinde kısa süreli bir operasyon ücreti uygulanıyor.',
    choices: [
      choice('pay_fee', 'Ücreti öde', 'Hızlı ve öngörülebilir', { cashDelta: -120 }),
      choice('detour', 'Ücretsiz yola sap', 'Masrafsız · Kısa gecikme', {
        deliveryTimeDeltaHours: 0.55,
      }),
    ],
  },
  {
    type: 'staff_motivation',
    severity: 'minor',
    polarity: 'neutral',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Personel',
    title: 'Şoför kısa destek bekliyor',
    description: 'Zorlu bir etaptan sonra şoför küçük bir moral desteği istiyor.',
    choices: [
      choice('support_driver', 'Kısa mola ver', 'Küçük gecikme · Deneyim', {
        deliveryTimeDeltaHours: 0.35,
        driverXpDelta: 8,
      }),
      choice('thank_driver', 'Takdir et ve devam et', 'Gecikme yok · Küçük deneyim', {
        driverXpDelta: 3,
      }),
    ],
  },
  {
    type: 'clear_traffic',
    severity: 'minor',
    polarity: 'positive',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Fırsat',
    title: 'Trafik beklenenden açık',
    description: 'Öndeki yol boş. Tempo artırmak mümkün.',
    choices: [
      choice('keep_pace', 'Tempoyu koru', 'Küçük zaman kazancı · Risk yok', {
        deliveryTimeDeltaHours: -0.25,
      }),
      choice('speed_up', 'Hızını artır', 'Daha iyi ilerleme · Hafif yakıt/kondisyon', {
        deliveryTimeDeltaHours: -0.45,
        fuelCostDelta: 55,
        truckConditionDelta: -1,
      }),
    ],
  },
  {
    type: 'fast_loading',
    severity: 'minor',
    polarity: 'positive',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Fırsat',
    title: 'Hızlı yükleme',
    description: 'Depoda yükleme beklenenden hızlı tamamlandı.',
    choices: [
      choice('depart', 'Hemen yola çık', 'Küçük zaman kazancı', {
        deliveryTimeDeltaHours: -0.3,
      }),
      choice('double_check', 'Son bir kontrol yap', 'Kazanç yok · Daha emin çıkış', {}),
    ],
  },
  {
    type: 'discount_fuel',
    severity: 'minor',
    polarity: 'positive',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Yakıt',
    title: 'İndirimli yakıt fırsatı',
    description: 'Rota üzerinde kısa süreli indirimli bir istasyon göründü.',
    choices: [
      choice('buy_fuel', 'Yakıt al', 'İndirimli dolum · Küçük maliyet', {
        cashDelta: -85,
        fuelLitersDelta: 28,
      }),
      choice('skip_fuel', 'Devam et', 'Etki yok', {}),
    ],
  },
  {
    type: 'favorable_weather',
    severity: 'minor',
    polarity: 'positive',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Hava',
    title: 'Hava beklenenden iyi',
    description: 'Görüş ve yol tutuşu iyi. Verimli gitmek mümkün.',
    choices: [
      choice('cruise', 'Verimli ilerle', 'Küçük zaman kazancı', {
        deliveryTimeDeltaHours: -0.2,
      }),
      choice('push', 'Tempo artır', 'Daha hızlı · Hafif yakıt', {
        deliveryTimeDeltaHours: -0.4,
        fuelCostDelta: 40,
      }),
    ],
  },
  {
    type: 'driver_shortcut',
    severity: 'minor',
    polarity: 'positive',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Şoför',
    title: 'Şoför alternatif rota öneriyor',
    description: 'Deneyimli bir kestirme var. Biraz daha yıpratıcı olabilir.',
    choices: [
      choice('take_shortcut', 'Alternatif rotayı kullan', 'Zaman kazancı · Küçük risk', {
        deliveryTimeDeltaHours: -0.5,
        fuelCostDelta: 50,
        truckConditionDelta: -1,
      }),
      choice('stay_main', 'Ana rotada kal', 'Risk yok', {}),
    ],
  },
  {
    type: 'market_opportunity',
    severity: 'moderate',
    polarity: 'positive',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Fırsat',
    title: 'Piyasa fırsatı',
    description: 'Rota üzerindeki bir işletme küçük bir ek yük teklif etti.',
    choices: [
      choice('take_load', 'Ek yükü kabul et', 'Ek gelir · Kontrollü gecikme', {
        cashDelta: 350,
        deliveryTimeDeltaHours: 0.75,
      }),
      choice('decline_load', 'Mevcut işe odaklan', 'Risk ve gecikme yok', {}),
    ],
  },
  {
    type: 'traffic',
    severity: 'moderate',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Rota',
    title: 'Yoğun trafik',
    description: 'Kamyon yoğun trafiğe girdi. Operasyonu nasıl yöneteceksin?',
    choices: [
      choice('alt_route', 'Alternatif rota kullan', 'Ek yakıt maliyeti · Daha hızlı varış', {
        cashDelta: -250,
        deliveryTimeDeltaHours: -1,
      }),
      choice('wait', 'Bekle', 'Ücretsiz · Teslimat gecikir', {
        deliveryTimeDeltaHours: 2,
      }),
    ],
  },
  {
    type: 'driver_break',
    severity: 'moderate',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Şoför',
    title: 'Şoför mola istiyor',
    description: 'Şoför kısa bir mola talep ediyor. Yorgunluk birikebilir.',
    choices: [
      choice('break', 'Mola ver', 'Kısa gecikme · Şoför dinlenir', {
        deliveryTimeDeltaHours: 1,
        driverXpDelta: 5,
      }),
      choice('continue', 'Devam et', 'Zaman korunur · Araç biraz yorulur', {
        truckConditionDelta: -2,
      }),
    ],
  },
  {
    type: 'tire_pressure',
    severity: 'moderate',
    polarity: 'negative',
    mechanical: true,
    repeatable: false,
    categoryLabel: 'Araç',
    title: 'Lastik basıncı uyarısı',
    description: 'Lastik basıncı düşük görünüyor. Şimdi bakmak ilerideki riski azaltır.',
    choices: [
      choice('check', 'Kontrol ettir', 'Küçük maliyet · Risk azalır', {
        cashDelta: -180,
        deliveryTimeDeltaHours: 0.5,
        truckConditionDelta: 1,
      }),
      choice('keep_going', 'Yola devam et', 'Maliyet yok · Kondisyon riski', {
        truckConditionDelta: -3,
      }),
    ],
  },
  {
    type: 'fuel_deviation',
    severity: 'moderate',
    polarity: 'negative',
    mechanical: true,
    repeatable: false,
    categoryLabel: 'Yakıt',
    title: 'Yakıt sapması',
    description: 'Yakıt tüketimi beklenenden farklı seyrediyor.',
    choices: [
      choice('optimize', 'Yakıtı optimize et', 'Kısa gecikme · Tasarruf', {
        deliveryTimeDeltaHours: 0.75,
        fuelCostDelta: -120,
      }),
      choice('speed_up', 'Hızlı devam et', 'Zaman kazancı · Ek yakıt', {
        deliveryTimeDeltaHours: -0.5,
        fuelCostDelta: 180,
      }),
    ],
  },
  {
    type: 'warehouse_issue',
    severity: 'moderate',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Depo',
    title: 'Depo operasyon sorunu',
    description: 'Varış deposunda boşaltma sırası uzadı.',
    choices: [
      choice('priority_slot', 'Öncelikli alan kirala', 'Maliyetli · Hızlı', {
        cashDelta: -260,
        deliveryTimeDeltaHours: -0.5,
      }),
      choice('wait_slot', 'Sırayı bekle', 'Ücretsiz · Operasyon gecikir', {
        deliveryTimeDeltaHours: 1.25,
      }),
    ],
  },
  {
    type: 'customer_request',
    severity: 'moderate',
    polarity: 'neutral',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Müşteri',
    title: 'Müşteri değişiklik talebi',
    description: 'Müşteri teslimatta küçük bir ek operasyon istiyor.',
    choices: [
      choice('accept_request', 'Talebi kabul et', 'Ek gelir · Kısa gecikme', {
        cashDelta: 280,
        deliveryTimeDeltaHours: 0.5,
        reputationDelta: 1,
      }),
      choice('keep_scope', 'Planı koru', 'Teslimat takvimi değişmez', {}),
    ],
  },
  {
    type: 'weather_front',
    severity: 'moderate',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Hava',
    title: 'Hava cephesi',
    description: 'Önde yoğun bir hava bandı var. Tempo kararı senin.',
    choices: [
      choice('slow_down', 'Yavaşla', 'Daha güvenli · Gecikme', {
        deliveryTimeDeltaHours: 0.9,
      }),
      choice('hold_pace', 'Mevcut tempoda devam et', 'Daha hızlı · Yakıt ve yıpranma', {
        fuelCostDelta: 90,
        truckConditionDelta: -2,
      }),
    ],
  },
  {
    type: 'insurance_penalty',
    severity: 'moderate',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Sigorta',
    title: 'Sigorta kontrolü',
    description: 'Operasyon belgesi için ek doğrulama istendi.',
    choices: [
      choice('pay_processing', 'Hızlı işlem ücretini öde', 'Masraf · Zaman kazancı', {
        cashDelta: -210,
        deliveryTimeDeltaHours: -0.25,
      }),
      choice('standard_review', 'Standart incelemeyi bekle', 'Ücretsiz · Kısa gecikme', {
        deliveryTimeDeltaHours: 1,
      }),
    ],
  },
  {
    type: 'emergency_delivery',
    severity: 'moderate',
    polarity: 'positive',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Acil İş',
    title: 'Erken teslim bonusu',
    description: 'Müşteri erken teslim için prim öneriyor.',
    choices: [
      choice('push_schedule', 'Tempoyu artır', 'Prim · Yakıt ve kondisyon maliyeti', {
        cashDelta: 300,
        fuelCostDelta: 100,
        deliveryTimeDeltaHours: -0.75,
        truckConditionDelta: -1,
      }),
      choice('keep_schedule', 'Normal devam et', 'Ek risk yok', {}),
    ],
  },
  {
    type: 'company_reputation',
    severity: 'moderate',
    polarity: 'neutral',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'İtibar',
    title: 'Yerel müşteri desteği',
    description: 'Yerel müşteri teslimat sürecinde ek özen bekliyor. İtibar yalnızca bu karara bağlıdır.',
    choices: [
      choice('premium_support', 'Ek destek sağla', 'Maliyet karşılığı itibar', {
        cashDelta: -240,
        reputationDelta: 2,
      }),
      choice('standard_service', 'Standart hizmet ver', 'Ek maliyet oluşmaz', {}),
    ],
  },
  {
    type: 'truck_failure',
    severity: 'major',
    polarity: 'negative',
    mechanical: true,
    repeatable: false,
    categoryLabel: 'Bakım',
    title: 'Ciddi mekanik uyarı',
    description: 'Araçtan olağan dışı bir ses geliyor. Teslimat durmak zorunda değil; karar senin.',
    choices: [
      choice('roadside_check', 'Yol kenarı kontrolü', 'Güvenli fakat maliyetli', {
        cashDelta: -320,
        deliveryTimeDeltaHours: 0.75,
        truckConditionDelta: 2,
      }),
      choice('continue_carefully', 'Temkinli devam et', 'Masrafsız · Kondisyon kaybı riski', {
        deliveryTimeDeltaHours: 0.5,
        truckConditionDelta: -4,
      }),
    ],
  },
  {
    type: 'severe_weather',
    severity: 'major',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Hava',
    title: 'Şiddetli hava',
    description: 'Önde yoğun fırtına bandı var. Durmak güvenli, devam etmek yıpratıcı.',
    choices: [
      choice('shelter', 'Sığınak bekle', 'Güvenli · Belirgin gecikme', {
        deliveryTimeDeltaHours: 1.6,
      }),
      choice('push_through', 'Dikkatli geç', 'Daha az gecikme · Yakıt ve kondisyon', {
        deliveryTimeDeltaHours: 0.45,
        fuelCostDelta: 140,
        truckConditionDelta: -5,
      }),
    ],
  },
  {
    type: 'cargo_risk',
    severity: 'major',
    polarity: 'negative',
    mechanical: false,
    repeatable: false,
    categoryLabel: 'Yük',
    title: 'Yük hasarı riski',
    description: 'Yük kayması belirtileri var. Şimdi durmak teslimatı kurtarabilir.',
    choices: [
      choice('secure_cargo', 'Dur ve sabitle', 'Zaman ve küçük maliyet · Yük korunur', {
        cashDelta: -160,
        deliveryTimeDeltaHours: 1.1,
      }),
      choice('press_on', 'Dikkatli devam et', 'Gecikme yok · Kondisyon ve zaman baskısı', {
        truckConditionDelta: -3,
        deliveryTimeDeltaHours: 0.25,
      }),
    ],
  },
];

const BY_TYPE = new Map(DEFINITIONS.map((item) => [item.type, item]));

export const DELIVERY_INCIDENT_TYPES: readonly DeliveryIncidentType[] = DEFINITIONS.map(
  (item) => item.type,
);

export const INCIDENT_CATEGORY_LABELS: Record<DeliveryIncidentType, string> = DEFINITIONS.reduce(
  (acc, item) => {
    acc[item.type] = item.categoryLabel;
    return acc;
  },
  {} as Record<DeliveryIncidentType, string>,
);

export function getIncidentDefinition(type: DeliveryIncidentType): IncidentDefinition {
  return BY_TYPE.get(type) ?? DEFINITIONS[0]!;
}

export function listIncidentDefinitions(
  severity?: DeliveryIncidentSeverity,
): readonly IncidentDefinition[] {
  if (!severity) {
    return DEFINITIONS;
  }
  return DEFINITIONS.filter((item) => item.severity === severity);
}

export function isKnownIncidentType(value: string): value is DeliveryIncidentType {
  return BY_TYPE.has(value as DeliveryIncidentType);
}

export function toIncidentTemplate(
  type: DeliveryIncidentType,
): Pick<DeliveryIncident, 'type' | 'title' | 'description' | 'choices' | 'severity' | 'polarity'> {
  const definition = getIncidentDefinition(type);
  return {
    type: definition.type,
    title: definition.title,
    description: definition.description,
    choices: definition.choices.map((item) => ({
      ...item,
      effects: { ...item.effects },
      effectSummary: item.effectSummary ?? formatOperationChoiceEffectSummary(item.effects),
    })),
    severity: definition.severity,
    polarity: definition.polarity,
  };
}
