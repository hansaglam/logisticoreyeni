import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { GameIcon } from '../ui';
import { colors, formatMoney, radius } from '../../theme';
import {
  DASHBOARD_RESOURCE_BAR_HEIGHT,
  DASHBOARD_RESOURCE_BAR_RADIUS,
  DASHBOARD_TOP_BAR_BG,
  DASHBOARD_TOP_BAR_BORDER,
  getDashboardMoneyColor,
} from './dashboardTheme';

interface DashboardResourceBarProps {
  money: number;
  level: number;
  xpProgress: number;
  isPaused: boolean;
  onTogglePause: () => void;
}

export default function DashboardResourceBar({
  money,
  level,
  xpProgress,
  isPaused,
  onTogglePause,
}: DashboardResourceBarProps) {
  const xpPercent = Math.round(Math.min(1, Math.max(0, xpProgress)) * 100);
  const moneyColor = getDashboardMoneyColor(money);

  return (
    <View style={styles.bar}>
      <View style={styles.resourceItem}>
        <GameIcon name="cash" size={14} color={moneyColor} />
        <Text
          style={[styles.cashText, { color: moneyColor }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {formatMoney(money)}
        </Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.levelPill}>
        <Text style={styles.levelText}>Lv.{level}</Text>
      </View>

      <View style={styles.xpTrack}>
        <View style={[styles.xpFill, { width: `${xpPercent}%` }]} />
      </View>

      <TouchableOpacity
        style={[styles.pauseBtn, isPaused ? styles.pauseBtnActive : null]}
        onPress={onTogglePause}
        accessibilityRole="button"
        accessibilityLabel={isPaused ? 'Devam et' : 'Duraklat'}
        activeOpacity={0.8}
      >
        <GameIcon
          name={isPaused ? 'play' : 'pause'}
          size={14}
          color={isPaused ? colors.success : colors.textPrimary}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: DASHBOARD_RESOURCE_BAR_HEIGHT,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: DASHBOARD_RESOURCE_BAR_RADIUS,
    borderWidth: 1,
    borderColor: DASHBOARD_TOP_BAR_BORDER,
    backgroundColor: DASHBOARD_TOP_BAR_BG,
    ...Platform.select({
      android: { elevation: 1 },
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
    }),
  },
  resourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '42%',
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: colors.divider,
    flexShrink: 0,
  },
  cashText: {
    fontWeight: '700',
    fontSize: 14,
    flexShrink: 1,
  },
  levelPill: {
    height: 29,
    paddingHorizontal: 11,
    borderRadius: 11,
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  levelText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.amber,
  },
  xpTrack: {
    flex: 1,
    minWidth: 48,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 1,
  },
  xpFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.amber,
  },
  pauseBtn: {
    width: 44,
    height: 44,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 0,
  },
  pauseBtnActive: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
});
