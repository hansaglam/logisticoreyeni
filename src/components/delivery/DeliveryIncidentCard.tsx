/**
 * Teslimat operasyon olayı — Hızlı Müdahale kartı.
 */

import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { formatIncidentChoiceEffectSummary } from '../../simulation/deliveryIncidents';
import { useGameStore } from '../../store/gameStore';
import { colors, spacing, typography } from '../../theme';
import type { Delivery, DeliveryIncidentChoice } from '../../types/game';
import { GameIcon } from '../ui';

export interface DeliveryIncidentCardProps {
  delivery: Delivery;
  compact?: boolean;
}

function DeliveryIncidentCardInner({ delivery, compact = false }: DeliveryIncidentCardProps) {
  const resolveDeliveryIncident = useGameStore((state) => state.resolveDeliveryIncident);
  const [loadingChoiceId, setLoadingChoiceId] = React.useState<string | null>(null);
  const incident = delivery.incident;

  const handleChoice = useCallback(
    async (choiceId: string) => {
      if (loadingChoiceId) {
        return;
      }
      setLoadingChoiceId(choiceId);
      try {
        await resolveDeliveryIncident(delivery.id, choiceId);
      } finally {
        setLoadingChoiceId(null);
      }
    },
    [delivery.id, loadingChoiceId, resolveDeliveryIncident],
  );

  if (!incident) {
    return null;
  }

  if (incident.status === 'resolved' || delivery.incidentResolved) {
    const resolvedChoice = incident.choices.find(
      (choice) => choice.id === incident.resolvedChoiceId,
    );

    return (
      <View style={[styles.resolvedWrap, compact && styles.resolvedWrapCompact]}>
        <View style={[styles.resolvedBadge, compact && styles.resolvedBadgeCompact]}>
          <GameIcon name="success" size={compact ? 10 : 11} color={colors.success} />
          <Text style={[styles.resolvedText, compact && styles.resolvedTextCompact]}>
            Karar uygulandı
          </Text>
        </View>
        {resolvedChoice ? (
          <Text
            style={[styles.resolvedChoiceText, compact && styles.resolvedChoiceTextCompact]}
            numberOfLines={1}
          >
            Seçim: {resolvedChoice.label}
          </Text>
        ) : null}
      </View>
    );
  }

  if (incident.status !== 'pending') {
    return null;
  }

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <Text style={[styles.title, compact && styles.titleCompact]}>HIZLI MÜDAHALE</Text>
      <Text
        style={[styles.incidentTitle, compact && styles.incidentTitleCompact]}
        numberOfLines={1}
      >
        {incident.title}
      </Text>
      <Text
        style={[styles.description, compact && styles.descriptionCompact]}
        numberOfLines={compact ? 1 : 2}
      >
        {incident.description}
      </Text>
      <Text style={[styles.prompt, compact && styles.promptCompact]}>
        Operasyon kararını seç.
      </Text>
      <View style={styles.choices}>
        {incident.choices.map((choice) => (
          <IncidentChoiceButton
            key={choice.id}
            choice={choice}
            compact={compact}
            loading={loadingChoiceId === choice.id}
            disabled={loadingChoiceId != null}
            onPress={() => {
              void handleChoice(choice.id);
            }}
          />
        ))}
      </View>
    </View>
  );
}

interface IncidentChoiceButtonProps {
  choice: DeliveryIncidentChoice;
  compact: boolean;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}

function IncidentChoiceButton({
  choice,
  compact,
  loading,
  disabled,
  onPress,
}: IncidentChoiceButtonProps) {
  const summary = formatIncidentChoiceEffectSummary(choice.effects);

  return (
    <TouchableOpacity
      style={[
        styles.choiceButton,
        compact && styles.choiceButtonCompact,
        disabled && styles.choiceButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <View style={styles.choiceMain}>
        <Text
          style={[styles.choiceLabel, compact && styles.choiceLabelCompact]}
          numberOfLines={1}
        >
          {choice.label}
        </Text>
        <Text
          style={[styles.choiceEffect, compact && styles.choiceEffectCompact]}
          numberOfLines={2}
        >
          {summary}
        </Text>
      </View>
      {loading ? <ActivityIndicator size="small" color={colors.accentBlue} /> : null}
    </TouchableOpacity>
  );
}

const DeliveryIncidentCard = React.memo(DeliveryIncidentCardInner);

export default DeliveryIncidentCard;

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 176, 64, 0.32)',
    backgroundColor: 'rgba(255, 176, 64, 0.07)',
    gap: 4,
  },
  cardCompact: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    gap: 3,
  },
  title: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '800',
    color: colors.warning,
    letterSpacing: 1.1,
  },
  titleCompact: {
    fontSize: 9,
    letterSpacing: 0.9,
  },
  incidentTitle: {
    ...typography.body,
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  incidentTitleCompact: {
    fontSize: 12,
  },
  description: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    lineHeight: 15,
  },
  descriptionCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  prompt: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: 2,
  },
  promptCompact: {
    fontSize: 10,
    marginTop: 1,
  },
  choices: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  choiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(120, 170, 255, 0.32)',
    backgroundColor: 'rgba(20, 36, 64, 0.88)',
  },
  choiceButtonCompact: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: spacing.xs,
  },
  choiceButtonDisabled: {
    opacity: 0.72,
  },
  choiceMain: {
    flex: 1,
    gap: 3,
  },
  choiceLabel: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  choiceLabelCompact: {
    fontSize: 11,
  },
  choiceEffect: {
    ...typography.caption,
    fontSize: 10,
    color: colors.accentBlue,
    fontWeight: '600',
    lineHeight: 14,
  },
  choiceEffectCompact: {
    fontSize: 9,
    lineHeight: 12,
  },
  resolvedWrap: {
    marginTop: spacing.sm,
    gap: 3,
  },
  resolvedWrapCompact: {
    marginTop: spacing.xs,
    gap: 2,
  },
  resolvedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
  },
  resolvedBadgeCompact: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  resolvedText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
  },
  resolvedTextCompact: {
    fontSize: 9,
  },
  resolvedChoiceText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    paddingLeft: 2,
  },
  resolvedChoiceTextCompact: {
    fontSize: 9,
  },
});
