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
  tone?: 'default' | 'danger';
}

export default function AccountActionRow({
  title,
  subtitle,
  icon,
  onPress,
  disabled = false,
  showChevron = true,
  tone = 'default',
}: AccountActionRowProps) {
  const iconColor = tone === 'danger' ? colors.danger : colors.accentBlue;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
    >
      <View style={[styles.iconWrap, tone === 'danger' && styles.iconWrapDanger]}>
        <GameIcon name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, tone === 'danger' && styles.titleDanger]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showChevron ? (
        <GameIcon name="chevronRight" size={16} color={colors.textMuted} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingVertical: 8,
  },
  rowPressed: {
    opacity: 0.9,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
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
    color: colors.textPrimary,
  },
  titleDanger: {
    color: colors.danger,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
