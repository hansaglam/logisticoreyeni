import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { GameIcon, StatusBadge } from '../ui';
import { colors, formatMoney, spacing, typography } from '../../theme';

interface DashboardResourceBarProps {
  money: number;
  diamonds: number;
  level: number;
  xpProgress: number;
  activeDeliveries: number;
  isPaused: boolean;
  onTogglePause: () => void;
}

export default function DashboardResourceBar({
  money,
  diamonds,
  level,
  xpProgress,
  activeDeliveries,
  isPaused,
  onTogglePause,
}: DashboardResourceBarProps) {
  const xpPercent = Math.round(Math.min(1, Math.max(0, xpProgress)) * 100);

  return (
    <View style={styles.bar}>
      <View style={styles.resourceGroup}>
        <View style={styles.resourceItem}>
          <GameIcon name="cash" size={13} color={colors.success} />
          <Text style={styles.cashText} numberOfLines={1}>
            {formatMoney(money)}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.resourceItem}>
          <Text style={styles.diamondIcon}>💎</Text>
          <Text style={styles.diamondText}>{diamonds.toLocaleString('en-US')}</Text>
        </View>
      </View>

      <View style={styles.centerGroup}>
        <View style={styles.levelPill}>
          <Text style={styles.levelText}>Lv.{level}</Text>
        </View>
        <View style={styles.xpTrack}>
          <View style={[styles.xpFill, { width: `${xpPercent}%` }]} />
        </View>
      </View>

      <View style={styles.rightGroup}>
        {activeDeliveries > 0 ? (
          <StatusBadge
            label={`${activeDeliveries} teslimat`}
            variant="blue"
            size="sm"
          />
        ) : null}
        <TouchableOpacity
          style={[styles.pauseBtn, isPaused ? styles.pauseBtnActive : null]}
          onPress={onTogglePause}
          accessibilityRole="button"
          accessibilityLabel={isPaused ? 'Devam et' : 'Duraklat'}
          activeOpacity={0.8}
        >
          <GameIcon
            name={isPaused ? 'play' : 'pause'}
            size={13}
            color={isPaused ? colors.success : colors.textPrimary}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  resourceGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  resourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: colors.border,
  },
  cashText: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.success,
    fontSize: 11,
  },
  diamondIcon: {
    fontSize: 10,
  },
  diamondText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.accentBlue,
    fontSize: 11,
  },
  centerGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    maxWidth: 130,
  },
  levelPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.accentAmberSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  levelText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '800',
    color: colors.accentAmber,
  },
  xpTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.cardSoft,
    overflow: 'hidden',
  },
  xpFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.accentAmber,
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  pauseBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.24)',
  },
  pauseBtnActive: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(74, 222, 128, 0.4)',
  },
});
