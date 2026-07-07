import type { TabKey } from '../components/BottomTabBar';
import type { TutorialState, TutorialStepId } from '../types/game';

export interface TutorialStepConfig {
  id: TutorialStepId;
  title: string;
  description: string;
  targetScreen: TabKey;
  ctaLabel: string;
}

export const TUTORIAL_STEPS: TutorialStepConfig[] = [
  {
    id: 'open_contracts',
    title: 'İlk sözleşmeni bul',
    description:
      'Sözleşmeler ekranından kamyonunun bulunduğu şehirden çıkan uygun bir işi seç.',
    targetScreen: 'contracts',
    ctaLabel: 'Sözleşmelere Git',
  },
  {
    id: 'select_contract',
    title: 'Uygun işi seç',
    description:
      'Kamyonunun bulunduğu şehirden çıkan ve kapasitesi uygun olan bir işi seç.',
    targetScreen: 'contracts',
    ctaLabel: 'İşi Seç',
  },
  {
    id: 'assign_team',
    title: 'Ekibini ata',
    description: 'İşi başlatmak için bir kamyon ve bir şoför seç.',
    targetScreen: 'contracts',
    ctaLabel: 'Ekibi Seç',
  },
  {
    id: 'track_delivery',
    title: 'Teslimatı takip et',
    description:
      'Teslimat başladı. Harita veya Ana Sayfa üzerinden ilerlemeyi takip edebilirsin.',
    targetScreen: 'dashboard',
    ctaLabel: 'Takip Et',
  },
  {
    id: 'complete_delivery',
    title: 'İlk kazancını al',
    description: 'Teslimat tamamlandığında ödeme kasana eklenecek.',
    targetScreen: 'dashboard',
    ctaLabel: 'Devam Et',
  },
  {
    id: 'open_market',
    title: 'Piyasayı incele',
    description:
      'Fiyat farklarını ve taşıma fırsatlarını görmek için Piyasa ekranına bak.',
    targetScreen: 'market',
    ctaLabel: 'Piyasaya Git',
  },
];

export const TUTORIAL_STEP_ORDER: TutorialStepId[] = TUTORIAL_STEPS.map((step) => step.id);

const TUTORIAL_STEP_BY_ID = new Map(TUTORIAL_STEPS.map((step) => [step.id, step]));

export function getTutorialStep(stepId: TutorialStepId): TutorialStepConfig | undefined {
  return TUTORIAL_STEP_BY_ID.get(stepId);
}

export function getNextTutorialStepId(stepId: TutorialStepId): TutorialStepId | null {
  const index = TUTORIAL_STEP_ORDER.indexOf(stepId);
  if (index < 0 || index >= TUTORIAL_STEP_ORDER.length - 1) {
    return null;
  }
  return TUTORIAL_STEP_ORDER[index + 1];
}

export function createDefaultTutorialState(): TutorialState {
  return {
    isEnabled: true,
    isCompleted: false,
    currentStepId: 'open_contracts',
    completedStepIds: [],
    dismissedStepIds: [],
  };
}
