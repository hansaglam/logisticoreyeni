import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getDashboardMoneyColor } from '../dashboard/dashboardTheme';
import { GameIcon } from '../ui';
import { colors, formatMoney, radius } from '../../theme';
import {
  SHOP_RESOURCE_BAR_BG,
  SHOP_RESOURCE_BAR_BORDER,
  SHOP_RESOURCE_BAR_HEIGHT,
  SHOP_RESOURCE_BAR_PADDING_H,
  SHOP_RESOURCE_BAR_RADIUS,
} from './shopTheme';

export interface ShopResourceBarProps {
  money: number;
  diamonds: number;
  level: number;
  xpProgress: number;
  isPaused: boolean;
  onTogglePause: () => void;
}

export default function ShopResourceBar({
  money,
  diamonds,
  level,
  xpProgress,
  isPaused,
  onTogglePause,
}: ShopResourceBarProps) {
  const xpPercent = Math.round(Math.min(1, Math.max(0, xpProgress)) * 100);
  const moneyColor = getDashboardMoneyColor(money);

  return (
    <View style={styles.bar}>
      <View style={styles.resourceItem}>
        <GameIcon name="cash" size={15} color={moneyColor} />
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

      <View style={styles.resourceItem}>
        <GameIcon name="diamond" size={14} color={colors.primaryLight} />
        <Text style={styles.diamondText} numberOfLines={1}>
          {diamonds.toLocaleString('en-US')}
        </Text>
      </View>

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
          size={15}
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
    height: SHOP_RESOURCE_BAR_HEIGHT,
    paddingHorizontal: SHOP_RESOURCE_BAR_PADDING_H,
    borderRadius: SHOP_RESOURCE_BAR_RADIUS,
    borderWidth: 1.25,
    borderColor: SHOP_RESOURCE_BAR_BORDER,
    backgroundColor: SHOP_RESOURCE_BAR_BG,
    marginBottom: 0,
    ...Platform.select({
      android: { elevation: 2 },
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.14,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      },
    }),
  },
  resourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(50,95,150,0.45)',
    flexShrink: 0,
  },
  cashText: {
    fontWeight: '700',
    fontSize: 15,
    flexShrink: 1,
  },
  diamondText: {
    fontWeight: '700',
    color: colors.primaryLight,
    fontSize: 13,
    flexShrink: 0,
  },
  levelPill: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  levelText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.amber,
  },
  xpTrack: {
    flex: 1,
    minWidth: 48,
    maxWidth: 96,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: '#0D1A2D',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(50,95,150,0.35)',
    flexShrink: 1,
  },
  xpFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.amber,
  },
  pauseBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D1A2D',
    borderWidth: 1,
    borderColor: 'rgba(50,95,150,0.45)',
    flexShrink: 0,
  },
  pauseBtnActive: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
  },
});
