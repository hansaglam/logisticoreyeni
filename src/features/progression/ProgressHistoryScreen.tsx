import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Crypto from 'expo-crypto';

import {
  ACHIEVEMENT_CATALOG,
  deriveAchievementProgress,
  normalizeProgressionFoundationState,
} from '../../domain/progressionFoundation';
import { normalizeCompanyStats } from '../../domain/companyStats';
import { getCanonicalSeasonHistory, getChallengeProgress, getCurrentSeason, getSeasonPoints } from '../../services/challengeService';
import { enrichSeasonHistoryWithCloseResults } from '../../services/seasonCloseService';
import {
  claimSeasonReward,
  fetchSeasonRewardEntitlementsForHistory,
  getSeasonRewardEntitlement,
  type GetSeasonRewardEntitlementClientResponse,
} from '../../services/seasonRewardService';
import { getFirebaseAuthSafe } from '../../services/firebase';
import { useGameStore } from '../../store/gameStore';
import { ActionButton, AppCard, AppScreen, EmptyState, GameIcon, ProgressBar, ScreenHeader, SectionTitle, StatusBadge } from '../../components/ui';
import { useAppDialog } from '../../components/AppDialogProvider';
import { colors, spacing, typography } from '../../theme';
import {
  MARKET_ALERTS_ENABLED,
  NOTIFICATION_CENTER_ENABLED,
  SEASON_CLOSE_SNAPSHOT_ENABLED,
  SEASON_REWARDS_ENABLED,
  V11_ANALYTICS_ENABLED,
} from '../../config/backendRoadmap';
import type { SeasonHistoryEntry, SeasonHistoryFinalLeaderboard } from '../../domain/progressionFoundation';
import { normalizeNotificationPreferences, type NotificationPreferences } from '../../domain/v11Notifications';
import { getNotificationPermissionState } from '../../services/notifications';
import { trackV11Analytics } from '../../services/analytics';
import { reconcileChallengeClaimCash } from '../challenges/claimReconciliation';
import {
  createSeasonRewardClaimAttempt,
  getSeasonRewardClaimErrorMessage,
  shouldRetainSeasonRewardClaimAttempt,
  type SeasonRewardClaimAttempt,
} from './seasonRewardClaimFlow';
import { mapSeasonRewardEntitlementToUi, shouldFetchSeasonRewards } from './seasonRewardUi';
import { SeasonRewardBlock } from './SeasonRewardBlock';
import {
  buildSeasonRewardUiMockResponse,
  SEASON_REWARD_UI_MOCK_STATES,
  type SeasonRewardUiMockState,
} from '../../dev/seasonRewardUiMocks';

interface Props {
  onBack: () => void;
  onOpenSeasons?: () => void;
}

function formatDate(value?: number): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('tr-TR');
}

function formatFinalScore(score: number): string {
  return Math.floor(score).toLocaleString('tr-TR');
}

function formatFinalRankLine(finals: SeasonHistoryFinalLeaderboard): string | null {
  if (finals.state === 'available' && finals.finalRank != null) {
    if (finals.participantCount != null && finals.participantCount > 0) {
      return `#${finals.finalRank} / ${finals.participantCount}`;
    }
    return `#${finals.finalRank}`;
  }
  if (finals.state === 'not_ranked') {
    return 'Bu sezon sıralamaya girmedin.';
  }
  if (finals.state === 'pending') {
    return 'Sıralama sonucu hazırlanıyor.';
  }
  if (finals.state === 'unavailable') {
    return 'Sıralama sonucu şu an alınamadı.';
  }
  return null;
}

