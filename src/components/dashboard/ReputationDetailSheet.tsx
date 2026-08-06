import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AppTutorialHelpButton from '../tutorial/AppTutorialHelpButton';
import AppTutorialOverlay from '../tutorial/AppTutorialOverlay';
import { AppTutorialTarget } from '../tutorial/AppTutorialTarget';
import { useScreenAppTutorial } from '../../hooks/useScreenAppTutorial';

import {
  REPUTATION_DECREASE_BEHAVIORS,
  REPUTATION_INCREASE_BEHAVIORS,
  REPUTATION_RULES,
} from '../../config/reputationRules';
import type { ReputationSummary } from '../../domain/reputationModel';
import type { ReputationHistoryEntry } from '../../domain/reputationModel';
import { GameIcon, ProgressBar } from '../ui';
import { colors } from '../../theme';

interface ReputationDetailSheetProps {
  visible: boolean;
  summary: ReputationSummary;
  history: ReputationHistoryEntry[];
  onClose: () => void;
}

function formatRuleDelta(key: keyof typeof REPUTATION_RULES): string {
  const value = REPUTATION_RULES[key];
  return value > 0 ? `+${value}` : `${value}`;
}

export default function ReputationDetailSheet({
  visible,
  summary,
  history,
  onClose,
}: ReputationDetailSheetProps) {
  const [layoutReady, setLayoutReady] = useState(false);

  const reputationTutorial = useScreenAppTutorial({
    tutorialId: 'reputation',
    layoutReady,
    blockingModals: !visible,
    autoStart: visible,
  });

  const pointsToNext =
    summary.nextTierAt != null ? Math.max(0, summary.nextTierAt - summary.score) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Şirket İtibarı</Text>
            <View style={styles.headerActions}>
              <AppTutorialHelpButton {...reputationTutorial.helpButtonProps} />
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
                hitSlop={12}
              >
                <GameIcon name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            onLayout={() => setLayoutReady(true)}
          >
            <AppTutorialTarget tutorialId="reputation" targetId="reputation-score">
              <View style={styles.scoreCard}>
                <Text style={styles.scoreValue}>
                  {summary.score}
                  <Text style={styles.scoreMax}>/100</Text>
                </Text>
                <Text style={styles.tierLabel}>{summary.tierLabel}</Text>
                <ProgressBar
                  progress={summary.progressToNextTier}
                  color={colors.purple}
                  height={6}
                  trackColor={colors.surface3}
                />
                {pointsToNext != null ? (
                  <Text style={styles.nextTierText}>
                    Sonraki seviyeye {pointsToNext} puan
                  </Text>
                ) : (
                  <Text style={styles.nextTierText}>En yüksek itibar seviyesindesin</Text>
                )}
              </View>
            </AppTutorialTarget>

            <AppTutorialTarget tutorialId="reputation" targetId="reputation-how">
              <View>
                <Text style={styles.lead}>
                  İtibar; teslimat performansını, sözleşme güvenilirliğini ve operasyon
                  kararlarını yansıtır.
                </Text>

                <Text style={styles.sectionTitle}>Artıran davranışlar</Text>
                {REPUTATION_INCREASE_BEHAVIORS.map((item) => (
                  <View key={item.key} style={styles.ruleRow}>
                    <Text style={styles.ruleLabel}>{item.label}</Text>
                    <Text style={styles.ruleDeltaPositive}>
                      {item.key === 'operation-positive'
                        ? `+${REPUTATION_RULES.positiveOperationOutcome}`
                        : formatRuleDelta(item.key as keyof typeof REPUTATION_RULES)}
                    </Text>
                  </View>
                ))}
              </View>
            </AppTutorialTarget>

            <AppTutorialTarget tutorialId="reputation" targetId="reputation-why">
              <View>
                <Text style={styles.sectionTitle}>Azaltan davranışlar</Text>
                {REPUTATION_DECREASE_BEHAVIORS.map((item) => (
                  <View key={item.key} style={styles.ruleRow}>
                    <Text style={styles.ruleLabel}>{item.label}</Text>
                    <Text style={styles.ruleDeltaNegative}>{formatRuleDelta(item.key)}</Text>
                  </View>
                ))}

                <Text style={styles.sectionTitle}>Son değişimler</Text>
                {history.length === 0 ? (
                  <Text style={styles.emptyHistory}>Henüz kayıtlı itibar değişimi yok.</Text>
                ) : (
                  history.slice(0, 10).map((entry) => (
                    <View key={entry.id} style={styles.historyRow}>
                      <Text
                        style={[
                          styles.historyDelta,
                          entry.delta >= 0 ? styles.historyDeltaPositive : styles.historyDeltaNegative,
                        ]}
                      >
                        {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                      </Text>
                      <Text style={styles.historyReason} numberOfLines={2}>
                        {entry.reason}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </AppTutorialTarget>
          </ScrollView>
          <AppTutorialOverlay {...reputationTutorial.overlayProps} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,8,23,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.2)',
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: 10,
    paddingBottom: 8,
  },
  scoreCard: {
    gap: 6,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(168,85,247,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.22)',
  },
  scoreValue: {
    color: colors.purple,
    fontSize: 28,
    fontWeight: '800',
  },
  scoreMax: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tierLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  nextTierText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  lead: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 4,
  },
  ruleLabel: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
  },
  ruleDeltaPositive: {
    color: '#4ADE80',
    fontSize: 12,
    fontWeight: '700',
  },
  ruleDeltaNegative: {
    color: '#F87171',
    fontSize: 12,
    fontWeight: '700',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 4,
  },
  historyDelta: {
    width: 34,
    fontSize: 12,
    fontWeight: '700',
  },
  historyDeltaPositive: {
    color: '#4ADE80',
  },
  historyDeltaNegative: {
    color: '#F87171',
  },
  historyReason: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  emptyHistory: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
});
