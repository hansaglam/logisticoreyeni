import React from 'react';
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import { ActionButton, GameIcon, IconButton, ProgressBar } from '../ui';

const MISSION_HERO_IMAGE = require('../../../assets/ui/neon_freight_in_the_future_city.png');

export type MissionsTabKey = 'missions' | 'weekly' | 'achievements';
export type PremiumMissionStatus = 'ready' | 'in_progress' | 'completed';

const STATUS_THEME: Record<
  PremiumMissionStatus,
  { label: string; color: string; background: string; border: string }
> = {
  ready: {
    label: 'HAZIR',
    color: colors.amber,
    background: colors.amberSoft,
    border: 'rgba(255,170,0,0.55)',
  },
  in_progress: {
    label: 'DEVAM EDİYOR',
    color: colors.primaryLight,
    background: colors.accentBlueSoft,
    border: 'rgba(57,160,255,0.48)',
  },
  completed: {
    label: 'TAMAMLANDI',
    color: colors.success,
    background: colors.successSoft,
    border: 'rgba(18,214,107,0.48)',
  },
};

const TAB_DEFINITIONS: Array<{
  key: MissionsTabKey;
  label: string;
  icon: GameIconName;
}> = [
  { key: 'missions', label: 'Görevler', icon: 'contract' },
  { key: 'weekly', label: 'Haftalık', icon: 'time' },
  { key: 'achievements', label: 'Başarılar', icon: 'trophy' },
];

const MISSION_ICON_BY_ID: Record<string, GameIconName> = {
  open_market: 'market',
  first_contract_start: 'contract',
  first_delivery: 'truck',
  first_profit: 'cash',
  first_trade: 'profit',
  own_2_trucks: 'truck',
  operate_in_3_cities: 'map',
  complete_5_deliveries: 'route',
  complete_10_deliveries: 'trophy',
  earn_10000_trade_profit: 'profit',
  reach_warehouse_value_25000: 'warehouse',
  reach_company_score_150k: 'trophy',
};

const CATEGORY_ICON: Record<string, GameIconName> = {
  starter: 'contract',
  career: 'trophy',
  delivery: 'truck',
  contracts: 'route',
  market: 'market',
  trading: 'profit',
  trade: 'profit',
  warehouse: 'warehouse',
  fleet: 'truck',
  reputation: 'reputation',
  city: 'map',
  economy: 'cash',
  season: 'time',
};

export function resolveMissionPresentationIcon(
  id: string,
  category?: string,
): GameIconName {
  return MISSION_ICON_BY_ID[id] ?? CATEGORY_ICON[category ?? ''] ?? 'contract';
}

export function formatMissionCompletionTime(
  completedAt: number | undefined,
  currentTime: number,
): string {
  if (completedAt == null || !Number.isFinite(completedAt) || completedAt < 0) {
    return 'Daha önce tamamlandı';
  }

  const safeCurrentTime = Number.isFinite(currentTime) ? Math.max(currentTime, completedAt) : completedAt;
  const completedDay = Math.floor(completedAt / 24);
  const currentDay = Math.floor(safeCurrentTime / 24);
  const dayDifference = Math.max(0, currentDay - completedDay);
  const hourOfDay = ((completedAt % 24) + 24) % 24;
  const hours = Math.floor(hourOfDay);
  const minutes = Math.floor((hourOfDay - hours) * 60);
  const timeLabel = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  if (dayDifference === 0) return `Bugün ${timeLabel}`;
  if (dayDifference === 1) return `Dün ${timeLabel}`;
  return `${dayDifference} gün önce · ${timeLabel}`;
}

