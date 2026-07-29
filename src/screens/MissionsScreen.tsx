/**
 * LogistiCore — Görevler ekranı (More > Görevler)
 * Retention Pack V1: Görevler · Haftalık · Başarılar
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  MissionHeroHeader,
  MissionSectionHeader,
  MissionSummaryBar,
  MissionTabs,
  PremiumMissionCard,
  type MissionsTabKey,
  type PremiumMissionStatus,
} from '../components/missions/MissionPresentation';
import OnboardingHintCard from '../components/onboarding/OnboardingHintCard';
import { AppCard, GameIcon } from '../components/ui';
import {
  CAREER_MISSIONS,
  STARTER_MISSIONS,
  createDefaultMissionsState,
  getMissionById,
} from '../config/missions';
import { MILESTONE_DEFINITIONS } from '../data/milestones';
import { getWeeklyObjectiveDefinitions } from '../data/weeklyObjectives';
import {
  useActiveOnboardingHint,
  useOnboardingScreenVisit,
} from '../hooks/useOnboardingScreenVisit';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { createDefaultRetentionState } from '../simulation/retentionProgress';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, spacing, typography } from '../theme';
import type { RetentionReward } from '../types/game';
import { getWeeklySeasonKey, getWeeklySeasonLabel } from '../utils/leaderboardSeason';
import {
  getMissionDisplayStatus,
  sortMissionIdsForDisplay,
  type MissionProgressResult,
} from '../utils/missionProgress';

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

function formatMissionProgress(current: number, target: number, missionId: string): string {
  if (missionId === 'reach_company_score_150k') {
    return `${Math.floor(current).toLocaleString('tr-TR')} / ${target.toLocaleString('tr-TR')}`;
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

function toPremiumMissionStatus(
  status: ReturnType<typeof getMissionDisplayStatus>,
): PremiumMissionStatus {
  if (status === 'claimed') return 'completed';
  if (status === 'ready') return 'ready';
  return 'in_progress';
}

function getRetentionStatus(isClaimed: boolean, isReady: boolean): PremiumMissionStatus {
  if (isClaimed) return 'completed';
  if (isReady) return 'ready';
  return 'in_progress';
}

interface MissionsScreenProps {
  onBack: () => void;
}

export default function MissionsScreen({ onBack }: MissionsScreenProps) {
  const { scrollBottomPadding } = useTabBarLayout();
  const [activeTab, setActiveTab] = useState<MissionsTabKey>('missions');

  const currentTime = useGameStore((state) => state.currentTime);
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
      const difference = score(aEntry, a.target) - score(bEntry, b.target);
      if (difference !== 0) return difference;
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
      const difference = score(aEntry, a.target) - score(bEntry, b.target);
      if (difference !== 0) return difference;
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

  const summary = useMemo(() => {
    if (activeTab === 'weekly') {
      let completed = 0;
      let ready = 0;
      for (const objective of sortedWeekly) {
        const entry = retention.weeklyObjectives[objective.id];
        if (entry?.isClaimed) completed += 1;
        else if ((entry?.progress ?? 0) >= objective.target) ready += 1;
      }
      return { total: sortedWeekly.length, completed, ready };
    }

    if (activeTab === 'achievements') {
      let completed = 0;
      let ready = 0;
      for (const milestone of sortedMilestones) {
        const entry = retention.milestones[milestone.id];
        if (entry?.isClaimed) completed += 1;
        else if ((entry?.progress ?? 0) >= milestone.target) ready += 1;
      }
      return { total: sortedMilestones.length, completed, ready };
    }

    const ids = [...starterMissionIds, ...careerMissionIds];
    let completed = 0;
    let ready = 0;
    for (const missionId of ids) {
      const status = getMissionDisplayStatus(
        missionId,
        missions,
        missionProgressById.get(missionId) ?? { current: 0, target: 1, isComplete: false },
      );
      if (status === 'claimed') completed += 1;
      else if (status === 'ready') ready += 1;
    }
    return { total: ids.length, completed, ready };
  }, [
    activeTab,
    careerMissionIds,
    missionProgressById,
    missions,
    retention.milestones,
    retention.weeklyObjectives,
    sortedMilestones,
    sortedWeekly,
    starterMissionIds,
  ]);

  const handleClaimMissionReward = useCallback(
    (missionId: string) => claimMissionReward(missionId),
    [claimMissionReward],
  );
  const handleClaimWeeklyObjective = useCallback(
    (objectiveId: string) => claimWeeklyObjectiveReward(objectiveId),
    [claimWeeklyObjectiveReward],
  );
  const handleClaimMilestone = useCallback(
    (milestoneId: string) => claimMilestoneReward(milestoneId),
    [claimMilestoneReward],
  );

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: Math.max(scrollBottomPadding, spacing.xxl) },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <MissionHeroHeader onBack={onBack} />
      <MissionTabs activeTab={activeTab} onChange={setActiveTab} />
      <MissionSummaryBar {...summary} />

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
          <MissionSectionHeader title="Başlangıç Görevleri" icon="contract" />
          {starterMissionIds.map((missionId) => {
            const mission = getMissionById(missionId);
            if (!mission) return null;
            const progress =
              missionProgressById.get(missionId) ??
              ({ current: 0, target: 1, isComplete: false } satisfies MissionProgressResult);
            const status = toPremiumMissionStatus(
              getMissionDisplayStatus(missionId, missions, progress),
            );
            return (
              <PremiumMissionCard
                key={missionId}
                id={missionId}
                category={mission.category}
                title={mission.title}
                description={mission.description}
                progress={progress.target > 0 ? progress.current / progress.target : 0}
                progressLabel={formatMissionProgress(
                  progress.current,
                  progress.target,
                  missionId,
                )}
                rewardLabel={formatMissionReward(missionId)}
                status={status}
                completedAt={missions.completedAtByMissionId[missionId]}
                currentTime={currentTime}
                onClaim={() => handleClaimMissionReward(missionId)}
              />
            );
          })}

          <MissionSectionHeader
            title="Kariyer Hedefleri"
            icon="trophy"
            style={styles.sectionSpaced}
          />
          {careerMissionIds.map((missionId) => {
            const mission = getMissionById(missionId);
            if (!mission) return null;
            const progress =
              missionProgressById.get(missionId) ??
              ({ current: 0, target: 1, isComplete: false } satisfies MissionProgressResult);
            const status = toPremiumMissionStatus(
              getMissionDisplayStatus(missionId, missions, progress),
            );
            return (
              <PremiumMissionCard
                key={missionId}
                id={missionId}
                category={mission.category}
                title={mission.title}
                description={mission.description}
                progress={progress.target > 0 ? progress.current / progress.target : 0}
                progressLabel={formatMissionProgress(
                  progress.current,
                  progress.target,
                  missionId,
                )}
                rewardLabel={formatMissionReward(missionId)}
                status={status}
                completedAt={missions.completedAtByMissionId[missionId]}
                currentTime={currentTime}
                onClaim={() => handleClaimMissionReward(missionId)}
              />
            );
          })}
        </>
      ) : null}

      {activeTab === 'weekly' ? (
        <>
          <AppCard variant="soft" style={styles.seasonCard} padded>
            <View style={styles.seasonHeader}>
              <View style={styles.seasonIcon}>
                <GameIcon name="time" size={19} color={colors.primaryLight} />
              </View>
              <View style={styles.seasonCopy}>
                <Text style={styles.seasonTitle}>Haftalık Sezon</Text>
                <Text style={styles.seasonDates}>{seasonLabel}</Text>
              </View>
            </View>
            <Text style={styles.seasonHint}>
              Leaderboard ile aynı haftayı takip eder. Yeni hafta başladığında görevler yenilenir.
            </Text>
          </AppCard>

          <MissionSectionHeader title="Bu Haftanın Görevleri" icon="time" />
          {sortedWeekly.map((objective) => {
            const entry = retention.weeklyObjectives[objective.id] ?? {
              progress: 0,
              isClaimed: false,
            };
            const isReady = !entry.isClaimed && entry.progress >= objective.target;
            return (
              <PremiumMissionCard
                key={objective.id}
                id={objective.id}
                category={objective.category}
                title={objective.title}
                description={objective.description}
                progress={objective.target > 0 ? entry.progress / objective.target : 0}
                progressLabel={formatRetentionProgress(
                  entry.progress,
                  objective.target,
                  objective.metric === 'weekly_trade_profit',
                )}
                rewardLabel={formatRetentionReward(objective.reward)}
                status={getRetentionStatus(entry.isClaimed, isReady)}
                completedAt={entry.completedAt}
                currentTime={currentTime}
                onClaim={() => handleClaimWeeklyObjective(objective.id)}
              />
            );
          })}
        </>
      ) : null}

      {activeTab === 'achievements' ? (
        <>
          <MissionSectionHeader title="Kariyer Başarıları" icon="trophy" />
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
              <PremiumMissionCard
                key={milestone.id}
                id={milestone.id}
                category={milestone.category}
                title={milestone.title}
                description={milestone.description}
                progress={milestone.target > 0 ? entry.progress / milestone.target : 0}
                progressLabel={formatRetentionProgress(
                  entry.progress,
                  milestone.target,
                  useMoney,
                )}
                rewardLabel={formatRetentionReward(milestone.reward)}
                status={getRetentionStatus(entry.isClaimed, isReady)}
                completedAt={entry.completedAt}
                currentTime={currentTime}
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
    backgroundColor: colors.background,
  },
  content: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sectionSpaced: {
    marginTop: spacing.sm,
  },
  seasonCard: {
    gap: spacing.sm,
    marginBottom: spacing.md,
    borderColor: 'rgba(35,136,255,0.3)',
    backgroundColor: '#081628',
  },
  seasonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  seasonIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: 'rgba(57,160,255,0.34)',
  },
  seasonCopy: {
    flex: 1,
    minWidth: 0,
  },
  seasonTitle: {
    ...typography.cardTitle,
    color: colors.primaryLight,
  },
  seasonDates: {
    ...typography.caption,
    marginTop: 2,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  seasonHint: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
