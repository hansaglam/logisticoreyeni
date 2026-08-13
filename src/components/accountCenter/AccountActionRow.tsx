import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from '../ui/GameIcon';

export interface AccountActionRowProps {
  title: string;
  subtitle?: string;
  icon: GameIconName;
  onPress: () => void;
  disabled?: boolean;
  showChevron?: boolean;
  tone?: 'default' | 'warning' | 'danger';
  compact?: boolean;
}

export default function AccountActionRow({
  title,
  subtitle,
  icon,
  onPress,
  disabled = false,
  showChevron = true,
  tone = 'default',
  compact = false,
}: AccountActionRowProps) {
  const iconColor =
    tone === 'danger' ? colors.danger : tone === 'warning' ? colors.accentAmber : colors.accentBlue;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => [
        styles.row,
        compact && styles.rowCompact,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
    >
      <View style={[styles.iconWrap, tone === 'danger' && styles.iconWrapDanger]}>
        <GameIcon name={icon} size={16} color={iconColor} />
      </View>
      <View style={styles.copy}>
        <Text
          style={[
            styles.title,
            tone === 'danger' && styles.titleDanger,
            tone === 'warning' && styles.titleWarning,
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={compact ? 1 : 2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showChevron ? (
        <GameIcon name="chevronRight" size={14} color={colors.textMuted} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 58,
    paddingVertical: 6,
  },
  rowCompact: {
    minHeight: 48,
    paddingVertical: 4,
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(35, 136, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapDanger: {
    backgroundColor: colors.dangerSoft,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.bodySmall,
    fontWeight: '700',
    fontSize: 14,
    color: colors.textPrimary,
  },
  titleDanger: {
    color: colors.danger,
  },
  titleWarning: {
    color: colors.accentAmber,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
});
