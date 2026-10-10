import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IconButton } from '../../components/ui';
import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { colors, spacing, typography } from '../../theme';
import { mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';

type Props = {
  title: string;
  identityLine: string;
  onBack: () => void;
};

export default function MapV2CountryHeader({ title, identityLine, onBack }: Props) {
  return (
    <View style={styles.row}>
      <IconButton icon="back" onPress={onBack} size={20} color={colors.textPrimary} />
      <View style={styles.flag} accessibilityLabel={mapV2ExperienceCopy.countryFlagCue}>
        <Text style={styles.flagEmoji}>🇹🇷</Text>
      </View>
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.kicker} numberOfLines={1}>
          {identityLine}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  flag: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagEmoji: { fontSize: 12 },
  titles: { flex: 1, minWidth: 0, gap: 1 },
  title: { ...typography.dashboardTitle, color: colors.textPrimary, lineHeight: 24 },
  kicker: { ...typography.caption, color: colors.textMuted },
});