export default function ProgressHistoryScreen({ onBack, onOpenSeasons }: Props) {
  const foundation = useGameStore((state) => state.progressionFoundation);
  const syncFoundation = useGameStore((state) => state.syncProgressionFoundation);
  const markRead = useGameStore((state) => state.markProgressInboxRead);
  const markAllRead = useGameStore((state) => state.markAllProgressInboxRead);
  const updateNotificationPreference = useGameStore((state) => state.updateNotificationPreference);
  const requestNavigation = useGameStore((state) => state.requestNavigationFromNotification);
  const { alert: showAlert, showDialog } = useAppDialog();
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState(false);
  const inFlight = useRef(false);
  const analyticsTracked = useRef(false);
  const [permissionState, setPermissionState] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');

  /** Local reward responses keyed by season — never global Zustand (account isolation). */
  const [rewardBySeason, setRewardBySeason] = useState<
    Record<string, GetSeasonRewardEntitlementClientResponse>
  >({});
  const [rewardOwnerUid, setRewardOwnerUid] = useState<string | null>(null);
  const [claimingSeasonKey, setClaimingSeasonKey] = useState<string | null>(null);
  const claimAttemptsRef = useRef<Map<string, SeasonRewardClaimAttempt>>(new Map());
  const [devMockState, setDevMockState] = useState<SeasonRewardUiMockState>('eligible_unclaimed');

  const clearRewardUiState = useCallback(() => {
    setRewardBySeason({});
    setRewardOwnerUid(null);
    setClaimingSeasonKey(null);
    claimAttemptsRef.current.clear();
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshError(false);
    try {
      const user = getFirebaseAuthSafe()?.currentUser;
      if (!user || user.isAnonymous) {
        clearRewardUiState();
        syncFoundation({ nowMs: Date.now() });
        return;
      }
      const [seasonResult, progressResult] = await Promise.all([
        getCurrentSeason(),
        getChallengeProgress(),
      ]);
      if (!seasonResult.ok || !seasonResult.season) {
        syncFoundation({ nowMs: Date.now() });
        setRefreshError(true);
        return;
      }
      const [pointsResult, historyResult] = await Promise.all([
        getSeasonPoints(seasonResult.season.key),
        getCanonicalSeasonHistory(seasonResult.season.key),
      ]);
      let seasonHistory: SeasonHistoryEntry[] | undefined = historyResult.ok
        ? historyResult.entries
        : undefined;
      if (SEASON_CLOSE_SNAPSHOT_ENABLED && seasonHistory && seasonHistory.length > 0) {
        try {
          seasonHistory = await enrichSeasonHistoryWithCloseResults(seasonHistory);
        } catch {
          // Keep points/claims history; do not fabricate finals.
          setRefreshError(true);
        }
      }
      if (shouldFetchSeasonRewards(SEASON_REWARDS_ENABLED) && seasonHistory && seasonHistory.length > 0) {
        try {
          const keys = seasonHistory.slice(0, 6).map((entry) => entry.seasonKey);
          const rewards = await fetchSeasonRewardEntitlementsForHistory(keys);
          setRewardOwnerUid(user.uid);
          setRewardBySeason(rewards);
        } catch {
          setRefreshError(true);
        }
      } else {
        clearRewardUiState();
      }
      const challenges = progressResult.ok && progressResult.challenges
        ? progressResult.challenges.filter((item) => item.progress.completed).length
        : undefined;
      syncFoundation({
        activeSeasonKey: seasonResult.season.key,
        seasonPoints: pointsResult.ok ? pointsResult.points : undefined,
        challengesCompleted: challenges,
        seasonHistory,
        nowMs: Date.now(),
      });
      if (!progressResult.ok || !pointsResult.ok || !historyResult.ok) setRefreshError(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [clearRewardUiState, syncFoundation]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!analyticsTracked.current) {
      analyticsTracked.current = true;
      void trackV11Analytics('progress_history_view', { source: 'company' });
      void trackV11Analytics('inbox_view', { source: 'progress_history' });
    }
    if (NOTIFICATION_CENTER_ENABLED) void getNotificationPermissionState().then(setPermissionState);
  }, []);

  const state = useMemo(() => normalizeProgressionFoundationState(foundation), [foundation]);
  const achievements = useMemo(() => {
    const live = useGameStore.getState();
    const stats = normalizeCompanyStats(live.companyStats, { player: live.player, currentTime: live.currentTime });
    const progress = deriveAchievementProgress(state, {
      player: live.player,
      companyStats: stats,
      seasonPoints: state.currentSeasonSnapshot?.seasonPoints,
      challengesCompleted: state.currentSeasonSnapshot?.challengesCompleted,
    });
    return progress.flatMap((item) => {
      const definition = ACHIEVEMENT_CATALOG.find((candidate) => candidate.id === item.achievementId);
      if (!definition || (definition.hidden && !item.completedAt)) return [];
      return [{ definition, progress: item }];
    });
  }, [state]);
  const unlockedCount = achievements.filter((item) => item.progress.completedAt).length;
  const unreadCount = state.inbox.filter((item) => !item.readAt).length;
  const notificationPreferences = normalizeNotificationPreferences(state.notificationPreferences);

  const activeUid = getFirebaseAuthSafe()?.currentUser?.uid ?? null;
  const rewardsBelongToCurrentUser =
    SEASON_REWARDS_ENABLED &&
    rewardOwnerUid != null &&
    activeUid != null &&
    rewardOwnerUid === activeUid;

  const handlePreferenceChange = useCallback(async (
    key: keyof Omit<NotificationPreferences, 'permissionAsked'>,
    enabled: boolean,
  ) => {
    await updateNotificationPreference(key, enabled);
    setPermissionState(await getNotificationPermissionState());
  }, [updateNotificationPreference]);

  const handleInboxOpen = useCallback((item: (typeof state.inbox)[number]) => {
    markRead(item.id);
    void trackV11Analytics('inbox_item_open', { inbox_type: item.type });
    if (item.relatedRoute === 'seasons-challenges') onOpenSeasons?.();
    if (item.relatedRoute === 'marketplace') {
      void trackV11Analytics('market_alert_open', { source: 'inbox' });
      requestNavigation('vehicleMarketplace');
    }
  }, [markRead, onOpenSeasons, requestNavigation, state.inbox]);

  const runClaim = useCallback(async (seasonKey: string) => {
    if (!SEASON_REWARDS_ENABLED || claimingSeasonKey) return;
    const user = getFirebaseAuthSafe()?.currentUser;
    if (!user || user.isAnonymous) {
      showAlert('Hesap gerekli', 'Ödül almak için hesabını bağlamalısın.');
      return;
    }
    setClaimingSeasonKey(seasonKey);
    const attempt =
      claimAttemptsRef.current.get(seasonKey) ??
      createSeasonRewardClaimAttempt(seasonKey, () => Crypto.randomUUID());
    claimAttemptsRef.current.set(seasonKey, attempt);
    try {
      const result = await claimSeasonReward(attempt.seasonKey, attempt.idempotencyKey);
      if (result.ok && (result.reason === 'success' || result.reason === 'already-claimed')) {
        const reconciled = await reconcileChallengeClaimCash(
          result.cashAfter ?? undefined,
        );
        const refreshed = await getSeasonRewardEntitlement(seasonKey);
        setRewardBySeason((prev) => ({ ...prev, [seasonKey]: refreshed }));
        claimAttemptsRef.current.delete(seasonKey);
        if (!reconciled && result.reason === 'success') {
          showAlert(
            'Ödül alındı',
            getSeasonRewardClaimErrorMessage('reconciliation-failed'),
          );
        }
        return;
      }
      if (result.reason === 'timeout' || result.reason === 'service-unavailable') {
        const refreshed = await getSeasonRewardEntitlement(seasonKey);
        setRewardBySeason((prev) => ({ ...prev, [seasonKey]: refreshed }));
        if (refreshed.reason === 'claimed') {
          await reconcileChallengeClaimCash();
          claimAttemptsRef.current.delete(seasonKey);
          return;
        }
        if (!shouldRetainSeasonRewardClaimAttempt(result.reason)) {
          claimAttemptsRef.current.delete(seasonKey);
        }
        showAlert('Bağlantı', getSeasonRewardClaimErrorMessage(result.reason));
        return;
      }
      if (result.reason === 'already-claimed') {
        const refreshed = await getSeasonRewardEntitlement(seasonKey);
        setRewardBySeason((prev) => ({ ...prev, [seasonKey]: refreshed }));
        await reconcileChallengeClaimCash(result.cashAfter ?? undefined);
        claimAttemptsRef.current.delete(seasonKey);
        return;
      }
      claimAttemptsRef.current.delete(seasonKey);
      showAlert('Ödül', getSeasonRewardClaimErrorMessage(result.reason));
    } finally {
      setClaimingSeasonKey(null);
    }
  }, [claimingSeasonKey, showAlert]);

  const confirmClaim = useCallback((seasonKey: string) => {
    showDialog({
      title: 'Sezon Ödülü',
      message: 'Sezon ödülün hesabına eklenecek.',
      variant: 'confirm',
      confirmLabel: 'Ödülü Al',
      cancelLabel: 'Vazgeç',
      onConfirm: () => {
        void runClaim(seasonKey);
      },
    });
  }, [runClaim, showDialog]);

  const devMockModel = useMemo(() => {
    if (!__DEV__ || !SEASON_REWARDS_ENABLED) return null;
    return mapSeasonRewardEntitlementToUi(
      buildSeasonRewardUiMockResponse(devMockState, 'DEV-MOCK'),
    );
  }, [devMockState]);

  return (
    <AppScreen scroll>
      <ScreenHeader title="İlerleme ve Geçmiş" subtitle="Başarımlar, sezonlar ve gelen kutusu" titleIcon="trophy" onBack={onBack} compact />

      {loading ? <ActivityIndicator color={colors.accentBlue} style={styles.loader} /> : null}
      {refreshError ? <Text style={styles.info}>Sunucu geçmişi yenilenemedi; kayıtlı bilgiler gösteriliyor.</Text> : null}

      <View style={styles.summaryRow}>
        <Summary label="Başarım" value={`${unlockedCount}/${ACHIEVEMENT_CATALOG.filter((item) => item.enabled && !item.hidden).length}`} />
        <Summary label="Geçmiş Sezon" value={String(state.seasonHistory.length)} />
        <Summary label="Okunmamış" value={String(unreadCount)} />
      </View>

      <SectionTitle title="Başarımlar" subtitle="Bilgilendirici rozetler; para ödülü içermez" compact />
      {achievements.slice(0, 8).map(({ definition, progress }) => {
        const unlocked = Boolean(progress.completedAt);
        return (
          <AppCard key={definition.id} variant="soft" style={styles.card} padded>
            <View style={styles.cardHeader}>
              <View style={styles.titleWrap}>
                <GameIcon name={unlocked ? 'trophy' : 'lock'} size={17} color={unlocked ? colors.success : colors.textMuted} />
                <Text style={styles.cardTitle}>{definition.title}</Text>
              </View>
              <StatusBadge label={definition.tier.toUpperCase()} variant={unlocked ? 'success' : 'muted'} size="sm" />
            </View>
            <Text style={styles.body}>{definition.description}</Text>
            <ProgressBar progress={Math.min(1, progress.current / progress.target)} color={unlocked ? colors.success : colors.accentBlue} height={5} />
            <Text style={styles.meta}>{progress.current} / {progress.target}{unlocked ? ` · ${formatDate(progress.completedAt)}` : ''}{definition.trackedFromV11 ? ' · V1.1’den itibaren' : ''}</Text>
          </AppCard>
        );
      })}

      <SectionTitle
        title="Önceki Sezonlar"
        subtitle={
          SEASON_CLOSE_SNAPSHOT_ENABLED
            ? 'Sezon puanı, görev kayıtları ve güvenilir final sıralama'
            : 'Canonical sezon puanı ve görev kayıtları'
        }
        compact
      />
      {state.seasonHistory.length === 0 ? (
        <EmptyState title="Henüz tamamlanan sezon yok" message="V1.1’den sonraki sezon sonuçların burada görünecek." icon="trophy" />
      ) : state.seasonHistory.slice(0, 6).map((entry) => {
        const finals = entry.finalLeaderboard;
        const rankLine = finals ? formatFinalRankLine(finals) : null;
        const rewardResponse =
          rewardsBelongToCurrentUser ? rewardBySeason[entry.seasonKey] : undefined;
        const rewardModel =
          SEASON_REWARDS_ENABLED && rewardsBelongToCurrentUser
            ? mapSeasonRewardEntitlementToUi(rewardResponse)
            : null;
        return (
          <AppCard key={entry.seasonKey} variant="soft" style={styles.compactCard} padded>
            <View style={styles.cardHeader}>
              <View style={styles.titleWrap}>
                <Text style={styles.cardTitle}>{entry.displayName}</Text>
                <Text style={styles.meta}>{formatDate(entry.endedAt)} · Salt okunur</Text>
              </View>
              <Text style={styles.points}>{entry.seasonPoints} puan</Text>
            </View>
            <Text style={styles.body}>{entry.challengeCompletionCount} görev ödülü kaydı</Text>
            {SEASON_CLOSE_SNAPSHOT_ENABLED && finals?.state === 'available' && finals.finalScore != null ? (
              <View style={styles.finalsRow}>
                <Text style={styles.finalsLabel}>Sıralama</Text>
                <Text style={styles.finalsValue}>{rankLine}</Text>
                <Text style={styles.finalsLabel}>Final Skor</Text>
                <Text style={styles.finalsValue}>{formatFinalScore(finals.finalScore)}</Text>
              </View>
            ) : null}
            {SEASON_CLOSE_SNAPSHOT_ENABLED && finals && finals.state !== 'available' && rankLine ? (
              <Text style={styles.finalsHint}>{rankLine}</Text>
            ) : null}
            {rewardModel ? (
              <SeasonRewardBlock
                model={rewardModel}
                claiming={claimingSeasonKey === entry.seasonKey}
                onClaimPress={() => confirmClaim(entry.seasonKey)}
              />
            ) : null}
          </AppCard>
        );
      })}

      {__DEV__ && SEASON_REWARDS_ENABLED && devMockModel ? (
        <>
          <SectionTitle
            title="DEV Sezon Ödülü Önizleme"
            subtitle="Firestore yazılmaz · üretim verisi değil"
            compact
          />
          <AppCard variant="soft" style={styles.compactCard} padded>
            <View style={styles.devMockRow}>
              {SEASON_REWARD_UI_MOCK_STATES.map((item) => (
                <TouchableOpacity
                  key={item}
                  onPress={() => setDevMockState(item)}
                  style={[styles.devChip, devMockState === item && styles.devChipActive]}
                >
                  <Text style={styles.devChipLabel}>{item}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <SeasonRewardBlock
              model={devMockModel}
              onClaimPress={() => {
                showAlert('DEV', 'Mock claim — gerçek callable çağrılmaz.');
              }}
            />
          </AppCard>
        </>
      ) : null}

      <View style={styles.sectionHeaderRow}>
        <SectionTitle title="Gelen Kutusu" subtitle={`${unreadCount} okunmamış`} compact />
        {unreadCount > 0 ? <TouchableOpacity onPress={markAllRead} style={styles.textButton}><Text style={styles.textButtonLabel}>Tümünü Oku</Text></TouchableOpacity> : null}
      </View>
      {state.inbox.length === 0 ? (
        <EmptyState title="Bildirim yok" message="Başarım ve sezon güncellemeleri burada görünecek." icon="notification" />
      ) : state.inbox.slice(0, 20).map((item) => (
        <TouchableOpacity key={item.id} onPress={() => handleInboxOpen(item)} activeOpacity={0.8}>
          <AppCard variant={item.readAt ? 'soft' : 'default'} style={styles.compactCard} padded>
            <View style={styles.cardHeader}><Text style={styles.cardTitle}>{item.title}</Text>{!item.readAt ? <View style={styles.unreadDot} /> : null}</View>
            <Text style={styles.body}>{item.body}</Text>
            <Text style={styles.meta}>{formatDate(item.createdAt)}</Text>
          </AppCard>
        </TouchableOpacity>
      ))}

      {MARKET_ALERTS_ENABLED && NOTIFICATION_CENTER_ENABLED ? (
        <>
          <SectionTitle
            title="Bildirim Tercihleri"
            subtitle={`Cihaz izni: ${permissionState === 'granted' ? 'Açık' : permissionState === 'denied' ? 'Kapalı' : 'Henüz sorulmadı'}`}
            compact
          />
          <AppCard variant="soft" style={styles.card} padded>
            <PreferenceRow
              label="Araç satışları"
              enabled={notificationPreferences.marketSaleAlerts}
              onPress={() => void handlePreferenceChange('marketSaleAlerts', !notificationPreferences.marketSaleAlerts)}
            />
            <PreferenceRow
              label="Pazar hareketleri"
              enabled={notificationPreferences.marketplaceActivityAlerts}
              onPress={() => void handlePreferenceChange('marketplaceActivityAlerts', !notificationPreferences.marketplaceActivityAlerts)}
            />
            <PreferenceRow
              label="Görev güncellemeleri"
              enabled={notificationPreferences.challengeAlerts}
              onPress={() => void handlePreferenceChange('challengeAlerts', !notificationPreferences.challengeAlerts)}
            />
            <PreferenceRow
              label="Sezon güncellemeleri"
              enabled={notificationPreferences.seasonAlerts}
              onPress={() => void handlePreferenceChange('seasonAlerts', !notificationPreferences.seasonAlerts)}
            />
            <Text style={styles.meta}>İzin verilmezse bildirimler Gelen Kutusu’nda görünmeye devam eder.</Text>
          </AppCard>
        </>
      ) : null}

      {V11_ANALYTICS_ENABLED ? <Text style={styles.analyticsNote}>V1.1 ölçüm sağlayıcısı: güvenli no-op/deferred</Text> : null}

      {onOpenSeasons ? <ActionButton label="Sezonlar ve Görevler" variant="secondary" onPress={onOpenSeasons} /> : null}
    </AppScreen>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <View style={styles.summary}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.meta}>{label}</Text></View>;
}

function PreferenceRow({ label, enabled, onPress }: { label: string; enabled: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.preferenceRow} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.cardTitle}>{label}</Text>
      <View style={[styles.toggle, enabled && styles.toggleEnabled]}>
        <View style={[styles.toggleThumb, enabled && styles.toggleThumbEnabled]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  loader: { marginVertical: spacing.md },
  info: { ...typography.caption, color: colors.accentAmber, marginBottom: spacing.sm },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  summary: { flex: 1, alignItems: 'center', padding: spacing.sm, borderRadius: 12, backgroundColor: colors.cardSoft },
  summaryValue: { ...typography.sectionTitle, color: colors.accentBlue },
  card: { marginBottom: spacing.sm },
  compactCard: { marginBottom: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...typography.bodySmall, fontWeight: '800', flexShrink: 1 },
  body: { ...typography.caption, color: colors.textSecondary, marginVertical: 6 },
  meta: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  points: { ...typography.bodySmall, color: colors.accentAmber, fontWeight: '800' },
  finalsRow: {
    marginTop: spacing.sm,
    gap: 2,
  },
  finalsLabel: { ...typography.caption, color: colors.textMuted },
  finalsValue: { ...typography.bodySmall, color: colors.accentBlue, fontWeight: '800' },
  finalsHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  textButtonLabel: { ...typography.caption, color: colors.accentBlue, fontWeight: '700' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentBlue },
  preferenceRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggle: { width: 44, height: 24, borderRadius: 12, padding: 3, backgroundColor: colors.border },
  toggleEnabled: { backgroundColor: colors.accentBlue },
  toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.textSecondary },
  toggleThumbEnabled: { alignSelf: 'flex-end', backgroundColor: colors.textPrimary },
  analyticsNote: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.sm },
  devMockRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  devChip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  devChipActive: { backgroundColor: colors.accentBlue },
  devChipLabel: { ...typography.caption, color: colors.textPrimary, fontSize: 10 },
});
