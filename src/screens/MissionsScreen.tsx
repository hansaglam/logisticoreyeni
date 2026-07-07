/**
 * LogistiCore - Görevler ekranı (More > Görevler)
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, AppCard, ProgressBar, ScreenHeader, SectionTitle, StatusBadge } from '../components/ui';
import { STARTER_MISSIONS, getMissionById } from '../config/missions';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, spacing, typography } from '../theme';

function formatMissionReward(missionId: string): string {
  const mission = getMissionById(missionId);
  if (!mission) return '';

  const parts: string[] = [];
  if (mission.reward.money) parts.push(formatMoney(mission.reward.money));
  if (mission.reward.xp) parts.push(`${mission.reward.xp} XP`);
  if (mission.reward.diamonds) parts.push(`${mission.reward.diamonds} elmas`);
  if (mission.reward.reputation) parts.push(`+${mission.reward.reputation} itibar`);
  return parts.join(' + ');
}

interface MissionsScreenProps {
  onBack: () => void;
}

export default function MissionsScreen({ onBack }: MissionsScreenProps) {
  const missions = useGameStore((state) => state.missions);
  const getMissionProgressValue = useGameStore((state) => state.getMissionProgressValue);
  const claimMissionReward = useGameStore((state) => state.claimMissionReward);

  const starterMissions = useMemo(
    () => STARTER_MISSIONS.filter((mission) => missions?.activeMissionIds?.includes(mission.id)),
    [missions?.activeMissionIds],
  );

  return (
    <View style={styles.root}>
      <ScreenHeader title="Görevler" subtitle="Başlangıç hedeflerini ve ödülleri takip et" onBack={onBack} compact />

      <SectionTitle title="Başlangıç Görevleri" compact />
      {starterMissions.map((mission) => {
        const progress = getMissionProgressValue(mission.id);
        const isClaimed = missions?.claimedMissionRewardIds?.includes(mission.id) ?? false;
        const ratio = progress.target > 0 ? progress.current / progress.target : 0;

        return (
          <AppCard key={mission.id} style={styles.card} padded>
            <View style={styles.cardHeader}>
              <Text style={styles.title}>{mission.title}</Text>
              {isClaimed ? (
                <StatusBadge label="Tamamlandı" variant="success" size="sm" />
              ) : progress.isComplete ? (
                <StatusBadge label="Hazır" variant="amber" size="sm" />
              ) : null}
            </View>
            <Text style={styles.description}>{mission.description}</Text>
            {!isClaimed ? (
              <>
                <ProgressBar progress={ratio} color={colors.accentBlue} height={5} />
                <Text style={styles.progressLabel}>
                  {Math.floor(progress.current)} / {progress.target}
                </Text>
              </>
            ) : null}
            <Text style={styles.reward}>Ödül: {formatMissionReward(mission.id)}</Text>
            {progress.isComplete && !isClaimed ? (
              <ActionButton
                label="Ödülü Al"
                onPress={() => claimMissionReward(mission.id)}
                variant="primary"
                compact
                style={styles.claimButton}
              />
            ) : null}
          </AppCard>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  card: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.cardTitle,
    flex: 1,
    minWidth: 0,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
  },
  reward: {
    ...typography.caption,
    color: colors.accentAmber,
    fontWeight: '700',
  },
  claimButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
});
