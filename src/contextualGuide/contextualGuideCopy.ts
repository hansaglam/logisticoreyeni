/**
 * Player-facing copy for mandatory first-run guided tutorial (TR).
 */

import type { ContextualGuideCardId } from '../types/game';

export type ContextualGuideCardCopy = {
  title: string;
  description: string;
  primaryLabel: string;
};

export const CONTEXTUAL_GUIDE_CARD_COPY: Record<
  ContextualGuideCardId,
  ContextualGuideCardCopy
> = {
  welcome: {
    title: 'Hoş Geldin!',
    description:
      'LogistiCore\'da kendi lojistik şirketini yöneteceksin. Şimdi temel adımları birlikte öğrenelim.',
    primaryLabel: 'Başlayalım',
  },
  choose_contract: {
    title: 'İlk İşini Seç',
    description:
      'Teslimatlar şirketinin ana gelir kaynağıdır. Buradan uygun işleri inceleyebilir ve teslimata hazırlanabilirsin.',
    primaryLabel: 'Sonraki',
  },
  manage_fleet: {
    title: 'Filonu Yönet',
    description:
      'Araçlarını burada görüntüleyebilir, yeni araçlar satın alabilir ve filonu geliştirebilirsin.',
    primaryLabel: 'Sonraki',
  },
  follow_route: {
    title: 'Rotanı Takip Et',
    description:
      'Aktif teslimatların sırasında rotanı, teslimat durumunu ve yolculuğunu Harita üzerinden takip edebilirsin.',
    primaryLabel: 'Sonraki',
  },
  need_help: {
    title: 'Şirketini Büyüt',
    description:
      'Filonu, depolarını, finansını, görevlerini ve diğer şirket sistemlerini Yönetim bölümünden kontrol edebilirsin.',
    primaryLabel: 'Eğitimi Tamamla',
  },
};
