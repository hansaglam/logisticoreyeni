import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import GameIcon from '../ui/GameIcon';

export interface AccountSettingRowProps {
  title: string;
  subtitle: string;
  icon: GameIconName;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export default function AccountSettingRow({
  title,
  subtitle,
  icon,
  value,
  onValueChange,
  disabled = false,
}: AccountSettingRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <GameIcon name={icon} size={16} color={colors.accentBlue} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.surface3, true: colors.primarySoft }}
        thumbColor={value ? colors.accentBlue : colors.textMuted}
        accessibilityLabel={title}
        accessibilityRole="switch"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 64,
    paddingVertical: 4,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(35, 136, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
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
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
});
