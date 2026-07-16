/**
 * LogistiCore - Görevler ekranı (More > Görevler)
 */

import React, { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  AppCard,
  ProgressBar,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import { CAREER_MISSIONS, STARTER_MISSIONS, createDefaultMissionsState, getMissionById } from '../config/missions';
import { useGameStore } from '../store/gameStore';
import {
  getMissionDisplayStatus,
  sortMissionIdsForDisplay,
  type MissionProgressResult,
} from '../utils/missionProgress';
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

function formatProgressValue(current: number, target: number, missionId: string): string {
  if (missionId === 'reach_company_score_150k') {
    return `${Math.floor(current).toLocaleString('en-US')} / ${target.toLocaleString('en-US')}`;
  }
  if (
    missionId === 'first_profit' ||
    missionId === 'reach_warehouse_value_25000' ||
    missionId === 'earn_10000_trade_profit'
  ) {
    return `${formatMoney(current)} / ${formatMoney(target)}`;
  }
  return `${Math.floor(current)} / ${target}`;
}

function MissionStatusBadge({
  status,
}: {
  status: ReturnType<typeof getMissionDisplayStatus>;
}) {
  if (status === 'claimed') {
    return <StatusBadge label="Tamamlandı" variant="success" size="sm" />;
  }
  if (status === 'ready') {
    return <StatusBadge label="Hazır" variant="amber" size="sm" />;
  }
  return <StatusBadge label="Devam Ediyor" variant="blue" size="sm" />;
}

function MissionCard({
  missionId,
  progress,
  missions,
  onClaim,
}: {
  missionId: string;
  progress: MissionProgressResult;
  missions: NonNullable<ReturnType<typeof useGameStore.getState>['missions']>;
  onClaim: () => void;
}) {
  const mission = getMissionById(missionId);
  if (!mission) return null;

  const status = getMissionDisplayStatus(missionId, missions, progress);
  const ratio = progress.target > 0 ? progress.current / progress.target : 0;
  const isCompact = status === 'claimed';

  return (
    <AppCard
      style={[styles.card, isCompact ? styles.cardCompact : null]}
      padded
    >
      <View style={styles.cardHeader}>
        <Text style={styles.title} numberOfLines={1}>
          {mission.title}
        </Text>
        <MissionStatusBadge status={status} />
      </View>
      <Text style={styles.description} numberOfLines={2}>
        {mission.description}
      </Text>
      {status !== 'claimed' ? (
        <>
          <ProgressBar progress={ratio} color={colors.accentBlue} height={5} />
          <Text style={styles.progressLabel}>
            {formatProgressValue(progress.current, progress.target, missionId)}
          </Text>
        </>
      ) : null}
      <Text style={styles.reward} numberOfLines={1}>
        Ödül: {formatMissionReward(missionId)}
      </Text>
      {status === 'ready' ? (
        <ActionButton
          label="Ödülü Al"
          onPress={onClaim}
          variant="primary"
          compact
          style={styles.claimButton}
        />
      ) : null}
    </AppCard>
  );
}

interface MissionsScreenProps {
  onBack: () => void;
}

export default function MissionsScreen({ onBack }: MissionsScreenProps) {
  const missions = useGameStore((state) => state.missions) ?? createDefaultMissionsState();
  const getMissionProgressValue = useGameStore((state) => state.getMissionProgressValue);
  const claimMissionReward = useGameStore((state) => state.claimMissionReward);
  const syncMissionProgress = useGameStore((state) => state.syncMissionProgress);

  useEffect(() => {
    syncMissionProgress();
  }, [syncMissionProgress]);

  const starterMissionIds = useMemo(() => {
    const ids = STARTER_MISSIONS.map((mission) => mission.id).filter((id) =>
      missions.activeMissionIds.includes(id),
    );
    return sortMissionIdsForDisplay(ids, missions, getMissionProgressValue);
  }, [missions, getMissionProgressValue]);

  const careerMissionIds = useMemo(() => {
    const ids = CAREER_MISSIONS.map((mission) => mission.id).filter((id) =>
      missions.activeMissionIds.includes(id),
    );
    return sortMissionIdsForDisplay(ids, missions, getMissionProgressValue);
  }, [missions, getMissionProgressValue]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Görevler"
        subtitle="Başlangıç ve kariyer hedeflerini takip et"
        onBack={onBack}
        compact
      />

      <SectionTitle title="Başlangıç Görevleri" compact />
      {starterMissionIds.map((missionId) => (
          <MissionCard
            key={missionId}
            missionId={missionId}
            progress={getMissionProgressValue(missionId)}
            missions={missions}
            onClaim={() => claimMissionReward(missionId)}
          />
        ))}

      <SectionTitle title="Kariyer Hedefleri" compact style={styles.sectionSpaced} />
      {careerMissionIds.map((missionId) => (
          <MissionCard
            key={missionId}
            missionId={missionId}
            progress={getMissionProgressValue(missionId)}
            missions={missions}
            onClaim={() => claimMissionReward(missionId)}
          />
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sectionSpaced: {
    marginTop: spacing.sm,
  },
  card: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  cardCompact: {
    paddingVertical: spacing.sm,
    opacity: 0.88,
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
    lineHeight: 16,
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
