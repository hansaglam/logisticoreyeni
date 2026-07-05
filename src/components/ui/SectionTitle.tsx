import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing, typography } from '../../theme';

interface SectionTitleProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Daha küçük muted alt başlık — filo sekmeleri vb. */
  compact?: boolean;
}

export default function SectionTitle({
  title,
  subtitle,
  right,
  style,
  compact = false,
}: SectionTitleProps) {
  return (
    <View style={[styles.row, compact && styles.rowCompact, style]}>
      <View style={styles.main}>
        <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  main: {
    flex: 1,
    marginRight: spacing.sm,
  },
  right: {
    alignItems: 'flex-end',
  },
  title: {
    ...typography.sectionTitle,
  },
  subtitle: {
    ...typography.caption,
    marginTop: 2,
  },
  rowCompact: {
    marginBottom: spacing.xs,
  },
  titleCompact: {
    fontSize: 14,
  },
  subtitleCompact: {
    fontSize: 10,
    lineHeight: 13,
    color: colors.textMuted,
    marginTop: 1,
  },
});
