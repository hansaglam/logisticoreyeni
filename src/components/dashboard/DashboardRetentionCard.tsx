import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../ui';
import { colors } from '../../theme';
import { DASHBOARD_SPLIT_CARD_HEIGHT } from './dashboardTheme';

interface DashboardRetentionCardProps {
  readyRewards: number;
  readyMilestones: number;
  readyWeekly: number;
  weeklyInProgress: number;
  weeklyTotal: number;
  onPress: () => void;
}

const AMBER = '#FFAA00';
const CARD_BG = '#10150E';
const INNER_SURFACE = '#141C12';
const SUBTITLE_COLOR = '#8494AB';

function RewardRow({
  icon,
  title,
  subtitle,
  iconColor,
  iconBg,
}: {
  icon: React.ComponentProps<typeof GameIcon>['name'];
  title: string;
  subtitle: string;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <View style={styles.rewardRow}>
      <View style={[styles.rewardIconWrap, { backgroundColor: iconBg }]}>
        <GameIcon name={icon} size={16} color={iconColor} />
      </View>
      <View style={styles.rewardText}>
        <Text style={styles.rewardTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rewardSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.rewardChevron}>
        <GameIcon name="chevronRight" size={14} color={colors.textSecondary} />
      </View>
    </View>
  );
}

export default function DashboardRetentionCard({
  readyRewards,
  readyMilestones,
  readyWeekly,
  weeklyInProgress,
  weeklyTotal,
  onPress,
}: DashboardRetentionCardProps) {
  const weeklyProgressCount = Math.min(weeklyTotal, weeklyInProgress + (readyWeekly > 0 ? readyWeekly : 0));
  const weeklyLine =
    weeklyTotal > 0
      ? readyWeekly > 0
        ? `${readyWeekly} haftalık ödül hazır`
        : `${weeklyProgressCount}/${weeklyTotal} görev ilerliyor`
      : 'Haftalık sezon yakında';

  const milestoneLine =
    readyMilestones > 0
      ? `${readyMilestones} kilometre taşı ödülü hazır`
      : readyRewards > 0
        ? 'Görev ödüllerini al'
        : 'Görevler devam ediyor';

  return (
    <Pressable onPress={onPress} style={styles.pressable}>
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <GameIcon name="package" size={15} color={AMBER} />
            <Text
              style={styles.headerTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.84}
            >
              Alınacak Ödüller
            </Text>
          </View>
          {readyRewards > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{readyRewards}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          <RewardRow
            icon="level"
            title="Haftalık Sezon Ödülü"
            subtitle={weeklyLine}
            iconColor={AMBER}
            iconBg="rgba(255, 170, 0, 0.15)"
          />
          <RewardRow
            icon="xp"
            title="Görev Ödülleri"
            subtitle={milestoneLine}
            iconColor={colors.primaryLight}
            iconBg="rgba(35, 136, 255, 0.13)"
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Tüm Ödüller</Text>
          <GameIcon name="chevronRight" size={12} color={AMBER} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    height: DASHBOARD_SPLIT_CARD_HEIGHT,
    paddingHorizontal: 11,
    paddingTop: 11,
    paddingBottom: 8,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.55)',
    backgroundColor: CARD_BG,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 1 },
      ios: {
        shadowColor: AMBER,
        shadowOpacity: 0.07,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: AMBER,
    flexShrink: 1,
  },
  countBadge: {
    minWidth: 23,
    height: 23,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 170, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  countBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: AMBER,
  },
  body: {
    flex: 1,
    marginTop: 5,
    marginBottom: 4,
    gap: 4,
    justifyContent: 'center',
  },
  rewardRow: {
    height: 41,
    borderRadius: 10,
    backgroundColor: INNER_SURFACE,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.12)',
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rewardIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rewardText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 7,
    justifyContent: 'center',
  },
  rewardTitle: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    color: '#F3F7FF',
  },
  rewardSub: {
    fontSize: 9.5,
    fontWeight: '500',
    lineHeight: 12,
    color: SUBTITLE_COLOR,
    marginTop: 1,
  },
  rewardChevron: {
    marginLeft: 4,
    flexShrink: 0,
    opacity: 0.9,
  },
  footer: {
    height: 26,
    paddingTop: 5,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 170, 0, 0.12)',
  },
  footerText: {
    fontSize: 10,
    fontWeight: '700',
    color: AMBER,
  },
});
