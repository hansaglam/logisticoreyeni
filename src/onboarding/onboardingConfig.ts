import type { NextActionVariant } from '../components/dashboard/dashboardHubLogic';
import type { GameIconName } from '../theme/icons';
import type { OnboardingRoute, OnboardingStepId } from '../types/game';

export interface OnboardingStepConfig {
  id: OnboardingStepId;
  title: string;
  description: string;
  /** Dashboard kartında gösterilecek açıklama — yoksa description kullanılır */
  dashboardDescription?: string;
  ctaLabel: string;
  route: OnboardingRoute;
  variant: NextActionVariant;
  icon: GameIconName;
  /** Yalnızca kullanıcı CTA ile tamamlanır */
  manualComplete?: boolean;
  hintId?: string;
  hintTitle?: string;
  hintDescription?: string;
}

export const ONBOARDING_STEP_ORDER: OnboardingStepId[] = [
  'welcome',
  'first_contract',
  'track_delivery',
  'market_intro',
  'first_trade',
  'warehouse_intro',
  'claim_rewards',
  'finish',
];

export const ONBOARDING_STEPS: OnboardingStepConfig[] = [
  {
    id: 'welcome',
    title: 'LogistiCore’a Hoş Geldin',
    description:
      'Şirketini büyütmek için sözleşmeler al, teslimatlar yap ve piyasayı takip et.',
    dashboardDescription:
      'İlk hedefin: uygun bir sözleşme seçip ilk teslimatını başlatmak.',
    ctaLabel: 'Başla',
    route: null,
    variant: 'primary',
    icon: 'company',
    manualComplete: true,
  },
  {
    id: 'first_contract',
    title: 'İlk İşini Seç',
    description:
      'İşler ekranında sana uygun sözleşmelerden biriyle ilk teslimatına başla.',
    ctaLabel: 'İşlere Git',
    route: 'Contracts',
    variant: 'primary',
    icon: 'contract',
    hintId: 'contracts_first_contract',
    hintTitle: 'Uygun İşler',
    hintDescription:
      'Başlatabileceğin işler üstte görünür. Bir işe dokunup teslimatı başlat.',
  },
  {
    id: 'track_delivery',
    title: 'Teslimatı Takip Et',
    description: 'Aktif teslimatlarını Harita ekranından takip edebilirsin.',
    ctaLabel: 'Haritaya Git',
    route: 'Map',
    variant: 'track',
    icon: 'map',
    hintId: 'map_track_delivery',
    hintTitle: 'Harita İpucu',
    hintDescription: 'Aktif teslimatlarını ve araç konumlarını buradan izle.',
  },
  {
    id: 'market_intro',
    title: 'Piyasayı Keşfet',
    description:
      'Stok fazla ürünler alım için, yoğun talep gören ürünler satış için takip edilebilir.',
    ctaLabel: 'Piyasaya Git',
    route: 'Market',
    variant: 'explore',
    icon: 'market',
    hintId: 'market_intro',
    hintTitle: 'Piyasa İpucu',
    hintDescription: 'Stok Fazla alım, Yoğun Talep satış fırsatı olabilir.',
  },
  {
    id: 'first_trade',
    title: 'İlk Ticaretini Yap',
    description:
      'Deposu olan şehirlerde ürün alabilir, fiyat değişince kârla satabilirsin.',
    ctaLabel: 'Piyasaya Git',
    route: 'Market',
    variant: 'explore',
    icon: 'market',
    hintId: 'market_first_trade',
    hintTitle: 'Piyasa İpucu',
    hintDescription: 'Stok Fazla alım, Yoğun Talep satış fırsatı olabilir.',
  },
  {
    id: 'warehouse_intro',
    title: 'Stoklarını Yönet',
    description:
      'Depolar ekranında ürünlerini, kapasiteni ve net kâr/zarar durumunu görebilirsin.',
    ctaLabel: 'Depolara Git',
    route: 'Warehouse',
    variant: 'primary',
    icon: 'warehouse',
    hintId: 'warehouse_intro',
    hintTitle: 'Depo İpucu',
    hintDescription: 'Stoklarının net kâr/zararını ve boş kapasiteni buradan takip et.',
  },
  {
    id: 'claim_rewards',
    title: 'Görev Ödüllerini Al',
    description:
      'Tamamlanan başlangıç görevlerinden ödül alarak şirketini hızlandır.',
    ctaLabel: 'Görevlere Git',
    route: 'Missions',
    variant: 'reward',
    icon: 'contract',
    hintId: 'missions_claim_rewards',
    hintTitle: 'Görev Ödülleri',
    hintDescription: 'Hazır ödülleri alarak şirketini daha hızlı büyüt.',
  },
  {
    id: 'finish',
    title: 'Şirketin Yola Çıktı',
    description:
      'Artık işler, piyasa fırsatları ve depolarla şirketini büyütebilirsin.',
    ctaLabel: 'Tamam',
    route: null,
    variant: 'primary',
    icon: 'company',
    manualComplete: true,
  },
];

const STEP_BY_ID = new Map(ONBOARDING_STEPS.map((step) => [step.id, step]));

export function getOnboardingStepById(stepId: string | null | undefined): OnboardingStepConfig | null {
  if (!stepId) return null;
  return STEP_BY_ID.get(stepId as OnboardingStepId) ?? null;
}

export function getNextOnboardingStepId(stepId: OnboardingStepId): OnboardingStepId | null {
  const index = ONBOARDING_STEP_ORDER.indexOf(stepId);
  if (index < 0 || index >= ONBOARDING_STEP_ORDER.length - 1) {
    return null;
  }
  return ONBOARDING_STEP_ORDER[index + 1] ?? null;
}

export function getOnboardingStepIndex(stepId: OnboardingStepId): number {
  const index = ONBOARDING_STEP_ORDER.indexOf(stepId);
  return index >= 0 ? index + 1 : 1;
}

export function getOnboardingProgressLabel(stepId: OnboardingStepId): string {
  const index = getOnboardingStepIndex(stepId);
  return `Başlangıç Rehberi ${index}/${ONBOARDING_STEP_ORDER.length}`;
}

export const KNOWN_ONBOARDING_STEP_IDS = new Set<OnboardingStepId>(ONBOARDING_STEP_ORDER);
