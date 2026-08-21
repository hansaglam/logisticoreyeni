import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { formatIncidentChoiceEffectSummary, INCIDENT_CATEGORY_LABELS } from '../../simulation/deliveryIncidents';
import {
  getOperationChoiceDisabledReason,
  getOperationChoiceNetCashDelta,
} from '../../simulation/deliveryOperationChoice';
import { useGameStore } from '../../store/gameStore';
import { colors, spacing, typography } from '../../theme';
import { GameIcon } from '../ui';

export interface DeliveryIncidentModalProps {
  pendingDeliveryId?: string;
  enabled: boolean;
}

export default function DeliveryIncidentModal({
  pendingDeliveryId,
  enabled,
}: DeliveryIncidentModalProps) {
  const [focusedDeliveryId, setFocusedDeliveryId] = useState<string | null>(null);
  const [loadingChoiceId, setLoadingChoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolveDeliveryIncident = useGameStore((state) => state.resolveDeliveryIncident);
  const playerMoney = useGameStore((state) => state.player.money);
  const delivery = useGameStore((state) =>
    focusedDeliveryId
      ? state.activeDeliveries.find((item) => item.id === focusedDeliveryId)
      : undefined,
  );

  useEffect(() => {
    if (enabled && pendingDeliveryId && !focusedDeliveryId) {
      setFocusedDeliveryId(pendingDeliveryId);
      setError(null);
    }
  }, [enabled, focusedDeliveryId, pendingDeliveryId]);

  const incident = delivery?.incident;
  const resolvedChoice = useMemo(
    () => incident?.choices.find((choice) => choice.id === incident.resolvedChoiceId),
    [incident],
  );
  const resolved = incident?.status === 'resolved' || delivery?.incidentResolved === true;
  const visible = enabled && Boolean(delivery && incident);

  const handleChoice = async (choiceId: string) => {
    if (!delivery || loadingChoiceId || resolved) return;
    setLoadingChoiceId(choiceId);
    setError(null);
    try {
      const result = await resolveDeliveryIncident(delivery.id, choiceId);
      if (!result.ok) setError(result.reason ?? 'Karar uygulanamadı.');
    } finally {
      setLoadingChoiceId(null);
    }
  };

  const dismissOutcome = () => {
    if (!resolved) return;
    setFocusedDeliveryId(null);
    setError(null);
  };

  if (!delivery || !incident) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissOutcome}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.headerRow}>
            <View style={styles.iconWrap}>
              <GameIcon
                name={resolved ? 'success' : 'warning'}
                size={24}
                color={resolved ? colors.success : colors.warning}
              />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>
                {resolved ? 'OPERASYON SONUCU' : INCIDENT_CATEGORY_LABELS[incident.type] ?? 'Olay'}
              </Text>
              <Text style={styles.title} numberOfLines={2}>{incident.title}</Text>
            </View>
          </View>

          {resolved ? (
            <View style={styles.outcomeCard}>
              <Text style={styles.outcomeTitle}>Kararın uygulandı</Text>
              <Text style={styles.description}>{resolvedChoice?.label ?? 'Operasyon kararı'}</Text>
              {resolvedChoice ? (
                <Text style={styles.effectText}>
                  {formatIncidentChoiceEffectSummary(resolvedChoice.effects)}
                </Text>
              ) : null}
              <Pressable style={styles.primaryButton} onPress={dismissOutcome}>
                <Text style={styles.primaryButtonText}>Devam Et</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.description} numberOfLines={3}>{incident.description}</Text>
              <Text style={styles.pendingTitle}>Karar bekleniyor</Text>
              <Text style={styles.clockNote}>
                Teslimat, seçim yapana kadar ilerlemiyor. Son teslim süresi işlemeye devam ediyor.
              </Text>
              <Text style={styles.requiredText}>Devam etmek için bir karar seç.</Text>
              <ScrollView
                style={styles.choiceScroll}
                contentContainerStyle={styles.choiceList}
                showsVerticalScrollIndicator={false}
              >
                {incident.choices.map((choice) => {
                  const loading = loadingChoiceId === choice.id;
                  const disabledReason = getOperationChoiceDisabledReason({
                    playerMoney,
                    effects: choice.effects,
                    incidentResolved: resolved,
                    deliveryActive:
                      delivery.status === 'on_route' || delivery.status === 'preparing',
                    isResolving: loadingChoiceId != null,
                  });
                  const disabled = disabledReason != null;
                  const showFundsWarning =
                    disabledReason === 'Bu işlem için yeterli nakit yok.' &&
                    getOperationChoiceNetCashDelta(choice.effects) < 0;

                  return (
                    <Pressable
                      key={choice.id}
                      style={({ pressed }) => [
                        styles.choiceButton,
                        pressed && !disabled && styles.choicePressed,
                        disabled && styles.choiceDisabled,
                      ]}
                      disabled={disabled}
                      onPress={() => void handleChoice(choice.id)}
                    >
                      <View style={styles.choiceCopy}>
                        <Text style={styles.choiceTitle}>{choice.label}</Text>
                        <Text style={styles.choiceDescription} numberOfLines={2}>
                          {choice.description}
                        </Text>
                        <Text style={styles.effectText} numberOfLines={2}>
                          {formatIncidentChoiceEffectSummary(choice.effects)}
                        </Text>
                        {showFundsWarning ? (
                          <Text style={styles.fundsWarningText}>{disabledReason}</Text>
                        ) : null}
                      </View>
                      {loading ? <ActivityIndicator color={colors.accentBlue} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: 'rgba(1, 6, 18, 0.78)',
  },
  sheet: {
    width: '100%',
    maxWidth: 430,
    maxHeight: '82%',
    alignSelf: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(57, 159, 255, 0.42)',
    backgroundColor: colors.surface,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { ...typography.caption, color: colors.warning, fontWeight: '800' },
  title: { ...typography.cardTitle, fontSize: 19, lineHeight: 24 },
  description: { ...typography.body, color: colors.textSecondary },
  requiredText: { ...typography.caption, color: colors.textMuted },
  pendingTitle: { ...typography.bodySmall, fontWeight: '800', color: colors.warning },
  clockNote: { ...typography.caption, color: colors.danger, fontWeight: '700', lineHeight: 16 },
  choiceScroll: { flexGrow: 0 },
  choiceList: { gap: spacing.sm },
  choiceButton: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  choicePressed: { borderColor: colors.accentBlue, backgroundColor: 'rgba(57, 159, 255, 0.09)' },
  choiceDisabled: { opacity: 0.65 },
  choiceCopy: { flex: 1, minWidth: 0, gap: 3 },
  choiceTitle: { ...typography.cardTitle },
  choiceDescription: { ...typography.caption, color: colors.textSecondary },
  effectText: { ...typography.caption, color: colors.warning, fontWeight: '700' },
  outcomeCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.35)',
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
  },
  outcomeTitle: { ...typography.cardTitle, color: colors.success },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  primaryButtonText: { ...typography.buttonText, color: '#FFFFFF' },
  fundsWarningText: { ...typography.caption, color: colors.warning, fontWeight: '600' },
  errorText: { ...typography.caption, color: colors.danger },
});
