/**
 * LogistiCore - Haftalık Liderlik Tablosu (V1)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AppTutorialHelpButton from '../components/tutorial/AppTutorialHelpButton';
import AppTutorialOverlay from '../components/tutorial/AppTutorialOverlay';
import { AppTutorialTarget } from '../components/tutorial/AppTutorialTarget';
import { useScreenAppTutorial } from '../hooks/useScreenAppTutorial';
import { useTutorialLayoutReady } from '../hooks/useTutorialLayoutReady';
import {
  AppCard,
  AppScreen,
  EmptyState,
  GameIcon,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import {
  DEFAULT_ACCOUNT_STATUS,
  getAccountStatus,
  subscribeAuthState,
  type AccountStatus,
} from '../services/authService';
import {
  LEADERBOARD_EMPTY_SEASON_MESSAGE,
  getLeaderboardKindMessage,
  getLeaderboardKindTitle,
  mapLeaderboardErrorCodeToKind,
} from '../domain/leaderboardErrorModel';
import {
  applyLeaderboardFetchError,
  applyLeaderboardFetchSuccess,
  beginLeaderboardRefresh,
  type LeaderboardScreenState,
} from '../domain/leaderboardScreenState';
import {
  fetchWeeklyLeaderboard,
  isLeaderboardEligible,
  resetLeaderboardSubmitCache,
  submitCurrentLeaderboardScore,
  type LeaderboardRankedEntry,
} from '../services/leaderboardService';
import {
  markLeaderboardSeasonSubmitted,
  maybeSubmitLeaderboardForSeasonChange,
} from '../services/leaderboardSeasonSync';
import { fetchUsernameProfile } from '../services/usernameService';
import { subscribeUsernameProfileChanged } from '../services/usernameProfileEvents';
import { leaderboardConfig } from '../config/leaderboard';
import {
  LEADERBOARD_SCORE_EXPLAINER,
  LEADERBOARD_UNRANKED_MESSAGE,
  LEADERBOARD_UNRANKED_TITLE,
  isLeaderboardRankedEligible,
} from '../domain/leaderboardRankEligibility';
import { formatLeaderboardSeasonRange } from '../utils/leaderboardSeason';
import { markStartup } from '../utils/startupPerformance';
import { formatCompanyScore, getCompanyScoreBreakdown } from '../simulation/companyScore';
import { useGameStore } from '../store/gameStore';
import {
  selectCities,
  selectFinanceLedger,
  selectProducts,
} from '../store/selectors/stableCollections';
import { selectPlayer, selectPlayerCompletedContracts } from '../store/selectors/playerFields';
import { selectCurrentTimeHour } from '../store/selectors/timeBuckets';
import { colors, spacing, typography } from '../theme';

interface LeaderboardScreenProps {
  onBack?: () => void;
  onOpenAccountSettings?: () => void;
}

const LEADERBOARD_LOAD_ERROR_MESSAGE =
  'Liderlik tablosu şu anda yüklenemedi. Lütfen tekrar dene.';

function resolveLeaderboardErrorMessage(
  errorCode?: string,
  error?: string,
): string {
  switch (errorCode) {
    case 'feature-disabled':
    case 'firebase-disabled':
      return 'Liderlik tablosu şu anda kullanılamıyor.';
    case 'auth-required':
      return 'Liderlik tablosunu görmek için giriş yapmalısın.';
    case 'anonymous-not-supported':
      return 'Sıralama için Google veya Apple hesabını bağlaman gerekir.';
    case 'save-not-found':
      return 'Bulut kaydın henüz hazır değil. Kısa süre sonra tekrar dene.';
    case 'invalid-player-state':
      return 'Oyuncu verisi doğrulanamadı. Tekrar senkronize etmeyi dene.';
    case 'rate-limited':
      return 'Çok fazla istek gönderildi. Biraz sonra tekrar dene.';
    case 'season-closed':
      return 'Bu sezon kapanmış. Güncel haftalık tabloyu yenile.';
    case 'username-required':
      return 'Liderlik tablosuna katılmak için önce kullanıcı adını oluşturmalısın.';
    case 'server-state-missing':
    case 'backend-not-ready':
      return 'Liderlik servisi henüz hazır değil. Kısa süre sonra tekrar dene.';
    case 'function-not-found':
    case 'function-unavailable':
      return 'Liderlik servisine şu anda ulaşılamıyor.';
    case 'network-error':
      return 'Bağlantı kurulamadı. İnternet bağlantını kontrol et.';
    case 'timeout':
      return 'İstek zaman aşımına uğradı. Lütfen tekrar dene.';
    case 'permission-denied':
      return 'Bu işlem için yetkin yok.';
    case 'app-check-failed':
      return 'Uygulama doğrulaması başarısız. Uygulamayı güncelle ve tekrar dene.';
    case 'service-unavailable':
      return 'Liderlik servisine şu anda ulaşılamıyor.';
    default:
      return LEADERBOARD_LOAD_ERROR_MESSAGE;
  }
}

function logLeaderboardError(errorCode?: string, error?: string): void {
  if (!__DEV__) {
    return;
  }
  if (errorCode === 'permission-denied') {
    console.warn(
      '[leaderboard] permission-denied — Firestore rules veya auth kontrol edilmeli.',
      error,
    );
    return;
  }
  if (errorCode === 'failed-precondition') {
    console.warn('[leaderboard] failed-precondition — composite index gerekebilir.', error);
    return;
  }
  if (errorCode) {
    console.warn('[leaderboard] load error', { errorCode, error });
  }
}

function formatScore(score: number): string {
  return Math.floor(score).toLocaleString('tr-TR');
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <View style={styles.topRankBadge}>
        <GameIcon name="trophy" size={11} color={colors.accentAmber} />
        <Text style={styles.topRankText}>#1</Text>
      </View>
    );
  }
  if (rank === 2) {
    return <StatusBadge label="#2" variant="muted" size="sm" />;
  }
  if (rank === 3) {
    return <StatusBadge label="#3" variant="info" size="sm" />;
  }
  return <Text style={styles.rankText}>#{rank}</Text>;
}

const LeaderboardRow = React.memo(function LeaderboardRow({
  entry,
  isPlayer,
}: {
  entry: LeaderboardRankedEntry;
  isPlayer: boolean;
}) {
  return (
    <AppCard
      variant={isPlayer ? 'soft' : 'default'}
      style={[styles.rowCard, isPlayer && styles.rowCardHighlight]}
      padded={false}
    >
      <View style={styles.rowInner}>
        <View style={styles.rankCol}>
          <RankBadge rank={entry.rank} />
        </View>
        <View style={styles.mainCol}>
          <View style={styles.nameRow}>
            <Text style={styles.companyName} numberOfLines={1} ellipsizeMode="tail">
              {entry.username?.trim() || entry.companyName}
            </Text>
            {isPlayer ? <StatusBadge label="Sen" variant="amber" size="sm" /> : null}
          </View>
          <Text style={styles.rowMeta} numberOfLines={1}>
            Seviye {entry.level} · İtibar {Math.round(entry.reputation)}/100 ·{' '}
            {entry.completedContracts} teslimat
          </Text>
        </View>
        <View style={styles.scoreCol}>
          <Text style={styles.scoreValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {formatScore(entry.companyScore)}
          </Text>
          <Text style={styles.scoreLabel}>puan</Text>
        </View>
      </View>
    </AppCard>
  );
});

function PlayerSummaryCard({
  entry,
  rank,
  outsideTop,
}: {
  entry: {
    username?: string;
    companyName: string;
    companyScore: number;
    level: number;
    reputation: number;
  };
  rank: number | null;
  outsideTop: boolean;
}) {
  return (
    <AppCard variant="soft" style={styles.playerCard} padded>
      <View style={styles.playerHeader}>
        <GameIcon name="trophy" size={18} color={colors.accentAmber} />
        <Text style={styles.playerTitle}>Senin sıralaman</Text>
      </View>
      <Text style={styles.playerCompany} numberOfLines={1}>
        {entry.username?.trim() || entry.companyName}
      </Text>
      <View style={styles.playerStats}>
        <View style={styles.playerStat}>
          <Text style={styles.playerStatLabel}>Sıra</Text>
          <Text
            style={[
              styles.playerStatValue,
              rank != null && rank <= 3 && styles.playerStatValueAccent,
            ]}
          >
            {rank ? `#${rank}` : outsideTop ? `Top ${leaderboardConfig.leaderboardSize} dışı` : '—'}
          </Text>
        </View>
        <View style={styles.playerStat}>
          <Text style={styles.playerStatLabel}>Puan</Text>
          <Text style={[styles.playerStatValue, styles.playerScoreValue]}>
            {formatScore(entry.companyScore)}
          </Text>
        </View>
        <View style={styles.playerStat}>
          <Text style={styles.playerStatLabel}>Seviye</Text>
          <Text style={styles.playerStatValue}>{entry.level}</Text>
        </View>
        <View style={styles.playerStat}>
          <Text style={styles.playerStatLabel}>İtibar</Text>
          <Text style={styles.playerStatValue}>{Math.round(entry.reputation)}</Text>
        </View>
      </View>
    </AppCard>
  );
}

function UnrankedEligibilityCard({
  completedDeliveries,
  remaining,
}: {
  completedDeliveries: number;
  remaining: number;
}) {
  return (
    <AppCard variant="soft" style={styles.unrankedCard} padded>
      <View style={styles.guestHeader}>
        <GameIcon name="warning" size={18} color={colors.accentAmber} />
        <Text style={styles.guestTitle}>{LEADERBOARD_UNRANKED_TITLE}</Text>
      </View>
      <Text style={styles.guestText}>{LEADERBOARD_UNRANKED_MESSAGE}</Text>
      <Text style={styles.unrankedProgress}>
        {completedDeliveries}/{leaderboardConfig.minCompletedDeliveriesToRank} teslimat · {remaining} teslimat kaldı
      </Text>
    </AppCard>
  );
}

function ScoreExplainerCard({
  breakdown,
}: {
  breakdown: {
    deliveryScore: number;
    progressionScore: number;
    reputationScore: number;
    assetScore: number;
    weeklyActivityScore: number;
    totalScore: number;
    rankedEligible: boolean;
  };
}) {
  return (
    <AppCard variant="soft" style={styles.explainerCard} padded>
      <Text style={styles.explainerTitle}>Şirket puanı nasıl hesaplanır?</Text>
      <Text style={styles.seasonHint}>{LEADERBOARD_SCORE_EXPLAINER}</Text>
      <View style={styles.explainerBreakdown}>
          <Text style={styles.explainerLine}>
            Teslimatlar: {formatCompanyScore(breakdown.deliveryScore)}
          </Text>
          <Text style={styles.explainerLine}>
            Şirket gelişimi: {formatCompanyScore(breakdown.progressionScore)}
          </Text>
          <Text style={styles.explainerLine}>
            İtibar: {formatCompanyScore(breakdown.reputationScore)}
          </Text>
          <Text style={styles.explainerLine}>
            Filo ve varlıklar: {formatCompanyScore(breakdown.assetScore)}
          </Text>
          <Text style={styles.explainerLine}>
            Haftalık performans: {formatCompanyScore(breakdown.weeklyActivityScore)}
          </Text>
          <Text style={styles.explainerTotal}>
            Toplam: {formatCompanyScore(breakdown.totalScore)}
          </Text>
          <Text style={styles.seasonHint}>
            Haftalık operasyon puanı sunucuda, bu haftaki teslimatlara göre hesaplanır.
          </Text>
        </View>
    </AppCard>
  );
}

function GuestPromptCard() {
  return (
    <AppCard variant="soft" style={styles.guestCard} padded>
      <View style={styles.guestHeader}>
        <GameIcon name="account" size={20} color={colors.info} />
        <Text style={styles.guestTitle}>Sıralamaya katılmak için hesabını bağla</Text>
      </View>
      <Text style={styles.guestText}>
        Haftalık liderlik tablosu yalnızca Google veya Apple ile bağlı hesaplar için geçerlidir.
        Şirket ekranından hesabını bağlayarak sıralamaya dahil olabilirsin.
      </Text>
    </AppCard>
  );
}

function UsernamePromptCard({ onOpenAccountSettings }: { onOpenAccountSettings?: () => void }) {
  return (
    <AppCard variant="soft" style={styles.guestCard} padded>
      <View style={styles.guestHeader}>
        <GameIcon name="account" size={20} color={colors.accentAmber} />
        <Text style={styles.guestTitle}>Liderlik Tablosuna katılmak için kullanıcı adı oluştur</Text>
      </View>
      <Text style={styles.guestText}>
        Görünen adın, haftalık sıralama ve Araç Pazarı’nda kullanılır.
      </Text>
      {onOpenAccountSettings ? (
        <Text style={styles.usernameCta} onPress={onOpenAccountSettings} accessibilityRole="button">
          Kullanıcı Adı Oluştur
        </Text>
      ) : null}
    </AppCard>
  );
}

export default function LeaderboardScreen({ onBack, onOpenAccountSettings }: LeaderboardScreenProps) {
  const { contentBottomPadding } = useTabBarLayout();
  const [account, setAccount] = useState<AccountStatus>(DEFAULT_ACCOUNT_STATUS);
  const [screenState, setScreenState] = useState<LeaderboardScreenState>({ status: 'loading' });
  const [usernameReady, setUsernameReady] = useState<boolean | null>(null);
  const { layoutReady, markLayoutReady } = useTutorialLayoutReady();
  const requestSeqRef = React.useRef(0);
  const listRef = useRef<FlatList<LeaderboardRankedEntry>>(null);
  const lastAuthUidRef = React.useRef<string | null>(null);

  const eligible = isLeaderboardEligible();
  const uid = account.uid;
  const player = useGameStore(selectPlayer);
  const cities = useGameStore(selectCities);
  const products = useGameStore(selectProducts);
  const financeLedger = useGameStore(selectFinanceLedger);
  const currentTimeHour = useGameStore(selectCurrentTimeHour);
  const completedDeliveries = useGameStore(selectPlayerCompletedContracts);
  const rankedEligible = isLeaderboardRankedEligible(completedDeliveries);
  const scoreBreakdownReady = screenState.status !== 'loading';
  const localScoreBreakdown = useMemo(
    () => {
      if (!scoreBreakdownReady) {
        return null;
      }
      return player
        ? getCompanyScoreBreakdown({
            player,
            cities,
            products,
            financeLedger,
            currentTime: currentTimeHour,
          })
        : null;
    },
    [scoreBreakdownReady, player, cities, products, financeLedger, currentTimeHour],
  );

  const fetchData =
    screenState.status === 'ready' || screenState.status === 'refreshing'
      ? screenState.data
      : null;
  const emptySeason = screenState.status === 'empty' ? screenState.season : null;
  const seasonLabel = useMemo(
    () =>
      formatLeaderboardSeasonRange(
        fetchData?.seasonStartMs ?? emptySeason?.startsAt,
        fetchData?.seasonEndMs ?? emptySeason?.endsAt,
      ),
    [emptySeason?.endsAt, emptySeason?.startsAt, fetchData?.seasonEndMs, fetchData?.seasonStartMs],
  );
  const entries = fetchData?.entries ?? [];
  const playerEntry = fetchData?.playerEntry ?? null;
  const playerRank = fetchData?.playerRank ?? null;

  const leaderboardTutorial = useScreenAppTutorial({
    tutorialId: 'leaderboard',
    layoutReady,
    stepOptions: { hasLeaderboardEntries: entries.length > 0 },
  });

  const isLoading = screenState.status === 'loading';
  const isRefreshing = screenState.status === 'refreshing';
  const errorKind = screenState.status === 'error' ? screenState.error : null;

  const refreshAccount = useCallback(() => {
    setAccount(getAccountStatus() ?? DEFAULT_ACCOUNT_STATUS);
  }, []);

  const syncLeaderboardScoreInBackground = useCallback(
    async (forceSubmit: boolean) => {
      try {
        await maybeSubmitLeaderboardForSeasonChange();
        const submitResult = await submitCurrentLeaderboardScore({ force: forceSubmit });
        if (submitResult.ok && submitResult.seasonKey) {
          await markLeaderboardSeasonSubmitted(submitResult.seasonKey);
        } else if (
          submitResult.errorCode &&
          submitResult.errorCode !== 'score-not-improved' &&
          submitResult.errorCode !== 'not-ranked-eligible'
        ) {
          logLeaderboardError(
            typeof submitResult.errorCode === 'string' ? submitResult.errorCode : undefined,
            submitResult.error,
          );
        }
        if (submitResult.ok && submitResult.updated) {
          const refreshed = await fetchWeeklyLeaderboard(uid);
          if (refreshed.ok) {
            setScreenState(applyLeaderboardFetchSuccess(refreshed));
          }
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('[leaderboard] background score sync failed', error);
        }
      }
    },
    [uid],
  );

  const loadLeaderboard = useCallback(
    async (options?: { forceSubmit?: boolean }) => {
      const forceSubmit = options?.forceSubmit ?? false;
      markStartup('LEADERBOARD_INIT_START');
      const requestSeq = ++requestSeqRef.current;
      setScreenState((current) => beginLeaderboardRefresh(current));

      if (!isLeaderboardEligible()) {
        if (requestSeq !== requestSeqRef.current) return;
        setScreenState({ status: 'unauthenticated' });
        return;
      }

      const [profile, result] = await Promise.all([
        fetchUsernameProfile(),
        fetchWeeklyLeaderboard(uid),
      ]);
      if (requestSeq !== requestSeqRef.current) return;

      const hasUsername = profile.ok && profile.profile.usernameSetupCompleted;
      setUsernameReady(hasUsername);
      if (!hasUsername) {
        setScreenState({ status: 'username-required' });
        return;
      }

      if (!result.ok) {
        setScreenState(
          applyLeaderboardFetchError(
            mapLeaderboardErrorCodeToKind(result.errorCode),
          ),
        );
        logLeaderboardError(result.errorCode, result.error);
        return;
      }

      setScreenState(applyLeaderboardFetchSuccess(result));
      markStartup('LEADERBOARD_INIT_DONE');

      void syncLeaderboardScoreInBackground(forceSubmit);
    },
    [syncLeaderboardScoreInBackground, uid],
  );

  useEffect(() => {
    refreshAccount();
    let cancelled = false;
    let interactionHandle: { cancel?: () => void } | null = null;
    const scheduleLoad = (forceSubmit: boolean) => {
      interactionHandle?.cancel?.();
      interactionHandle = InteractionManager.runAfterInteractions(() => {
        if (!cancelled) {
          void loadLeaderboard({ forceSubmit });
        }
      });
    };
    const unsub = subscribeAuthState((user) => {
      refreshAccount();
      const nextUid = user && !user.isAnonymous ? user.uid : null;
      const uidChanged =
        lastAuthUidRef.current !== null && lastAuthUidRef.current !== nextUid;
      if (uidChanged) {
        resetLeaderboardSubmitCache();
        setScreenState({ status: 'loading' });
      }
      lastAuthUidRef.current = nextUid;
      scheduleLoad(uidChanged);
    });
    return () => {
      cancelled = true;
      interactionHandle?.cancel?.();
      unsub();
    };
  }, [loadLeaderboard, refreshAccount]);

  useEffect(() => {
    if (!eligible) {
      setUsernameReady(null);
      return;
    }
    const unsubProfile = subscribeUsernameProfileChanged(() => {
      void loadLeaderboard({ forceSubmit: false });
    });
    return unsubProfile;
  }, [eligible, loadLeaderboard]);

  const playerOutsideTop =
    Boolean(playerEntry) &&
    !entries.some((entry) => entry.uid === playerEntry?.uid);

  const renderItem = useCallback(
    ({ item }: { item: LeaderboardRankedEntry }) => (
      <LeaderboardRow entry={item} isPlayer={Boolean(uid && item.uid === uid)} />
    ),
    [uid],
  );

  const keyExtractor = useCallback((item: LeaderboardRankedEntry) => item.uid, []);

  const listFooter = useMemo(() => {
    if (errorKind || entries.length === 0 || entries.length > 2) {
      return null;
    }
    return (
      <View style={styles.growHintCard}>
        <GameIcon name="employees" size={14} color={colors.textMuted} />
        <Text style={styles.growHintText}>
          Haftalık sıralama yeni başladı. Diğer şirketler katıldıkça liste burada büyüyecek.
        </Text>
      </View>
    );
  }, [errorKind, entries.length]);

  const listHeader = useMemo(
    () => (
      <View style={styles.headerBlock}>
        <AppTutorialTarget tutorialId="leaderboard" targetId="weekly-season" layoutMode="stretch">
          <AppCard variant="soft" style={styles.seasonCard} padded>
            <View style={styles.seasonRow}>
              <GameIcon name="company" size={18} color={colors.accentBlue} />
              <View style={styles.seasonText}>
                <Text style={styles.seasonTitle}>Haftalık sezon</Text>
                <Text style={styles.seasonDates}>{seasonLabel}</Text>
              </View>
              <StatusBadge label="Canlı" variant="success" size="sm" />
            </View>
            <Text style={styles.seasonHint}>
              {LEADERBOARD_SCORE_EXPLAINER} Varsayılan itibar sıralamada avantaj sağlamaz.
            </Text>
          </AppCard>
        </AppTutorialTarget>

        {!eligible ? <GuestPromptCard /> : null}
        {eligible && usernameReady === false ? (
          <UsernamePromptCard onOpenAccountSettings={onOpenAccountSettings} />
        ) : null}

        {eligible && usernameReady !== false && !rankedEligible ? (
          <UnrankedEligibilityCard
            completedDeliveries={completedDeliveries}
            remaining={Math.max(
              0,
              leaderboardConfig.minCompletedDeliveriesToRank - completedDeliveries,
            )}
          />
        ) : null}

        {eligible && rankedEligible && playerEntry ? (
          <AppTutorialTarget tutorialId="leaderboard" targetId="my-rank" layoutMode="stretch">
            <PlayerSummaryCard
              entry={playerEntry}
              rank={playerRank}
              outsideTop={playerOutsideTop}
            />
          </AppTutorialTarget>
        ) : null}

        {localScoreBreakdown ? (
          <ScoreExplainerCard breakdown={localScoreBreakdown} />
        ) : null}

        <AppTutorialTarget tutorialId="leaderboard" targetId="company-ranking" layoutMode="stretch">
          <SectionTitle title={`En iyi ${leaderboardConfig.leaderboardSize}`} compact />
        </AppTutorialTarget>
      </View>
    ),
    [seasonLabel, eligible, usernameReady, onOpenAccountSettings, playerEntry, playerRank, playerOutsideTop, rankedEligible, completedDeliveries, localScoreBreakdown],
  );

  const headerRightAction = (
    <AppTutorialHelpButton {...leaderboardTutorial.helpButtonProps} />
  );

  if (isLoading && entries.length === 0) {
    return (
      <View style={styles.screenRoot}>
        <AppScreen reserveTabBarSpace={false}>
          {onBack ? (
            <ScreenHeader
              title="Liderlik Tablosu"
              compact
              onBack={onBack}
              rightAction={headerRightAction}
            />
          ) : (
            <AppTutorialTarget tutorialId="leaderboard" targetId="leaderboard-header" layoutMode="stretch">
              <ScreenHeader title="Liderlik Tablosu" compact rightAction={headerRightAction} />
            </AppTutorialTarget>
          )}
          <View style={styles.loadingWrap} onLayout={markLayoutReady}>
            <ActivityIndicator size="large" color={colors.accentBlue} />
            <Text style={styles.loadingText}>Sıralama yükleniyor...</Text>
          </View>
        </AppScreen>
        <AppTutorialOverlay {...leaderboardTutorial.overlayProps} />
      </View>
    );
  }

  return (
    <View style={styles.screenRoot}>
      <AppScreen reserveTabBarSpace={false}>
        {onBack ? (
          <ScreenHeader
            title="Liderlik Tablosu"
            subtitle={seasonLabel}
            compact
            onBack={onBack}
            rightAction={headerRightAction}
          />
        ) : (
          <AppTutorialTarget tutorialId="leaderboard" targetId="leaderboard-header" layoutMode="stretch">
            <ScreenHeader
              title="Liderlik Tablosu"
              subtitle={seasonLabel}
              compact
              rightAction={headerRightAction}
            />
          </AppTutorialTarget>
        )}

        <FlatList
          ref={listRef}
          data={entries}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          style={styles.list}
          onLayout={markLayoutReady}
          onScroll={leaderboardTutorial.handleScroll}
          onScrollEndDrag={leaderboardTutorial.handleScrollEnd}
          onMomentumScrollEnd={leaderboardTutorial.handleScrollEnd}
          scrollEventThrottle={16}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        ListEmptyComponent={
          errorKind ? (
            <EmptyState
              title={getLeaderboardKindTitle(errorKind)}
              message={getLeaderboardKindMessage(errorKind)}
              icon="warning"
              actionLabel="Tekrar dene"
              onAction={() => void loadLeaderboard({ forceSubmit: true })}
            />
          ) : screenState.status === 'empty' ? (
            <EmptyState
              title="Henüz sıralama yok"
              message={LEADERBOARD_EMPTY_SEASON_MESSAGE}
              icon="company"
            />
          ) : screenState.status === 'username-required' ? null : screenState.status === 'unauthenticated' ? (
            <EmptyState
              title="Sıralamaya katılmak için hesabını bağla"
              message="Haftalık liderlik tablosu yalnızca Google veya Apple ile bağlı hesaplar için geçerlidir."
              icon="account"
            />
          ) : null
        }
        contentContainerStyle={[styles.listContent, { paddingBottom: contentBottomPadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadLeaderboard({ forceSubmit: true })}
            tintColor={colors.accentBlue}
          />
        }
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        windowSize={8}
      />
      </AppScreen>
      <AppTutorialOverlay {...leaderboardTutorial.overlayProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: spacing.sm,
  },
  headerBlock: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  seasonCard: {
    gap: spacing.sm,
  },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  seasonText: {
    flex: 1,
    minWidth: 0,
  },
  seasonTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  seasonDates: {
    ...typography.bodySmall,
    fontWeight: '700',
    marginTop: 2,
  },
  seasonHint: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  guestCard: {
    gap: spacing.sm,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  guestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  guestTitle: {
    ...typography.bodySmall,
    fontWeight: '700',
    flex: 1,
  },
  guestText: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  usernameCta: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    color: colors.accentBlue,
    fontSize: 13,
    fontWeight: '800',
  },
  unrankedCard: {
    gap: spacing.sm,
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  unrankedProgress: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accentAmber,
  },
  explainerCard: {
    gap: spacing.sm,
  },
  explainerTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  explainerBreakdown: {
    gap: 4,
  },
  explainerLine: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  explainerTotal: {
    ...typography.bodySmall,
    fontWeight: '800',
    marginTop: 4,
  },
  playerCard: {
    gap: spacing.sm,
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  playerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  playerTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accentAmber,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  playerCompany: {
    ...typography.cardTitle,
    fontSize: 15,
  },
  playerStats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  playerStat: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.cardSoft,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  playerStatLabel: {
    ...typography.caption,
    fontSize: 10,
  },
  playerStatValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    marginTop: 2,
  },
  playerStatValueAccent: {
    color: colors.accentAmber,
  },
  playerScoreValue: {
    color: colors.accentAmber,
    fontSize: 15,
  },
  growHintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  growHintText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 15,
  },
  rowCard: {
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  rowCardHighlight: {
    borderColor: 'rgba(245, 158, 11, 0.45)',
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rankCol: {
    width: 44,
    alignItems: 'center',
  },
  rankText: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.textMuted,
  },
  topRankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.accentAmberSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
  },
  topRankText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    color: colors.accentAmber,
  },
  mainCol: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  companyName: {
    ...typography.bodySmall,
    fontWeight: '700',
    flexShrink: 1,
    minWidth: 0,
  },
  rowMeta: {
    ...typography.caption,
    marginTop: 2,
  },
  scoreCol: {
    alignItems: 'flex-end',
    minWidth: 64,
    maxWidth: 96,
    flexShrink: 0,
  },
  scoreValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.accentAmber,
  },
  scoreLabel: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxxl,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
});
