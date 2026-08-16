import React, { useEffect, useState } from 'react';
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
import { useTutorialLayoutReady } from '../../hooks/useTutorialLayoutReady';

import {
  REPUTATION_DECREASE_BEHAVIORS,
  REPUTATION_INCREASE_BEHAVIORS,
  REPUTATION_RULES,
} from '../../config/reputationRules';
import type { ReputationSummary } from '../../domain/reputationModel';
import type { ReputationHistoryEntry } from '../../domain/reputationModel';
import {
  buildReputationHistoryDetail,
  LEGACY_SETTLEMENT_UNAVAILABLE,
} from '../../domain/deliveryResultPresentation';
import { findSettlementRecord } from '../../domain/deliveryDelayDiagnostics';
import { getCityName } from '../../utils/entityLookup';
import { GameIcon, ProgressBar } from '../ui';
import { colors } from '../../theme';
import { useGameStore } from '../../store/gameStore';

interface ReputationDetailSheetProps {
  visible: boolean;
  summary: ReputationSummary;
  history: readonly ReputationHistoryEntry[];
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
  const { layoutReady, markLayoutReady, resetLayoutReady } = useTutorialLayoutReady();

  useEffect(() => {
    if (!visible) {
      resetLayoutReady();
    }
  }, [resetLayoutReady, visible]);

  const reputationTutorial = useScreenAppTutorial({
    tutorialId: 'reputation',
    layoutReady,
    blockingModals: !visible,
    autoStart: true,
  });
  const settlementHistory = useGameStore((state) => state.deliverySettlementHistory ?? []);
  const [selectedEntry, setSelectedEntry] = useState<ReputationHistoryEntry | null>(null);

  useEffect(() => {
    if (!visible) {
      setSelectedEntry(null);
    }
  }, [visible]);

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

          {selectedEntry ? (
            <ReputationHistoryDetailView
              entry={selectedEntry}
              record={findSettlementRecord(settlementHistory, selectedEntry.deliveryId)}
              onBack={() => setSelectedEntry(null)}
            />
          ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            onLayout={markLayoutReady}
          >
            <AppTutorialTarget tutorialId="reputation" targetId="reputation-score" layoutMode="stretch">
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

            <AppTutorialTarget tutorialId="reputation" targetId="reputation-how" layoutMode="stretch">
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

            <AppTutorialTarget tutorialId="reputation" targetId="reputation-why" layoutMode="stretch">
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
                  history.slice(0, 10).map((entry) => {
                    const isDeliveryEntry =
                      entry.source === 'delivery-settlement' ||
                      entry.source === 'delivery-failure' ||
                      entry.source === 'contract-cancelled';
                    return (
                      <Pressable
                        key={entry.id}
                        style={styles.historyRow}
                        onPress={isDeliveryEntry ? () => setSelectedEntry(entry) : undefined}
                        disabled={!isDeliveryEntry}
                      >
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
                        {isDeliveryEntry ? (
                          <GameIcon name="chevronRight" size={14} color={colors.textMuted} />
                        ) : null}
                      </Pressable>
                    );
                  })
                )}
              </View>
            </AppTutorialTarget>
          </ScrollView>
          )}
          <AppTutorialOverlay {...reputationTutorial.overlayProps} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ReputationHistoryDetailView({
  entry,
  record,
  onBack,
}: {
  entry: ReputationHistoryEntry;
  record: ReturnType<typeof findSettlementRecord>;
  onBack: () => void;
}) {
  const detail = buildReputationHistoryDetail(record);
  const routeLabel = record
    ? `${getCityName(record.originCityId)} → ${getCityName(record.destinationCityId)}`
    : null;

  return (
    <View style={styles.detailWrap}>
      <Pressable onPress={onBack} style={styles.detailBack} accessibilityRole="button">
        <Text style={styles.detailBackText}>← Geri</Text>
      </Pressable>
      <Text style={styles.detailTitle}>{detail.title}</Text>
      {routeLabel ? <Text style={styles.detailRoute}>{routeLabel}</Text> : null}
      {detail.unavailable ? (
        <Text style={styles.emptyHistory}>{LEGACY_SETTLEMENT_UNAVAILABLE}</Text>
      ) : (
        <>
          {detail.plannedLine ? <Text style={styles.detailLine}>{detail.plannedLine}</Text> : null}
          {detail.actualLine ? <Text style={styles.detailLine}>{detail.actualLine}</Text> : null}
          {detail.latenessLine ? <Text style={styles.detailLine}>{detail.latenessLine}</Text> : null}
          {detail.causes.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Nedenler</Text>
              {detail.causes.map((cause) => (
                <Text key={cause} style={styles.detailLine}>
                  • {cause}
                </Text>
              ))}
            </>
          ) : null}
          <Text style={styles.sectionTitle}>İtibar değişimi</Text>
          <Text
            style={[
              styles.historyDelta,
              entry.delta >= 0 ? styles.historyDeltaPositive : styles.historyDeltaNegative,
            ]}
          >
            {detail.reputationLine || (entry.delta > 0 ? `+${entry.delta}` : `${entry.delta}`)}
          </Text>
        </>
      )}
    </View>
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
  detailWrap: {
    gap: 8,
    paddingBottom: 12,
  },
  detailBack: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  detailBackText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  detailTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  detailRoute: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  detailLine: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
});
