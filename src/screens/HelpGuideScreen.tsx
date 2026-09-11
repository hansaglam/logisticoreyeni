/**
 * Yardım & Rehber — player-facing help content + Getting Started replay.
 */

import React, { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
import {
  AppCard,
  AppScreen,
  GameIcon,
  ScreenHeader,
  SectionTitle,
} from '../components/ui';
import { MIN_TOUCH_TARGET } from '../constants/layout';
import {
  HELP_GUIDE_REPLAY_CTA_LABEL,
  HELP_GUIDE_REPLAY_HINT,
  HELP_GUIDE_SECTIONS,
  type HelpGuideSectionId,
  type HelpGuideSectionMeta,
} from '../contextualGuide/helpGuideSections';
import { consumePendingHelpGuideSection } from '../contextualGuide/openHelpGuide';
import { useGameStore } from '../store/gameStore';
import { colors, radius, spacing, typography } from '../theme';

export type HelpGuideScreenProps = {
  onBack?: () => void;
};

function HelpSectionCard({
  section,
  expanded,
  onToggle,
  onReplayPress,
}: {
  section: HelpGuideSectionMeta;
  expanded: boolean;
  onToggle: () => void;
  onReplayPress?: () => void;
}) {
  return (
    <AppCard style={styles.sectionCard} padded={false}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={onToggle}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${section.title}. ${expanded ? 'Daralt' : 'Genişlet'}`}
      >
        <View style={styles.sectionIconWrap}>
          <GameIcon name={section.icon} size={18} color={colors.accentBlue} />
        </View>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle} numberOfLines={2}>
            {section.title}
          </Text>
          <Text style={styles.sectionSummary} numberOfLines={expanded ? 4 : 2}>
            {section.summary}
          </Text>
        </View>
        <GameIcon
          name={expanded ? 'chevronUp' : 'chevronDown'}
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.sectionBody}>
          {section.paragraphs.map((paragraph) => (
            <Text key={paragraph} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
          {section.bullets && section.bullets.length > 0 ? (
            <View style={styles.bulletList}>
              {section.bullets.map((bullet) => (
                <View key={bullet} style={styles.bulletRow}>
                  <Text style={styles.bulletMark}>•</Text>
                  <Text style={styles.bulletText}>{bullet}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {section.showReplayCta && onReplayPress ? (
            <View style={styles.replayBlock}>
              <Text style={styles.replayHint}>{HELP_GUIDE_REPLAY_HINT}</Text>
              <TouchableOpacity
                style={styles.replayButton}
                onPress={onReplayPress}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={HELP_GUIDE_REPLAY_CTA_LABEL}
              >
                <Text style={styles.replayButtonLabel}>{HELP_GUIDE_REPLAY_CTA_LABEL}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}
    </AppCard>
  );
}

export default function HelpGuideScreen({ onBack }: HelpGuideScreenProps) {
  const { alert: showAlert } = useAppDialog();
  const resetContextualGuideForReplay = useGameStore(
    (state) => state.resetContextualGuideForReplay,
  );
  const [expandedId, setExpandedId] = useState<HelpGuideSectionId | null>(() => {
    return consumePendingHelpGuideSection() ?? 'getting_started';
  });

  const handleReplay = useCallback(() => {
    resetContextualGuideForReplay();
    showAlert(
      'Başlangıç rehberi hazır',
      'Temel adımlar oyun ekranlarında sırayla gösterilecek. İstediğin zaman eğitimden çıkabilirsin.',
      [
        {
          text: 'Ana Ekrana Dön',
          onPress: () => {
            onBack?.();
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { allowContextualGuideNavigationBypass } =
              require('../contextualGuide/contextualGuideSession') as typeof import('../contextualGuide/contextualGuideSession');
            allowContextualGuideNavigationBypass();
            useGameStore.setState({ navigationRequest: { tab: 'dashboard' } });
          },
        },
        { text: 'Burada Kal', style: 'cancel' },
      ],
    );
  }, [onBack, resetContextualGuideForReplay, showAlert]);

  return (
    <AppScreen scroll>
      <ScreenHeader
        title="Yardım & Rehber"
        subtitle="Oyun rehberi ve yardım konuları"
        titleIcon="help"
        onBack={onBack}
        compact
      />

      <AppCard variant="soft" style={styles.introCard} padded>
        <View style={styles.introRow}>
          <View style={styles.introIcon}>
            <GameIcon name="help" size={20} color={colors.accentAmber} />
          </View>
          <View style={styles.introText}>
            <Text style={styles.introTitle}>LogistiCore Rehberi</Text>
            <Text style={styles.introBody}>
              Kısa konular halinde oyun sistemlerini açıklar. Başlarken bölümünden
              temel rehberi tekrar açabilirsin.
            </Text>
          </View>
        </View>
      </AppCard>

      <SectionTitle title="Konular" compact />

      <View style={styles.sectionList}>
        {HELP_GUIDE_SECTIONS.map((section) => (
          <HelpSectionCard
            key={section.id}
            section={section}
            expanded={expandedId === section.id}
            onToggle={() =>
              setExpandedId((current) =>
                current === section.id ? null : section.id,
              )
            }
            onReplayPress={section.showReplayCta ? handleReplay : undefined}
          />
        ))}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  introCard: {
    marginBottom: spacing.md,
  },
  introRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.accentAmberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introText: {
    flex: 1,
    minWidth: 0,
  },
  introTitle: {
    ...typography.cardTitle,
    marginBottom: spacing.xs,
  },
  introBody: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  sectionList: {
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  sectionCard: {
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET + spacing.md,
  },
  sectionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.accentBlueSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    ...typography.cardTitle,
  },
  sectionSummary: {
    ...typography.bodySmall,
    marginTop: 2,
    color: colors.textSecondary,
  },
  sectionBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  paragraph: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  bulletList: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  bulletMark: {
    ...typography.bodySmall,
    color: colors.accentAmber,
    fontWeight: '800',
    width: 12,
  },
  bulletText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
    minWidth: 0,
    lineHeight: 18,
  },
  replayBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  replayHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  replayButton: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.button,
    backgroundColor: colors.accentAmber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  replayButtonLabel: {
    ...typography.buttonText,
    color: '#1A1200',
    fontWeight: '800',
    textAlign: 'center',
  },
});
