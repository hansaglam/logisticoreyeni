/**
 * LogistiCore - Haftalık Liderlik Tablosu (V1)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  AppCard,
  AppScreen,
  EmptyState,
  GameIcon,
  ScreenHeader,
  SectionTitle,
  StatusBadge,
} from '../components/ui';
import {
  DEFAULT_ACCOUNT_STATUS,
  getAccountStatus,
  subscribeAuthState,
  type AccountStatus,
} from '../services/authService';
import {
  fetchWeeklyLeaderboard,
  isLeaderboardEligible,
  type LeaderboardRankedEntry,
} from '../services/leaderboardService';
import { leaderboardConfig } from '../config/leaderboard';
import { getWeeklySeasonLabel } from '../utils/leaderboardSeason';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { colors, spacing, typography } from '../theme';

interface LeaderboardScreenProps {
  onBack?: () => void;
}

const LEADERBOARD_LOAD_ERROR_MESSAGE =
  'Liderlik tablosu şu anda yüklenemedi. Lütfen tekrar dene.';

function resolveLeaderboardErrorMessage(
  errorCode?: string,
  error?: string,
): string {
  if (errorCode === 'firebase-disabled') {
    return 'Liderlik tablosu şu anda kullanılamıyor.';
  }
  return LEADERBOARD_LOAD_ERROR_MESSAGE;
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
              {entry.companyName}
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
  entry: { companyName: string; companyScore: number; level: number; reputation: number };
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
        {entry.companyName}
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

export default function LeaderboardScreen({ onBack }: LeaderboardScreenProps) {
  const { contentBottomPadding } = useTabBarLayout();
  const [account, setAccount] = useState<AccountStatus>(DEFAULT_ACCOUNT_STATUS);
  const [fetchResult, setFetchResult] = useState<Awaited<
    ReturnType<typeof fetchWeeklyLeaderboard>
  > | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seasonLabel = useMemo(() => getWeeklySeasonLabel(), []);
  const eligible = isLeaderboardEligible();
  const uid = account.uid;

  const refreshAccount = useCallback(() => {
    setAccount(getAccountStatus() ?? DEFAULT_ACCOUNT_STATUS);
  }, []);

  const loadLeaderboard = useCallback(async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    const result = await fetchWeeklyLeaderboard(uid);
    setFetchResult(result);
    if (!result.ok) {
      logLeaderboardError(result.errorCode, result.error);
      setError(resolveLeaderboardErrorMessage(result.errorCode, result.error));
    } else {
      setError(null);
    }

    setIsLoading(false);
    setIsRefreshing(false);
  }, [uid]);

  useEffect(() => {
    refreshAccount();
    const unsub = subscribeAuthState(refreshAccount);
    return unsub;
  }, [refreshAccount]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  const renderItem = useCallback(
    ({ item }: { item: LeaderboardRankedEntry }) => (
      <LeaderboardRow entry={item} isPlayer={Boolean(uid && item.uid === uid)} />
    ),
    [uid],
  );

  const keyExtractor = useCallback((item: LeaderboardRankedEntry) => item.uid, []);

  const entries = fetchResult?.entries ?? [];
  const playerEntry = fetchResult?.playerEntry ?? null;
  const playerRank = fetchResult?.playerRank ?? null;

  const listFooter = useMemo(() => {
    if (error || entries.length === 0 || entries.length > 2) {
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
  }, [error, entries.length]);

  const listHeader = useMemo(
    () => (
      <View style={styles.headerBlock}>
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
            Sıralama şirket puanına göre yapılır. Nakit, filo ve operasyon gücün bir arada
            değerlendirilir.
          </Text>
        </AppCard>

        {!eligible ? <GuestPromptCard /> : null}

        {eligible && playerEntry ? (
          <PlayerSummaryCard
            entry={playerEntry}
            rank={playerRank}
            outsideTop={playerRank === null && entries.length > 0}
          />
        ) : null}

        <SectionTitle title={`En iyi ${leaderboardConfig.leaderboardSize}`} compact />
      </View>
    ),
    [seasonLabel, eligible, playerEntry, playerRank, entries.length],
  );

  if (isLoading && entries.length === 0) {
    return (
      <AppScreen scrollBottomPadding={0}>
        {onBack ? (
          <ScreenHeader title="Liderlik Tablosu" compact onBack={onBack} />
        ) : (
          <ScreenHeader title="Liderlik Tablosu" compact />
        )}
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.accentBlue} />
          <Text style={styles.loadingText}>Sıralama yükleniyor...</Text>
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen scrollBottomPadding={0}>
      {onBack ? (
        <ScreenHeader title="Liderlik Tablosu" subtitle={seasonLabel} compact onBack={onBack} />
      ) : (
        <ScreenHeader title="Liderlik Tablosu" subtitle={seasonLabel} compact />
      )}

      <FlatList
        data={entries}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={styles.list}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        ListEmptyComponent={
          error ? (
            <EmptyState
              title="Sıralama yüklenemedi"
              message={error}
              icon="warning"
              actionLabel="Tekrar dene"
              onAction={() => void loadLeaderboard(true)}
            />
          ) : (
            <EmptyState
              title="Henüz sıralama yok"
              message={
                eligible
                  ? 'Bu hafta ilk katılan sen ol. Oyun ilerledikçe puanın otomatik güncellenir.'
                  : 'Bağlı hesaplar katıldıkça haftalık sıralama burada görünecek.'
              }
              icon="company"
            />
          )
        }
        contentContainerStyle={[styles.listContent, { paddingBottom: contentBottomPadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void loadLeaderboard(true)}
            tintColor={colors.accentBlue}
          />
        }
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        windowSize={8}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
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
