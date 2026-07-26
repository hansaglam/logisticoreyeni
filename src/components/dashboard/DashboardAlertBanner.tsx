import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../ui';
import { colors } from '../../theme';
import { DASHBOARD_ALERT_HEIGHT, DASHBOARD_ALERT_RADIUS } from './dashboardTheme';

interface DashboardAlertBannerProps {
  message: string;
  onPress?: () => void;
  variant?: 'warning' | 'danger';
}

export default function DashboardAlertBanner({
  message,
  onPress,
  variant = 'warning',
}: DashboardAlertBannerProps) {
  const isDanger = variant === 'danger';
  const accent = isDanger ? colors.danger : colors.amber;
  const bg = isDanger ? 'rgba(255, 90, 89, 0.08)' : 'rgba(255, 170, 0, 0.08)';
  const border = isDanger ? 'rgba(255, 90, 89, 0.48)' : 'rgba(255, 170, 0, 0.48)';

  const content = (
    <View style={[styles.banner, { backgroundColor: bg, borderColor: border }]}>
      <GameIcon name="warning" size={19} color={accent} />
      <Text style={styles.message} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
        {message}
      </Text>
      {onPress ? <GameIcon name="chevronRight" size={17} color={accent} /> : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: DASHBOARD_ALERT_HEIGHT,
    paddingHorizontal: 12,
    borderRadius: DASHBOARD_ALERT_RADIUS,
    borderWidth: 1,
  },
  message: {
    flex: 1,
    fontWeight: '700',
    fontSize: 12.5,
    lineHeight: 16,
    color: colors.textPrimary,
  },
});
