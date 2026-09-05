import * as Crypto from 'expo-crypto';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type AppStateStatus,
} from 'react-native';

import { ActionButton, AppCard, AppScreen, EmptyState, GameIcon, ScreenHeader, SectionTitle, StatusBadge } from '../../components/ui';
import { isInternalBuildProfile } from '../../config/buildProfile';
import { CHALLENGES_ENABLED, SEASONS_ENABLED } from '../../config/backendRoadmap';
import { subscribeAuthState } from '../../services/authService';
import {
  claimChallengeReward,
  getChallengeProgress,
  getCurrentSeason,
  getSeasonPoints,
} from '../../services/challengeService';
import { getFirebaseAuthSafe } from '../../services/firebase';
import { trackV11Analytics } from '../../services/analytics';
import { useGameStore } from '../../store/gameStore';
import { colors, spacing, typography } from '../../theme';
import ChallengeCard from '../challenges/ChallengeCard';
import {
  challengeAttemptKey,
  canClaimChallenge,
  createChallengeClaimAttempt,
  getChallengeErrorMessage,
  hasChallengePeriodRolledOver,
  shouldRetainClaimAttempt,
  withChallengeClaimTimeout,
  type ChallengeClaimAttempt,
  type ChallengeClaimFailureReason,
} from '../challenges/claimFlow';
import { reconcileChallengeClaimCash } from '../challenges/claimReconciliation';
import type { ChallengeProgressItem, PeriodDefinition, SeasonDefinition } from './types';

interface SeasonsChallengesScreenProps {
  onBack: () => void;
  onOpenAccountCenter: () => void;
  onOpenLeaderboard?: () => void;
}

type ScreenMode = 'loading' | 'guest' | 'ready' | 'error';

interface ChallengeViewState {
  season: SeasonDefinition;
  dailyPeriod: PeriodDefinition;
  weeklyPeriod: PeriodDefinition;
  challenges: ChallengeProgressItem[];
  seasonPoints: number | null;
}