export function MissionHeroHeader({
  onBack,
}: {
  onBack: () => void;
}) {
  return (
    <ImageBackground
      source={MISSION_HERO_IMAGE}
      style={styles.hero}
      imageStyle={styles.heroBackgroundImage}
      resizeMode="cover"
    >
      <View style={styles.heroImageWash} pointerEvents="none" />
      <View style={styles.heroCopyFade} pointerEvents="none" />
      <View style={styles.heroTopAccent} pointerEvents="none" />
      <IconButton
        icon="back"
        onPress={onBack}
        size={21}
        color={colors.textPrimary}
        backgroundColor="rgba(8,26,52,0.92)"
        style={styles.backButton}
        accessibilityLabel="Geri"
      />
      <View style={styles.heroCopy}>
        <Text style={styles.heroTitle}>Görevler</Text>
        <Text style={styles.heroSubtitle} numberOfLines={2}>
          Başlangıç, haftalık ve kariyer başarıları
        </Text>
      </View>
      <View style={styles.heroRightBreathingRoom} pointerEvents="none" />
    </ImageBackground>
  );
}

export function MissionTabs({
  activeTab,
  onChange,
}: {
  activeTab: MissionsTabKey;
  onChange: (tab: MissionsTabKey) => void;
}) {
  return (
    <View style={styles.tabRow}>
      {TAB_DEFINITIONS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.tabButton,
              active && styles.tabButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <GameIcon
              name={tab.icon}
              size={15}
              color={active ? colors.textPrimary : colors.textSecondary}
            />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MissionSummaryBar({
  total,
  completed,
  ready,
}: {
  total: number;
  completed: number;
  ready: number;
}) {
  const items = [
    { label: 'Toplam', value: total, icon: 'contract' as const, color: colors.primaryLight },
    { label: 'Tamamlanan', value: completed, icon: 'success' as const, color: colors.success },
    { label: 'Ödül Hazır', value: ready, icon: 'xp' as const, color: colors.amber },
  ];

  return (
    <View style={styles.summary}>
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 ? <View style={styles.summaryDivider} /> : null}
          <View style={styles.summaryItem}>
            <View style={[styles.summaryIcon, { backgroundColor: `${item.color}18` }]}>
              <GameIcon name={item.icon} size={15} color={item.color} />
            </View>
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryValue}>{item.value}</Text>
              <Text style={styles.summaryLabel} numberOfLines={1}>
                {item.label}
              </Text>
            </View>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

export function MissionSectionHeader({
  title,
  icon = 'route',
  style,
}: {
  title: string;
  icon?: GameIconName;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionTitleRow}>
        <GameIcon name={icon} size={15} color={colors.primaryLight} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionLine} />
    </View>
  );
}

export interface PremiumMissionCardProps {
  id: string;
  category?: string;
  title: string;
  description: string;
  progress: number;
  progressLabel: string;
  rewardLabel: string;
  status: PremiumMissionStatus;
  completedAt?: number;
  currentTime: number;
  onClaim?: () => void;
}

export const PremiumMissionCard = React.memo(function PremiumMissionCard({
  id,
  category,
  title,
  description,
  progress,
  progressLabel,
  rewardLabel,
  status,
  completedAt,
  currentTime,
  onClaim,
}: PremiumMissionCardProps) {
  const theme = STATUS_THEME[status];
  const icon = resolveMissionPresentationIcon(id, category);
  const completed = status === 'completed';

  return (
    <View
      style={[
        styles.card,
        completed && styles.cardCompleted,
        status === 'ready' && styles.cardReady,
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.iconFrame, completed && styles.iconFrameCompleted]}>
          <View style={styles.iconGlow} pointerEvents="none" />
          <GameIcon name={icon} size={25} color={completed ? colors.success : colors.primaryLight} />
        </View>

        <View style={styles.cardHeading}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.cardDescription} numberOfLines={2}>
            {description}
          </Text>
        </View>

        <View
          style={[
            styles.statusPill,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.statusText, { color: theme.color }]} numberOfLines={1}>
            {theme.label}
          </Text>
        </View>
      </View>

      {!completed ? (
        <View style={styles.progressBlock}>
          <ProgressBar
            progress={progress}
            color={status === 'ready' ? colors.amber : colors.primary}
            trackColor="#13243B"
            height={5}
          />
          <Text style={styles.progressLabel} numberOfLines={1}>
            {progressLabel}
          </Text>
        </View>
      ) : null}

      <View style={styles.cardFooter}>
        <View style={styles.rewardRow}>
          <GameIcon name="xp" size={15} color={colors.amber} />
          <Text style={styles.rewardText} numberOfLines={2}>
            Ödül: {rewardLabel}
          </Text>
        </View>
        {status === 'ready' && onClaim ? (
          <ActionButton
            label="Ödülü Al"
            onPress={onClaim}
            icon="success"
            iconSize={15}
            compact
            style={styles.claimButton}
          />
        ) : completed ? (
          <View style={styles.completedCheck}>
            <GameIcon name="success" size={19} color={colors.success} />
          </View>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  hero: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: -spacing.md,
    marginTop: -spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomRightRadius: radius.xl,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  heroBackgroundImage: {
    borderBottomRightRadius: radius.xl,
  },
  heroImageWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2,8,19,0.18)',
  },
  heroCopyFade: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '70%',
    backgroundColor: 'rgba(2,8,19,0.68)',
  },
  heroTopAccent: {
    position: 'absolute',
    left: spacing.md,
    top: 0,
    width: 74,
    height: 1,
    backgroundColor: 'rgba(57,160,255,0.72)',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderColor: 'rgba(57,160,255,0.62)',
    backgroundColor: 'rgba(4,16,35,0.9)',
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingLeft: spacing.sm,
  },
  heroTitle: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
  },
  heroSubtitle: {
    ...typography.caption,
    color: '#9CB2CF',
    marginTop: 3,
    lineHeight: 14,
    textAlign: 'center',
  },
  heroRightBreathingRoom: {
    width: 76,
  },
  tabRow: {
    minHeight: 48,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#061120',
  },
  tabButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.surface2,
  },
  tabButtonActive: {
    backgroundColor: colors.primaryDeep,
    borderColor: colors.primaryLight,
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 7,
    elevation: 3,
  },
  tabLabel: {
    ...typography.tabLabel,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  tabLabelActive: {
    color: colors.textPrimary,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.86,
  },
  summary: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(35,136,255,0.26)',
    backgroundColor: '#081628',
  },
  summaryItem: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  summaryIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCopy: {
    minWidth: 0,
  },
  summaryValue: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  summaryLabel: {
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.divider,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 31,
    marginBottom: spacing.sm,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    fontSize: 14,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(35,136,255,0.3)',
  },
  card: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(35,136,255,0.28)',
    backgroundColor: '#081526',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardReady: {
    borderColor: 'rgba(255,170,0,0.34)',
  },
  cardCompleted: {
    borderColor: 'rgba(18,214,107,0.52)',
    backgroundColor: '#081526',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  iconFrame: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(57,160,255,0.5)',
    backgroundColor: '#0A2340',
    overflow: 'hidden',
  },
  iconFrameCompleted: {
    borderColor: 'rgba(18,214,107,0.46)',
    backgroundColor: 'rgba(18,214,107,0.1)',
  },
  iconGlow: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 18,
    backgroundColor: 'rgba(57,160,255,0.14)',
  },
  cardHeading: {
    flex: 1,
    minWidth: 0,
    paddingTop: 1,
  },
  cardTitle: {
    ...typography.cardTitle,
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  cardDescription: {
    ...typography.caption,
    marginTop: 3,
    color: colors.textSecondary,
    lineHeight: 15,
  },
  statusPill: {
    maxWidth: 96,
    minHeight: 23,
    flexShrink: 0,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '900',
    letterSpacing: 0.35,
    textAlign: 'center',
  },
  progressBlock: {
    gap: spacing.xs,
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    fontWeight: '700',
  },
  cardFooter: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rewardRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  rewardText: {
    ...typography.caption,
    flex: 1,
    color: colors.amber,
    fontWeight: '700',
    lineHeight: 15,
  },
  claimButton: {
    flexShrink: 0,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderColor: colors.primaryLight,
  },
  completedCheck: {
    width: 40,
    height: 32,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: 'rgba(18,214,107,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(18,214,107,0.3)',
  },
});
