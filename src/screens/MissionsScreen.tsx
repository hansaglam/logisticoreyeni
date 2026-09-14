/**
 * LogistiCore — Görevler ekranı (More > Görevler)
 * Retention Pack V1: Görevler · Haftalık · Başarılar
 *
 * Weekly tab: dual-mode.
 * - BACKEND_WEEKLY_MISSIONS_ENABLED=false → legacy local weekly objectives
 * - true → getWeeklyMissions / claimWeeklyMissionReward (no local cash mint)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  MissionHeroHeader,
  MissionSectionHeader,
  MissionSummaryBar,
  MissionTabs,
  PremiumMissionCard,
  type MissionsTabKey,
  type PremiumMissionStatus,
} from '../components/missions/MissionPresentation';
import { AppCard, GameIcon } from '../components/ui';
import { BACKEND_WEEKLY_MISSIONS_ENABLED } from '../config/backendRoadmap';
import {
  CAREER_MISSIONS,
  STARTER_MISSIONS,
  getMissionById,
} from '../config/missions';
import { MILESTONE_DEFINITIONS } from '../data/milestones';
import {
  buildRewardReceiptKey,
  isRewardClaimed,
} from '../domain/rewardClaimIntegrity';
import { getWeeklyObjectiveDefinitions } from '../data/weeklyObjectives';
import {
  canClaimBackendWeeklyMission,
  createWeeklyMissionClaimAttempt,
  formatWeeklyRemainingLabel,
  getWeeklyMissionClaimErrorMessage,
  getWeeklyMissionDifficultyLabel,
  shouldRetainWeeklyMissionClaimAttempt,
  weeklyMissionClaimAttemptKey,
  type WeeklyMissionClaimAttempt,
} from '../features/weeklyMissions/claimFlow';
import { setBackendWeeklyMissionsCache } from '../features/weeklyMissions/weeklyMissionCache';
import { reconcileChallengeClaimCash } from '../features/challenges/claimReconciliation';
import {
  useOnboardingScreenVisit,
} from '../hooks/useOnboardingScreenVisit';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { getAccountStatus } from '../services/authService';
import {
  claimWeeklyMissionReward,
  createWeeklyMissionClaimIdempotencyKey,
  getWeeklyMissions,
  type WeeklyMissionPlayerView,
} from '../services/weeklyMissionService';
import { useGameStore } from '../store/gameStore';
import {
  selectMissions,
  selectRetention,
  selectRewardReceipts,
} from '../store/selectors/stableCollections';
import { selectCurrentTimeQuarterHour } from '../store/selectors/timeBuckets';
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
  if (mission.reward.reputation) parts.push(`+${mission.reward.reputation} İtibar`);
  return parts.join(' · ');
}

function formatRetentionReward(reward: RetentionReward): string {
  const parts: string[] = [];
  if (reward.cash) parts.push(`+${formatMoney(reward.cash)}`);
  if (reward.xp) parts.push(`+${reward.xp} XP`);
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

type BackendWeeklyLoadState =
  | { status: 'idle' | 'loading' }
  | {
      status: 'ready';
      weekKey: string;
      startsAt: number;
      endsAt: number;
      remainingMs: number;
      claimAvailableForAccount: boolean;
      missions: WeeklyMissionPlayerView[];
    }
  | { status: 'error'; reason: string };

interface MissionsScreenProps {
  onBack: () => void;
}

export default function MissionsScreen({ onBack }: MissionsScreenProps) {
  const { contentBottomPadding, screenTopPadding } = useTabBarLayout();
  const [activeTab, setActiveTab] = useState<MissionsTabKey>('missions');
  const [claimingRewardKeys, setClaimingRewardKeys] = useState<Set<string>>(() => new Set());
  const [backendWeekly, setBackendWeekly] = useState<BackendWeeklyLoadState>({ status: 'idle' });
  const [backendClaimMessage, setBackendClaimMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const claimAttemptsRef = useRef<Map<string, WeeklyMissionClaimAttempt>>(new Map());

  const currentTime = useGameStore(selectCurrentTimeQuarterHour);
  const missions = useGameStore(selectMissions);
  const retention = useGameStore(selectRetention);
  const rewardReceipts = useGameStore(selectRewardReceipts);
  const getMissionProgressValue = useGameStore((state) => state.getMissionProgressValue);
  const claimMissionReward = useGameStore((state) => state.claimMissionReward);
  const syncMissionProgress = useGameStore((state) => state.syncMissionProgress);
  const syncRetentionProgress = useGameStore((state) => state.syncRetentionProgress);
  const claimMilestoneReward = useGameStore((state) => state.claimMilestoneReward);
  const claimWeeklyObjectiveReward = useGameStore((state) => state.claimWeeklyObjectiveReward);
  const addNotification = useGameStore((state) => state.addNotification);

  useOnboardingScreenVisit('Missions');

  // Legacy weekly season key — recompute so Monday boundary does not freeze forever.
  const legacySeasonKey = useMemo(() => getWeeklySeasonKey(new Date(nowMs)), [nowMs]);
  const legacySeasonLabel = useMemo(() => getWeeklySeasonLabel(new Date(nowMs)), [nowMs]);

  useEffect(() => {
    syncMissionProgress();
    if (!BACKEND_WEEKLY_MISSIONS_ENABLED) {
      syncRetentionProgress();
    }
  }, [syncMissionProgress, syncRetentionProgress]);

  useEffect(() => {
    if (!BACKEND_WEEKLY_MISSIONS_ENABLED || activeTab !== 'weekly') {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [activeTab]);

  const loadBackendWeekly = useCallback(async () => {
    if (!BACKEND_WEEKLY_MISSIONS_ENABLED) return;
    setBackendWeekly({ status: 'loading' });
    setBackendClaimMessage(null);
    const result = await getWeeklyMissions();
    if (!result.ok) {
      setBackendWeekly({ status: 'error', reason: result.reason });
      return;
    }
    setBackendWeeklyMissionsCache(result);
    setBackendWeekly({
      status: 'ready',
      weekKey: result.weekKey,
      startsAt: result.startsAt,
      endsAt: result.endsAt,
      remainingMs: result.remainingMs,
      claimAvailableForAccount: result.claimAvailableForAccount,
      missions: result.missions,
    });
  }, []);

  useEffect(() => {
    if (BACKEND_WEEKLY_MISSIONS_ENABLED && activeTab === 'weekly') {
      void loadBackendWeekly();
    }
  }, [activeTab, loadBackendWeekly]);

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
    () =>
      BACKEND_WEEKLY_MISSIONS_ENABLED
        ? []
        : getWeeklyObjectiveDefinitions(legacySeasonKey),
    [legacySeasonKey],
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

  const sortedBackendWeekly = useMemo(() => {
    if (backendWeekly.status !== 'ready') return [];
    return [...backendWeekly.missions].sort((a, b) => {
      const score = (mission: WeeklyMissionPlayerView) => {
        if (!mission.claimed && (mission.completed || mission.claimAvailable)) return 0;
        if (!mission.claimed) return 1;
        return 3;
      };
      const difference = score(a) - score(b);
      if (difference !== 0) return difference;
      return a.difficulty.localeCompare(b.difficulty);
    });
  }, [backendWeekly]);

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
      if (BACKEND_WEEKLY_MISSIONS_ENABLED) {
        if (backendWeekly.status !== 'ready') {
          return { total: 0, completed: 0, ready: 0 };
        }
        let completed = 0;
        let ready = 0;
        for (const mission of backendWeekly.missions) {
          if (mission.claimed) completed += 1;
          else if (mission.completed || mission.claimAvailable) ready += 1;
        }
        return { total: backendWeekly.missions.length, completed, ready };
      }
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
    backendWeekly,
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
    async (missionId: string) => {
      const claimKey = buildRewardReceiptKey('mission', missionId);
      if (claimingRewardKeys.has(claimKey)) return;
      setClaimingRewardKeys((prev) => new Set(prev).add(claimKey));
      try {
        await Promise.resolve(claimMissionReward(missionId));
      } finally {
        setClaimingRewardKeys((prev) => {
          const next = new Set(prev);
          next.delete(claimKey);
          return next;
        });
      }
    },
    [claimMissionReward, claimingRewardKeys],
  );

  const handleClaimLegacyWeeklyObjective = useCallback(
    async (objectiveId: string) => {
      if (BACKEND_WEEKLY_MISSIONS_ENABLED) {
        return;
      }
      const claimKey = buildRewardReceiptKey('weekly', objectiveId, legacySeasonKey);
      if (claimingRewardKeys.has(claimKey)) return;
      setClaimingRewardKeys((prev) => new Set(prev).add(claimKey));
      try {
        await Promise.resolve(claimWeeklyObjectiveReward(objectiveId));
      } finally {
        setClaimingRewardKeys((prev) => {
          const next = new Set(prev);
          next.delete(claimKey);
          return next;
        });
      }
    },
    [claimWeeklyObjectiveReward, claimingRewardKeys, legacySeasonKey],
  );

  const handleClaimBackendWeekly = useCallback(
    async (mission: WeeklyMissionPlayerView) => {
      if (!BACKEND_WEEKLY_MISSIONS_ENABLED || backendWeekly.status !== 'ready') {
        return;
      }
      const account = getAccountStatus();
      const linkedAccount =
        Boolean(account.uid) && !account.isAnonymous && account.provider !== 'guest';
      if (
        !canClaimBackendWeeklyMission({
          completed: mission.completed,
          claimed: mission.claimed,
          claimAvailable: mission.claimAvailable,
          linkedAccount,
          featuresEnabled: true,
          requestPending: false,
        })
      ) {
        if (!linkedAccount) {
          setBackendClaimMessage('Hesabını bağlayarak ödül alabilirsin.');
        }
        return;
      }

      const attemptKey = weeklyMissionClaimAttemptKey(backendWeekly.weekKey, mission.id);
      let attempt = claimAttemptsRef.current.get(attemptKey);
      if (!attempt) {
        attempt = createWeeklyMissionClaimAttempt(
          backendWeekly.weekKey,
          mission.id,
          createWeeklyMissionClaimIdempotencyKey,
        );
        claimAttemptsRef.current.set(attemptKey, attempt);
      }

      if (claimingRewardKeys.has(attemptKey)) return;
      setClaimingRewardKeys((prev) => new Set(prev).add(attemptKey));
      setBackendClaimMessage(null);
      try {
        const result = await claimWeeklyMissionReward(attempt);
        if (result.ok) {
          claimAttemptsRef.current.delete(attemptKey);
          await reconcileChallengeClaimCash(result.cashAfter);
          addNotification({
            time: useGameStore.getState().currentTime,
            type: 'success',
            title: 'Haftalık ödül alındı',
            message: `${mission.title} · +${formatMoney(result.cashAmount)}`,
            autoDismissMs: 3500,
          });
          await loadBackendWeekly();
          return;
        }
        if (result.reason === 'already-claimed') {
          claimAttemptsRef.current.delete(attemptKey);
          setBackendClaimMessage(getWeeklyMissionClaimErrorMessage(result.reason));
          await loadBackendWeekly();
          return;
        }
        if (result.reason === 'not-complete' || result.reason === 'week-not-current') {
          claimAttemptsRef.current.delete(attemptKey);
          setBackendClaimMessage(getWeeklyMissionClaimErrorMessage(result.reason));
          await loadBackendWeekly();
          return;
        }
        if (!shouldRetainWeeklyMissionClaimAttempt(result.reason)) {
          claimAttemptsRef.current.delete(attemptKey);
        }
        setBackendClaimMessage(getWeeklyMissionClaimErrorMessage(result.reason));
      } finally {
        setClaimingRewardKeys((prev) => {
          const next = new Set(prev);
          next.delete(attemptKey);
          return next;
        });
      }
    },
    [addNotification, backendWeekly, claimingRewardKeys, loadBackendWeekly],
  );

  const handleClaimMilestone = useCallback(
    async (milestoneId: string) => {
      const claimKey = buildRewardReceiptKey('achievement', milestoneId);
      if (claimingRewardKeys.has(claimKey)) return;
      setClaimingRewardKeys((prev) => new Set(prev).add(claimKey));
      try {
        await Promise.resolve(claimMilestoneReward(milestoneId));
      } finally {
        setClaimingRewardKeys((prev) => {
          const next = new Set(prev);
          next.delete(claimKey);
          return next;
        });
      }
    },
    [claimMilestoneReward, claimingRewardKeys],
  );

  const isAchievementClaimed = useCallback(
    (milestoneId: string) => {
      const entry = retention.milestones[milestoneId];
      return (
        entry?.isClaimed === true ||
        isRewardClaimed(rewardReceipts, buildRewardReceiptKey('achievement', milestoneId))
      );
    },
    [retention.milestones, rewardReceipts],
  );

  const isLegacyWeeklyClaimed = useCallback(
    (objectiveId: string) => {
      const entry = retention.weeklyObjectives[objectiveId];
      return (
        entry?.isClaimed === true ||
        isRewardClaimed(
          rewardReceipts,
          buildRewardReceiptKey('weekly', objectiveId, legacySeasonKey),
        )
      );
    },
    [retention.weeklyObjectives, rewardReceipts, legacySeasonKey],
  );

  const backendCountdownLabel = useMemo(() => {
    if (backendWeekly.status !== 'ready') return null;
    const remaining = Math.max(0, backendWeekly.endsAt - nowMs);
    return formatWeeklyRemainingLabel(remaining);
  }, [backendWeekly, nowMs]);

  const account = getAccountStatus();
  const linkedAccount =
    Boolean(account.uid) && !account.isAnonymous && account.provider !== 'guest';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: screenTopPadding,
          paddingBottom: Math.max(contentBottomPadding, spacing.xxl),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <MissionHeroHeader onBack={onBack} />
      <MissionTabs activeTab={activeTab} onChange={setActiveTab} />
      <MissionSummaryBar {...summary} />

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
        BACKEND_WEEKLY_MISSIONS_ENABLED ? (
          <>
            <AppCard variant="soft" style={styles.seasonCard} padded>
              <View style={styles.seasonHeader}>
                <View style={styles.seasonIcon}>
                  <GameIcon name="time" size={19} color={colors.primaryLight} />
                </View>
                <View style={styles.seasonCopy}>
                  <Text style={styles.seasonTitle}>Haftalık Sezon</Text>
                  <Text style={styles.seasonDates}>
                    {backendWeekly.status === 'ready'
                      ? backendWeekly.weekKey
                      : 'Yükleniyor…'}
                  </Text>
                </View>
              </View>
              {backendCountdownLabel ? (
                <Text style={styles.seasonHint}>Yenilenmeye {backendCountdownLabel}</Text>
              ) : (
                <Text style={styles.seasonHint}>
                  Leaderboard ile aynı haftayı takip eder. Yeni hafta başladığında görevler yenilenir.
                </Text>
              )}
              {!linkedAccount ? (
                <Text style={styles.seasonHint}>
                  Hesabını bağlayarak ödül alabilirsin.
                </Text>
              ) : null}
              {backendClaimMessage ? (
                <Text style={styles.claimMessage}>{backendClaimMessage}</Text>
              ) : null}
            </AppCard>

            <MissionSectionHeader title="Bu Haftanın Görevleri" icon="time" />

            {backendWeekly.status === 'loading' || backendWeekly.status === 'idle' ? (
              <View style={styles.stateBlock}>
                <ActivityIndicator color={colors.primaryLight} />
                <Text style={styles.stateText}>Haftalık görevler yükleniyor…</Text>
              </View>
            ) : null}

            {backendWeekly.status === 'error' ? (
              <View style={styles.stateBlock}>
                <Text style={styles.stateText}>
                  {backendWeekly.reason === 'feature-disabled'
                    ? 'Haftalık görevler şu anda kullanılamıyor.'
                    : 'Haftalık görevlere ulaşılamadı.'}
                </Text>
                <Pressable onPress={() => void loadBackendWeekly()} style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>Tekrar Dene</Text>
                </Pressable>
              </View>
            ) : null}

            {backendWeekly.status === 'ready' && sortedBackendWeekly.length === 0 ? (
              <View style={styles.stateBlock}>
                <Text style={styles.stateText}>Bu hafta için görev bulunamadı.</Text>
              </View>
            ) : null}

            {backendWeekly.status === 'ready'
              ? sortedBackendWeekly.map((mission) => {
                  const claimed = mission.claimed;
                  const isReady = !claimed && (mission.completed || mission.claimAvailable);
                  const attemptKey = weeklyMissionClaimAttemptKey(
                    backendWeekly.weekKey,
                    mission.id,
                  );
                  const canClaim =
                    isReady &&
                    linkedAccount &&
                    canClaimBackendWeeklyMission({
                      completed: mission.completed,
                      claimed: mission.claimed,
                      claimAvailable: mission.claimAvailable,
                      linkedAccount,
                      featuresEnabled: true,
                      requestPending: claimingRewardKeys.has(attemptKey),
                    });
                  return (
                    <PremiumMissionCard
                      key={mission.id}
                      id={mission.id}
                      category="contracts"
                      title={mission.title}
                      description={mission.description}
                      difficultyLabel={getWeeklyMissionDifficultyLabel(mission.difficulty)}
                      progress={mission.target > 0 ? mission.progress / mission.target : 0}
                      progressLabel={formatRetentionProgress(mission.progress, mission.target)}
                      rewardLabel={`+${formatMoney(mission.reward.cash)}`}
                      status={getRetentionStatus(claimed, isReady)}
                      completedAt={mission.claimedAt ?? undefined}
                      currentTime={currentTime}
                      isClaiming={claimingRewardKeys.has(attemptKey)}
                      onClaim={canClaim ? () => handleClaimBackendWeekly(mission) : undefined}
                    />
                  );
                })
              : null}
          </>
        ) : (
          <>
            <AppCard variant="soft" style={styles.seasonCard} padded>
              <View style={styles.seasonHeader}>
                <View style={styles.seasonIcon}>
                  <GameIcon name="time" size={19} color={colors.primaryLight} />
                </View>
                <View style={styles.seasonCopy}>
                  <Text style={styles.seasonTitle}>Haftalık Sezon</Text>
                  <Text style={styles.seasonDates}>{legacySeasonLabel}</Text>
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
              const claimed = isLegacyWeeklyClaimed(objective.id);
              const isReady = !claimed && entry.progress >= objective.target;
              const claimKey = buildRewardReceiptKey('weekly', objective.id, legacySeasonKey);
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
                  status={getRetentionStatus(claimed, isReady)}
                  completedAt={entry.completedAt}
                  currentTime={currentTime}
                  isClaiming={claimingRewardKeys.has(claimKey)}
                  onClaim={() => handleClaimLegacyWeeklyObjective(objective.id)}
                />
              );
            })}
          </>
        )
      ) : null}

      {activeTab === 'achievements' ? (
        <>
          <MissionSectionHeader title="Kariyer Başarıları" icon="trophy" />
          {sortedMilestones.map((milestone) => {
            const entry = retention.milestones[milestone.id] ?? {
              progress: 0,
              isClaimed: false,
            };
            const claimed = isAchievementClaimed(milestone.id);
            const isReady = !claimed && entry.progress >= milestone.target;
            const claimKey = buildRewardReceiptKey('achievement', milestone.id);
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
                status={getRetentionStatus(claimed, isReady)}
                completedAt={entry.completedAt}
                currentTime={currentTime}
                isClaiming={claimingRewardKeys.has(claimKey)}
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
  claimMessage: {
    ...typography.caption,
    color: colors.amber,
    lineHeight: 16,
  },
  stateBlock: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  stateText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.accentBlueSoft,
    borderWidth: 1,
    borderColor: 'rgba(57,160,255,0.34)',
  },
  retryButtonText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primaryLight,
  },
});
