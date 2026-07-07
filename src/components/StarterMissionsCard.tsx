/**
 * Dashboard başlangıç görevleri kartı
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, AppCard, ProgressBar, SectionTitle, StatusBadge } from './ui';
import { getMissionById } from '../config/missions';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, spacing, typography } from '../theme';

function formatMissionReward(missionId: string): string {
  const mission = getMissionById(missionId);
  if (!mission) return '';

  const parts: string[] = [];
  if (mission.reward.money) {
    parts.push(formatMoney(mission.reward.money));
  }
  if (mission.reward.xp) {
    parts.push(`${mission.reward.xp} XP`);
  }
  if (mission.reward.diamonds) {
    parts.push(`${mission.reward.diamonds} elmas`);
  }
  if (mission.reward.reputation) {
    parts.push(`+${mission.reward.reputation} itibar`);
  }
  return parts.join(' + ');
}

export default function StarterMissionsCard() {
  const missions = useGameStore((state) => state.missions);
  const getMissionProgressValue = useGameStore((state) => state.getMissionProgressValue);
  const claimMissionReward = useGameStore((state) => state.claimMissionReward);

  const visibleMissions = useMemo(() => {
    const active = missions?.activeMissionIds ?? [];
    return active
      .filter((missionId) => !missions?.claimedMissionRewardIds?.includes(missionId))
      .slice(0, 3);
  }, [missions?.activeMissionIds, missions?.claimedMissionRewardIds]);

  if (visibleMissions.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <SectionTitle title="Başlangıç Görevleri" compact />
      <AppCard style={styles.card} padded>
        {visibleMissions.map((missionId, index) => {
          const mission = getMissionById(missionId);
          if (!mission) return null;

          const progress = getMissionProgressValue(missionId);
          const isClaimed = missions?.claimedMissionRewardIds?.includes(missionId) ?? false;
          const isComplete = progress.isComplete;
          const ratio = progress.target > 0 ? progress.current / progress.target : 0;

          return (
            <View
              key={missionId}
              style={[styles.missionRow, index === visibleMissions.length - 1 ? styles.missionRowLast : null]}
            >
              <View style={styles.missionHeader}>
                <Text style={styles.missionTitle} numberOfLines={1}>
                  {mission.title}
                </Text>
                {isClaimed ? (
                  <StatusBadge label="Tamamlandı" variant="success" size="sm" />
                ) : isComplete ? (
                  <StatusBadge label="Hazır" variant="amber" size="sm" />
                ) : (
                  <Text style={styles.missionProgressText}>
                    {Math.floor(progress.current)}/{progress.target}
                  </Text>
                )}
              </View>

              {!isComplete && !isClaimed ? (
                <ProgressBar progress={ratio} color={colors.accentBlue} height={4} />
              ) : null}

              <Text style={styles.missionReward} numberOfLines={1}>
                Ödül: {formatMissionReward(missionId)}
              </Text>

              {isComplete && !isClaimed ? (
                <ActionButton
                  label="Ödülü Al"
                  onPress={() => claimMissionReward(missionId)}
                  variant="primary"
                  compact
                  style={styles.claimButton}
                />
              ) : null}
            </View>
          );
        })}
      </AppCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.xs,
  },
  card: {
    gap: spacing.sm,
  },
  missionRow: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  missionRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  missionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  missionTitle: {
    ...typography.bodySmall,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  missionProgressText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  missionReward: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  claimButton: {
    alignSelf: 'flex-start',
    marginTop: 2,
  },
});