function formatCountdown(targetMs: number, nowMs: number): string {
  const remaining = Math.max(0, targetMs - nowMs);
  const totalMinutes = Math.ceil(remaining / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} gün ${hours} sa`;
  if (hours > 0) return `${hours} sa ${minutes} dk`;
  return `${minutes} dk`;
}

function isLinkedAccount(): boolean {
  const user = getFirebaseAuthSafe()?.currentUser;
  return Boolean(user && !user.isAnonymous);
}

export default function SeasonsChallengesScreen({
  onBack,
  onOpenAccountCenter,
  onOpenLeaderboard,
}: SeasonsChallengesScreenProps) {
  const [mode, setMode] = useState<ScreenMode>(() => (isLinkedAccount() ? 'loading' : 'guest'));
  const [data, setData] = useState<ChallengeViewState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingClaimKey, setPendingClaimKey] = useState<string | null>(null);
  const [lastClaimResult, setLastClaimResult] = useState<string>('—');
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [displayNowMs, setDisplayNowMs] = useState(Date.now());
  const requestInFlightRef = useRef(false);
  const dataRef = useRef<ChallengeViewState | null>(null);
  const claimInFlightRef = useRef<string | null>(null);
  const claimAttemptsRef = useRef(new Map<string, ChallengeClaimAttempt>());
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const rolloverAttemptRef = useRef<string | null>(null);

  const refresh = useCallback(async (showLoading = false) => {
    if (requestInFlightRef.current || !SEASONS_ENABLED || !CHALLENGES_ENABLED) return;
    if (!isLinkedAccount()) {
      setMode('guest');
      dataRef.current = null;
      setData(null);
      return;
    }
    requestInFlightRef.current = true;
    setErrorMessage(null);
    if (showLoading) setMode('loading');
    else setRefreshing(true);
    try {
      const seasonResult = await getCurrentSeason();
      if (!seasonResult.ok || !seasonResult.season) {
        const reason = seasonResult.reason ?? 'service-unavailable';
        if (reason === 'auth-required') setMode('guest');
        else {
          setErrorMessage(getChallengeErrorMessage(reason as ChallengeClaimFailureReason));
          setMode(dataRef.current ? 'ready' : 'error');
        }
        return;
      }

      const progressResult = await getChallengeProgress();
      if (
        !progressResult.ok ||
        !progressResult.dailyPeriod ||
        !progressResult.weeklyPeriod ||
        !progressResult.challenges
      ) {
        const reason = progressResult.reason ?? 'service-unavailable';
        if (reason === 'auth-required') setMode('guest');
        else {
          setErrorMessage(getChallengeErrorMessage(reason as ChallengeClaimFailureReason));
          setMode(dataRef.current ? 'ready' : 'error');
        }
        return;
      }

      const pointsResult = await getSeasonPoints(seasonResult.season.key);
      const previousPoints = dataRef.current?.season.key === seasonResult.season.key
        ? dataRef.current.seasonPoints
        : null;
      const challenges = progressResult.challenges.filter((item) => item.definition.enabled);
      const nextData: ChallengeViewState = {
        season: seasonResult.season,
        dailyPeriod: progressResult.dailyPeriod,
        weeklyPeriod: progressResult.weeklyPeriod,
        challenges,
        seasonPoints: pointsResult.ok ? pointsResult.points : previousPoints,
      };
      dataRef.current = nextData;
      setData(nextData);
      setLastRefreshAt(Date.now());
      setDisplayNowMs(Date.now());
      setMode('ready');
    } finally {
      requestInFlightRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void trackV11Analytics('seasons_screen_view', { source: 'company' });
    void refresh(true);
  }, []); // Screen mount is the More sub-route focus boundary.

  useEffect(() => subscribeAuthState((user) => {
    if (!user || user.isAnonymous) {
      setMode('guest');
      dataRef.current = null;
      setData(null);
      claimAttemptsRef.current.clear();
      return;
    }
    void refresh(true);
  }), [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appStateRef.current === 'background' || appStateRef.current === 'inactive';
      appStateRef.current = nextState;
      if (wasBackground && nextState === 'active') void refresh(false);
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setDisplayNowMs(now);
      if (!data || !hasChallengePeriodRolledOver(now, data.dailyPeriod.endsAt, data.weeklyPeriod.endsAt)) return;
      const rolloverKey = `${data.dailyPeriod.key}:${data.weeklyPeriod.key}`;
      if (rolloverAttemptRef.current === rolloverKey) return;
      rolloverAttemptRef.current = rolloverKey;
      claimAttemptsRef.current.clear();
      claimInFlightRef.current = null;
      setPendingClaimKey(null);
      void refresh(false);
    }, 60_000);
    return () => clearInterval(interval);
  }, [data, refresh]);

  const handleClaim = useCallback(async (item: ChallengeProgressItem) => {
    const linkedAccount = isLinkedAccount();
    if (!canClaimChallenge({
      completed: item.progress.completed,
      claimed: item.progress.claimed,
      linkedAccount,
      featuresEnabled: SEASONS_ENABLED && CHALLENGES_ENABLED,
      requestPending: Boolean(claimInFlightRef.current || requestInFlightRef.current),
    })) {
      if (!linkedAccount) setMode('guest');
      return;
    }
    if (!linkedAccount) {
      setMode('guest');
      return;
    }
    const key = challengeAttemptKey(item.definition.id, item.progress.periodKey);
    void trackV11Analytics('challenge_claim_tap', {
      challenge_type: item.definition.cadence,
    });
    const attempt = claimAttemptsRef.current.get(key) ?? createChallengeClaimAttempt(
      item.definition.id,
      item.progress.periodKey,
      () => Crypto.randomUUID(),
    );
    claimAttemptsRef.current.set(key, attempt);
    claimInFlightRef.current = key;
    setPendingClaimKey(key);
    setErrorMessage(null);

    try {
      const result = await withChallengeClaimTimeout(claimChallengeReward(attempt));
      if (result.ok) {
        const reconciled = await reconcileChallengeClaimCash(result.cashAfter);
        const pointsResult = await getSeasonPoints(result.seasonKey);
        const pointsReconciled =
          pointsResult.ok && pointsResult.points === result.seasonPointsAfter;
        if (!reconciled || !pointsReconciled) {
          void trackV11Analytics('challenge_claim_failure', { result: 'reconciliation_failed' });
          setErrorMessage(getChallengeErrorMessage('reconciliation-failed'));
          setLastClaimResult('reconciliation-failed');
          return;
        }
        claimAttemptsRef.current.delete(key);
        void trackV11Analytics('challenge_claim_success', {
          challenge_type: item.definition.cadence,
        });
        setLastClaimResult('success');
        useGameStore.getState().addNotification({
          type: 'success',
          title: 'Görev ödülü alındı',
          message: 'Nakit ve sezon puanın sunucudan güncellendi.',
          time: useGameStore.getState().currentTime,
        });
        await refresh(false);
        return;
      }

      const reason = (result.reason ?? 'service-unavailable') as ChallengeClaimFailureReason;
      void trackV11Analytics('challenge_claim_failure', { result: reason });
      setLastClaimResult(reason);
      if (reason === 'already-claimed') {
        await reconcileChallengeClaimCash();
        claimAttemptsRef.current.delete(key);
        await refresh(false);
        return;
      }
      if (!shouldRetainClaimAttempt(reason)) claimAttemptsRef.current.delete(key);
      setErrorMessage(getChallengeErrorMessage(reason));
      if (reason === 'period-closed') await refresh(false);
    } catch {
      void trackV11Analytics('challenge_claim_failure', { result: 'timeout' });
      setLastClaimResult('timeout');
      setErrorMessage(getChallengeErrorMessage('timeout'));
    } finally {
      claimInFlightRef.current = null;
      setPendingClaimKey(null);
    }
  }, [refresh]);

  const daily = useMemo(
    () => data?.challenges.filter((item) => item.definition.cadence === 'daily') ?? [],
    [data?.challenges],
  );
  const weekly = useMemo(
    () => data?.challenges.filter((item) => item.definition.cadence === 'weekly') ?? [],
    [data?.challenges],
  );

  const header = (
    <ScreenHeader
      title="Sezonlar ve Görevler"
      subtitle="Günlük ve haftalık hedeflerini tamamla"
      onBack={onBack}
      compact
      rightAction={
        mode === 'ready' ? (
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={() => void refresh(false)}
            disabled={refreshing}
            accessibilityRole="button"
            accessibilityLabel="Görevleri yenile"
          >
            {refreshing ? <ActivityIndicator size="small" color={colors.accentBlue} /> : <GameIcon name="refresh" size={20} color={colors.accentBlue} />}
          </TouchableOpacity>
        ) : null
      }
    />
  );

  if (!SEASONS_ENABLED || !CHALLENGES_ENABLED) {
    return <AppScreen embedded>{header}<EmptyState title="Sezon görevleri kapalı" message="Bu özellik bu sürümde kullanılamıyor." icon="lock" /></AppScreen>;
  }

  if (mode === 'guest') {
    return (
      <AppScreen embedded scroll>
        {header}
        <EmptyState
          title="Bağlı hesap gerekli"
          message="Sezon ilerlemeni güvenle saklamak ve ödül almak için Google veya Apple hesabını bağla."
          icon="account"
          actionLabel="Hesap Merkezi"
          onAction={onOpenAccountCenter}
        />
      </AppScreen>
    );
  }

  if (mode === 'loading') {
    return <AppScreen embedded>{header}<View style={styles.centerState}><ActivityIndicator size="large" color={colors.accentBlue} /><Text style={styles.stateText}>Sezon görevleri yükleniyor...</Text></View></AppScreen>;
  }

  if (mode === 'error' || !data) {
    return (
      <AppScreen embedded scroll>
        {header}
        <EmptyState title="Görevler yüklenemedi" message={errorMessage ?? 'Bağlantını kontrol edip tekrar dene.'} icon="warning" actionLabel="Tekrar Dene" onAction={() => void refresh(true)} />
      </AppScreen>
    );
  }

  return (
    <AppScreen embedded scroll>
      {header}
      <AppCard variant="highlighted" style={styles.seasonCard} padded={false}>
        <View style={styles.seasonIcon}><GameIcon name="trophy" size={24} color={colors.accentAmber} /></View>
        <View style={styles.seasonMain}>
          <Text style={styles.seasonName}>{data.season.displayName}</Text>
          <Text style={styles.seasonReset}>Sezon yenilenmesine {formatCountdown(data.season.endsAt, displayNowMs)}</Text>
        </View>
        <View style={styles.pointsWrap}>
          <Text style={styles.pointsValue}>{data.seasonPoints ?? '—'}</Text>
          <Text style={styles.pointsLabel}>SEZON PUANI</Text>
        </View>
      </AppCard>

      {errorMessage ? (
        <AppCard variant="highlighted" style={styles.feedbackCard} padded={false}>
          <GameIcon name="warning" size={16} color={colors.accentAmber} />
          <Text style={styles.feedbackText}>{errorMessage}</Text>
        </AppCard>
      ) : null}

      <View style={styles.sectionHeader}>
        <SectionTitle title="Günlük Görevler" compact />
        <StatusBadge label={formatCountdown(data.dailyPeriod.endsAt, displayNowMs)} variant="blue" size="sm" />
      </View>
      {daily.length > 0 ? daily.map((item) => (
        <ChallengeCard key={`${item.progress.periodKey}:${item.definition.id}`} item={item} pending={refreshing || pendingClaimKey === challengeAttemptKey(item.definition.id, item.progress.periodKey)} onClaim={handleClaim} />
      )) : <EmptyState compact title="Günlük görev yok" message="Yeni görevler için daha sonra tekrar kontrol et." />}

      <View style={styles.sectionHeader}>
        <SectionTitle title="Haftalık Görevler" compact />
        <StatusBadge label={formatCountdown(data.weeklyPeriod.endsAt, displayNowMs)} variant="amber" size="sm" />
      </View>
      {weekly.length > 0 ? weekly.map((item) => (
        <ChallengeCard key={`${item.progress.periodKey}:${item.definition.id}`} item={item} pending={refreshing || pendingClaimKey === challengeAttemptKey(item.definition.id, item.progress.periodKey)} onClaim={handleClaim} />
      )) : <EmptyState compact title="Haftalık görev yok" message="Yeni görevler için daha sonra tekrar kontrol et." />}

      {onOpenLeaderboard ? <ActionButton label="Sezon Sıralamasını Gör" onPress={onOpenLeaderboard} variant="secondary" fullWidth compact icon="trophy" style={styles.leaderboardButton} /> : null}

      {isInternalBuildProfile() ? (
        <AppCard variant="soft" style={styles.diagnostics} padded={false}>
          <Text style={styles.diagnosticsTitle}>INTERNAL DIAGNOSTICS</Text>
          <Text style={styles.diagnosticsText}>Sezon: {data.season.key}</Text>
          <Text style={styles.diagnosticsText}>Günlük: {data.dailyPeriod.key}</Text>
          <Text style={styles.diagnosticsText}>Haftalık: {data.weeklyPeriod.key}</Text>
          <Text style={styles.diagnosticsText}>Son yenileme: {lastRefreshAt ? new Date(lastRefreshAt).toLocaleTimeString('tr-TR') : '—'}</Text>
          <Text style={styles.diagnosticsText}>Son claim: {lastClaimResult}</Text>
        </AppCard>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  refreshButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.bodySmall },
  seasonCard: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  seasonIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: colors.accentAmberSoft, alignItems: 'center', justifyContent: 'center' },
  seasonMain: { flex: 1, minWidth: 0 },
  seasonName: { ...typography.cardTitle, fontSize: 15 },
  seasonReset: { ...typography.caption, marginTop: 3 },
  pointsWrap: { alignItems: 'flex-end' },
  pointsValue: { ...typography.statValue, color: colors.accentAmber },
  pointsLabel: { ...typography.caption, fontSize: 9, fontWeight: '800' },
  feedbackCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md },
  feedbackText: { ...typography.bodySmall, flex: 1, color: colors.textPrimary },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, marginBottom: spacing.sm },
  leaderboardButton: { marginTop: spacing.sm, marginBottom: spacing.md },
  diagnostics: { padding: spacing.md, marginTop: spacing.sm, marginBottom: spacing.md },
  diagnosticsTitle: { ...typography.caption, color: colors.accentBlue, fontWeight: '800', marginBottom: spacing.xs },
  diagnosticsText: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
