import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from './GameIcon';

interface SmallStatPillProps {
  label: string;
  value: string;
  accentColor?: string;
  icon?: GameIconName;
  /** Daha küçük dairesel stat kartı — filo üst özeti vb. */
  compact?: boolean;
  /** Market üst metrikleri için ekstra kompakt boyut */
  dense?: boolean;
  /** Yatay chip düzeni — uzun metinler için daha geniş */
  layout?: 'stacked' | 'chip';
}

export default function SmallStatPill({
  label,
  value,
  accentColor = colors.textPrimary,
  icon,
  compact = false,
  dense = false,
  layout = 'stacked',
}: SmallStatPillProps) {
  const isDense = compact && dense;
  const isChip = layout === 'chip';

  if (isChip) {
    return (
      <View style={[styles.pillChip, isDense && styles.pillChipDense]}>
        {icon ? (
          <View style={[styles.iconWrapChip, { backgroundColor: `${accentColor}18` }]}>
            <GameIcon name={icon} size={16} color={accentColor} />
          </View>
        ) : null}
        <View style={styles.chipTextBlock}>
          <Text style={styles.labelChip} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
          <Text
            style={[styles.valueChip, { color: accentColor }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {value}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.pill, compact && styles.pillCompact, isDense && styles.pillDense]}>
      {icon ? (
        <View
          style={[
            styles.iconWrap,
            compact && styles.iconWrapCompact,
            isDense && styles.iconWrapDense,
            { backgroundColor: `${accentColor}18` },
          ]}
        >
          <GameIcon name={icon} size={isDense ? 16 : 18} color={accentColor} />
        </View>
      ) : null}
      <Text style={[styles.label, compact && styles.labelCompact, isDense && styles.labelDense]}>
        {label}
      </Text>
      <Text
        style={[
          styles.value,
          compact && styles.valueCompact,
          isDense && styles.valueDense,
          { color: accentColor },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.cardSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 88,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.caption,
    marginBottom: 2,
  },
  value: {
    ...typography.bodySmall,
    fontWeight: '800',
  },
  pillCompact: {
    width: 66,
    minWidth: 66,
    height: 64,
    paddingHorizontal: spacing.xs,
    paddingVertical: 5,
  },
  iconWrapCompact: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginBottom: 3,
  },
  labelCompact: {
    fontSize: 11,
    lineHeight: 13,
    marginBottom: 1,
  },
  valueCompact: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '800',
  },
  pillDense: {
    width: 64,
    minWidth: 64,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  iconWrapDense: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginBottom: 2,
  },
  labelDense: {
    fontSize: 10,
    lineHeight: 12,
  },
  valueDense: {
    fontSize: 13,
    lineHeight: 15,
    fontWeight: '800',
  },
  pillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 0,
    minHeight: 54,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 8,
  },
  pillChipDense: {
    minWidth: 82,
    height: 52,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconWrapChip: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  labelChip: {
    fontSize: 10,
    lineHeight: 13,
    color: colors.textMuted,
    marginBottom: 2,
  },
  valueChip: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    flexShrink: 1,
  },
});
