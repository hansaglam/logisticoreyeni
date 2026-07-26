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
  hintId?: string;
  hintTitle?: string;
  hintDescription?: string;
  /** Kamyon rotası artwork göster */
  showArtwork?: boolean;
}

export const ONBOARDING_STEP_ORDER: OnboardingStepId[] = [
  'choose_first_contract',
  'assign_team',
  'track_delivery',
  'complete_first_delivery',
  'claim_first_reward',
];

export const ONBOARDING_TOTAL_STEPS = ONBOARDING_STEP_ORDER.length;

export const ONBOARDING_STEPS: OnboardingStepConfig[] = [
  {
    id: 'choose_first_contract',
    title: 'İlk İşini Seç',
    description: 'Uygun bir sözleşme seçerek lojistik operasyonuna başla.',
    ctaLabel: 'İşlere Git',
    route: 'Contracts',
    variant: 'primary',
    icon: 'contract',
    showArtwork: true,
    hintId: 'contracts_choose_first',
    hintTitle: 'Uygun İşler',
    hintDescription: 'Başlatabileceğin işler üstte görünür. Bir işe dokunup devam et.',
  },
  {
    id: 'assign_team',
    title: 'Kamyon ve Şoför Ata',
    description: 'Yük kapasitesine uygun kamyonu ve müsait şoförü görevlendir.',
    ctaLabel: 'Atamayı Yap',
    route: 'Contracts',
    variant: 'primary',
    icon: 'truck',
    hintId: 'contracts_assign_team',
    hintTitle: 'Ekip Ataması',
    hintDescription: 'Kamyon ve şoför seçip teslimatı başlat.',
  },
  {
    id: 'track_delivery',
    title: 'Teslimatı Takip Et',
    description: 'Kamyonun rotasını ve kalan teslim süresini haritadan izle.',
    ctaLabel: 'Haritaya Git',
    route: 'Map',
    variant: 'track',
    icon: 'map',
    showArtwork: true,
    hintId: 'map_track_delivery',
    hintTitle: 'Harita İpucu',
    hintDescription: 'Aktif teslimatlarını ve araç konumlarını buradan izle.',
  },
  {
    id: 'complete_first_delivery',
    title: 'İlk Teslimatını Tamamla',
    description: 'Teslimat tamamlandığında ödeme, deneyim ve itibar kazanırsın.',
    ctaLabel: 'Teslimatı Gör',
    route: 'Map',
    variant: 'track',
    icon: 'truck',
    showArtwork: true,
    hintId: 'map_complete_delivery',
    hintTitle: 'Teslimat Devam Ediyor',
    hintDescription: 'Teslimat tamamlanana kadar rotayı buradan takip edebilirsin.',
  },
  {
    id: 'claim_first_reward',
    title: 'İlk Ödülünü Al',
    description: 'Başlangıç görevini tamamladın. Hazır ödülünü alarak şirketini güçlendir.',
    ctaLabel: 'Görevlere Git',
    route: 'Missions',
    variant: 'reward',
    icon: 'level',
    hintId: 'missions_claim_reward',
    hintTitle: 'Görev Ödülleri',
    hintDescription: 'Hazır ödülleri alarak şirketini daha hızlı büyüt.',
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
  return `BAŞLANGIÇ REHBERİ · ${index}/${ONBOARDING_TOTAL_STEPS}`;
}

export const KNOWN_ONBOARDING_STEP_IDS = new Set<OnboardingStepId>(ONBOARDING_STEP_ORDER);

const LEGACY_STEP_MAP: Record<string, OnboardingStepId> = {
  welcome: 'choose_first_contract',
  first_contract: 'choose_first_contract',
  track_delivery: 'track_delivery',
  market_intro: 'claim_first_reward',
  first_trade: 'claim_first_reward',
  warehouse_intro: 'claim_first_reward',
  claim_rewards: 'claim_first_reward',
  finish: 'claim_first_reward',
};

export function migrateOnboardingStepId(stepId: string | null | undefined): OnboardingStepId | null {
  if (!stepId) return null;
  if (KNOWN_ONBOARDING_STEP_IDS.has(stepId as OnboardingStepId)) {
    return stepId as OnboardingStepId;
  }
  return LEGACY_STEP_MAP[stepId] ?? 'choose_first_contract';
}
