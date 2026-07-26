/**
 * LogistiCore - Görevler ekranı (More > Görevler)
 * Retention Pack V1: Görevler · Haftalık · Başarılar
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  AppCard,
  ProgressBar,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import { CAREER_MISSIONS, STARTER_MISSIONS, createDefaultMissionsState, getMissionById } from '../config/missions';
import { MILESTONE_DEFINITIONS } from '../data/milestones';
import { getWeeklyObjectiveDefinitions } from '../data/weeklyObjectives';
import OnboardingHintCard from '../components/onboarding/OnboardingHintCard';
import { useActiveOnboardingHint, useOnboardingScreenVisit } from '../hooks/useOnboardingScreenVisit';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { useGameStore } from '../store/gameStore';
import { createDefaultRetentionState } from '../simulation/retentionProgress';
import {
  getMissionDisplayStatus,
  sortMissionIdsForDisplay,
  type MissionProgressResult,
} from '../utils/missionProgress';
import { getWeeklySeasonKey, getWeeklySeasonLabel } from '../utils/leaderboardSeason';
import type { RetentionReward } from '../types/game';
import { colors, formatMoney, spacing, typography } from '../theme';

type MissionsTab = 'missions' | 'weekly' | 'achievements';

function formatMissionReward(missionId: string): string {
  const mission = getMissionById(missionId);
  if (!mission) return '';

  const parts: string[] = [];
  if (mission.reward.money) parts.push(`+${formatMoney(mission.reward.money)}`);
  if (mission.reward.xp) parts.push(`+${mission.reward.xp} XP`);
  if (mission.reward.diamonds) parts.push(`+${mission.reward.diamonds} Elmas`);
  if (mission.reward.reputation) parts.push(`+${mission.reward.reputation} İtibar`);
  return parts.join(' · ');
}

function formatRetentionReward(reward: RetentionReward): string {
  const parts: string[] = [];
  if (reward.cash) parts.push(`+${formatMoney(reward.cash)}`);
  if (reward.xp) parts.push(`+${reward.xp} XP`);
  if (reward.diamonds) parts.push(`+${reward.diamonds} Elmas`);
  if (reward.reputation) parts.push(`+${reward.reputation} İtibar`);
  if (reward.badgeId) parts.push('Rozet');
  return parts.join(' · ');
}

function formatProgressValue(current: number, target: number, missionId: string): string {
  if (missionId === 'reach_company_score_150k') {
    return `${Math.floor(current).toLocaleString('en-US')} / ${target.toLocaleString('en-US')}`;
  }
  if (missionId === 'first_profit') {
    return `${formatMoney(current)} / ${formatMoney(target)} sözleşme geliri`;
  }
  if (
    missionId === 'reach_warehouse_value_25000' ||
    missionId === 'earn_10000_trade_profit'
  ) {
    return `${formatMoney(current)} / ${formatMoney(target)}`;
  }
  return `${Math.floor(current)} / ${target}`;
}

function formatRetentionProgress(current: number, target: number, useMoney = false): string {
  if (useMoney) {
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

function RetentionStatusBadge({ isClaimed, isReady }: { isClaimed: boolean; isReady: boolean }) {
  if (isClaimed) {
    return <StatusBadge label="Alındı" variant="success" size="sm" />;
  }
  if (isReady) {
    return <StatusBadge label="Hazır" variant="amber" size="sm" />;
  }
  return <StatusBadge label="Devam Ediyor" variant="blue" size="sm" />;
}

const TabButton = React.memo(function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabButton, active && styles.tabButtonActive]}
    >
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
    </Pressable>
  );
});

const MissionCard = React.memo(function MissionCard({
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
    <AppCard style={[styles.card, isCompact ? styles.cardCompact : null]} padded>
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
});

const RetentionObjectiveCard = React.memo(function RetentionObjectiveCard({
  title,
  description,
  progress,
  target,
  reward,
  isClaimed,
  isReady,
  useMoney,
  onClaim,
}: {
  title: string;
  description: string;
  progress: number;
  target: number;
  reward: RetentionReward;
  isClaimed: boolean;
  isReady: boolean;
  useMoney?: boolean;
  onClaim: () => void;
}) {
  const ratio = target > 0 ? progress / target : 0;

  return (
    <AppCard style={[styles.card, isClaimed ? styles.cardCompact : null]} padded>
      <View style={styles.cardHeader}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <RetentionStatusBadge isClaimed={isClaimed} isReady={isReady} />
      </View>
      <Text style={styles.description} numberOfLines={2}>
        {description}
      </Text>
      {!isClaimed ? (
        <>
          <ProgressBar progress={ratio} color={colors.accentBlue} height={5} />
          <Text style={styles.progressLabel}>
            {formatRetentionProgress(progress, target, useMoney)}
          </Text>
        </>
      ) : null}
      <Text style={styles.reward} numberOfLines={1}>
        Ödül: {formatRetentionReward(reward)}
      </Text>
      {isReady ? (
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
});

interface MissionsScreenProps {
  onBack: () => void;
}

export default function MissionsScreen({ onBack }: MissionsScreenProps) {
  const { scrollBottomPadding } = useTabBarLayout();
  const [activeTab, setActiveTab] = useState<MissionsTab>('missions');

  const missions = useGameStore((state) => state.missions) ?? createDefaultMissionsState();
  const retention = useGameStore((state) => state.retention) ?? createDefaultRetentionState();
  const getMissionProgressValue = useGameStore((state) => state.getMissionProgressValue);
  const claimMissionReward = useGameStore((state) => state.claimMissionReward);
  const syncMissionProgress = useGameStore((state) => state.syncMissionProgress);
  const syncRetentionProgress = useGameStore((state) => state.syncRetentionProgress);
  const claimMilestoneReward = useGameStore((state) => state.claimMilestoneReward);
  const claimWeeklyObjectiveReward = useGameStore((state) => state.claimWeeklyObjectiveReward);

  useOnboardingScreenVisit('Missions');
  const onboardingHint = useActiveOnboardingHint(['claim_first_reward']);

  const seasonKey = useMemo(() => getWeeklySeasonKey(), []);
  const seasonLabel = useMemo(() => getWeeklySeasonLabel(), []);

  useEffect(() => {
    syncMissionProgress();
    syncRetentionProgress();
  }, [syncMissionProgress, syncRetentionProgress]);

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

  const weeklyObjectives = useMemo(
    () => getWeeklyObjectiveDefinitions(seasonKey),
    [seasonKey],
  );

  const sortedMilestones = useMemo(() => {
    return [...MILESTONE_DEFINITIONS].sort((a, b) => {
      const aEntry = retention.milestones[a.id];
      const bEntry = retention.milestones[b.id];
      const score = (entry: typeof aEntry, target: number) => {
        if (!entry) return 2;
        if (!entry.isClaimed && entry.progress >= target) return 0;
        if (!entry.isClaimed) return 1;
        return 3;
      };
      const diff = score(aEntry, a.target) - score(bEntry, b.target);
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title, 'tr');
    });
  }, [retention.milestones]);

  const sortedWeekly = useMemo(() => {
    return [...weeklyObjectives].sort((a, b) => {
      const aEntry = retention.weeklyObjectives[a.id];
      const bEntry = retention.weeklyObjectives[b.id];
      const score = (entry: typeof aEntry, target: number) => {
        if (!entry) return 2;
        if (!entry.isClaimed && entry.progress >= target) return 0;
        if (!entry.isClaimed) return 1;
        return 3;
      };
      const diff = score(aEntry, a.target) - score(bEntry, b.target);
      if (diff !== 0) return diff;
      return a.slot.localeCompare(b.slot);
    });
  }, [weeklyObjectives, retention.weeklyObjectives]);

  const missionProgressById = useMemo(() => {
    const ids = [...starterMissionIds, ...careerMissionIds];
    const map = new Map<string, MissionProgressResult>();
    for (const missionId of ids) {
      map.set(missionId, getMissionProgressValue(missionId));
    }
    return map;
  }, [starterMissionIds, careerMissionIds, getMissionProgressValue]);

  const handleClaimMissionReward = useCallback(
    (missionId: string) => {
      claimMissionReward(missionId);
    },
    [claimMissionReward],
  );

  const handleClaimWeeklyObjective = useCallback(
    (objectiveId: string) => {
      claimWeeklyObjectiveReward(objectiveId);
    },
    [claimWeeklyObjectiveReward],
  );

  const handleClaimMilestone = useCallback(
    (milestoneId: string) => {
      claimMilestoneReward(milestoneId);
    },
    [claimMilestoneReward],
  );

  const handleSelectMissionsTab = useCallback(() => setActiveTab('missions'), []);
  const handleSelectWeeklyTab = useCallback(() => setActiveTab('weekly'), []);
  const handleSelectAchievementsTab = useCallback(() => setActiveTab('achievements'), []);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: scrollBottomPadding }]}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Görevler"
        subtitle="Başlangıç, haftalık sezon ve kariyer başarıları"
        onBack={onBack}
        compact
      />

      <View style={styles.tabRow}>
        <TabButton
          label="Görevler"
          active={activeTab === 'missions'}
          onPress={handleSelectMissionsTab}
        />
        <TabButton
          label="Haftalık"
          active={activeTab === 'weekly'}
          onPress={handleSelectWeeklyTab}
        />
        <TabButton
          label="Başarılar"
          active={activeTab === 'achievements'}
          onPress={handleSelectAchievementsTab}
        />
      </View>

      {onboardingHint && activeTab === 'missions' ? (
        <OnboardingHintCard
          title={onboardingHint.title}
          description={onboardingHint.description}
          icon={onboardingHint.icon}
          badgeLabel={onboardingHint.badgeLabel}
          accentVariant={onboardingHint.accentVariant}
          onDismiss={onboardingHint.onDismiss}
        />
      ) : null}

      {activeTab === 'missions' ? (
        <>
          <SectionTitle title="Başlangıç Görevleri" compact />
          {starterMissionIds.map((missionId) => (
            <MissionCard
              key={missionId}
              missionId={missionId}
              progress={missionProgressById.get(missionId) ?? { current: 0, target: 1, isComplete: false }}
              missions={missions}
              onClaim={() => handleClaimMissionReward(missionId)}
            />
          ))}

          <SectionTitle title="Kariyer Hedefleri" compact style={styles.sectionSpaced} />
          {careerMissionIds.map((missionId) => (
            <MissionCard
              key={missionId}
              missionId={missionId}
              progress={missionProgressById.get(missionId) ?? { current: 0, target: 1, isComplete: false }}
              missions={missions}
              onClaim={() => handleClaimMissionReward(missionId)}
            />
          ))}
        </>
      ) : null}

      {activeTab === 'weekly' ? (
        <>
          <AppCard variant="soft" style={styles.seasonCard} padded>
            <Text style={styles.seasonTitle}>Haftalık Sezon</Text>
            <Text style={styles.seasonDates}>{seasonLabel}</Text>
            <Text style={styles.seasonHint}>
              Leaderboard ile aynı haftayı takip eder. Yeni hafta başladığında görevler yenilenir.
            </Text>
          </AppCard>

          <SectionTitle title="Bu Haftanın Görevleri" compact />
          {sortedWeekly.map((objective) => {
            const entry = retention.weeklyObjectives[objective.id] ?? {
              progress: 0,
              isClaimed: false,
            };
            const isReady = !entry.isClaimed && entry.progress >= objective.target;
            const useMoney = objective.metric === 'weekly_trade_profit';

            return (
              <RetentionObjectiveCard
                key={objective.id}
                title={objective.title}
                description={objective.description}
                progress={entry.progress}
                target={objective.target}
                reward={objective.reward}
                isClaimed={entry.isClaimed}
                isReady={isReady}
                useMoney={useMoney}
                onClaim={() => handleClaimWeeklyObjective(objective.id)}
              />
            );
          })}
        </>
      ) : null}

      {activeTab === 'achievements' ? (
        <>
          <SectionTitle title="Kariyer Başarıları" compact />
          {sortedMilestones.map((milestone) => {
            const entry = retention.milestones[milestone.id] ?? {
              progress: 0,
              isClaimed: false,
            };
            const isReady = !entry.isClaimed && entry.progress >= milestone.target;
            const useMoney =
              milestone.metric.type === 'trade_profit_total' ||
              milestone.metric.type === 'trade_profit_product' ||
              milestone.metric.type === 'cash' ||
              milestone.metric.type === 'company_score';

            return (
              <RetentionObjectiveCard
                key={milestone.id}
                title={milestone.title}
                description={milestone.description}
                progress={entry.progress}
                target={milestone.target}
                reward={milestone.reward}
                isClaimed={entry.isClaimed}
                isReady={isReady}
                useMoney={useMoney}
                onClaim={() => handleClaimMilestone(milestone.id)}
              />
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: colors.accentBlueSoft,
    borderColor: 'rgba(56, 189, 248, 0.45)',
  },
  tabButtonText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tabButtonTextActive: {
    color: colors.accentBlue,
  },
  seasonCard: {
    marginBottom: spacing.sm,
    gap: spacing.xs,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  seasonTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accentBlue,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  seasonDates: {
    ...typography.bodySmall,
    fontWeight: '700',
  },
  seasonHint: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
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
